import type { IndexingConfig } from "@chipmate/chipmate-indexing/config"

type Auth = unknown

type Env = {
  CHIPMATE_API_KEY?: string
  CHIPMATE_ORG_ID?: string
}

type Provider = {
  key?: unknown
  options?: Record<string, unknown>
}

export type ChipMateIndexingAuth = {
  apiKey?: string
  baseUrl?: string
  organizationId?: string
}

const providers = [
  "openai",
  "ollama",
  "openai-compatible",
  "gemini",
  "mistral",
  "vercel-ai-gateway",
  "bedrock",
  "openrouter",
  "voyage",
]

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed || undefined
}

function token(auth: Auth): string | undefined {
  const data = record(auth)
  if (data.type === "api") return text(data.key)
  if (data.type === "oauth") return text(data.access)
  return
}

function org(auth: Auth): string | undefined {
  const data = record(auth)
  if (data.type === "oauth") return text(data.accountId)
  return
}

function value(input: unknown): boolean {
  if (input === undefined || input === null) return false
  if (typeof input === "string") return input.trim().length > 0
  if (typeof input === "object") return Object.values(input).some(value)
  return true
}

function hasOtherProvider(indexing: unknown): boolean {
  const cfg = record(indexing)
  return providers.some((provider) => value(cfg[provider]))
}

export function resolveChipMateIndexingAuth(input: {
  config?: unknown
  provider?: Provider
  auth?: Auth
  env?: Env
}): ChipMateIndexingAuth {
  const config = record(input.config)
  const options = record(record(config.provider).chipmate)
  const provider = input.provider ?? record(input.provider)
  const providerOptions = record(provider.options)
  const providerConfig = record(options.options)
  const chipmate = record(record(config.indexing).chipmate)
  const env = input.env ?? process.env

  return {
    apiKey:
      text(chipmate.apiKey) ??
      text(providerConfig.apiKey) ??
      token(input.auth) ??
      text(provider.key) ??
      text(providerOptions.chipmateToken) ??
      text(env.CHIPMATE_API_KEY),
    baseUrl: text(chipmate.baseUrl) ?? text(providerConfig.baseURL) ?? text(providerConfig.baseUrl),
    organizationId:
      text(chipmate.organizationId) ??
      text(providerConfig.chipmateOrganizationId) ??
      org(input.auth) ??
      text(providerOptions.chipmateOrganizationId) ??
      text(env.CHIPMATE_ORG_ID),
  }
}

export function hasChipMateIndexingAuth(input: Parameters<typeof resolveChipMateIndexingAuth>[0]): boolean {
  return !!resolveChipMateIndexingAuth(input).apiKey
}

export function shouldDefaultIndexingToChipMate(indexing: unknown, auth: ChipMateIndexingAuth): boolean {
  const cfg = record(indexing)
  if (cfg.provider !== undefined || !auth.apiKey) return false
  return !hasOtherProvider(cfg)
}

export function indexingWithChipMateDefault(
  indexing: IndexingConfig | undefined,
  auth: ChipMateIndexingAuth,
): IndexingConfig | undefined {
  if (!shouldDefaultIndexingToChipMate(indexing, auth)) return indexing
  return { ...indexing, provider: "chipmate" }
}
