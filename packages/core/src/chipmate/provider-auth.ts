import { createHash } from "node:crypto"

type Credential = { type: string; metadata?: Record<string, string> }
type Options = { baseURL?: unknown; headers?: unknown; apiKey?: unknown; chipmateCredentialGuard?: unknown }
type Provider = { options?: Options; env?: readonly string[]; models?: Record<string, unknown> }

function entries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value).sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
}

/** 保存用户确认的鉴权配置摘要，防止其他配置层复活已删除的凭据。 */
export function customProviderCredentialGuard(options: Options, provider?: Provider) {
  const values: unknown[] = [new URL(String(options.baseURL)).origin, entries(options.headers), options.apiKey ?? null]
  if (provider) {
    const models = Object.entries(provider.models ?? {})
      .map(
        ([id, model]) =>
          [id, entries(model && typeof model === "object" && "headers" in model ? model.headers : undefined)] as const,
      )
      .filter(([, headers]) => headers.length > 0)
      .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
    values.push(provider.env ?? [], models)
  }
  const digest = createHash("sha256").update(JSON.stringify(values)).digest("hex")
  // 保留旧摘要读取兼容性；新保存同时绑定环境变量和模型级请求头。
  return provider ? `v2:${digest}` : digest
}

export function providerCredentialGuardMatches(options: Options | undefined, provider?: Provider) {
  if (options?.chipmateCredentialGuard === undefined) return true
  try {
    const complete =
      typeof options.chipmateCredentialGuard === "string" && options.chipmateCredentialGuard.startsWith("v2:")
    if (complete && !provider) return false
    return options.chipmateCredentialGuard === customProviderCredentialGuard(options, complete ? provider : undefined)
  } catch {
    return false
  }
}

/** 自定义密钥只允许用于保存时确认的源；路径调整仍属于同一个源。 */
export function customProviderAuthMetadata(baseURL: string) {
  return { chipmateOrigin: new URL(baseURL).origin }
}

/** 配置和凭据分步写入时，任何错配状态都必须停止加载该提供商。 */
export function mismatchedProviderCredentials(
  providers: Record<string, Provider | null> | undefined,
  credentials: Record<string, Credential>,
) {
  const overridden = Object.entries(providers ?? {}).flatMap(([id, provider]) =>
    providerCredentialGuardMatches(provider?.options, provider ?? undefined) ? [] : [id],
  )
  return [
    ...overridden,
    ...Object.entries(credentials).flatMap(([id, credential]) => {
      const origin = credential.type === "api" ? credential.metadata?.chipmateOrigin : undefined
      if (origin === undefined) return []
      const baseURL = providers?.[id]?.options?.baseURL
      if (typeof baseURL !== "string") return [id]
      try {
        return new URL(baseURL).origin === origin ? [] : [id]
      } catch {
        return [id]
      }
    }),
  ]
}
