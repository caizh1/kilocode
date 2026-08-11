import { createHash } from "crypto"
import path from "path"

const prefix = "@external"

export function same(left: string, right: string, api: path.PlatformPath = path): boolean {
  const a = api.resolve(left)
  const b = api.resolve(right)
  if (api.sep === "\\") return a.toLowerCase() === b.toLowerCase()
  return a === b
}

export function within(root: string, target: string, api: path.PlatformPath = path): boolean {
  const rel = api.relative(api.resolve(root), api.resolve(target))
  if (!rel || rel === ".") return true
  if (api.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${api.sep}`)) return false
  return true
}

export function token(root: string, api: path.PlatformPath = path): string {
  const value = api.resolve(root).replaceAll(api.sep, "/")
  const normalized = api.sep === "\\" ? value.toLowerCase() : value
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}

export function key(root: string, file: string, api: path.PlatformPath = path): string {
  const rel = api.relative(api.resolve(root), api.resolve(file)).replaceAll(api.sep, "/")
  return `${prefix}/${token(root, api)}/${rel}`
}

export function external(value: string): boolean {
  return value === prefix || value.startsWith(`${prefix}/`)
}

export function relative(value: string): string | undefined {
  if (!external(value)) return
  const parts = value.replaceAll("\\", "/").split("/")
  if (parts.length < 3) return
  return parts.slice(2).join("/")
}

export function id(value: string): string | undefined {
  if (!external(value)) return
  return value.replaceAll("\\", "/").split("/")[1]
}
