import { createHash } from "node:crypto"
import path from "node:path"

export function normalizeWorkspace(workspace: string): string {
  const normalized = path.resolve(workspace).replace(/\\/g, "/").replace(/\/+$/, "") || "/"
  if (/^[A-Z]:\//.test(normalized)) return normalized.charAt(0).toLowerCase() + normalized.slice(1)
  return normalized
}

export function workspaceKey(workspace: string): string {
  return createHash("sha256").update(normalizeWorkspace(workspace)).digest("hex")
}
