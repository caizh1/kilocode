import type { KiloClient } from "@kilocode/sdk/v2/client"
import { randomBytes } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "node:path"
import WebSocket, { type RawData } from "ws"
import { TerminalManager } from "../agent-manager/terminal-manager"
import type { TerminalFont } from "../agent-manager/types"
import type {
  AgentConsoleActivityEvent,
  AgentConsoleInMessage,
  AgentConsoleOutMessage,
  AgentConsoleRunSource,
} from "./types"
import { routeAgentConsoleInput } from "./input"
import { AgentConsoleIntegration, type AgentConsoleShellActivity, type AgentConsoleShellState } from "./integration"

const ACTIVITY_BYTES = 2 * 1024 * 1024
const ACTIVITY_EVENTS = 5000
const EXPECT_TIMEOUT_MS = 30_000
const RECOVERY_PROBE_MS = 400
const RECOVERY_TIMEOUT_MS = 5_000

interface Config {
  baseUrl: string
  password: string
}

interface Deps {
  client(): KiloClient
  ready(root: string): Promise<void>
  config(): Config | undefined
  root(): string | undefined
  canonical?(value: string): Promise<string>
  rcfile(): string
  font(): TerminalFont
  post(message: AgentConsoleOutMessage): void
  log(message: string): void
}

interface Run {
  runId: string
  source: AgentConsoleRunSource
  command: string
  callId?: string
  timer?: ReturnType<typeof setTimeout>
}

interface Activity {
  seq: number
  bytes: number
  events: AgentConsoleActivityEvent[]
  expected?: Run
  active?: Run
}

interface Recovery {
  probe: ReturnType<typeof setTimeout>
  timeout: ReturnType<typeof setTimeout>
}

export class AgentConsoleTerminal {
  private readonly manager: TerminalManager
  private readonly urls = new Map<string, string>()
  private readonly sockets = new Map<string, WebSocket>()
  private readonly cursors = new Map<string, number>()
  private readonly integrations = new Map<
    string,
    { parser: AgentConsoleIntegration; timer: ReturnType<typeof setTimeout> }
  >()
  private readonly activities = new Map<string, Activity>()
  private readonly recoveries = new Map<string, Recovery>()
  private current: string | undefined
  private pending: Promise<void> | undefined

  constructor(private readonly deps: Deps) {
    this.manager = new TerminalManager({
      getClient: deps.client,
      buildWsUrl: (id, dir) => this.url(id, dir),
      log: (message) => deps.log(String(message)),
    })
  }

  handle(message: AgentConsoleInMessage): boolean {
    if (message.type === "agentConsole.terminal.create") {
      void this.create()
      return true
    }
    if (message.type === "agentConsole.shell.restart") {
      void this.restart()
      return true
    }
    if (message.type === "agentConsole.terminal.connect") {
      this.connect(message.terminalId)
      return true
    }
    if (message.type === "agentConsole.terminal.write") {
      this.write(message.terminalId, message.data)
      return true
    }
    if (message.type === "agentConsole.terminal.recover") {
      this.recover(message.terminalId)
      return true
    }
    if (message.type === "agentConsole.terminal.disconnect") {
      this.disconnect(message.terminalId)
      return true
    }
    if (message.type === "agentConsole.terminal.close") {
      void this.close(message.terminalId)
      return true
    }
    if (message.type === "agentConsole.terminal.resize") {
      void this.manager.resize(message.terminalId, message.cols, message.rows)
      return true
    }
    if (message.type === "agentConsole.terminal.diagnostic") {
      const detail = message.detail ? ` ${message.detail.slice(0, 500)}` : ""
      this.deps.log(`Webview ${message.event}: terminal=${message.terminalId}${detail}`)
      return true
    }
    if (message.type === "agentConsole.input.route") {
      void this.route(message.requestId, message.input)
      return true
    }
    if (message.type === "agentConsole.command.expect") {
      this.expect(message.terminalId, {
        runId: message.runId,
        source: message.source,
        command: message.command,
        callId: message.callId,
      })
      return true
    }
    if (message.type === "agentConsole.command.cancel") {
      this.cancel(message.terminalId, message.runId)
      return true
    }
    return message.type === "agentConsole.session.new" || message.type === "agentConsole.mode.changed"
  }

  dispose(): Promise<void> {
    this.current = undefined
    for (const id of this.sockets.keys()) this.disconnect(id)
    this.urls.clear()
    this.cursors.clear()
    for (const item of this.integrations.values()) clearTimeout(item.timer)
    this.integrations.clear()
    for (const item of this.activities.values()) this.clear(item)
    this.activities.clear()
    for (const id of this.recoveries.keys()) this.finishRecovery(id, false, "Shell disposed during recovery")
    return this.manager.dispose()
  }

  async bind(sessionID: string, directory: string): Promise<void> {
    const id = this.current
    if (!id) throw new Error("Agent Console shell has not been created")
    const root = this.deps.root()
    if (!root) throw new Error("Agent Console session directory does not match the persistent shell")
    const [shell, session] = await Promise.all([this.canonical(root), this.canonical(directory)])
    if (shell !== session) {
      throw new Error("Agent Console session directory does not match the persistent shell")
    }
    const state = this.integrations.get(id)?.parser.state()
    if (!state || state.status !== "ready") {
      throw new Error(state?.status === "error" ? state.message : "Agent Console shell integration is not ready")
    }
    await this.manager.associate(id, sessionID)
    this.deps.log(`Session bound: terminal=${id} session=${sessionID} cwd=${state.cwd}`)
  }

  private create(): Promise<void> {
    if (this.current) return Promise.resolve()
    if (this.pending) return this.pending
    const root = this.deps.root()
    if (!root) {
      this.deps.post({ type: "agentConsole.terminal.error", message: "Open a folder before creating a shell." })
      return Promise.resolve()
    }
    const token = randomBytes(16).toString("hex")
    this.pending = this.deps
      .ready(root)
      .then(() => {
        const config = this.deps.config()
        if (!config) throw new Error("Not connected to CLI backend")
        const backend = new URL(config.baseUrl).origin
        this.deps.log(`Shell create requested: cwd=${root} backend=${backend}`)
        return this.manager.create({
          worktreeId: null,
          cwd: root,
          title: "ChipMate Agent Console",
          command: "/usr/bin/env",
          args: ["bash", "--rcfile", this.deps.rcfile(), "-i"],
          env: {
            KILO_AGENT_CONSOLE: "1",
            KILO_AGENT_CONSOLE_TOKEN: token,
          },
        })
      })
      .then((created) => {
        this.current = created.terminalId
        this.urls.set(created.terminalId, created.wsUrl)
        this.cursors.set(created.terminalId, 0)
        this.activities.set(created.terminalId, { seq: 0, bytes: 0, events: [] })
        const parser = new AgentConsoleIntegration(
          token,
          (state) => this.integration(created.terminalId, state),
          (event) => this.activity(created.terminalId, event),
        )
        const timer = setTimeout(() => {
          parser.fail("Bash integration did not become ready within 10 seconds")
        }, 10_000)
        this.integrations.set(created.terminalId, { parser, timer })
        this.deps.post({
          type: "agentConsole.terminal.created",
          terminalId: created.terminalId,
          title: "Shell",
          font: this.deps.font(),
        })
        this.deps.post({
          type: "agentConsole.terminal.state",
          terminalId: created.terminalId,
          state: { status: "starting" },
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.deps.log(`Shell create failed: ${message}`)
        this.deps.post({ type: "agentConsole.terminal.error", message })
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }

  private async close(id: string): Promise<void> {
    this.finishRecovery(id, false, "Shell closed during recovery")
    this.disconnect(id)
    this.urls.delete(id)
    this.cursors.delete(id)
    const integration = this.integrations.get(id)
    if (integration) clearTimeout(integration.timer)
    this.integrations.delete(id)
    const activity = this.activities.get(id)
    if (activity) this.clear(activity)
    this.activities.delete(id)
    await this.manager.close(id)
    if (this.current === id) this.current = undefined
    this.deps.post({ type: "agentConsole.terminal.closed", terminalId: id })
  }

  private async restart(): Promise<void> {
    const id = this.current
    if (id) await this.close(id)
    await this.create()
  }

  private async route(requestId: string, input: string): Promise<void> {
    const routed = await routeAgentConsoleInput(input)
    this.deps.post({ type: "agentConsole.input.routed", requestId, ...routed })
  }

  private connect(id: string): void {
    const url = this.urls.get(id)
    if (!url) {
      this.fail(id, "Shell terminal is no longer available")
      return
    }
    this.snapshot(id)
    this.disconnect(id)
    const target = new URL(url)
    target.searchParams.set("cursor", String(this.cursors.get(id) ?? 0))
    const endpoint = this.endpoint(target.toString())
    this.deps.log(`Extension relay connecting: terminal=${id} endpoint=${endpoint}`)
    const socket = new WebSocket(target, { handshakeTimeout: 10_000 })
    this.sockets.set(id, socket)
    socket.on("open", () => {
      if (this.sockets.get(id) !== socket) return
      this.deps.log(`Extension relay open: terminal=${id} endpoint=${endpoint}`)
      this.deps.post({ type: "agentConsole.terminal.connected", terminalId: id })
    })
    socket.on("message", (data, binary) => {
      if (this.sockets.get(id) !== socket) return
      const frame = this.output(data, binary)
      if (frame.cursor !== undefined) this.cursors.set(id, frame.cursor)
      if (frame.data === undefined) return
      this.cursors.set(id, (this.cursors.get(id) ?? 0) + frame.data.length)
      this.integrations.get(id)?.parser.push(frame.data)
      this.deps.post({ type: "agentConsole.terminal.data", terminalId: id, data: frame.data })
    })
    socket.on("error", (err) => {
      if (this.sockets.get(id) !== socket) return
      const message = this.message(err)
      this.deps.log(`Extension relay error: terminal=${id} endpoint=${endpoint} error=${message}`)
      this.deps.post({ type: "agentConsole.terminal.relayError", terminalId: id, message })
    })
    socket.on("close", (code, reason) => {
      if (this.sockets.get(id) !== socket) return
      this.sockets.delete(id)
      const message = reason.toString() || "none"
      const activity = this.activities.get(id)
      if (activity) this.clearExpected(activity)
      this.deps.log(`Extension relay close: terminal=${id} code=${code} reason=${message}`)
      this.deps.post({
        type: "agentConsole.terminal.disconnected",
        terminalId: id,
        code,
        reason: message,
      })
    })
  }

  private write(id: string, data: string): void {
    const socket = this.sockets.get(id)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.fail(id, `Shell relay is not connected (readyState=${socket?.readyState ?? "missing"})`)
      return
    }
    socket.send(data, (err) => {
      if (!err || this.sockets.get(id) !== socket) return
      this.fail(id, err.message)
    })
  }

  private recover(id: string): void {
    if (this.recoveries.has(id)) return
    const socket = this.sockets.get(id)
    const parser = this.integrations.get(id)?.parser
    if (!socket || socket.readyState !== WebSocket.OPEN || !parser) {
      const message = "Shell relay is not connected; restart the Shell to recover"
      this.deps.log(`Recovery unavailable: terminal=${id}`)
      this.deps.post({ type: "agentConsole.terminal.recovery", terminalId: id, success: false, message })
      return
    }
    const probe = setTimeout(() => {
      if (!this.recoveries.has(id)) return
      this.deps.log(`Recovery probe: terminal=${id}`)
      this.write(id, "__chipmate_resync\r")
    }, RECOVERY_PROBE_MS)
    const timeout = setTimeout(() => {
      if (!this.recoveries.has(id)) return
      const message = "Shell did not return to a clean prompt; restart the Shell to continue"
      parser.error(message)
      this.finishRecovery(id, false, message)
    }, RECOVERY_TIMEOUT_MS)
    this.recoveries.set(id, { probe, timeout })
    parser.recover()
    this.deps.log(`Recovery requested: terminal=${id}`)
    this.write(id, "\x03")
  }

  private finishRecovery(id: string, success: boolean, message?: string): void {
    const recovery = this.recoveries.get(id)
    if (!recovery) return
    clearTimeout(recovery.probe)
    clearTimeout(recovery.timeout)
    this.recoveries.delete(id)
    this.deps.log(`Recovery ${success ? "completed" : "failed"}: terminal=${id}${message ? ` reason=${message}` : ""}`)
    this.deps.post({ type: "agentConsole.terminal.recovery", terminalId: id, success, message })
  }

  private disconnect(id: string): void {
    this.finishRecovery(id, false, "Shell relay disconnected during recovery")
    const socket = this.sockets.get(id)
    if (!socket) return
    this.sockets.delete(id)
    socket.close()
  }

  private fail(id: string, message: string): void {
    const activity = this.activities.get(id)
    if (activity) this.clearExpected(activity)
    this.deps.log(`Extension relay unavailable: terminal=${id} error=${message}`)
    this.deps.post({ type: "agentConsole.terminal.relayError", terminalId: id, message })
  }

  private output(data: RawData, binary: boolean): { data?: string; cursor?: number } {
    const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data
    if (!binary || bytes[0] !== 0x00) return { data: bytes.toString("utf8") }
    try {
      const parsed = JSON.parse(bytes.subarray(1).toString("utf8")) as { cursor?: unknown }
      return typeof parsed.cursor === "number" && Number.isSafeInteger(parsed.cursor) ? { cursor: parsed.cursor } : {}
    } catch (err) {
      this.deps.log(`Invalid PTY control frame: ${this.message(err)}`)
      return {}
    }
  }

  private integration(id: string, state: AgentConsoleShellState): void {
    const item = this.integrations.get(id)
    if (item && state.status !== "starting") clearTimeout(item.timer)
    const detail = state.status === "ready" || state.status === "busy" ? ` cwd=${state.cwd}` : ""
    this.deps.log(`Bash integration ${state.status}: terminal=${id}${detail}`)
    this.deps.post({ type: "agentConsole.terminal.state", terminalId: id, state })
    if (state.status === "ready" && this.recoveries.has(id)) this.finishRecovery(id, true)
  }

  private activity(id: string, input: AgentConsoleShellActivity): void {
    const state = this.activities.get(id)
    if (!state) return
    const run = input.kind === "begin" ? this.begin(state) : state.active
    const event: AgentConsoleActivityEvent = {
      seq: ++state.seq,
      time: Date.now(),
      kind: input.kind,
      data: input.kind === "idle" || input.kind === "data" ? input.data : undefined,
      cwd: input.kind === "begin" || input.kind === "end" ? input.cwd : undefined,
      exitCode: input.kind === "end" ? input.exitCode : undefined,
      runId: run?.runId,
      source: run?.source,
      callId: run?.callId,
      command: run?.command,
    }
    this.record(state, event)
    this.deps.post({ type: "agentConsole.terminal.activity", terminalId: id, event })
    if (input.kind === "end") state.active = undefined
  }

  private begin(state: Activity): Run | undefined {
    const run = state.expected
    if (!run) return
    this.clearExpected(state)
    state.active = { ...run, timer: undefined }
    return state.active
  }

  private expect(id: string, run: Run): void {
    const state = this.activities.get(id)
    const shell = this.integrations.get(id)?.parser.state()
    if (!state || !shell || shell.status !== "ready") {
      this.deps.log(`Run expectation ignored: terminal=${id} run=${run.runId} shell=${shell?.status ?? "missing"}`)
      return
    }
    this.clearExpected(state)
    const timer = setTimeout(() => {
      if (state.expected?.runId !== run.runId) return
      state.expected = undefined
      this.deps.log(`Run expectation expired: terminal=${id} run=${run.runId}`)
    }, EXPECT_TIMEOUT_MS)
    state.expected = { ...run, timer }
    this.deps.log(`Run expected: terminal=${id} run=${run.runId} source=${run.source}`)
  }

  private cancel(id: string, runId: string): void {
    const state = this.activities.get(id)
    if (!state || state.expected?.runId !== runId) return
    this.clearExpected(state)
    this.deps.log(`Run expectation cancelled: terminal=${id} run=${runId}`)
  }

  private snapshot(id: string): void {
    const state = this.activities.get(id)
    if (!state) return
    this.deps.post({
      type: "agentConsole.terminal.activitySnapshot",
      terminalId: id,
      events: state.events.slice(),
      throughSeq: state.seq,
    })
  }

  private record(state: Activity, event: AgentConsoleActivityEvent): void {
    const bytes = Buffer.byteLength(event.data ?? "") + 128
    state.events.push(event)
    state.bytes += bytes
    while (state.events.length > ACTIVITY_EVENTS || state.bytes > ACTIVITY_BYTES) {
      const first = state.events.shift()
      if (!first) break
      state.bytes -= Buffer.byteLength(first.data ?? "") + 128
    }
  }

  private clearExpected(state: Activity): void {
    if (state.expected?.timer) clearTimeout(state.expected.timer)
    state.expected = undefined
  }

  private clear(state: Activity): void {
    this.clearExpected(state)
    if (state.active?.timer) clearTimeout(state.active.timer)
    state.active = undefined
  }

  private endpoint(value: string): string {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  }

  private message(err: unknown): string {
    if (err instanceof Error) return err.message
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string") return err.message
    return String(err)
  }

  private canonical(value: string): Promise<string> {
    const full = path.normalize(path.resolve(value))
    const resolve = this.deps.canonical ?? realpath
    return Promise.resolve()
      .then(() => resolve(full))
      .then((result) => path.normalize(path.resolve(result)))
      .catch(() => full)
  }

  private url(id: string, dir: string): string {
    const config = this.deps.config()
    if (!config) throw new Error("Not connected to CLI backend")
    const base = config.baseUrl.replace(/^http/i, "ws")
    const token = Buffer.from(`kilo:${config.password}`).toString("base64")
    return `${base}/pty/${encodeURIComponent(id)}/connect?directory=${encodeURIComponent(dir)}&auth_token=${encodeURIComponent(token)}`
  }
}
