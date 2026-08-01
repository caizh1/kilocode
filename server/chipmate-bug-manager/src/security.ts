import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const derive = promisify(scrypt)

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = (await derive(password, salt, 64)) as Buffer
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, saltText, keyText] = stored.split("$")
  if (kind !== "scrypt" || !saltText || !keyText) return false
  const salt = Buffer.from(saltText, "base64url")
  const expected = Buffer.from(keyText, "base64url")
  const actual = (await derive(password, salt, expected.length)) as Buffer
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function token() {
  return randomBytes(32).toString("base64url")
}

export function inviteCode() {
  return `CM-${randomBytes(12).toString("hex").toUpperCase()}`
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(digest(left))
  const b = Buffer.from(digest(right))
  return a.length === b.length && timingSafeEqual(a, b)
}

export function sanitizeLog(value: string) {
  return value
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "")
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      "[私钥已脱敏]",
    )
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [已脱敏]")
    .replace(
      /(["'](?:token|password|secret|cookie|api[_-]?key|authorization)["']\s*:\s*["'])[^"'\r\n]+(["'])/gi,
      "$1[已脱敏]$2",
    )
    .replace(
      /(--(?:token|password|secret|cookie|api[_-]?key|authorization))\s+\S+/gi,
      "$1 [已脱敏]",
    )
    .replace(
      /\b(token|password|secret|cookie|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
      "$1=[已脱敏]",
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g,
      "[访问凭据已脱敏]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
      "[JWT 已脱敏]",
    )
    .replace(/(\bhttps?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[URL 凭据已脱敏]@")
}
