import type { ProviderMetadata } from "@opencode-ai/llm"
import { isRecord } from "@/util/record"

export namespace ChipMateResponseMetadata {
  function vercelID(value: unknown) {
    if (typeof value !== "string") return
    const id = value.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(id)) return
    return id
  }

  export function write(metadata: ProviderMetadata | undefined, headers: Record<string, string> | undefined) {
    const id = vercelID(Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "x-vercel-id")?.[1])
    if (!id) return metadata
    const chipmate = isRecord(metadata?.chipmate) ? metadata.chipmate : {}
    return { ...metadata, chipmate: { ...chipmate, vercelID: id } }
  }

  export function read(metadata: ProviderMetadata | undefined) {
    const chipmate = metadata?.chipmate
    if (!isRecord(chipmate)) return
    return vercelID(chipmate.vercelID)
  }
}
