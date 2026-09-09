import type { ProviderMetadata } from "@opencode-ai/llm"
import { isRecord } from "@/util/record"

export namespace ChipMateResponseMetadata {
  function requestID(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined
    const id = value.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(id)) return undefined
    return id
  }

  const header = (headers: Record<string, string> | undefined, name: string) =>
    Object.entries(headers ?? {}).find(([candidate]) => candidate.toLowerCase() === name)?.[1]

  export function write(metadata: ProviderMetadata | undefined, headers: Record<string, string> | undefined) {
    const vercelID = requestID(header(headers, "x-vercel-id"))
    const newAPIRequestID = requestID(header(headers, "x-oneapi-request-id"))
    if (!vercelID && !newAPIRequestID) return metadata
    const chipmate = isRecord(metadata?.chipmate) ? metadata.chipmate : {}
    return {
      ...metadata,
      chipmate: {
        ...chipmate,
        ...(vercelID ? { vercelID } : {}),
        ...(newAPIRequestID ? { newAPIRequestID } : {}),
      },
    }
  }

  export function read(metadata: ProviderMetadata | undefined): string | undefined {
    const chipmate = metadata?.chipmate
    if (!isRecord(chipmate)) return undefined
    return requestID(chipmate.vercelID)
  }

  export function readNewAPI(metadata: ProviderMetadata | undefined): string | undefined {
    const chipmate = metadata?.chipmate
    if (!isRecord(chipmate)) return undefined
    return requestID(chipmate.newAPIRequestID)
  }
}
