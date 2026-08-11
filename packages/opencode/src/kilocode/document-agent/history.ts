import type { ModelMessage } from "ai"

type ToolPart = {
  type: "tool-call" | "tool-result"
  toolName: string
}

function toolPart(part: unknown): part is ToolPart {
  if (!part || typeof part !== "object") return false
  const value = part as { type?: unknown; toolName?: unknown }
  return (value.type === "tool-call" || value.type === "tool-result") && typeof value.toolName === "string"
}

export function documentAgentHistory(messages: ModelMessage[], available: ReadonlySet<string>): ModelMessage[] {
  return messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return [message]
    const content = message.content.filter((part) => !toolPart(part) || available.has(part.toolName))
    if (content.length === message.content.length) return [message]
    if (content.length === 0) return []
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- filtering preserves the role-specific part union
    return [{ ...message, content } as ModelMessage]
  })
}
