import {
  deriveChipmateServerEndpoints,
  extractChipmateServerOrigin,
  normalizeChipmateServerBaseUrl,
} from "../src/shared/chipmate-server"

export type PackagedChipmateServerInput = {
  baseUrl?: string
  marketplace?: string
  word?: string
  mermaid?: string
}

export type PackagedChipmateServerDefaults = {
  baseUrl?: string
  marketplace?: string
  word?: string
  mermaid?: string
  plantuml?: string
}

type Manifest = {
  contributes?: {
    configuration?: {
      properties?: Record<string, { default?: unknown }>
    }
  }
}

export function resolvePackagedChipmateServer(input: PackagedChipmateServerInput): PackagedChipmateServerDefaults {
  const values = [
    input.baseUrl ? normalizeChipmateServerBaseUrl(input.baseUrl) : undefined,
    legacy(input.marketplace, "/marketplace", "marketplace"),
    legacy(input.word, "/render/word", "Word renderer"),
    legacy(input.mermaid, "/render/mermaid", "Mermaid renderer"),
  ].filter((value): value is string => Boolean(value))
  if (values.length === 0) return {}
  const origins = new Set(values)
  if (origins.size !== 1) {
    throw new Error(`ChipMate Server package defaults use different origins: ${[...origins].join(", ")}`)
  }
  const baseUrl = values[0]!
  const endpoints = deriveChipmateServerEndpoints(baseUrl)
  return {
    baseUrl,
    marketplace: endpoints.marketplace,
    word: endpoints.word,
    mermaid: endpoints.mermaid,
    plantuml: endpoints.plantuml,
  }
}

export function applyPackagedChipmateServer(manifest: Manifest, defaults: PackagedChipmateServerDefaults) {
  const props = manifest.contributes?.configuration?.properties
  if (!props)
    throw new Error("Cannot inject ChipMate Server defaults: package.json configuration properties are missing.")
  if (defaults.baseUrl) props["chipmate.v2.chipmateServer.baseUrl"].default = defaults.baseUrl
  if (defaults.marketplace) props["chipmate.v2.marketplace.baseUrl"].default = defaults.marketplace
  if (defaults.word) props["chipmate.v2.documents.wordRender.remoteEndpoint"].default = defaults.word
  if (defaults.mermaid) props["chipmate.v2.documents.mermaidRender.remoteEndpoint"].default = defaults.mermaid
}

export async function restorePackagedManifest(path: string, source: string) {
  await Bun.write(path, source)
}

function legacy(value: string | undefined, suffix: string, label: string): string | undefined {
  if (!value) return undefined
  const origin = extractChipmateServerOrigin(value, suffix)
  if (origin) return origin
  throw new Error(`${label} package default is not a valid ${suffix} endpoint: ${value}`)
}
