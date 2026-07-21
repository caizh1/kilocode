/** @jsxImportSource solid-js */

import { type Component, type JSX, For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useSession } from "../src/context/session"
import { messageTurns } from "../src/context/session-queue"
import { transcriptRows, type TranscriptRow } from "../src/context/transcript-rows"
import { TranscriptRowView } from "../src/components/chat/TranscriptRow"
import { WorkingIndicator } from "../src/components/shared/WorkingIndicator"
import { TurnOutcome } from "../src/components/shared/TurnOutcome"
import type { AgentConsoleActivityEvent } from "../src/types/messages/extension-messages"
import { activityBlocks } from "./activity"
import { TerminalActivity } from "./TerminalActivity"

interface Props {
  activities: () => AgentConsoleActivityEvent[]
  footer?: () => JSX.Element
  footerTarget?: () => { messageID: string; callID: string } | undefined
  error?: () => string | undefined
  prompt: () => JSX.Element
}

function time(row: TranscriptRow): number {
  return row.message.time?.created ?? (Date.parse(row.message.createdAt) || 0)
}

export const HybridTimeline: Component<Props> = (props) => {
  const session = useSession()
  let viewport!: HTMLDivElement
  let frame: number | undefined
  const revert = () => session.revert() ?? undefined

  const rows = createMemo(() =>
    transcriptRows(
      messageTurns(session.messages(), revert(), (message) => session.getParts(message.id)),
      (id) => session.getParts(id),
      { size: 8, hidden: session.isErrorHidden, revert: revert() },
    ),
  )

  const events = createMemo(() => {
    const transcript = rows().map((row, order) => ({
      type: "row" as const,
      key: row.key,
      created: time(row),
      order,
      row,
    }))
    const terminal = activityBlocks(props.activities()).map((block, order) => ({
      type: "terminal" as const,
      key: block.id,
      created: block.time,
      order: transcript.length + order,
      block,
    }))
    return [...transcript, ...terminal]
      .sort((a, b) => a.created - b.created || a.order - b.order)
  })

  const target = (row: TranscriptRow) => {
    const footer = props.footerTarget?.()
    if (!footer || row.message.id !== footer.messageID) return false
    if (row.type !== "assistant" && row.type !== "user") return false
    return row.parts.some((part) => part.type === "tool" && part.callID === footer.callID)
  }

  const targeted = createMemo(() => rows().some(target))

  const scroll = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      viewport.scrollTop = viewport.scrollHeight
    })
  }

  createEffect(() => {
    events()
      .map((event) => {
        if (event.type === "terminal") return `${event.key}:${event.block.data.length}:${event.block.running}`
        const row = event.row
        if (row.type === "diff" || row.type === "error") return row.key
        return row.parts.length
      })
      .join(":")
    session.status()
    scroll()
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <div ref={viewport} data-slot="agent-console-timeline" role="log" aria-live="polite">
      <div data-slot="agent-console-timeline-content">
        <Show when={events().length === 0}>
          <div data-slot="agent-console-empty">
            <Icon name="sparkle" size="small" />
            <span>输入自然语言调用 Agent，输入 Linux 命令直接执行。</span>
          </div>
        </Show>
        <For each={events()}>
          {(event) => (
            <>
              <Show when={event.type === "row" ? event.row : undefined}>
                {(row) => <TranscriptRowView row={row()} />}
              </Show>
              <Show when={event.type === "terminal" ? event.block : undefined}>
                {(block) => <TerminalActivity block={block()} />}
              </Show>
              <Show when={event.type === "row" && target(event.row)}>{props.footer?.()}</Show>
            </>
          )}
        </For>
        <WorkingIndicator />
        <TurnOutcome />
        <Show when={!targeted() && props.footer}>{props.footer?.()}</Show>
        <Show when={props.error?.()}>{(message) => <div data-slot="agent-console-input-error">{message()}</div>}</Show>
        {props.prompt()}
      </div>
    </div>
  )
}
