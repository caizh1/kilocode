import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sort(value))
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort(item)]),
  )
}
