const OSC = "\x1b]6973;"
const BEL = "\x07"
const ST = "\x1b\\"

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

function decode(value: string): string | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return
  return Buffer.from(value, "base64").toString("utf8")
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

  constructor(
    token: string,
    private readonly update: (state: AgentConsoleShellState) => void,
    private readonly activity: (event: AgentConsoleShellActivity) => void = () => undefined,
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
    const [kind, first, second] = value.split(";")
    if (kind === "ready" || kind === "resync") {
      const cwd = first ? decode(first) : undefined
      if (cwd !== undefined) this.set({ status: "ready", cwd })
      return
    }
    if (kind === "begin") {
      const cwd = first ? decode(first) : undefined
      if (cwd !== undefined) {
        this.set({ status: "busy", cwd })
        this.activity({ kind: "begin", cwd })
      }
      return
    }
    if (kind !== "end") return
    const code = Number(first)
    const cwd = second ? decode(second) : undefined
    if (cwd !== undefined && Number.isSafeInteger(code) && code >= 0 && code <= 255) {
      this.set({ status: "ready", cwd })
      this.activity({ kind: "end", cwd, exitCode: code })
    }
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
