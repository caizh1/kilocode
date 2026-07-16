import type { Message, Part, SessionStatusInfo } from "../types/messages"

function compact(msg: Message | undefined, parts: (id: string) => Part[]) {
  return msg?.role === "user" && parts(msg.id).some((part) => part.type === "compaction")
}

export function compactionBoundary(messages: Message[], parts: (id: string) => Part[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const user = messages[i]
    if (!user || !compact(user, parts)) continue

    for (let j = i + 1; j < messages.length; j += 1) {
      const msg = messages[j]
      if (!msg || msg.role === "user") break
      if (msg.role !== "assistant" || msg.summary !== true || msg.parentID !== user.id) continue
      if (msg.finish && msg.finish !== "error" && !msg.error) return i
      break
    }
  }
  return -1
}

export function compactionActive(messages: Message[], parts: (id: string) => Part[], status: SessionStatusInfo) {
  if (status.type !== "busy") return false

  const index = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]
      if (compact(msg, parts)) return i
    }
    return -1
  })()
  if (index < 0) return false

  const tail = messages.slice(index + 1)
  if (tail.some((msg) => msg.role === "user")) return false
  if (tail.some((msg) => msg.role === "assistant" && msg.summary !== true)) return false

  const summary = tail.find((msg) => msg.role === "assistant" && msg.summary === true)
  return !summary?.error && summary?.finish !== "error"
}
