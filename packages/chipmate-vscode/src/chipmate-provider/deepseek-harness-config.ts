import type { ChipMateClient } from "@chipmate/sdk/v2"
import type { StoredProviderKey } from "../provider-actions"

type Provider = {
  options?: Record<string, unknown>
}

export type DeepSeekHarnessCredential = {
  baseURL: string
  apiKey: string
}

export type DeepSeekHarnessCredentialErrorReason =
  | "missing-base-url"
  | "missing-api-key"
  | "unsupported-auth"
  | "auth-read-failed"

export class DeepSeekHarnessCredentialError extends Error {
  constructor(
    readonly reason: DeepSeekHarnessCredentialErrorReason,
    message: string,
  ) {
    super(message)
    this.name = "DeepSeekHarnessCredentialError"
  }
}

export async function resolveDeepSeekHarnessCredential(
  client: ChipMateClient,
  providerID: string,
  provider: Provider,
  stored: StoredProviderKey | undefined,
): Promise<DeepSeekHarnessCredential> {
  const auth = await readAuth(client, providerID)
  if (auth && auth.type !== "api") {
    throw new DeepSeekHarnessCredentialError(
      "unsupported-auth",
      "ChipMate Gateway/OAuth 登录不能直接用于官方 DSH；请为所选 Provider 保存直接 NewAPI API Key",
    )
  }

  const baseURL =
    normalizeURL(option(provider.options, "baseURL")) ??
    normalizeURL(option(auth?.metadata, "baseURL")) ??
    normalizeURL(stored?.baseURL)
  if (!baseURL) throw new DeepSeekHarnessCredentialError("missing-base-url", "所选 Provider 未配置可用的 NewAPI 地址")

  const apiKey = auth?.type === "api" ? auth.key : stored?.key
  if (typeof apiKey !== "string" || !apiKey.trim())
    throw new DeepSeekHarnessCredentialError("missing-api-key", "所选 Provider 未保存直接 NewAPI API Key")
  return { baseURL, apiKey }
}

async function readAuth(client: ChipMateClient, providerID: string): Promise<Auth | undefined> {
  try {
    const response = await client.auth.get({ providerID }, { throwOnError: true })
    return parseAuth(response.data)
  } catch (error) {
    if (error instanceof DeepSeekHarnessCredentialError) throw error
    throw new DeepSeekHarnessCredentialError("auth-read-failed", "无法读取所选 Provider 的受保护凭据")
  }
}

type Auth =
  | { type: "api"; key: string; metadata?: Record<string, unknown> }
  | { type: "oauth" | "wellknown"; metadata?: Record<string, unknown> }

function parseAuth(value: unknown): Auth | undefined {
  if (value === null || value === undefined) return
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("受保护凭据格式无效")
  const auth = value as Record<string, unknown>
  if (auth.type === "api") {
    return {
      type: "api",
      key: typeof auth.key === "string" ? auth.key : "",
      metadata: record(auth.metadata),
    }
  }
  if (auth.type === "oauth" || auth.type === "wellknown") {
    return { type: auth.type, metadata: record(auth.metadata) }
  }
  throw new Error("受保护凭据格式无效")
}

function normalizeURL(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\/+$/u, "")
  if (!normalized) return
  try {
    const url = new URL(normalized)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    return normalized
  } catch {
    return
  }
}

function option(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const option = value?.[key]
  return typeof option === "string" && option.trim() ? option : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
