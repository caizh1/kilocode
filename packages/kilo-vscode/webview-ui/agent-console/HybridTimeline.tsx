/** @jsxImportSource solid-js */

import {
  type Accessor,
  type Component,
  type JSX,
  type Setter,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../src/context/session"
import { messageTurns } from "../src/context/session-queue"
import { transcriptRows, type TranscriptRow } from "../src/context/transcript-rows"
import { TranscriptRowView } from "../src/components/chat/TranscriptRow"
import { WorkingIndicator } from "../src/components/shared/WorkingIndicator"
import { TurnOutcome } from "../src/components/shared/TurnOutcome"
import type { AgentConsoleActivityEvent } from "../src/types/messages/extension-messages"
import { activityBlocks, type AgentConsoleActivityBlock } from "./activity"
import { TerminalActivity } from "./TerminalActivity"

interface Props {
  activities: () => AgentConsoleActivityEvent[]
  footer?: () => JSX.Element
  footerTarget?: () => { messageID: string; callID: string } | undefined
  error?: () => string | undefined
  failures?: () => Failure[]
  retry?: (failure: Failure) => void
}

export interface Failure {
  id: string
  input: string
  message: string
  created: number
}

type Event =
  | {
      type: "row"
      key: string
      created: number
      order: number
      row: Accessor<TranscriptRow>
      update: Setter<TranscriptRow>
    }
  | {
      type: "terminal"
      key: string
      created: number
      order: number
      block: Accessor<AgentConsoleActivityBlock>
      update: Setter<AgentConsoleActivityBlock>
    }

type Draft =
  | { type: "row"; key: string; created: number; order: number; row: TranscriptRow }
  | { type: "terminal"; key: string; created: number; order: number; block: AgentConsoleActivityBlock }

function stable(item: Draft, old?: Event): Event {
  if (item.type === "row") {
    if (old?.type === "row") {
      old.update(item.row)
      return old
    }
    const [row, update] = createSignal(item.row)
    return { ...item, row, update }
  }
  if (old?.type === "terminal") {
    old.update(item.block)
    return old
  }
  const [block, update] = createSignal(item.block)
  return { ...item, block, update }
}

function time(row: TranscriptRow): number {
  return row.message.time?.created ?? (Date.parse(row.message.createdAt) || 0)
}

export const HybridTimeline: Component<Props> = (props) => {
  const session = useSession()
  let viewport!: HTMLDivElement
  let frame: number | undefined
  let pinned = true
  const revert = () => session.revert() ?? undefined

  const rows = createMemo<TranscriptRow[]>(
    (prev) =>
      transcriptRows(
        messageTurns(session.messages(), revert(), (message) => session.getParts(message.id)),
        (id) => session.getParts(id),
        { size: 8, hidden: session.isErrorHidden, revert: revert() },
        prev,
      ),
    [],
  )

  const blocks = createMemo<AgentConsoleActivityBlock[]>(
    (prev) => activityBlocks(props.activities(), prev).filter((block) => block.kind === "run" && !block.running),
    [],
  )
  const events = createMemo<Event[]>((prev) => {
    const transcript: Draft[] = rows().map((row, order) => ({
      type: "row" as const,
      key: row.key,
      created: time(row),
      order,
      row,
    }))
    const terminal: Draft[] = blocks().map((block, order) => ({
      type: "terminal" as const,
      key: block.id,
      created: block.time,
      order: transcript.length + order,
      block,
    }))
    const prior = new Map(prev.map((event) => [`${event.type}:${event.key}`, event]))
    return [...transcript, ...terminal]
      .sort((a, b) => a.created - b.created || a.order - b.order)
      .map((event) => stable(event, prior.get(`${event.type}:${event.key}`)))
  }, [])

  const target = (row: TranscriptRow) => {
    const footer = props.footerTarget?.()
    if (!footer || row.message.id !== footer.messageID) return false
    if (row.type !== "assistant" && row.type !== "user") return false
    return row.parts.some((part) => part.type === "tool" && part.callID === footer.callID)
  }

  const targeted = createMemo(() => rows().some(target))

  const scroll = () => {
    if (!pinned) return
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (!pinned) return
      viewport.scrollTop = viewport.scrollHeight
    })
  }

  createEffect(() => {
    events()
      .map((event) => {
        if (event.type === "terminal") {
          const block = event.block()
          return `${event.key}:${block.data.length}:${block.running}`
        }
        const row = event.row()
        if (row.type === "diff" || row.type === "error") return row.key
        return row.parts.length
      })
      .join(":")
    session.status()
    scroll()
  })

  const track = () => {
    pinned = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 8
  }

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <div ref={viewport} data-slot="agent-console-timeline" role="log" aria-live="polite" onScroll={track}>
      <div data-slot="agent-console-timeline-content">
        <Show when={events().length === 0}>
          <div data-slot="agent-console-empty">
            <Icon name="sparkle" size="small" />
            <span>输入自然语言调用 Agent，输入系统命令直接执行。</span>
          </div>
        </Show>
        <For each={events()}>
          {(event) => (
            <>
              <Show when={event.type === "row" ? event.row() : undefined}>
                {(row) => <TranscriptRowView row={row()} />}
              </Show>
              <Show when={event.type === "terminal" ? event.block() : undefined}>
                {(block) => <TerminalActivity block={block()} />}
              </Show>
              <Show when={event.type === "row" && target(event.row())}>{props.footer?.()}</Show>
            </>
          )}
        </For>
        <WorkingIndicator />
        <TurnOutcome />
        <Show when={!targeted() && props.footer}>{props.footer?.()}</Show>
        <For each={props.failures?.() ?? []}>
          {(failure) => (
            <div data-slot="agent-console-dispatch-error" data-id={failure.id}>
              <div data-slot="agent-console-dispatch-input">{failure.input}</div>
              <div data-slot="agent-console-dispatch-message">{failure.message}</div>
              <Button size="small" variant="ghost" onClick={() => props.retry?.(failure)}>
                重试
              </Button>
            </div>
          )}
        </For>
        <Show when={props.error?.()}>{(message) => <div data-slot="agent-console-input-error">{message()}</div>}</Show>
      </div>
    </div>
  )
}
