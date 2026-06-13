import * as vscode from "vscode"
import { distance } from "fastest-levenshtein"
import type { QwenAutocompleteHelperVars } from "./helperVars"

export type QwenStreamFilterInput = {
  completion: string
  suffix: string
  stopTokens: string[]
  helper: QwenAutocompleteHelperVars
  position: vscode.Position
  multiline: boolean
}

export const PREFIXES_TO_SKIP = ["<COMPLETION>"]

const STOP_AT_PATTERNS = ["diff --git"]
const LINES_TO_STOP_AT = ["# End of file.", "<STOP EDITING HERE", "<|/updated_code|>", "```"]
const BRACKET_ENDING_CHARS = [")", "]", "}", ";"]
const SEQUENCE_LENGTH = 20
const COMMENT = "//"

// Non-streaming-compatible subset of Continue stream transforms.
// Source: Continue commit eaa23c5a9de86049dff765f635c18f61d1d043bb
// - core/autocomplete/generation/CompletionStreamer.ts
// - core/autocomplete/filtering/streamTransforms/StreamTransformPipeline.ts
// - core/autocomplete/filtering/streamTransforms/charStream.ts
// - core/autocomplete/filtering/streamTransforms/lineStream.ts
//
// This runs after qwen-direct receives a complete /v1/completions response, so
// it can truncate/filter displayed text but cannot perform upstream fullStop.
export function filterQwenCompletion(input: QwenStreamFilterInput): string {
  const stopped = stopAtStartOfText(stopAtStopTokensText(input.completion, [...input.stopTokens, ...STOP_AT_PATTERNS]), input.suffix)
  const below = lineBelowCursor(input.helper, input.position)
  const lines = stopped.split(/\r?\n/)
  const filtered = stopAtSimilarLine(
    noDoubleNewLine(
      skipPrefixes(
        avoidPathLine(
          avoidEmptyComments(
            stopAtRepeatingLines(stopAtLinesExact(stopAtLines(lines), below.trim() === "" ? [] : [below])),
            COMMENT,
          ),
          COMMENT,
        ),
      ),
    ),
    below,
  )
  const text = filtered.join("\n")
  if (input.multiline) return text
  return text.split("\n", 1)[0] ?? ""
}

export function lineIsRepeated(a: string, b: string): boolean {
  if (a.length <= 4 || b.length <= 4) {
    return false
  }

  const left = a.trim()
  const right = b.trim()
  return distance(left, right) / right.length < 0.1
}

function stopAtStopTokensText(text: string, tokens: string[]): string {
  const hits = tokens.map((token) => text.indexOf(token)).filter((index) => index >= 0)
  if (hits.length === 0) return text
  return text.slice(0, Math.min(...hits))
}

function stopAtStartOfText(text: string, suffix: string): string {
  if (suffix.length < SEQUENCE_LENGTH) return text

  const target = suffix.trimStart().slice(0, Math.floor(SEQUENCE_LENGTH * 1.5))
  let buffer = ""
  let output = ""

  for (const char of text) {
    buffer += char

    if (buffer.length >= SEQUENCE_LENGTH && target.includes(buffer)) {
      return output
    }

    while (buffer.length > SEQUENCE_LENGTH) {
      output += buffer[0]
      buffer = buffer.slice(1)
    }
  }

  return output + buffer
}

function stopAtLines(lines: string[]): string[] {
  const output: string[] = []
  for (const line of lines) {
    if (shouldStopAtLine(line)) break
    output.push(line)
  }
  return output
}

function shouldStopAtLine(line: string): boolean {
  for (const stop of LINES_TO_STOP_AT) {
    if (!line.includes(stop)) continue

    const valid = validatePatternInLine(line, stop)
    if (!valid.isValid) continue

    const trimmed = line.trimStart()
    if (trimmed.startsWith(stop)) return true

    const before = valid.beforePattern.trimEnd()
    if (before.length < valid.beforePattern.length) return true
  }

  return false
}

function validatePatternInLine(line: string, pattern: string): { isValid: boolean; beforePattern: string } {
  const index = line.indexOf(pattern)
  if (index === -1) return { isValid: false, beforePattern: "" }

  if (index > 0) {
    const char = line[index - 1]
    if (char && !char.match(/\s/)) return { isValid: false, beforePattern: "" }
  }

  const before = line.substring(0, index)
  const single = (before.match(/'/g) || []).length
  const double = (before.match(/"/g) || []).length
  if (single % 2 !== 0 || double % 2 !== 0) return { isValid: false, beforePattern: before }

  return { isValid: true, beforePattern: before }
}

function stopAtLinesExact(lines: string[], stops: string[]): string[] {
  if (stops.length === 0) return lines
  const output: string[] = []
  for (const line of lines) {
    if (stops.some((stop) => line === stop)) break
    output.push(line)
  }
  return output
}

function stopAtRepeatingLines(lines: string[]): string[] {
  let previous: string | undefined
  let repeats = 0
  const output: string[] = []

  for (const line of lines) {
    if (line === previous) {
      repeats++
      if (repeats === 3) return output
    } else {
      output.push(line)
      repeats = 1
    }
    previous = line
  }

  return output
}

function avoidEmptyComments(lines: string[], comment: string): string[] {
  return lines.filter((line) => line.trim() !== comment)
}

function avoidPathLine(lines: string[], comment: string): string[] {
  return lines.filter((line) => !line.startsWith(`${comment} Path: `))
}

function skipPrefixes(lines: string[]): string[] {
  const output: string[] = []
  let first = true

  for (const line of lines) {
    if (first) {
      const match = PREFIXES_TO_SKIP.find((prefix) => line.startsWith(prefix))
      if (match) {
        output.push(line.slice(match.length))
        continue
      }
      first = false
    }
    output.push(line)
  }

  return output
}

function noDoubleNewLine(lines: string[]): string[] {
  const output: string[] = []
  let first = true

  for (const line of lines) {
    if (line.trim() === "" && !first) return output
    first = false
    output.push(line)
  }

  return output
}

function stopAtSimilarLine(lines: string[], line: string): string[] {
  const trimmed = line.trim()
  const bracket = isBracketEnding(trimmed)
  const output: string[] = []

  for (const next of lines) {
    if (trimmed === "") {
      output.push(next)
      continue
    }

    if (bracket && trimmed.trim() === next.trim()) {
      output.push(next)
      continue
    }

    if (next === line) break
    if (lineIsRepeated(next, trimmed)) break

    output.push(next)
  }

  return output
}

function isBracketEnding(line: string): boolean {
  return line
    .trim()
    .split("")
    .some((char) => BRACKET_ENDING_CHARS.includes(char))
}

function lineBelowCursor(helper: QwenAutocompleteHelperVars, position: vscode.Position): string {
  let line = ""
  let offset = 1
  while (line.trim() === "" && position.line + offset <= helper.fileLines.length - 1) {
    line = helper.fileLines[Math.min(position.line + offset, helper.fileLines.length - 1)] ?? ""
    offset++
  }
  return line
}
