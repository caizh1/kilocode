import type { KiloClient } from "@kilocode/sdk/v2/client"
import { randomBytes } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "node:path"
import WebSocket, { type RawData } from "ws"
import { ptyError, TerminalManager } from "../agent-manager/terminal-manager"
import type { TerminalFont } from "../agent-manager/types"
import type {
  AgentConsoleActivityEvent,
  AgentConsoleInMessage,
  AgentConsoleMode,
  AgentConsoleOutMessage,
  AgentConsoleRunSource,
} from "./types"
import { routeAgentConsoleInput } from "./input"
import {
  AgentConsoleIntegration,
  type AgentConsoleShellApplied,
  type AgentConsoleShellActivity,
  type AgentConsoleShellInput,
  type AgentConsoleShellState,
} from "./integration"

const ACTIVITY_BYTES = 2 * 1024 * 1024
const ACTIVITY_EVENTS = 5000
const EXPECT_TIMEOUT_MS = 30_000
const RECOVERY_PROBE_MS = 400
const RECOVERY_TIMEOUT_MS = 5_000
const CAPTURE_TIMEOUT_MS = 2_000
const APPLY_TIMEOUT_MS = 2_000
const ARM_INTERVAL_MS = 50
const ARM_TIMEOUT_MS = 2_000
const EXECUTE_KEY = "\x18\x05"
const AGENT_KEY = "\x18\x01"
const SHELL_KEY = "\x18\x08"
const CLEAR_KEY = "\x18\x15"
const AGENT_APPLY_KEY = "\x18\x19"
const SHELL_APPLY_KEY = "\x18\x0e"
const CAPTURE_RESET_KEY = "\x18\x12"
const CAPTURE_APPLY_KEY = "\x18\x10"
const COMPLETED_CAPTURES = 256
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  psfile?(): string
  platform?: NodeJS.Platform
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

interface Capture {
  requestId: string
  timer: ReturnType<typeof setTimeout>
}

interface Application {
  requestId: string
  input: string
  routed: { route: "agent" | "shell"; input: string }
  timer: ReturnType<typeof setTimeout>
}

interface Arm {
  pulse: ReturnType<typeof setInterval>
  timeout: ReturnType<typeof setTimeout>
}

type ShellItem = {
  path: string
  name: string
  acceptable: boolean
}

type Startup = {
  command: string
  args: string[]
  name: "Bash" | "PowerShell"
}

const ROUTE_TIMEOUT = Symbol("route-timeout")

function shellname(value: string): string {
  return path.win32
    .basename(value)
    .replace(/\.exe$/i, "")
    .toLowerCase()
}

function capture(id: string): string {
  const payload = id.replaceAll("-", "")
  return `${CAPTURE_RESET_KEY}${Array.from(payload, (digit) => `\x18${digit}`).join("")}${CAPTURE_APPLY_KEY}`
}

export function powershell(items: readonly ShellItem[]): ShellItem | undefined {
  for (const name of ["pwsh", "powershell"]) {
    const item = items.find(
      (candidate) =>
        candidate.acceptable && [candidate.name, candidate.path].some((value) => shellname(value) === name),
    )
    if (item) return item
  }
  return undefined
}

export class AgentConsoleTerminal {
  private readonly manager: TerminalManager
  private readonly urls = new Map<string, string>()
  private readonly sockets = new Map<string, WebSocket>()
  private readonly cursors = new Map<string, number>()
  private readonly integrations = new Map<
    string,
    { parser: AgentConsoleIntegration; timer: ReturnType<typeof setTimeout>; name: Startup["name"] }
  >()
  private readonly activities = new Map<string, Activity>()
  private readonly recoveries = new Map<string, Recovery>()
  private readonly captures = new Map<string, Capture>()
  private readonly applications = new Map<string, Application>()
  private readonly arms = new Map<string, Arm>()
  private readonly completed = new Map<string, string[]>()
  private mode: AgentConsoleMode = "agent"
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
    if (message.type === "agentConsole.input.capture") {
      this.capture(message.terminalId, message.requestId)
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
    if (message.type === "agentConsole.mode.changed") {
      this.mode = message.mode
      const id = this.current
      if (id) {
        if (this.arms.has(id)) this.writeMode(id)
        else this.syncMode(id)
      }
      return true
    }
    return message.type === "agentConsole.session.new"
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
    for (const id of this.captures.keys()) this.finishCapture(id, "Shell disposed while capturing input")
    for (const id of this.applications.keys()) this.finishApplication(id, "Shell disposed while applying input")
    for (const id of this.arms.keys()) this.finishArm(id)
    this.completed.clear()
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
    if (this.current) {
      this.replay(this.current)
      return Promise.resolve()
    }
    if (this.pending) {
      return this.pending.then(() => {
        if (this.current) this.replay(this.current)
      })
    }
    const root = this.deps.root()
    if (!root) {
      this.deps.post({ type: "agentConsole.terminal.error", message: "Open a folder before creating a shell." })
      return Promise.resolve()
    }
    const token = randomBytes(16).toString("hex")
    this.pending = this.deps
      .ready(root)
      .then(async () => {
        const config = this.deps.config()
        if (!config) throw new Error("Not connected to CLI backend")
        const backend = new URL(config.baseUrl).origin
        this.deps.log(`Shell create requested: cwd=${root} backend=${backend}`)
        const start = await this.startup(root)
        const created = await this.manager.create({
          worktreeId: null,
          cwd: root,
          title: "ChipMate Agent Console",
          command: start.command,
          args: start.args,
          env: {
            KILO_AGENT_CONSOLE: "1",
            KILO_AGENT_CONSOLE_TOKEN: token,
          },
        })
        return { created, start }
      })
      .then(({ created, start }) => {
        this.current = created.terminalId
        this.urls.set(created.terminalId, created.wsUrl)
        this.cursors.set(created.terminalId, 0)
        this.activities.set(created.terminalId, { seq: 0, bytes: 0, events: [] })
        const parser = new AgentConsoleIntegration(
          token,
          (state) => this.integration(created.terminalId, state),
          (event) => this.activity(created.terminalId, event),
          (event) => void this.route(created.terminalId, event),
          (cwd) => this.arm(created.terminalId, cwd),
          (event) => this.applied(created.terminalId, event),
        )
        const timer = setTimeout(() => {
          parser.fail(`${start.name} integration did not become ready within 10 seconds`)
        }, 10_000)
        this.integrations.set(created.terminalId, { parser, timer, name: start.name })
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
        const message = ptyError(err)
        this.deps.log(`Shell create failed: ${message}`)
        this.deps.post({ type: "agentConsole.terminal.error", message })
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }

  private replay(id: string): void {
    const state = this.integrations.get(id)?.parser.state() ?? { status: "starting" as const }
    this.deps.log(`Shell state replayed: terminal=${id} state=${state.status}`)
    this.deps.post({
      type: "agentConsole.terminal.created",
      terminalId: id,
      title: "Shell",
      font: this.deps.font(),
    })
    this.deps.post({ type: "agentConsole.terminal.state", terminalId: id, state })
    this.snapshot(id)
  }

  private async startup(root: string): Promise<Startup> {
    if ((this.deps.platform ?? process.platform) !== "win32") {
      return {
        command: "/usr/bin/env",
        args: ["bash", "--rcfile", this.deps.rcfile(), "-i"],
        name: "Bash",
      }
    }
    const { data, error } = await this.deps.client().pty.shells({ directory: root })
    if (error) throw new Error(`Failed to detect PowerShell: ${ptyError(error)}`)
    const shell = powershell(data ?? [])
    if (!shell) {
      throw new Error(
        "Agent Console requires PowerShell 7 (pwsh) or Windows PowerShell 5.1. Install PowerShell and restart VS Code.",
      )
    }
    const script = this.deps.psfile?.()
    if (!script) throw new Error("Agent Console PowerShell integration script is unavailable")
    return {
      command: shell.path,
      args: ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", script],
      name: "PowerShell",
    }
  }

  private async close(id: string): Promise<void> {
    this.finishRecovery(id, false, "Shell closed during recovery")
    this.finishCapture(id, "Shell closed while capturing input")
    this.finishApplication(id, "Shell closed while applying input")
    this.disconnect(id)
    this.urls.delete(id)
    this.cursors.delete(id)
    const integration = this.integrations.get(id)
    if (integration) clearTimeout(integration.timer)
    this.integrations.delete(id)
    this.finishArm(id)
    const activity = this.activities.get(id)
    if (activity) this.clear(activity)
    this.activities.delete(id)
    this.completed.delete(id)
    await this.manager.close(id)
    if (this.current === id) this.current = undefined
    this.deps.post({ type: "agentConsole.terminal.closed", terminalId: id })
  }

  private async restart(): Promise<void> {
    const id = this.current
    if (id) await this.close(id)
    await this.create()
  }

  private capture(id: string, requestId: string): void {
    if (!UUID.test(requestId)) {
      this.inputError(requestId, "Invalid input capture request", "capture")
      return
    }
    if (this.wasCompleted(id, requestId)) {
      this.inputError(requestId, "Input capture request was already completed", "capture")
      return
    }
    const shell = this.integrations.get(id)?.parser.state()
    const socket = this.sockets.get(id)
    if (!shell || shell.status !== "ready" || !socket || socket.readyState !== WebSocket.OPEN) {
      this.inputError(
        requestId,
        shell?.status === "error" ? shell.message : "Shell is not ready to capture input",
        "capture",
      )
      return
    }
    if (this.captures.has(id)) {
      this.inputError(requestId, "Another input capture is already in progress", "capture")
      return
    }
    const timer = setTimeout(() => {
      const capture = this.captures.get(id)
      if (capture?.requestId !== requestId) return
      this.captures.delete(id)
      this.deps.log(`Input capture timed out: terminal=${id} request=${requestId}`)
      this.inputError(requestId, "输入分流超时，当前 Shell 输入未被清除，请重试。", "capture")
    }, CAPTURE_TIMEOUT_MS)
    this.captures.set(id, { requestId, timer })
    this.deps.log(`Input capture requested: terminal=${id} request=${requestId}`)
    socket.send(capture(requestId), (err) => {
      if (!err) return
      const capture = this.captures.get(id)
      if (capture?.requestId !== requestId) return
      clearTimeout(capture.timer)
      this.captures.delete(id)
      this.inputError(requestId, err.message, "capture")
      this.fail(id, err.message)
    })
  }

  private async route(id: string, event: AgentConsoleShellInput): Promise<void> {
    const capture = this.captures.get(id)
    if (!capture) {
      this.deps.log(`Late input capture ignored: terminal=${id} request=${event.requestId}`)
      return
    }
    if (capture.requestId !== event.requestId) {
      this.deps.log(
        `Mismatched input capture ignored: terminal=${id} expected=${capture.requestId} received=${event.requestId}`,
      )
      return
    }
    if (this.wasCompleted(id, capture.requestId)) return
    clearTimeout(capture.timer)
    this.captures.delete(id)
    this.remember(id, capture.requestId)
    const input = event
    const pending = routeAgentConsoleInput(
      input.input,
      process.env,
      this.deps.platform ?? process.platform,
      input.command,
    ).then(
      (value) => ({ kind: "route" as const, value }),
      (err: unknown) => ({ kind: "error" as const, message: this.message(err) }),
    )
    const result = await Promise.race([
      pending,
      new Promise<typeof ROUTE_TIMEOUT>((resolve) => setTimeout(() => resolve(ROUTE_TIMEOUT), CAPTURE_TIMEOUT_MS)),
    ])
    if (result === ROUTE_TIMEOUT) {
      this.inputError(input.requestId, "输入分流超时，当前 Shell 输入未被清除，请重试。", "route", input.input)
      return
    }
    if (result.kind === "error") {
      this.inputError(input.requestId, result.message, "route", input.input)
      return
    }
    const routed = result.value
    const shell = this.integrations.get(id)?.parser.state()
    const socket = this.sockets.get(id)
    if (!shell || shell.status !== "ready" || !socket || socket.readyState !== WebSocket.OPEN) {
      this.inputError(
        input.requestId,
        "Shell changed state while routing input; the current line was not submitted",
        "route",
        input.input,
      )
      return
    }
    if (routed.route === "agent") {
      this.apply(id, input, routed, `${AGENT_APPLY_KEY}${EXECUTE_KEY}`)
      return
    }
    const line = input.input.trim()
    if (!line) {
      this.apply(id, input, routed, `${SHELL_APPLY_KEY}${EXECUTE_KEY}`)
      return
    }
    const state = this.activities.get(id)
    if (state) {
      this.expect(id, {
        runId: input.requestId,
        source: "direct",
        command: routed.input,
      })
    }
    const forced = line.startsWith("!")
    this.apply(
      id,
      input,
      routed,
      forced ? `${CLEAR_KEY}${routed.input}${SHELL_APPLY_KEY}${EXECUTE_KEY}` : `${SHELL_APPLY_KEY}${EXECUTE_KEY}`,
    )
  }

  private apply(
    id: string,
    event: AgentConsoleShellInput,
    routed: { route: "agent" | "shell"; input: string },
    data: string,
  ): void {
    const socket = this.sockets.get(id)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.inputError(
        event.requestId,
        "Shell relay disconnected before the routed input was applied",
        "route",
        event.input,
      )
      return
    }
    if (this.applications.has(id)) {
      this.inputError(event.requestId, "Another routed input is still being applied", "apply", event.input)
      return
    }
    const timer = setTimeout(() => {
      const application = this.applications.get(id)
      if (application?.requestId !== event.requestId) return
      this.applications.delete(id)
      const state = this.activities.get(id)
      if (state?.expected?.runId === event.requestId) this.clearExpected(state)
      this.deps.log(`Input application timed out: terminal=${id} request=${event.requestId}`)
      this.inputError(
        event.requestId,
        "输入应用超时，Shell 未确认清空或执行，请保留当前输入并重试。",
        "apply",
        event.input,
      )
    }, APPLY_TIMEOUT_MS)
    this.applications.set(id, {
      requestId: event.requestId,
      input: event.input,
      routed,
      timer,
    })
    socket.send(data, (err) => {
      if (!err) return
      const application = this.applications.get(id)
      if (application?.requestId !== event.requestId) return
      this.finishApplication(id, err.message)
      this.fail(id, err.message)
    })
  }

  private applied(id: string, event: AgentConsoleShellApplied): void {
    const application = this.applications.get(id)
    if (!application) {
      this.deps.log(`Late input application ignored: terminal=${id} request=${event.requestId}`)
      return
    }
    if (application.requestId !== event.requestId || application.routed.route !== event.route) {
      this.deps.log(
        `Mismatched input application ignored: terminal=${id} expected=${application.requestId}/${application.routed.route} received=${event.requestId}/${event.route}`,
      )
      return
    }
    clearTimeout(application.timer)
    this.applications.delete(id)
    this.deps.log(`Input application confirmed: terminal=${id} request=${event.requestId} route=${event.route}`)
    this.deps.post({
      type: "agentConsole.input.routed",
      requestId: event.requestId,
      ...application.routed,
    })
  }

  private finishCapture(id: string, message: string): void {
    const capture = this.captures.get(id)
    if (!capture) return
    clearTimeout(capture.timer)
    this.captures.delete(id)
    this.inputError(capture.requestId, message, "capture")
  }

  private finishApplication(id: string, message: string): void {
    const application = this.applications.get(id)
    if (!application) return
    clearTimeout(application.timer)
    this.applications.delete(id)
    const state = this.activities.get(id)
    if (state?.expected?.runId === application.requestId) this.clearExpected(state)
    this.inputError(application.requestId, message, "apply", application.input)
  }

  private inputError(requestId: string, message: string, stage: "capture" | "route" | "apply", input?: string): void {
    this.deps.post({
      type: "agentConsole.input.error",
      requestId,
      message,
      stage,
      recovery: "retain",
      input,
    })
  }

  private wasCompleted(id: string, requestId: string): boolean {
    return this.completed.get(id)?.includes(requestId) === true
  }

  private remember(id: string, requestId: string): void {
    const ids = [...(this.completed.get(id) ?? []), requestId].slice(-COMPLETED_CAPTURES)
    this.completed.set(id, ids)
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
      if (this.arms.has(id)) this.writeMode(id)
      else this.syncMode(id)
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
      this.finishApplication(id, "Shell relay disconnected while applying input")
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
      this.write(id, `__chipmate_resync${EXECUTE_KEY}`)
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
    this.finishCapture(id, "Shell relay disconnected while capturing input")
    this.finishApplication(id, "Shell relay disconnected while applying input")
    const socket = this.sockets.get(id)
    if (!socket) return
    this.sockets.delete(id)
    socket.close()
  }

  private fail(id: string, message: string): void {
    this.finishCapture(id, message)
    this.finishApplication(id, message)
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
    this.deps.log(`${item?.name ?? "Shell"} integration ${state.status}: terminal=${id}${detail}`)
    this.deps.post({ type: "agentConsole.terminal.state", terminalId: id, state })
    if (state.status !== "ready") return
    this.finishArm(id)
    if (this.recoveries.has(id)) this.finishRecovery(id, true)
  }

  private activity(id: string, input: AgentConsoleShellActivity): void {
    const state = this.activities.get(id)
    if (!state) return
    const run = input.kind === "begin" ? this.begin(state) : state.active
    if (input.kind !== "idle" && !run) return
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

  private syncMode(id: string): void {
    const state = this.integrations.get(id)?.parser.state()
    const socket = this.sockets.get(id)
    if (!state || state.status !== "ready" || !socket || socket.readyState !== WebSocket.OPEN) return
    this.writeMode(id)
  }

  private arm(id: string, cwd: string): void {
    if (this.arms.has(id)) {
      this.writeMode(id)
      return
    }
    const socket = this.sockets.get(id)
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    this.deps.log(`Shell input arming: terminal=${id} mode=${this.mode} cwd=${cwd}`)
    const pulse = setInterval(() => this.writeMode(id), ARM_INTERVAL_MS)
    const timeout = setTimeout(() => {
      if (!this.arms.has(id)) return
      this.finishArm(id)
      const message = "Shell input bindings did not become ready within 2 seconds"
      this.deps.log(`Shell input arming failed: terminal=${id} cwd=${cwd}`)
      this.integrations.get(id)?.parser.error(message)
    }, ARM_TIMEOUT_MS)
    this.arms.set(id, { pulse, timeout })
    this.writeMode(id)
  }

  private writeMode(id: string): void {
    const socket = this.sockets.get(id)
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    this.write(id, this.mode === "agent" ? AGENT_KEY : SHELL_KEY)
  }

  private finishArm(id: string): void {
    const arm = this.arms.get(id)
    if (!arm) return
    clearInterval(arm.pulse)
    clearTimeout(arm.timeout)
    this.arms.delete(id)
  }
}
