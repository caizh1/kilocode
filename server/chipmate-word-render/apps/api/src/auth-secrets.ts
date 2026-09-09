import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"

export class AuthSecrets {
  private readonly key: Buffer
  private readonly breakGlass: Buffer | undefined

  constructor(masterKey: Buffer | string, breakGlass?: Buffer | string) {
    this.key = normalizeKey(masterKey)
    this.breakGlass = breakGlass === undefined ? undefined : Buffer.from(breakGlass).subarray(0, 4096)
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env) {
    const master = requiredFile(env.CHIPMATE_AUTH_MASTER_KEY_FILE, "CHIPMATE_AUTH_MASTER_KEY_FILE")
    const breakGlass = optionalFile(env.CHIPMATE_AUTH_BREAK_GLASS_KEY_FILE)
    return new AuthSecrets(master, breakGlass)
  }

  encrypt(value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", this.key, iv)
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".")
  }

  decrypt(value: string) {
    const [version, iv, tag, encrypted] = value.split(".")
    if (version !== "v1" || !iv || !tag || encrypted === undefined) throw new Error("LDAP 凭据密文格式无效。")
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8")
  }

  verifyBreakGlass(value: string) {
    if (!this.breakGlass || !value) return false
    const actual = createHash("sha256").update(value).digest()
    const expected = createHash("sha256").update(this.breakGlass).digest()
    return timingSafeEqual(actual, expected)
  }

  hasBreakGlass() {
    return Boolean(this.breakGlass)
  }
}

function normalizeKey(value: Buffer | string) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(value)
  if (source.length < 32) throw new Error("ChipMate 认证主密钥至少需要 32 字节。")
  return createHash("sha256").update(source).digest()
}

function requiredFile(path: string | undefined, name: string) {
  if (!path?.trim()) throw new Error(`${name} 未配置。`)
  return readFileSync(path.trim())
}

function optionalFile(path: string | undefined) {
  if (!path?.trim()) return undefined
  const value = readFileSync(path.trim(), "utf8").trim()
  return value || undefined
}
