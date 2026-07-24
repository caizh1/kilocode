export interface TerminalStyle {
  color?: string
  background?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export interface TerminalRun {
  text: string
  style: TerminalStyle
}

export type TerminalLine = TerminalRun[]

type Cell = { text: string; style: TerminalStyle }
type State = { lines: Cell[][]; style: TerminalStyle; x: number; y: number }

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

function color(value: number): string | undefined {
  if (value >= 0 && value < PALETTE.length) return PALETTE[value]
  if (value >= 232 && value <= 255) {
    const shade = 8 + (value - 232) * 10
    return `rgb(${shade}, ${shade}, ${shade})`
  }
  if (value < 16 || value > 231) return
  const index = value - 16
  const step = (part: number) => (part === 0 ? 0 : 55 + part * 40)
  return `rgb(${step(Math.floor(index / 36))}, ${step(Math.floor((index % 36) / 6))}, ${step(index % 6)})`
}

function key(value: TerminalStyle): string {
  return `${value.color}|${value.background}|${value.bold}|${value.dim}|${value.italic}|${value.underline}`
}

function line(state: State): Cell[] {
  while (!state.lines[state.y]) state.lines.push([])
  return state.lines[state.y]
}

function move(state: State, row: number, col: number): void {
  state.y = Math.max(0, Math.min(4999, row))
  state.x = Math.max(0, Math.min(32768, col))
  line(state)
}

function put(state: State, text: string): void {
  const cells = line(state)
  while (cells.length < state.x) cells.push({ text: " ", style: {} })
  cells[state.x] = { text, style: { ...state.style } }
  state.x++
}

function basic(style: TerminalStyle, value: number): TerminalStyle | undefined {
  if (value === 0) return {}
  if (value === 1) return { ...style, bold: true }
  if (value === 2) return { ...style, dim: true }
  if (value === 3) return { ...style, italic: true }
  if (value === 4) return { ...style, underline: true }
  if (value === 22) return { ...style, bold: false, dim: false }
  if (value === 23) return { ...style, italic: false }
  if (value === 24) return { ...style, underline: false }
  if (value >= 30 && value <= 37) return { ...style, color: color(value - 30) }
  if (value >= 90 && value <= 97) return { ...style, color: color(value - 90 + 8) }
  if (value >= 40 && value <= 47) return { ...style, background: color(value - 40) }
  if (value >= 100 && value <= 107) return { ...style, background: color(value - 100 + 8) }
  if (value === 39) return { ...style, color: undefined }
  if (value === 49) return { ...style, background: undefined }
  return
}

function sgr(state: State, values: number[]): void {
  const params = values.length ? values : [0]
  for (let index = 0; index < params.length; index++) {
    const value = params[index]
    const next = basic(state.style, value)
    if (next) {
      state.style = next
      continue
    }
    if ((value !== 38 && value !== 48) || (params[index + 1] !== 5 && params[index + 1] !== 2)) continue
    if (params[index + 1] === 5) {
      const shade = color(params[index + 2] ?? -1)
      state.style = value === 38 ? { ...state.style, color: shade } : { ...state.style, background: shade }
      index += 2
      continue
    }
    const red = Math.max(0, Math.min(255, params[index + 2] ?? 0))
    const green = Math.max(0, Math.min(255, params[index + 3] ?? 0))
    const blue = Math.max(0, Math.min(255, params[index + 4] ?? 0))
    const shade = `rgb(${red}, ${green}, ${blue})`
    state.style = value === 38 ? { ...state.style, color: shade } : { ...state.style, background: shade }
    index += 4
  }
}

function erase(state: State, value: number): void {
  const cells = line(state)
  if (value === 1) {
    for (let index = 0; index <= state.x; index++) cells[index] = { text: " ", style: {} }
    return
  }
  if (value === 2) {
    cells.splice(0)
    return
  }
  cells.splice(state.x)
}

function csi(state: State, final: string, raw: string): void {
  const params = raw.replace(/^[?>!]/, "").split(";").map((value) => Number(value || 0))
  const first = params[0] || 1
  if (final === "m") sgr(state, params)
  else if (final === "A") move(state, state.y - first, state.x)
  else if (final === "B") move(state, state.y + first, state.x)
  else if (final === "C") move(state, state.y, state.x + first)
  else if (final === "D") move(state, state.y, state.x - first)
  else if (final === "G") move(state, state.y, first - 1)
  else if (final === "H" || final === "f") move(state, (params[0] || 1) - 1, (params[1] || 1) - 1)
  else if (final === "K") erase(state, params[0] ?? 0)
  else if (final === "J" && (params[0] ?? 0) === 2) {
    state.lines.splice(0, state.lines.length, [])
    move(state, 0, 0)
  }
}

function escape(state: State, data: string, index: number): number | undefined {
  if (data[index] !== "\x1b") return
  if (data[index + 1] === "[") {
    const match = data.slice(index + 2).match(/^([0-9;:?>!]*)[ -/]?([@-~])/)
    if (!match) return index + 1
    csi(state, match[2], match[1].replaceAll(":", ";"))
    return index + 2 + match[0].length
  }
  if (data[index + 1] !== "]") return index + Math.min(2, data.length - index)
  const bel = data.indexOf("\x07", index + 2)
  const st = data.indexOf("\x1b\\", index + 2)
  const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)
  if (end === -1) return data.length
  return end + (end === st ? 2 : 1)
}

function control(state: State, char: string): boolean {
  if (char === "\r") state.x = 0
  else if (char === "\n") {
    if (state.y < 4999) move(state, state.y + 1, 0)
    else {
      state.lines.shift()
      state.lines.push([])
      state.x = 0
    }
  } else if (char === "\b") state.x = Math.max(0, state.x - 1)
  else if (char === "\t") {
    const stop = state.x + (8 - (state.x % 8))
    while (state.x < stop) put(state, " ")
  } else return false
  return true
}

function runs(cells: Cell[]): TerminalLine {
  const clean = cells.slice()
  while (clean.at(-1)?.text === " ") clean.pop()
  const output: TerminalRun[] = []
  for (const cell of clean) {
    const last = output.at(-1)
    if (last && key(last.style) === key(cell.style)) last.text += cell.text
    else output.push({ text: cell.text, style: cell.style })
  }
  return output
}

export function terminalLines(data: string): TerminalLine[] {
  const state: State = { lines: [[]], style: {}, x: 0, y: 0 }
  for (let index = 0; index < data.length; ) {
    const next = escape(state, data, index)
    if (next !== undefined) {
      index = next
      continue
    }
    const char = data[index]
    if (control(state, char)) {
      index++
      continue
    }
    const code = data.codePointAt(index)
    if (code === undefined) break
    const text = String.fromCodePoint(code)
    if (code >= 0x20 && code !== 0x7f) put(state, text)
    index += text.length
  }
  const output = state.lines.slice(-5000).map(runs)
  while (output.length > 1 && output.at(-1)?.length === 0) output.pop()
  return output
}
