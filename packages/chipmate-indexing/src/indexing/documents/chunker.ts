import { createHash } from "crypto"
import path from "path"
import type { DocumentChunk, DocumentSection } from "./types"

export function chunkDocument(
  section: DocumentSection,
  workspace: string,
  size: number,
  overlap: number,
  source?: string,
): DocumentChunk[] {
  const lines = section.text.split(/\r?\n/)
  const chunks: DocumentChunk[] = []
  let start = 0

  while (start < lines.length) {
    const first = lines[start] ?? ""
    if (first.length > size) {
      const startLine = section.kind === "text" ? section.startLine + start : section.startLine
      const endLine = section.kind === "text" ? startLine : section.endLine
      const sourceRef = ref(section, workspace, startLine, endLine, source)
      chunks.push(...splitContent(section, first, size, overlap, startLine, endLine, sourceRef))
      start += 1
      continue
    }

    const out: string[] = []
    let length = 0
    let end = start

    while (end < lines.length) {
      const line = lines[end] ?? ""
      const next = length + line.length + (out.length > 0 ? 1 : 0)
      if (out.length > 0 && next > size) break
      out.push(line)
      length = next
      end += 1
    }

    const content = out.join("\n").trim()
    if (content) {
      const startLine = section.kind === "text" ? section.startLine + start : section.startLine
      const endLine = section.kind === "text" ? section.startLine + Math.max(start, end - 1) : section.endLine
      chunks.push(chunk(section, content, startLine, endLine, ref(section, workspace, startLine, endLine, source)))
    }

    if (end >= lines.length) break
    const next = backtrack(lines, end, overlap)
    start = next > start ? next : end
  }

  return chunks
}

export function splitDocumentChunk(chunk: DocumentChunk, size: number, overlap: number): DocumentChunk[] {
  return splitContent(chunk, chunk.content, size, overlap, chunk.startLine, chunk.endLine, chunk.sourceRef)
}

function splitContent(
  section: DocumentSection,
  content: string,
  size: number,
  overlap: number,
  startLine: number,
  endLine: number,
  sourceRef: string,
): DocumentChunk[] {
  return split(content, size, overlap).map((part) => chunk(section, part, startLine, endLine, sourceRef))
}

function split(content: string, requestedSize: number, requestedOverlap: number): string[] {
  const size = Math.max(1, Math.floor(requestedSize))
  const overlap = Math.min(Math.max(0, Math.floor(requestedOverlap)), Math.floor(size * 0.2))
  const parts: string[] = []
  let start = 0

  while (start < content.length) {
    const candidate = safeEnd(content, Math.min(content.length, start + size))
    const hardEnd = candidate > start ? candidate : Math.min(content.length, start + size + 1)
    const end = hardEnd >= content.length ? content.length : semanticEnd(content, start, hardEnd, size)
    const value = content.slice(start, end).trim()
    if (value) parts.push(value)
    if (end >= content.length) break
    const next = safeStart(content, Math.max(start + 1, end - overlap))
    start = next > start ? next : end
  }

  return parts
}

function semanticEnd(content: string, start: number, hardEnd: number, size: number): number {
  const minimum = start + Math.max(1, Math.floor(size * 0.6))
  for (let index = hardEnd; index > minimum; index -= 1) {
    if (/[\s\p{P}]/u.test(content[index - 1] ?? "")) return safeEnd(content, index)
  }
  return hardEnd
}

function safeEnd(content: string, index: number): number {
  if (index <= 0 || index >= content.length) return index
  const previous = content.charCodeAt(index - 1)
  const current = content.charCodeAt(index)
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff ? index - 1 : index
}

function safeStart(content: string, index: number): number {
  if (index <= 0 || index >= content.length) return index
  const previous = content.charCodeAt(index - 1)
  const current = content.charCodeAt(index)
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff ? index - 1 : index
}

function chunk(
  section: DocumentSection,
  content: string,
  startLine: number,
  endLine: number,
  sourceRef: string,
): DocumentChunk {
  return {
    ...section,
    content,
    startLine,
    endLine,
    sourceRef,
    chunkHash: hash(`${sourceRef}\0${content}`),
  }
}

function backtrack(lines: string[], end: number, overlap: number): number {
  if (overlap <= 0) return end
  let size = 0
  let index = end
  while (index > 0 && size < overlap) {
    index -= 1
    size += (lines[index] ?? "").length + 1
  }
  return Math.max(index, end - 1)
}

function ref(section: DocumentSection, workspace: string, startLine: number, endLine: number, source?: string): string {
  const rel =
    source ??
    path.normalize(path.isAbsolute(section.filePath) ? path.relative(workspace, section.filePath) : section.filePath)
  if (section.kind === "pdf") return `${rel}#page=${section.page ?? startLine}`
  if (section.kind === "spreadsheet")
    return `${rel}#sheet=${encodeURIComponent(section.sheet ?? "Sheet")} rows=${startLine}-${endLine}`
  if (section.kind === "diagram") {
    const media = (section.mediaPath ?? "unknown").split("/").map(encodeURIComponent).join("/")
    return `${rel}#media=${media}`
  }
  return `${rel}:${startLine}-${endLine}`
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
