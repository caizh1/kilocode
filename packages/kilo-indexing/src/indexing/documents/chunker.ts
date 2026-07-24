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
      const sourceRef = ref(section, workspace, startLine, endLine, source)
      chunks.push({
        ...section,
        content,
        startLine,
        endLine,
        sourceRef,
        chunkHash: hash(`${sourceRef}\0${content}`),
      })
    }

    if (end >= lines.length) break
    const next = backtrack(lines, end, overlap)
    start = next > start ? next : end
  }

  return chunks
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
