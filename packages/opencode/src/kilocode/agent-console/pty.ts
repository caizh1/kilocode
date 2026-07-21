import path from "node:path"
import stripAnsi from "strip-ansi"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "agent-console-pty" })
const OSC = "\x1b]6973;"
const BEL = "\x07"
const ST = "\x1b\\"
const LIMIT = 2 * 1024 * 1024

export const ENV_ENABLED = "KILO_AGENT_CONSOLE"
export const ENV_TOKEN = "KILO_AGENT_CONSOLE_TOKEN"
export const TITLE = "ChipMate Agent Console"

type Marker = "ready" | "begin" | "end" | "resync"

type Result = {
  output: string
  exitCode: number
  cwd: string
  bytes: number
  truncated: boolean
}

type Active = {
  started: number
  last: number
  chunks: Buffer[]
  bytes: number
  kept: number
  truncated: boolean
  done(result: Result | Error): void
  promise: Promise<Result | Error>
}

type Slot = {
  directory: string
  ptyID: string
  token: string
  prefix: string
  generation: number
  sessionID?: string
  cwd?: string
  ready: boolean
  busy: boolean
  closed: boolean
  buffer: string
  active?: Active
  write(data: string): Promise<void>
  disconnect?: () => void
}

type Registration = {
  directory: string
  ptyID: string
  token: string
  write(data: string): Promise<void>
}

type RunInput = {
  directory: string
  sessionID: string
  command: string
  abort: AbortSignal
  timeout?: number
}

const ptys = new Map<string, Slot>()
const sessions = new Map<string, Slot>()
const generations = new Map<string, number>()

function dir(value: string) {
  return path.resolve(value)
}

function ptyKey(directory: string, ptyID: string) {
  return `${dir(directory)}\0${ptyID}`
}

function sessionKey(directory: string, sessionID: string) {
  return `${dir(directory)}\0${sessionID}`
}

function token(value: unknown): string | undefined {
  if (typeof value !== "string") return
  if (!/^[a-f0-9]{32}$/i.test(value)) return
  return value
}

function decode(value: string): string | undefined {
  try {
    return Buffer.from(value, "base64").toString("utf8")
  } catch (err) {
    log.warn("invalid cwd marker", { error: String(err) })
    return
  }
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

function capture(slot: Slot, value: string) {
  const active = slot.active
  if (!active || active.started === 0 || !value) return
  const chunk = Buffer.from(value)
  active.last = Date.now()
  active.bytes += chunk.length
  active.chunks.push(chunk)
  active.kept += chunk.length
  while (active.kept > LIMIT && active.chunks.length > 0) {
    const first = active.chunks[0]!
    const excess = active.kept - LIMIT
    if (first.length <= excess) {
      active.chunks.shift()
      active.kept -= first.length
      active.truncated = true
      continue
    }
    active.chunks[0] = first.subarray(excess)
    active.kept -= excess
    active.truncated = true
  }
}

function complete(slot: Slot, code: number, cwd: string) {
  const active = slot.active
  slot.active = undefined
  slot.cwd = cwd
  slot.busy = false
  slot.ready = true
  if (!active) return
  const output = Buffer.concat(active.chunks).toString("utf8")
  active.done({ output, exitCode: code, cwd, bytes: active.bytes, truncated: active.truncated })
  log.info("command complete", {
    ptyID: slot.ptyID,
    generation: slot.generation,
    duration: Date.now() - active.started,
    exitCode: code,
    bytes: active.bytes,
    truncated: active.truncated,
  })
}

function marker(slot: Slot, value: string) {
  const [kind, first, second] = value.split(";") as [Marker, string | undefined, string | undefined]
  if (kind === "ready" || kind === "resync") {
    const cwd = first ? decode(first) : undefined
    if (cwd === undefined) return
    slot.cwd = cwd
    if (kind === "resync" && slot.active) {
      const active = slot.active
      slot.active = undefined
      active.done(new Error("Agent Console command was interrupted while recovering the Shell"))
    }
    slot.ready = true
    slot.busy = false
    if (kind === "resync") log.info("terminal resynchronized", { ptyID: slot.ptyID, generation: slot.generation })
    return
  }
  if (kind === "begin") {
    const cwd = first ? decode(first) : undefined
    if (cwd !== undefined) slot.cwd = cwd
    slot.ready = false
    slot.busy = true
    if (slot.active && slot.active.started === 0) {
      slot.active.started = Date.now()
      slot.active.last = slot.active.started
    }
    return
  }
  if (kind !== "end") return
  const code = Number(first)
  const cwd = second ? decode(second) : undefined
  if (!Number.isSafeInteger(code) || code < 0 || code > 255 || cwd === undefined) return
  complete(slot, code, cwd)
}

function feed(slot: Slot, value: string) {
  slot.buffer += value
  while (slot.buffer) {
    const start = slot.buffer.indexOf(slot.prefix)
    if (start === -1) {
      const keep = overlap(slot.buffer, slot.prefix)
      capture(slot, slot.buffer.slice(0, slot.buffer.length - keep))
      slot.buffer = slot.buffer.slice(slot.buffer.length - keep)
      return
    }
    capture(slot, slot.buffer.slice(0, start))
    const from = start + slot.prefix.length
    const end = closer(slot.buffer, from)
    if (!end) {
      slot.buffer = slot.buffer.slice(start)
      return
    }
    marker(slot, slot.buffer.slice(from, end.index))
    slot.buffer = slot.buffer.slice(end.index + end.length)
  }
}

function fail(slot: Slot, err: Error) {
  const active = slot.active
  slot.active = undefined
  slot.ready = false
  slot.busy = false
  if (active) active.done(err)
}

function detach(slot: Slot, reason = "The Agent Console terminal closed") {
  if (slot.closed) return
  slot.closed = true
  slot.disconnect?.()
  ptys.delete(ptyKey(slot.directory, slot.ptyID))
  if (slot.sessionID) sessions.delete(sessionKey(slot.directory, slot.sessionID))
  fail(slot, new Error(reason))
  log.info("terminal detached", { ptyID: slot.ptyID, generation: slot.generation })
}

export function registration(env: Record<string, string> | undefined) {
  if (env?.[ENV_ENABLED] !== "1") return
  return token(env[ENV_TOKEN])
}

export function isAgentConsole(title: string) {
  return title === TITLE
}

export function attach(input: Registration) {
  const directory = dir(input.directory)
  const key = ptyKey(directory, input.ptyID)
  const old = ptys.get(key)
  if (old) detach(old, "The Agent Console terminal was replaced")
  const generation = (generations.get(key) ?? 0) + 1
  generations.set(key, generation)
  const slot: Slot = {
    directory,
    ptyID: input.ptyID,
    token: input.token,
    prefix: `${OSC}${input.token};`,
    generation,
    ready: false,
    busy: false,
    closed: false,
    buffer: "",
    write: input.write,
  }
  ptys.set(key, slot)
  log.info("terminal attached", { ptyID: slot.ptyID, generation })
  return {
    get readyState() {
      return slot.closed ? 3 : 1
    },
    send(data: string | Uint8Array | ArrayBuffer) {
      if (slot.closed) return
      const bytes = typeof data === "string" ? undefined : data instanceof ArrayBuffer ? new Uint8Array(data) : data
      if (bytes?.[0] === 0) return
      feed(slot, typeof data === "string" ? data : new TextDecoder().decode(bytes))
    },
    close(_code?: number, reason?: string) {
      detach(slot, reason || "The Agent Console terminal closed")
    },
    connected(disconnect: () => void) {
      slot.disconnect = disconnect
    },
  }
}

export function bind(input: { directory: string; ptyID: string; sessionID: string | null | undefined }) {
  const slot = ptys.get(ptyKey(input.directory, input.ptyID))
  if (!slot) throw new Error("Agent Console PTY integration is unavailable")
  if (slot.closed) throw new Error("Agent Console PTY has ended")
  if (slot.active) throw new Error("Agent Console PTY is executing a command")
  if (slot.sessionID) sessions.delete(sessionKey(slot.directory, slot.sessionID))
  slot.sessionID = input.sessionID ?? undefined
  if (!slot.sessionID) return
  const key = sessionKey(slot.directory, slot.sessionID)
  const old = sessions.get(key)
  if (old && old !== slot) old.sessionID = undefined
  sessions.set(key, slot)
  log.info("session bound", { ptyID: slot.ptyID, sessionID: slot.sessionID, generation: slot.generation })
}

export function inspect(input: { directory: string; sessionID: string }) {
  const slot = sessions.get(sessionKey(input.directory, input.sessionID))
  if (!slot || slot.closed) throw new Error("Agent Console shell is not bound to this session")
  if (!slot.ready || slot.busy || !slot.cwd) throw new Error("Agent Console shell is not at a clean prompt")
  return { cwd: slot.cwd, ptyID: slot.ptyID, generation: slot.generation }
}

function active(): Active {
  const state = { resolve: undefined as ((result: Result | Error) => void) | undefined }
  const promise = new Promise<Result | Error>((resolve) => {
    state.resolve = resolve
  })
  return {
    started: 0,
    last: Date.now(),
    chunks: [],
    bytes: 0,
    kept: 0,
    truncated: false,
    done: (result) => state.resolve?.(result),
    promise,
  }
}

function wait(promise: Promise<Result | Error>, signal: AbortSignal, ms: number, activity?: Active) {
  return new Promise<Result | Error | "timeout" | "aborted">((resolve) => {
    let settled = false
    const started = Date.now()
    const done = (value: Result | Error | "timeout" | "aborted") => {
      if (settled) return
      settled = true
      clearInterval(timer)
      signal.removeEventListener("abort", abort)
      resolve(value)
    }
    const abort = () => done("aborted")
    const timer = setInterval(
      () => {
        if (Date.now() - (activity?.last ?? started) >= ms) done("timeout")
      },
      Math.min(ms, 1_000),
    )
    promise.then(done)
    if (signal.aborted) done("aborted")
    else signal.addEventListener("abort", abort, { once: true })
  })
}

export async function run(input: RunInput): Promise<Result> {
  const slot = sessions.get(sessionKey(input.directory, input.sessionID))
  if (!slot || slot.closed) throw new Error("Agent Console shell is not bound to this session")
  if (!slot.ready || slot.busy || !slot.cwd) throw new Error("Agent Console shell is not at a clean prompt")
  if (slot.active) throw new Error("Agent Console shell is already executing a command")
  const task = active()
  slot.active = task
  slot.ready = false
  const started = Date.now()
  log.info("command write", { ptyID: slot.ptyID, generation: slot.generation })
  await slot.write(`${input.command}\r`).catch((err: unknown) => {
    fail(slot, err instanceof Error ? err : new Error(String(err)))
    throw err
  })
  const outcome = await wait(task.promise, input.abort, input.timeout ?? 120_000, task)
  if (typeof outcome !== "string") {
    if (outcome instanceof Error) throw outcome
    return {
      ...outcome,
      output: stripAnsi(outcome.output).replace(/\r\n/g, "\n").replace(/\r/g, "").trim(),
    }
  }
  await slot.write("\x03").catch((err: unknown) => {
    log.warn("interrupt failed", { ptyID: slot.ptyID, error: String(err) })
  })
  await wait(task.promise, new AbortController().signal, 2_000)
  if (slot.active === task || !slot.ready) {
    await slot.write("__chipmate_resync\r").catch((err: unknown) => {
      log.warn("resync write failed", { ptyID: slot.ptyID, error: String(err) })
    })
    await wait(task.promise, new AbortController().signal, 3_000)
  }
  if (slot.active === task) {
    fail(slot, new Error("Agent Console shell recovery failed"))
  }
  log.warn("command interrupted", {
    ptyID: slot.ptyID,
    generation: slot.generation,
    duration: Date.now() - started,
    reason: outcome,
  })
  throw new Error(outcome === "timeout" ? "Agent Console command timed out" : "Agent Console command was cancelled")
}
