import type { Message, Part } from "../../types/messages"

export type ConversationNavigationMode = "closed" | "inputs" | "search"

export interface UserInputEntry {
  messageID: string
  sessionID: string
  preview: string
  filterText: string
  timestamp: number
  sourceIndex: number
}

export interface UserInputJumpRequest {
  messageID: string
}

function timestamp(message: Message) {
  const value = message.time?.created ?? Date.parse(message.createdAt)
  return Number.isFinite(value) ? value : 0
}

function firstParagraph(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n").trim()
  return normalized.split(/\n\s*\n/, 1)[0]?.trim() ?? ""
}

function attachmentLabel(part: Extract<Part, { type: "file" }>, fallback: string) {
  return part.filename?.trim() || part.mime?.trim() || fallback
}

export function collectUserInputEntries(
  messages: readonly Message[],
  getParts: (messageID: string) => readonly Part[],
  attachmentFallback: string,
) {
  const entries: UserInputEntry[] = []

  messages.forEach((message, sourceIndex) => {
    if (message.role !== "user") return
    const parts = getParts(message.id)
    if (parts.some((part) => part.type === "compaction")) return

    const text = parts
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.synthetic)
      .map((part) => part.text.trim())
      .filter(Boolean)
    const files = parts.filter((part): part is Extract<Part, { type: "file" }> => part.type === "file")
    if (text.length === 0 && files.length === 0) return

    const fileLabels = files.map((part) => attachmentLabel(part, attachmentFallback))
    const rawText = text.join("\n\n")
    const preview = firstParagraph(rawText) || fileLabels[0] || attachmentFallback
    entries.push({
      messageID: message.id,
      sessionID: message.sessionID,
      preview,
      filterText: [...text, ...fileLabels].join("\n"),
      timestamp: timestamp(message),
      sourceIndex,
    })
  })

  return entries.sort((a, b) => b.timestamp - a.timestamp || b.sourceIndex - a.sourceIndex)
}

export function filterUserInputEntries(entries: readonly UserInputEntry[], query: string, locale?: string) {
  const needle = query.trim().toLocaleLowerCase(locale)
  if (!needle) return [...entries]
  return entries.filter((entry) => entry.filterText.toLocaleLowerCase(locale).includes(needle))
}

export function requestUserInputJump(detail: UserInputJumpRequest) {
  window.dispatchEvent(new CustomEvent<UserInputJumpRequest>("navigateToUserInput", { detail }))
}
