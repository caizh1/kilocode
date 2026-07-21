/** @jsxImportSource solid-js */

import { type Component, For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { Terminal, type IBufferCell } from "@xterm/xterm"
import type { AgentConsoleActivityBlock } from "./activity"

interface Style {
  color?: string
  background?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

interface Run {
  text: string
  style: Style
}

type Line = Run[]

const PALETTE = [
  "var(--vscode-terminal-ansiBlack, #000000)",
  "var(--vscode-terminal-ansiRed, #cd3131)",
  "var(--vscode-terminal-ansiGreen, #0dbc79)",
  "var(--vscode-terminal-ansiYellow, #e5e510)",
  "var(--vscode-terminal-ansiBlue, #2472c8)",
  "var(--vscode-terminal-ansiMagenta, #bc3fbc)",
  "var(--vscode-terminal-ansiCyan, #11a8cd)",
  "var(--vscode-terminal-ansiWhite, #e5e5e5)",
  "var(--vscode-terminal-ansiBrightBlack, #666666)",
  "var(--vscode-terminal-ansiBrightRed, #f14c4c)",
  "var(--vscode-terminal-ansiBrightGreen, #23d18b)",
  "var(--vscode-terminal-ansiBrightYellow, #f5f543)",
  "var(--vscode-terminal-ansiBrightBlue, #3b8eea)",
  "var(--vscode-terminal-ansiBrightMagenta, #d670d6)",
  "var(--vscode-terminal-ansiBrightCyan, #29b8db)",
  "var(--vscode-terminal-ansiBrightWhite, #ffffff)",
]

function hex(value: number) {
  return `#${value.toString(16).padStart(6, "0")}`
}

function palette(value: number) {
  if (value < PALETTE.length) return PALETTE[value]
  if (value >= 232) {
    const shade = 8 + (value - 232) * 10
    return `rgb(${shade}, ${shade}, ${shade})`
  }
  const index = value - 16
  const step = (part: number) => (part === 0 ? 0 : 55 + part * 40)
  return `rgb(${step(Math.floor(index / 36))}, ${step(Math.floor((index % 36) / 6))}, ${step(index % 6)})`
}

function color(cell: IBufferCell, foreground: boolean) {
  if (foreground ? cell.isFgRGB() : cell.isBgRGB()) return hex(foreground ? cell.getFgColor() : cell.getBgColor())
  if (foreground ? cell.isFgPalette() : cell.isBgPalette()) {
    return palette(foreground ? cell.getFgColor() : cell.getBgColor())
  }
  return undefined
}

function style(cell: IBufferCell): Style {
  return {
    color: color(cell, true),
    background: color(cell, false),
    bold: !!cell.isBold(),
    dim: !!cell.isDim(),
    italic: !!cell.isItalic(),
    underline: !!cell.isUnderline(),
  }
}

function key(value: Style) {
  return `${value.color}|${value.background}|${value.bold}|${value.dim}|${value.italic}|${value.underline}`
}

function snapshot(term: Terminal): Line[] {
  const buffer = term.buffer.active
  const lines: Line[] = []
  const start = Math.max(0, buffer.length - 5000)
  for (let y = start; y < buffer.length; y++) {
    const line = buffer.getLine(y)
    if (!line) continue
    const runs: Line = []
    for (let x = 0; x < Math.min(line.length, term.cols); x++) {
      const cell = line.getCell(x)
      if (!cell || cell.getWidth() === 0) continue
      const text = cell.getChars() || " "
      const next = style(cell)
      const prev = runs.at(-1)
      if (prev && key(prev.style) === key(next)) prev.text += text
      else runs.push({ text, style: next })
    }
    while (runs.length > 0) {
      const last = runs.at(-1)!
      last.text = last.text.replace(/\s+$/, "")
      if (last.text) break
      runs.pop()
    }
    lines.push(runs)
  }
  while (lines.length > 1 && lines.at(-1)?.length === 0) lines.pop()
  return lines
}

const Output: Component<{ data: string }> = (props) => {
  const [lines, setLines] = createSignal<Line[]>([])
  const [cols, setCols] = createSignal(120)
  let host!: HTMLPreElement
  let frame: number | undefined
  let generation = 0

  const render = (data: string, width: number) => {
    const current = ++generation
    const term = new Terminal({
      cols: Math.max(20, width),
      rows: 24,
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: true,
    })
    term.write(data, () => {
      if (current === generation) setLines(snapshot(term))
      term.dispose()
    })
  }

  createEffect(() => {
    const data = props.data
    const width = cols()
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      render(data, width)
    })
  })

  onMount(() => {
    const resize = () => {
      const size = Number.parseFloat(getComputedStyle(host).fontSize) || 13
      setCols(Math.max(20, Math.floor(host.clientWidth / Math.max(6, size * 0.61))))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    onCleanup(() => observer.disconnect())
  })

  onCleanup(() => {
    generation += 1
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <pre ref={host} data-slot="agent-console-terminal-output">
      <For each={lines()}>
        {(line, index) => (
          <>
            <For each={line}>
              {(run) => (
                <span
                  style={{
                    color: run.style.color ?? "#fff",
                    "background-color": run.style.background,
                    "font-weight": run.style.bold ? "700" : undefined,
                    opacity: run.style.dim ? "0.78" : "1",
                    "font-style": run.style.italic ? "italic" : undefined,
                    "text-decoration": run.style.underline ? "underline" : undefined,
                  }}
                >
                  {run.text}
                </span>
              )}
            </For>
            <Show when={index() < lines().length - 1}>{"\n"}</Show>
          </>
        )}
      </For>
    </pre>
  )
}

export const TerminalActivity: Component<{ block: AgentConsoleActivityBlock }> = (props) => {
  return (
    <div
      data-component="agent-console-terminal-activity"
      data-kind={props.block.kind}
      data-running={props.block.running ? "" : undefined}
      data-source={props.block.source}
    >
      <Show when={props.block.data}>
        <Output data={props.block.data} />
      </Show>
      <Show when={props.block.kind === "run" && !props.block.running && props.block.exitCode !== undefined}>
        <div data-slot="agent-console-command-status" data-exit={props.block.exitCode === 0 ? "success" : "error"}>
          {props.block.exitCode === 0 ? "完成" : `退出码 ${props.block.exitCode}`}
        </div>
      </Show>
      <Show when={props.block.kind === "run" && props.block.running}>
        <div data-slot="agent-console-command-status" data-exit="running">
          执行中
        </div>
      </Show>
    </div>
  )
}
