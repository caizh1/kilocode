// kilocode_change - new file
import * as Stream from "effect/Stream"
import type { LLMEvent as Event } from "@opencode-ai/llm"

const OPEN = "<think>"
const CLOSE = "</think>"

type TextEvent = Extract<Event, { type: "text-delta" }>
type MetaEvent = TextEvent | Extract<Event, { type: "text-end" }>

function text(event: TextEvent) {
  const raw = event as unknown as { text?: unknown; delta?: unknown }
  if (typeof raw.text === "string") return raw.text
  if (typeof raw.delta === "string") return raw.delta
  return ""
}

function tagPrefixLength(value: string, tag: string) {
  const lower = value.toLowerCase()
  const token = tag.toLowerCase()
  const max = Math.min(lower.length, token.length - 1)
  for (let i = max; i > 0; i -= 1) {
    if (lower.endsWith(token.slice(0, i))) return i
  }
  return 0
}

function textDelta(event: TextEvent, value: string): Event {
  return {
    ...event,
    text: value,
    delta: value,
  } as Event
}

function reasoningStart(id: string, event: MetaEvent): Event {
  return {
    type: "reasoning-start",
    id,
    providerMetadata: event.providerMetadata,
  } as Event
}

function reasoningDelta(id: string, value: string, event: MetaEvent): Event {
  return {
    type: "reasoning-delta",
    id,
    text: value,
    delta: value,
    providerMetadata: event.providerMetadata,
  } as Event
}

function reasoningEnd(id: string, event: MetaEvent): Event {
  return {
    type: "reasoning-end",
    id,
    providerMetadata: event.providerMetadata,
  } as Event
}

export namespace KiloSessionThinking {
  export class Normalizer {
    private pending = ""
    private open = false
    private id: string | undefined
    private seq = 0

    push(event: Event): Event[] {
      if (event.type === "text-delta") return this.consume(event)
      if (event.type === "text-end") return [...this.close(event), event]
      return [event]
    }

    private consume(event: TextEvent): Event[] {
      const value = text(event)
      if (!value) return [event]

      const out: Event[] = []
      let rest = this.pending + value
      this.pending = ""

      while (rest) {
        if (this.open) {
          const lower = rest.toLowerCase()
          const close = lower.indexOf(CLOSE)
          if (close === -1) {
            const keep = tagPrefixLength(rest, CLOSE)
            const body = keep > 0 ? rest.slice(0, -keep) : rest
            this.pending = keep > 0 ? rest.slice(-keep) : ""
            this.reason(out, body, event)
            return out
          }

          this.reason(out, rest.slice(0, close), event)
          out.push(...this.close(event))
          rest = rest.slice(close + CLOSE.length)
          continue
        }

        const lower = rest.toLowerCase()
        const open = lower.indexOf(OPEN)
        if (open === -1) {
          const keep = tagPrefixLength(rest, OPEN)
          const body = keep > 0 ? rest.slice(0, -keep) : rest
          this.pending = keep > 0 ? rest.slice(-keep) : ""
          if (body) out.push(textDelta(event, body))
          return out
        }

        const body = rest.slice(0, open)
        if (body) out.push(textDelta(event, body))
        this.start(out, event)
        rest = rest.slice(open + OPEN.length)
      }

      return out
    }

    private start(out: Event[], event: MetaEvent) {
      this.open = true
      this.pending = ""
      this.id = `think-${this.seq}`
      this.seq += 1
      out.push(reasoningStart(this.id, event))
    }

    private reason(out: Event[], value: string, event: MetaEvent) {
      if (!value) return
      if (!this.open) this.start(out, event)
      if (!this.id) return
      out.push(reasoningDelta(this.id, value, event))
    }

    private close(event: MetaEvent): Event[] {
      this.pending = ""
      if (!this.open || !this.id) return []
      const id = this.id
      this.open = false
      this.id = undefined
      return [reasoningEnd(id, event)]
    }
  }

  export function events(input: Event[]) {
    const state = new Normalizer()
    return input.flatMap((event) => state.push(event))
  }

  export function stream(input: Stream.Stream<Event, unknown>) {
    const state = new Normalizer()
    return input.pipe(Stream.flatMap((event) => Stream.fromIterable(state.push(event))))
  }
}
