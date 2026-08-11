import type { LanguageModelV3Middleware, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { safeValidateTypes } from "@ai-sdk/provider-utils"
import { jsonSchema, tool, type ModelMessage, type Tool } from "ai"
import type { Config } from "@/config/config"
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "dsml" })

const START = "<｜DSML｜tool_calls>"
const ORPHAN = '<｜DSML｜parameter name="'
const OPEN = '<｜DSML｜invoke name="'
const END = "</｜DSML｜tool_calls>"
const INVOKE = "</｜DSML｜invoke>"
const PARAMETER = "</｜DSML｜parameter>"
const NESTED = "<｜DSML｜"
const CLOSING = "</｜DSML｜"
const RETRY = "chipmate_dsml_orphan_retry"
const WARNING = "The model returned an incomplete tool call twice. No tool was executed; automatic DSML repair stopped."
const RETRY_ERROR =
  "The provider returned an incomplete DSML tool call without an invoke name. Reissue exactly one normal structured tool call using one available tool. Do not emit DSML markup as text."
const LIMIT = 256 * 1024
const EVENTS = 4096
const CALLS = 16
const PARAMS = 128
const encoder = new TextEncoder()
const INVALID = tool({
  description: "Do not use",
  inputSchema: jsonSchema<{ tool: string; error: string }>({
    type: "object",
    additionalProperties: false,
    required: ["tool", "error"],
    properties: {
      tool: { type: "string" },
      error: { type: "string" },
    },
  }),
  execute: (input) => ({
    title: "Invalid Tool",
    output: `The arguments provided to the tool are invalid: ${input.error}`,
    metadata: {},
  }),
})

type Delta = Extract<LanguageModelV3StreamPart, { type: "text-delta" }>

type Param = {
  name: string
  string: boolean
  value: unknown
}

type Call = {
  name: string
  params: Param[]
  input: Record<string, unknown>
}

type Success = {
  ok: true
  calls: Call[]
}

type Failure = {
  ok: false
  reason: string
}

type Result = Success | Failure

type Syntax = {
  kind: "full" | "orphan"
  phase: "call" | "invoke-name" | "invoke-end" | "name" | "string-open" | "string" | "value" | "next" | "end" | "tail"
  cursor: number
  calls: number
  count: number
  names: Set<string>
  name: string
  string: boolean
  value: number
  scan: number
}

type Capture = {
  kind: "full" | "orphan"
  id: string
  text: string
  bytes: number
  parts: LanguageModelV3StreamPart[]
  ended: boolean
  state: Syntax
}

type Hit = {
  kind: Capture["kind"]
  marker: string
  index: number
}

function fail(reason: string): Failure {
  return { ok: false, reason }
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => equal(value, right[index]))
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false
  const a = Object.keys(left)
  const b = Object.keys(right)
  if (a.length !== b.length || a.some((key) => !Object.hasOwn(right, key))) return false
  return a.every((key) => equal(Reflect.get(left, key), Reflect.get(right, key)))
}

function space(text: string, offset: number) {
  let index = offset
  while (/\s/u.test(text[index] ?? "")) index++
  return index
}

function read(text: string, check = true): Result {
  if (encoder.encode(text).byteLength > LIMIT) return fail("size-limit")
  if (!text.startsWith(START)) return fail("missing-start")

  const calls: Call[] = []
  let index = START.length

  while (index < text.length) {
    index = space(text, index)
    if (text.startsWith(END, index)) {
      index += END.length
      if (text.slice(index).trim()) return fail("trailing-content")
      if (calls.length === 0) return fail("empty-block")
      if (!check) return { ok: true, calls }
      const again = read(render(calls), false)
      if (!again.ok || !equal(calls, again.calls)) return fail("roundtrip")
      return { ok: true, calls }
    }

    if (calls.length >= CALLS) return fail("call-limit")
    const open = /^<｜DSML｜invoke name="([^"<>]+)">/u.exec(text.slice(index))
    if (!open) return fail("invalid-invoke")
    const name = open[1]
    index += open[0].length

    const params: Param[] = []
    const input: Record<string, unknown> = Object.create(null)

    while (index < text.length) {
      index = space(text, index)
      if (text.startsWith(INVOKE, index)) {
        index += INVOKE.length
        calls.push({ name, params, input })
        break
      }

      if (params.length >= PARAMS) return fail("parameter-limit")
      const tag = /^<｜DSML｜parameter name="([^"<>]+)" string="(true|false)">/u.exec(text.slice(index))
      if (!tag) return fail("invalid-parameter")
      const key = tag[1]
      if (Object.hasOwn(input, key)) return fail("duplicate-parameter")
      index += tag[0].length

      const close = text.indexOf(PARAMETER, index)
      if (close < 0) return fail("missing-parameter-end")
      const raw = text.slice(index, close)
      if (raw.includes(NESTED)) return fail("nested-tag")
      const string = tag[2] === "true"
      const value = (() => {
        if (string) return { ok: true as const, value: raw }
        try {
          const parsed: unknown = JSON.parse(raw)
          if (typeof parsed === "string") return { ok: false as const }
          return { ok: true as const, value: parsed }
        } catch {
          return { ok: false as const }
        }
      })()
      if (!value.ok) return fail("invalid-json-parameter")

      input[key] = value.value
      params.push({ name: key, string, value: value.value })
      index = close + PARAMETER.length
    }

    if (calls.at(-1)?.name !== name) return fail("missing-invoke-end")
  }

  return fail("missing-end")
}

function render(calls: Call[]) {
  const body = calls
    .map((call) => {
      const params = call.params
        .map((param) => {
          const value = param.string ? String(param.value) : JSON.stringify(param.value)
          return `<｜DSML｜parameter name="${param.name}" string="${param.string}">${value}${PARAMETER}`
        })
        .join("\n")
      return `<｜DSML｜invoke name="${call.name}">\n${params}\n${INVOKE}`
    })
    .join("\n")
  return `${START}\n${body}\n${END}`
}

async function parse(text: string, tools: Record<string, Tool>): Promise<Result> {
  const result = read(text)
  if (!result.ok) return result

  for (const call of result.calls) {
    const tool = call.name === "invalid" ? undefined : tools[call.name]
    if (!tool) return fail("unknown-tool")
    const checked = await safeValidateTypes({ value: call.input, schema: tool.inputSchema })
    if (!checked.success) return fail("schema")
    if (!equal(checked.value, call.input)) return fail("schema-transform")
  }

  return result
}

function token(text: string, offset: number, values: string[]) {
  const rest = text.slice(offset)
  const value = values.find((item) => rest.startsWith(item))
  if (value) return { ok: true as const, value }
  if (values.some((item) => item.startsWith(rest))) return { ok: true as const }
  return { ok: false as const }
}

function advance(state: Syntax, text: string): string | undefined {
  while (true) {
    if (state.phase === "call") {
      state.cursor = space(text, state.cursor)
      const result = token(text, state.cursor, [OPEN, END])
      if (!result.ok) return "invalid-invoke"
      if (!result.value) return undefined
      state.cursor += result.value.length
      if (result.value === END) {
        if (state.calls === 0) return "empty-block"
        state.phase = "tail"
        continue
      }
      if (state.calls >= CALLS) return "call-limit"
      state.name = ""
      state.phase = "invoke-name"
      continue
    }

    if (state.phase === "invoke-name") {
      const quote = text.indexOf('"', state.cursor)
      const left = text.indexOf("<", state.cursor)
      const right = text.indexOf(">", state.cursor)
      const invalid = [left, right].filter((index) => index >= 0).sort((a, b) => a - b)[0]
      if (invalid !== undefined && (quote < 0 || invalid < quote)) return "invalid-invoke"
      if (quote < 0) return undefined
      state.name = text.slice(state.cursor, quote)
      if (!state.name) return "invalid-invoke"
      state.cursor = quote + 1
      state.phase = "invoke-end"
      continue
    }

    if (state.phase === "invoke-end") {
      const result = token(text, state.cursor, [">"])
      if (!result.ok) return "invalid-invoke"
      if (!result.value) return undefined
      state.cursor += result.value.length
      state.count = 0
      state.names = new Set()
      state.phase = "next"
      continue
    }

    if (state.phase === "name") {
      const quote = text.indexOf('"', state.cursor)
      const left = text.indexOf("<", state.cursor)
      const right = text.indexOf(">", state.cursor)
      const invalid = [left, right].filter((index) => index >= 0).sort((a, b) => a - b)[0]
      if (invalid !== undefined && (quote < 0 || invalid < quote)) return "invalid-parameter-name"
      if (quote < 0) return undefined
      state.name = text.slice(state.cursor, quote)
      if (!state.name) return "invalid-parameter-name"
      state.cursor = quote + 1
      state.phase = "string-open"
      continue
    }

    if (state.phase === "string-open") {
      const result = token(text, state.cursor, [' string="'])
      if (!result.ok) return "invalid-parameter"
      if (!result.value) return undefined
      state.cursor += result.value.length
      state.phase = "string"
      continue
    }

    if (state.phase === "string") {
      const result = token(text, state.cursor, ['true">', 'false">'])
      if (!result.ok) return "invalid-parameter"
      if (!result.value) return undefined
      state.string = result.value === 'true">'
      state.cursor += result.value.length
      state.value = state.cursor
      state.scan = state.cursor
      state.phase = "value"
      continue
    }

    if (state.phase === "value") {
      const close = text.indexOf(PARAMETER, state.scan)
      const nested = text.indexOf(NESTED, state.scan)
      const closing = text.indexOf(CLOSING, state.scan)
      const invalid =
        state.kind === "orphan" &&
        closing >= 0 &&
        (close >= 0 ? closing < close : !PARAMETER.startsWith(text.slice(closing)))
      if ((nested >= 0 && (close < 0 || nested < close)) || invalid) {
        return "nested-tag"
      }
      if (close < 0) {
        state.scan = Math.max(state.scan, text.length - Math.max(PARAMETER.length, NESTED.length, CLOSING.length) + 1)
        return undefined
      }
      const raw = text.slice(state.value, close)
      if (!state.string) {
        try {
          const value: unknown = JSON.parse(raw)
          if (typeof value === "string") return "invalid-json-parameter"
        } catch {
          return "invalid-json-parameter"
        }
      }
      if (state.names.has(state.name)) return "duplicate-parameter"
      state.names.add(state.name)
      state.count++
      state.cursor = close + PARAMETER.length
      state.phase = "next"
      continue
    }

    if (state.phase === "next") {
      state.cursor = space(text, state.cursor)
      const result = token(text, state.cursor, [ORPHAN, INVOKE])
      if (!result.ok) return state.kind === "orphan" ? "invalid-orphan-tail" : "invalid-parameter"
      if (!result.value) return undefined
      state.cursor += result.value.length
      if (result.value === INVOKE) {
        if (state.kind === "orphan") {
          state.phase = "end"
          continue
        }
        state.calls++
        state.phase = "call"
        continue
      }
      if (state.count >= PARAMS) return "parameter-limit"
      state.name = ""
      state.phase = "name"
      continue
    }

    if (state.phase === "end") {
      state.cursor = space(text, state.cursor)
      const result = token(text, state.cursor, [END])
      if (!result.ok) return "missing-end"
      if (!result.value) return undefined
      state.cursor += result.value.length
      state.phase = "tail"
      continue
    }

    const tail = text.slice(state.cursor)
    if (/\S/u.test(tail)) return "trailing-content"
    state.cursor = text.length
    return undefined
  }
}

function syntax(capture: Capture, final = false): string | undefined {
  const reason = advance(capture.state, capture.text)
  if (reason) return reason
  const eof =
    final &&
    capture.kind === "orphan" &&
    capture.state.phase === "end" &&
    capture.text.slice(capture.state.cursor).trim() === ""
  if (final && capture.state.phase !== "tail" && !eof) {
    return capture.kind === "orphan" ? "incomplete-orphan" : "incomplete-full"
  }
  if (final && capture.kind === "full") {
    const result = read(capture.text)
    return result.ok ? undefined : result.reason
  }
  return undefined
}

function overlap(text: string) {
  const markers = [START, ORPHAN]
  const max = Math.min(text.length, Math.max(...markers.map((marker) => marker.length)) - 1)
  for (let size = max; size > 0; size--) {
    if (markers.some((marker) => marker.startsWith(text.slice(-size)))) return size
  }
  return 0
}

function hit(text: string, offset = 0): Hit | undefined {
  const full = text.indexOf(START, offset)
  const orphan = text.indexOf(ORPHAN, offset)
  if (full < 0 && orphan < 0) return undefined
  if (full >= 0 && (orphan < 0 || full <= orphan)) return { kind: "full", marker: START, index: full }
  return { kind: "orphan", marker: ORPHAN, index: orphan }
}

function split(parts: Delta[], count: number): [Delta[], Delta[]] {
  const head: Delta[] = []
  const tail: Delta[] = []
  let left = count

  for (const part of parts) {
    if (left >= part.delta.length) {
      head.push(part)
      left -= part.delta.length
      continue
    }
    if (left > 0) head.push({ ...part, delta: part.delta.slice(0, left) })
    tail.push({ ...part, delta: part.delta.slice(left) })
    left = 0
  }

  return [head, tail]
}

function content(parts: Delta[]) {
  return parts.map((part) => part.delta).join("")
}

function inline(text: string) {
  let mark = 0
  let index = 0
  while (index < text.length) {
    if (text[index] !== "`") {
      index++
      continue
    }
    let end = index + 1
    while (text[end] === "`") end++
    const size = end - index
    let slash = index - 1
    while (slash >= 0 && text[slash] === "\\") slash--
    const escaped = (index - slash - 1) % 2 === 1
    if (mark === 0 && !escaped) mark = size
    else if (mark === size) mark = 0
    index = end
  }
  return mark > 0
}

function tracker() {
  let fence: { char: string; size: number } | undefined
  let line = ""

  const next = (state: typeof fence, value: string) => {
    const match = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/u.exec(value)
    if (!match) return state
    const mark = match[1]
    if (!state) return { char: mark[0], size: mark.length }
    if (state.char === mark[0] && mark.length >= state.size && !match[2].trim()) return undefined
    return state
  }

  return {
    push(value: string) {
      const lines = (line + value).split("\n")
      line = lines.pop() ?? ""
      for (const item of lines) fence = next(fence, item)
    },
    active(prefix: string, suffix: string) {
      const lines = (line + prefix).split("\n")
      const current = lines.pop() ?? ""
      let state = fence
      for (const item of lines) state = next(state, item)
      const value = current + suffix
      if (next(state, value) !== undefined) return true
      if (/^\s*>/u.test(value)) return true
      if (/^\s*(?: {4}|\t)/u.test(value)) return true
      return inline(value)
    },
  }
}

function structured(part: LanguageModelV3StreamPart) {
  return part.type.startsWith("tool-")
}

function allowed(part: LanguageModelV3StreamPart, capture: Capture) {
  if (part.type === "raw" || part.type === "response-metadata") return true
  if (part.type === "text-delta") return part.id === capture.id && !capture.ended
  if (part.type === "text-end") return part.id === capture.id && !capture.ended
  return false
}

function unexpected(part: LanguageModelV3StreamPart, capture: Capture) {
  if (part.type === "text-delta" || part.type === "text-end") {
    if (part.id !== capture.id) return "text-id"
    return "text-after-end"
  }
  if (structured(part)) return "structured-tool-event"
  if (part.type === "error") return "error-event"
  if (part.type.startsWith("reasoning-")) return "reasoning-event"
  return "unexpected-event"
}

function retried(messages: readonly ModelMessage[]) {
  const start = messages.findLastIndex((message) => message.role === "user")
  if (start < 0) return false

  for (const message of messages.slice(start + 1)) {
    if (message.role !== "assistant" || typeof message.content === "string") continue
    for (const part of message.content) {
      if (part.type !== "tool-call" || part.toolName !== "invalid") continue
      const input = part.input
      if (!input || typeof input !== "object" || Array.isArray(input)) continue
      if ("tool" in input && input.tool === RETRY) return true
    }
  }
  return false
}

function middleware(input: {
  tools: Record<string, Tool>
  messages: readonly ModelMessage[]
}): LanguageModelV3Middleware {
  const exhausted = retried(input.messages)
  return {
    specificationVersion: "v3",
    async wrapStream({ doStream }) {
      const result = await doStream()
      const fence = tracker()
      let pending: Delta[] = []
      let capture: Capture | undefined
      let done = false

      const stream = result.stream.pipeThrough(
        new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          async transform(part, ctrl) {
            const emit = (parts: LanguageModelV3StreamPart[]) => {
              for (const item of parts) {
                if (item.type === "text-delta") fence.push(item.delta)
                ctrl.enqueue(item)
              }
            }
            const flush = () => {
              emit(pending)
              pending = []
            }
            const replay = (reason: string) => {
              if (!capture) return
              const parts = capture.parts
              capture = undefined
              done = true
              log.warn("DSML tool call repair rejected", { reason })
              emit(parts)
            }
            const hidden = (current: Capture, replacement?: string) => {
              let inserted = false
              for (const item of current.parts) {
                if (item.type === "text-delta") {
                  if (!replacement || inserted) continue
                  ctrl.enqueue({ ...item, delta: replacement })
                  inserted = true
                  continue
                }
                ctrl.enqueue(item)
              }
            }

            if (done) {
              ctrl.enqueue(part)
              return
            }

            if (capture) {
              if (part.type === "finish") {
                const current = capture
                capture = undefined
                done = true
                const terminal = part.finishReason.unified === "stop" || part.finishReason.unified === "tool-calls"
                const reason = terminal ? syntax(current, true) : "finish-reason"
                if (reason) {
                  log.warn("DSML tool call repair rejected", { reason })
                  emit(current.parts)
                  ctrl.enqueue(part)
                  return
                }

                if (current.kind === "orphan") {
                  if (exhausted) {
                    hidden(current, WARNING)
                    log.warn("orphan-correction-exhausted")
                    ctrl.enqueue({
                      ...part,
                      finishReason: { ...part.finishReason, unified: "stop" },
                    })
                    return
                  }
                  hidden(current)
                  ctrl.enqueue({
                    type: "tool-call",
                    toolCallId: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
                    toolName: "invalid",
                    input: JSON.stringify({ tool: RETRY, error: RETRY_ERROR }),
                  })
                  log.info("orphan-correction-issued")
                  ctrl.enqueue({
                    ...part,
                    finishReason: { ...part.finishReason, unified: "tool-calls" },
                  })
                  return
                }

                const parsed = await parse(current.text, input.tools)
                if (!parsed.ok) {
                  log.warn("DSML tool call repair rejected", { reason: parsed.reason })
                  emit(current.parts)
                  ctrl.enqueue(part)
                  return
                }

                hidden(current)
                for (const call of parsed.calls) {
                  ctrl.enqueue({
                    type: "tool-call",
                    toolCallId: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
                    toolName: call.name,
                    input: JSON.stringify(call.input),
                  })
                }
                ctrl.enqueue({
                  ...part,
                  finishReason: { ...part.finishReason, unified: "tool-calls" },
                })
                return
              }

              if (!allowed(part, capture)) {
                const reason = unexpected(part, capture)
                capture.parts.push(part)
                replay(reason)
                return
              }

              capture.parts.push(part)
              if (part.type === "text-delta") {
                capture.text += part.delta
                capture.bytes += encoder.encode(part.delta).byteLength
              }
              if (part.type === "text-end") capture.ended = true

              if (capture.parts.length > EVENTS) {
                replay("event-limit")
                return
              }
              if (capture.bytes > LIMIT) {
                replay("size-limit")
                return
              }
              const reason = syntax(capture, part.type === "text-end")
              if (reason) replay(reason)
              return
            }

            if (structured(part)) {
              flush()
              done = true
              ctrl.enqueue(part)
              return
            }

            if (part.type === "text-delta") {
              if (pending[0] && pending[0].id !== part.id) flush()
              pending.push(part)

              while (pending.length > 0) {
                const value = content(pending)
                let offset = 0
                let found: Hit | undefined
                while (offset < value.length) {
                  const current = hit(value, offset)
                  if (!current) break
                  if (!fence.active(value.slice(0, current.index), current.marker)) {
                    found = current
                    break
                  }
                  offset = current.index + current.marker.length
                }
                if (found) {
                  const [head, tail] = split(pending, found.index)
                  emit(head)
                  pending = tail
                  const text = content(pending)
                  capture = {
                    kind: found.kind,
                    id: pending[0]?.id ?? part.id,
                    text,
                    bytes: encoder.encode(text).byteLength,
                    parts: pending,
                    ended: false,
                    state: {
                      kind: found.kind,
                      phase: found.kind === "orphan" ? "name" : "call",
                      cursor: found.kind === "orphan" ? ORPHAN.length : START.length,
                      calls: 0,
                      count: 0,
                      names: new Set(),
                      name: "",
                      string: false,
                      value: 0,
                      scan: 0,
                    },
                  }
                  pending = []
                  if (capture.parts.length > EVENTS) {
                    replay("event-limit")
                    return
                  }
                  if (capture.bytes > LIMIT) {
                    replay("size-limit")
                    return
                  }
                  const reason = syntax(capture)
                  if (reason) replay(reason)
                  return
                }

                const keep = overlap(value)
                const [head, tail] = split(pending, value.length - keep)
                emit(head)
                pending = tail
                return
              }
              return
            }

            flush()
            if (part.type === "finish" || part.type === "error") done = true
            ctrl.enqueue(part)
          },
          flush(ctrl) {
            for (const part of pending) ctrl.enqueue(part)
            if (capture) {
              log.warn("DSML tool call repair rejected", { reason: "missing-finish" })
              for (const part of capture.parts) ctrl.enqueue(part)
            }
          },
        }),
      )

      return { ...result, stream }
    },
  }
}

function enabled(input: {
  cfg: Config.Info
  model: { providerID: string; id: string }
  tools: Record<string, Tool>
  toolChoice?: "auto" | "required" | "none"
}) {
  const repair = input.cfg.experimental?.dsml_tool_call_repair
  if (repair?.enabled !== true || !repair.model) return false
  if (repair.model !== `${input.model.providerID}/${input.model.id}`) return false
  if (input.toolChoice === "none") return false
  return Object.keys(input.tools).some((name) => name !== "invalid")
}

export const DSML = {
  START,
  enabled,
  invalid: INVALID,
  middleware,
  parse,
}
