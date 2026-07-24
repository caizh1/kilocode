import { isUtf8 } from "node:buffer"

const OSC = "\x1b]6973;"
const BEL = "\x07"
const ST = "\x1b\\"
const MARKER_BYTES = 96 * 1024
const INPUT_BYTES = 64 * 1024
const INPUT_IDS = 256
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AgentConsoleShellState =
  | { status: "starting" }
  | { status: "ready"; cwd: string }
  | { status: "busy"; cwd: string }
  | { status: "recovering"; cwd?: string }
  | { status: "error"; message: string }

export type AgentConsoleShellActivity =
  | { kind: "idle"; data: string }
  | { kind: "begin"; cwd: string }
  | { kind: "data"; data: string }
  | { kind: "end"; cwd: string; exitCode: number }

export type AgentConsoleShellInput = {
  kind: "input"
  requestId: string
  input: string
  command: boolean
}

export type AgentConsoleShellApplied = {
  kind: "applied"
  requestId: string
  route: "agent" | "shell"
}

function decode(value: string): string | undefined {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return
  const bytes = Buffer.from(value, "base64")
  if (bytes.toString("base64") !== value || !isUtf8(bytes)) return
  return bytes.toString("utf8")
}

function closer(value: string, from: number) {
  const bel = value.indexOf(BEL, from)
  const st = value.indexOf(ST, from)
  if (bel === -1 && st === -1) return
  if (st === -1 || (bel !== -1 && bel < st)) return { index: bel, length: 1 }
  return { index: st, length: 2 }
}

function overlap(value: string, prefix: string) {
  const max = Math.min(value.length, prefix.length - 1)
  for (let size = max; size > 0; size--) {
    if (value.endsWith(prefix.slice(0, size))) return size
  }
  return 0
}

export class AgentConsoleIntegration {
  private readonly prefix: string
  private buffer = ""
  private current: AgentConsoleShellState = { status: "starting" }
  private readonly ids = new Set<string>()
  private readonly order: string[] = []
  private readonly acks = new Set<string>()
  private readonly ackorder: string[] = []

  constructor(
    token: string,
    private readonly update: (state: AgentConsoleShellState) => void,
    private readonly activity: (event: AgentConsoleShellActivity) => void = () => undefined,
    private readonly input: (event: AgentConsoleShellInput) => void = () => undefined,
    private readonly arm: (cwd: string) => void = () => undefined,
    private readonly applied: (event: AgentConsoleShellApplied) => void = () => undefined,
  ) {
    this.prefix = `${OSC}${token};`
  }

  state(): AgentConsoleShellState {
    return this.current
  }

  push(value: string): void {
    this.buffer += value
    while (this.buffer) {
      const start = this.buffer.indexOf(this.prefix)
      if (start === -1) {
        const keep = overlap(this.buffer, this.prefix)
        this.output(this.buffer.slice(0, this.buffer.length - keep))
        this.buffer = this.buffer.slice(this.buffer.length - keep)
        return
      }
      this.output(this.buffer.slice(0, start))
      const from = start + this.prefix.length
      const end = closer(this.buffer, from)
      if (!end) {
        if (this.buffer.length > MARKER_BYTES) {
          this.output(this.buffer.slice(0, start + 1))
          this.buffer = this.buffer.slice(start + 1)
          continue
        }
        this.buffer = this.buffer.slice(start)
        return
      }
      this.marker(this.buffer.slice(from, end.index))
      this.buffer = this.buffer.slice(end.index + end.length)
    }
  }

  fail(message: string): void {
    if (this.current.status !== "starting") return
    this.set({ status: "error", message })
  }

  recover(): void {
    const cwd = this.current.status === "ready" || this.current.status === "busy" ? this.current.cwd : undefined
    this.set({ status: "recovering", cwd })
  }

  error(message: string): void {
    this.set({ status: "error", message })
  }

  private marker(value: string): void {
    const [kind, first, second, third] = value.split(";")
    if (kind === "ready") {
      const cwd = first ? decode(first) : undefined
      if (cwd !== undefined) this.set({ status: "ready", cwd })
      return
    }
    if (kind === "prompt") {
      const cwd = first ? decode(first) : undefined
      if (cwd !== undefined) this.arm(cwd)
      return
    }
    if (kind === "resync") return
    if (kind === "begin") {
      const cwd = first ? decode(first) : undefined
      if (cwd !== undefined) {
        this.set({ status: "busy", cwd })
        this.activity({ kind: "begin", cwd })
      }
      return
    }
    if (kind === "input") {
      this.inputMarker(first, second, third)
      return
    }
    if (kind === "applied") {
      this.appliedMarker(first, second)
      return
    }
    if (kind !== "end") return
    const code = Number(first)
    const cwd = second ? decode(second) : undefined
    if (cwd !== undefined && Number.isSafeInteger(code) && code >= 0 && code <= 255) {
      this.activity({ kind: "end", cwd, exitCode: code })
      this.arm(cwd)
    }
  }

  private inputMarker(requestId?: string, known?: string, payload?: string): void {
    if (!requestId || !UUID.test(requestId) || (known !== "0" && known !== "1") || payload === undefined) return
    if (payload.length > Math.ceil((INPUT_BYTES * 4) / 3) + 4 || this.ids.has(requestId)) return
    const decoded = decode(payload)
    if (decoded === undefined || Buffer.byteLength(decoded) > INPUT_BYTES) return
    this.ids.add(requestId)
    this.order.push(requestId)
    if (this.order.length > INPUT_IDS) {
      const old = this.order.shift()
      if (old) this.ids.delete(old)
    }
    this.input({ kind: "input", requestId, command: known === "1", input: decoded })
  }

  private appliedMarker(requestId?: string, route?: string): void {
    if (!requestId || !UUID.test(requestId) || (route !== "agent" && route !== "shell")) return
    const key = `${requestId}/${route}`
    if (this.acks.has(key)) return
    this.acks.add(key)
    this.ackorder.push(key)
    if (this.ackorder.length > INPUT_IDS) {
      const old = this.ackorder.shift()
      if (old) this.acks.delete(old)
    }
    this.applied({ kind: "applied", requestId, route })
  }

  private output(data: string): void {
    if (!data) return
    this.activity({ kind: this.current.status === "busy" ? "data" : "idle", data })
  }

  private set(state: AgentConsoleShellState): void {
    this.current = state
    this.update(state)
  }
}
