/** @jsxImportSource solid-js */

import { type Accessor, type Component, For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useSession } from "../src/context/session"
import { messageTurns } from "../src/context/session-queue"
import { transcriptRows, type TranscriptRow } from "../src/context/transcript-rows"
import { TranscriptRowView } from "../src/components/chat/TranscriptRow"
import { WorkingIndicator } from "../src/components/shared/WorkingIndicator"
import { TurnOutcome } from "../src/components/shared/TurnOutcome"

export interface ShellEntry {
  id: string
  command: string
  output: string
  created: number
  state: "running" | "complete" | "error"
}

interface Props {
  entries: Accessor<ShellEntry[]>
  footer?: () => import("solid-js").JSX.Element
}

type Event =
  | { type: "agent"; key: string; created: number; order: number; row: TranscriptRow }
  | { type: "shell"; key: string; created: number; order: number; entry: ShellEntry }

function time(row: TranscriptRow): number {
  return row.message.time?.created ?? (Date.parse(row.message.createdAt) || 0)
}

function clean(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:[@-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r(?!\n)/g, "")
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

  const events = createMemo<Event[]>(() => {
    const agent = rows().map((row, order) => ({
      type: "agent" as const,
      key: row.key,
      created: time(row),
      order,
      row,
    }))
    const shell = props.entries().map((entry, order) => ({
      type: "shell" as const,
      key: entry.id,
      created: entry.created,
      order: rows().length + order,
      entry,
    }))
    return [...agent, ...shell].sort((a, b) => a.created - b.created || a.order - b.order)
  })

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
        if (event.type === "shell") return event.entry.output.length
        if (event.row.type === "diff" || event.row.type === "error") return event.row.key
        return event.row.parts.length
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
            <Show
              when={event.type === "shell" ? event.entry : undefined}
              fallback={<TranscriptRowView row={(event as Extract<Event, { type: "agent" }>).row} />}
            >
              {(entry) => (
                <section data-component="agent-console-shell-entry" data-state={entry().state}>
                  <div data-slot="agent-console-shell-command">
                    <span data-slot="agent-console-prompt">$</span>
                    <code>{entry().command}</code>
                  </div>
                  <Show when={entry().output}>
                    <pre>{clean(entry().output)}</pre>
                  </Show>
                  <Show when={entry().state === "running"}>
                    <span data-slot="agent-console-shell-running">执行中…</span>
                  </Show>
                </section>
              )}
            </Show>
          )}
        </For>
        <WorkingIndicator />
        <TurnOutcome />
        <Show when={props.footer}>{props.footer?.()}</Show>
      </div>
    </div>
  )
}
