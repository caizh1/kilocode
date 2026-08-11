import { LLMEvent, type LLMEvent as Event, type ProviderMetadata } from "@opencode-ai/llm"
import * as Stream from "effect/Stream"

const OPEN = "<think>"
const CLOSE = "</think>"

type Model = {
  api: {
    id: string
    npm: string
  }
  capabilities: {
    reasoning: boolean
  }
}

type TextStart = Extract<Event, { type: "text-start" }>
type TextDelta = Extract<Event, { type: "text-delta" }>
type TextEnd = Extract<Event, { type: "text-end" }>

type TextBlock = {
  start: TextStart
  mode: "detecting" | "reasoning" | "answer"
  buffered: TextDelta[]
  close: string
  reasoningID?: string
  textStarted: boolean
}

function tagPrefixLength(value: string, tag: string) {
  const lower = value.toLowerCase()
  const token = tag.toLowerCase()
  const max = Math.min(lower.length, token.length - 1)
  for (let length = max; length > 0; length -= 1) {
    if (lower.endsWith(token.slice(0, length))) return length
  }
  return 0
}

function opening(value: string): { type: "pending" } | { type: "mismatch" } | { type: "match"; offset: number } {
  const body = value.trimStart()
  if (!body) return { type: "pending" }
  const lower = body.toLowerCase()
  if (lower.startsWith(OPEN)) {
    return {
      type: "match",
      offset: value.length - body.length + OPEN.length,
    }
  }
  if (OPEN.startsWith(lower)) return { type: "pending" }
  return { type: "mismatch" }
}

function metadata(event: Event): ProviderMetadata | undefined {
  return "providerMetadata" in event ? event.providerMetadata : undefined
}

function textDelta(event: TextDelta, value: string): Event {
  return LLMEvent.textDelta({
    id: event.id,
    text: value,
    providerMetadata: event.providerMetadata,
  })
}

export namespace ChipMateSessionThinking {
  export function supports(model: Model) {
    return (
      model.api.npm === "@ai-sdk/openai-compatible" &&
      model.capabilities.reasoning &&
      model.api.id.toLowerCase().includes("deepseek-v4")
    )
  }

  export class Normalizer {
    private block: TextBlock | undefined
    private native = false
    private used = false
    private sequence = 0

    push(event: Event): Event[] {
      switch (event.type) {
        case "step-start": {
          const out = this.finish(event)
          this.native = false
          this.used = false
          return [...out, event]
        }
        case "reasoning-start":
        case "reasoning-delta":
        case "reasoning-end": {
          const out = this.flushDetecting()
          this.native = true
          return [...out, event]
        }
        case "text-start":
          return this.start(event)
        case "text-delta":
          return this.delta(event)
        case "text-end":
          return this.end(event)
        case "step-finish":
        case "finish":
        case "provider-error":
          return [...this.finish(event), event]
        default:
          return [event]
      }
    }

    private start(event: TextStart): Event[] {
      const out = this.finish(event)
      if (this.native || this.used) return [...out, event]
      this.block = {
        start: event,
        mode: "detecting",
        buffered: [],
        close: "",
        textStarted: false,
      }
      return out
    }

    private delta(event: TextDelta): Event[] {
      const block = this.block
      if (!block) return [event]
      if (block.mode === "answer") return this.answer(event)
      if (block.mode === "reasoning") return this.reason(event, event.text)

      block.buffered.push(event)
      const value = block.buffered.map((item) => item.text).join("")
      const state = opening(value)
      if (state.type === "pending") return []
      if (state.type === "mismatch") return this.flushDetecting()

      block.mode = "reasoning"
      block.reasoningID = `think-tag-${this.sequence++}`
      this.used = true
      const out: Event[] = [
        LLMEvent.reasoningStart({
          id: block.reasoningID,
          providerMetadata: block.buffered.find((item) => item.providerMetadata)?.providerMetadata,
        }),
      ]
      let skip = state.offset
      for (const item of block.buffered) {
        if (skip >= item.text.length) {
          skip -= item.text.length
          continue
        }
        out.push(...this.reason(item, item.text.slice(skip)))
        skip = 0
      }
      block.buffered = []
      return out
    }

    private reason(event: TextDelta, value: string): Event[] {
      const block = this.block
      if (!block || block.mode !== "reasoning" || !block.reasoningID) return [textDelta(event, value)]

      const out: Event[] = []
      const rest = block.close + value
      block.close = ""
      const index = rest.toLowerCase().indexOf(CLOSE)
      if (index === -1) {
        const keep = tagPrefixLength(rest, CLOSE)
        const body = keep > 0 ? rest.slice(0, -keep) : rest
        block.close = keep > 0 ? rest.slice(-keep) : ""
        if (body) {
          out.push(
            LLMEvent.reasoningDelta({
              id: block.reasoningID,
              text: body,
              providerMetadata: event.providerMetadata,
            }),
          )
        }
        return out
      }

      const body = rest.slice(0, index)
      if (body) {
        out.push(
          LLMEvent.reasoningDelta({
            id: block.reasoningID,
            text: body,
            providerMetadata: event.providerMetadata,
          }),
        )
      }
      out.push(
        LLMEvent.reasoningEnd({
          id: block.reasoningID,
          providerMetadata: event.providerMetadata,
        }),
      )
      block.mode = "answer"
      block.reasoningID = undefined
      const answer = rest.slice(index + CLOSE.length)
      if (answer) out.push(...this.answer(event, answer))
      return out
    }

    private answer(event: TextDelta, value = event.text): Event[] {
      const block = this.block
      if (!block) return [textDelta(event, value)]
      const body = block.textStarted ? value : value.trimStart()
      if (!body) return []
      const out: Event[] = []
      if (!block.textStarted) {
        out.push(block.start)
        block.textStarted = true
      }
      out.push(textDelta(event, body))
      return out
    }

    private end(event: TextEnd): Event[] {
      const block = this.block
      if (!block) return [event]
      const out: Event[] = []
      if (block.mode === "detecting") out.push(...this.flushDetecting())
      if (block.mode === "reasoning") out.push(...this.finishReasoning(event))
      if (block.mode === "answer" && block.textStarted) out.push(event)
      this.block = undefined
      return out
    }

    private flushDetecting(): Event[] {
      const block = this.block
      if (!block || block.mode !== "detecting") return []
      block.mode = "answer"
      block.textStarted = true
      const out: Event[] = [block.start, ...block.buffered]
      block.buffered = []
      return out
    }

    private finishReasoning(event: Event): Event[] {
      const block = this.block
      if (!block || block.mode !== "reasoning" || !block.reasoningID) return []
      const out: Event[] = []
      if (block.close) {
        out.push(
          LLMEvent.reasoningDelta({
            id: block.reasoningID,
            text: block.close,
            providerMetadata: metadata(event),
          }),
        )
      }
      out.push(
        LLMEvent.reasoningEnd({
          id: block.reasoningID,
          providerMetadata: metadata(event),
        }),
      )
      block.close = ""
      block.mode = "answer"
      block.reasoningID = undefined
      return out
    }

    private finish(event: Event): Event[] {
      const block = this.block
      if (!block) return []
      const out: Event[] = []
      if (block.mode === "detecting") out.push(...this.flushDetecting())
      if (block.mode === "reasoning") out.push(...this.finishReasoning(event))
      if (block.mode === "answer" && block.textStarted) {
        out.push(
          LLMEvent.textEnd({
            id: block.start.id,
            providerMetadata: metadata(event),
          }),
        )
      }
      this.block = undefined
      return out
    }
  }

  export function events(input: Event[], model: Model) {
    if (!supports(model)) return input
    const state = new Normalizer()
    return input.flatMap((event) => state.push(event))
  }

  export function stream(input: Stream.Stream<Event, unknown>, model: Model) {
    if (!supports(model)) return input
    const state = new Normalizer()
    return input.pipe(Stream.flatMap((event) => Stream.fromIterable(state.push(event))))
  }
}
