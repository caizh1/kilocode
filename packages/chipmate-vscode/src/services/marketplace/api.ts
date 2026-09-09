import { parse as parseYaml } from "yaml"
import { MarketplaceApiError, safeMarketplaceErrorText } from "./errors"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  AgentMarketplaceItem,
  SkillMarketplaceItem,
  RawSkill,
  MarketplaceUploadPayload,
  MarketplaceUser,
  MarketCapabilities,
  MarketStatus,
  InstallationState,
  AnalyticsSeries,
  PublicationPatch,
  PublicationRun,
  SkillDetail,
  MarketplaceErrorReason,
} from "./types"
import type { MarketEvent } from "./analytics"

const BASE_URL = "https://api.chipmate.ai/api/marketplace"
const CACHE_TTL = 300_000
const MAX_RETRIES = 3
const TIMEOUT = 10_000

type FetchText = (url: string) => Promise<string>

export interface MarketplaceApiClientOptions {
  baseUrl?: string
  skillsOnly?: boolean
  fetchText?: FetchText
  disabledReason?: string
}

export type MarketplaceAuthorize = <T>(task: (accessToken: string) => Promise<T>, interactive?: boolean) => Promise<T>

export interface InstallIntent {
  skillId: string
  revision: number
  sha256: string
  downloadUrl: string
}

export interface InstallationSync {
  skillId: string
  revision: number
  sha256: string
  scope: "global" | "project"
  status: "installed" | "updating" | "removed" | "local-unmanaged"
  clientId: string
  workspaceId?: string
  changedAt: string
}

interface CacheEntry {
  data: unknown
  timestamp: number
}

export function kebabToTitleCase(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function parseResponse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return parseYaml(text)
  }
}

function transformSkill(raw: RawSkill): SkillMarketplaceItem {
  const display = raw.name?.trim() || kebabToTitleCase(raw.id)
  return {
    type: "skill" as const,
    id: raw.id,
    name: display,
    displayName: display,
    description: raw.description,
    author: raw.uploadedBy || raw.author,
    category: raw.category,
    displayCategory: kebabToTitleCase(raw.category),
    githubUrl: raw.githubUrl,
    content: raw.content,
    uploadedBy: raw.uploadedBy,
    uploadedAt: raw.uploadedAt,
    updatedAt: raw.updatedAt,
    downloadCount: typeof raw.downloadCount === "number" ? raw.downloadCount : undefined,
    stars: typeof raw.stars === "number" ? raw.stars : undefined,
    suggest_for: raw.suggest_for,
  }
}

async function fetchWithRetry(url: string, fetchText: FetchText = defaultFetchText, attempt = 0): Promise<string> {
  try {
    return await fetchText(url)
  } catch (err) {
    if (attempt >= MAX_RETRIES - 1) throw err
    const delay = 1000 * Math.pow(2, attempt)
    await new Promise((resolve) => setTimeout(resolve, delay))
    return fetchWithRetry(url, fetchText, attempt + 1)
  }
}

async function defaultFetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) {
      throw new MarketplaceApiError(`HTTP ${response.status}: ${response.statusText}`, { status: response.status })
    }
    return await response.text()
  } catch (err) {
    if (err instanceof MarketplaceApiError) throw err
    const message = err instanceof Error ? err.message : String(err)
    const reason = /aborted|aborterror|timed? ?out/i.test(message)
      ? "timeout"
      : /invalid[ -]?url|err_invalid_url/i.test(message)
        ? "invalid-url"
        : "network"
    throw new MarketplaceApiError(safeMarketplaceErrorText(message) || "marketplace-network-error", { reason })
  } finally {
    clearTimeout(timer)
  }
}

function fetchErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/aborted|aborterror|operation was aborted/i.test(message)) return "连接 ChipMate Server 超时或被中止"
  if (/HTTP 404/i.test(message)) return "未找到技能目录或 skills.json"
  return message
}

export class MarketplaceApiClient {
  private cache = new Map<string, CacheEntry>()
  private capability: MarketCapabilities | null | undefined
  private readonly baseUrl: string
  private readonly skillsOnly: boolean
  private readonly fetchText: FetchText
  private readonly disabledReason?: string
  private authorization?: MarketplaceAuthorize

  constructor(options: MarketplaceApiClientOptions = {}) {
    this.baseUrl = options.disabledReason ? "" : normalizeBaseUrl(options.baseUrl) || BASE_URL
    this.skillsOnly = options.skillsOnly ?? false
    this.fetchText = options.fetchText ?? defaultFetchText
    this.disabledReason = options.disabledReason
  }

  private getCached(key: string): unknown | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data
  }

  marketplaceBaseUrl(): string {
    return this.baseUrl
  }

  setAuthorization(authorization: MarketplaceAuthorize) {
    this.authorization = authorization
  }

  private protected<T>(accessToken: string, task: (token: string) => Promise<T>) {
    return this.authorization ? this.authorization(task, false) : task(accessToken)
  }

  isSkillsOnly(): boolean {
    return this.skillsOnly
  }

  marketplaceMode(): "skills-only" | "full" {
    return this.skillsOnly ? "skills-only" : "full"
  }

  serverBaseUrl(): string {
    return this.baseUrl.replace(/\/marketplace$/i, "")
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  private async fetchMcps(): Promise<McpMarketplaceItem[]> {
    const cached = this.getCached("mcps")
    if (cached) return cached as McpMarketplaceItem[]

    const text = await fetchWithRetry(`${this.baseUrl}/mcps`, this.fetchText)
    const parsed = parseResponse(text) as { items?: unknown[] }
    const items = (parsed.items ?? []) as Array<Record<string, unknown>>
    const result = items.map((item) => ({ ...item, type: "mcp" as const }) as McpMarketplaceItem)
    this.setCache("mcps", result)
    return result
  }

  private async fetchAgents(): Promise<AgentMarketplaceItem[]> {
    const cached = this.getCached("agents")
    if (cached) return cached as AgentMarketplaceItem[]

    const text = await fetchWithRetry(`${this.baseUrl}/agents`, this.fetchText)
    const parsed = parseResponse(text) as { items?: unknown[] }
    const items = (parsed.items ?? []) as Array<Record<string, unknown>>
    const result = items.map((item) => ({ ...item, type: "agent" as const }) as AgentMarketplaceItem)
    this.setCache("agents", result)
    return result
  }

  private async fetchSkills(apiKey?: string, warn?: (message: string) => void): Promise<SkillMarketplaceItem[]> {
    const cached = this.getCached("skills")
    const items = cached ? (cached as SkillMarketplaceItem[]) : await this.loadSkills()
    if (!apiKey || !(await this.isAligned())) return items
    const favorites = await requestJson(`${this.serverBaseUrl()}/api/v1/me/favorites`, { apiKey }).catch(
      (err: unknown) => {
        warn?.(`获取市场收藏失败：${fetchErrorMessage(err)}`)
        return []
      },
    )
    const ids = new Set(
      Array.isArray(favorites)
        ? favorites.flatMap((item) => (isObject(item) && typeof item.id === "string" ? [item.id] : []))
        : [],
    )
    return items.map((item) => ({ ...item, favorite: ids.has(item.id) }))
  }

  private async loadSkills(): Promise<SkillMarketplaceItem[]> {
    if (await this.isAligned()) {
      const items: SkillMarketplaceItem[] = []
      const state = { cursor: "" }
      do {
        const query = new URLSearchParams({ limit: "100", ...(state.cursor ? { cursor: state.cursor } : {}) })
        const text = await fetchWithRetry(`${this.serverBaseUrl()}/api/v1/skills?${query}`, this.fetchText)
        const parsed = parseResponse(text)
        if (!isObject(parsed) || !Array.isArray(parsed.items)) throw new Error("aligned-market-invalid-catalog")
        items.push(...parsed.items.flatMap((item) => this.alignedSkill(item)))
        state.cursor = typeof parsed.nextCursor === "string" ? parsed.nextCursor : ""
      } while (state.cursor)
      this.setCache("skills", items)
      return items
    }

    const text = await fetchWithRetry(`${this.baseUrl}/skills`, this.fetchText)
    const parsed = parseResponse(text) as { items?: unknown[] }
    const items = (parsed.items ?? []) as RawSkill[]
    const result = items.map(transformSkill)
    this.setCache("skills", result)
    return result
  }

  private alignedSkill(value: unknown): SkillMarketplaceItem[] {
    if (!isObject(value) || typeof value.id !== "string" || typeof value.name !== "string") return []
    const category = typeof value.category === "string" ? value.category : "general"
    const revision = typeof value.latestRevision === "number" ? value.latestRevision : 1
    const author =
      isObject(value.author) && typeof value.author.displayName === "string" ? value.author.displayName : undefined
    return [
      {
        type: "skill",
        id: value.id,
        name: value.name,
        displayName: value.name,
        description: typeof value.description === "string" ? value.description : "",
        category,
        displayCategory: kebabToTitleCase(category),
        content: `${this.serverBaseUrl()}/api/v1/skills/${encodeURIComponent(value.id)}/releases/${revision}/archive`,
        revision,
        ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
        ...(author ? { author, uploadedBy: author } : {}),
        ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
        ...(typeof value.downloads === "number" ? { downloadCount: value.downloads } : {}),
        ...(typeof value.favorites === "number" ? { stars: value.favorites } : {}),
        risk: skillRisk(value.risk),
        ...(Array.isArray(value.tags)
          ? { tags: value.tags.filter((tag): tag is string => typeof tag === "string") }
          : {}),
      },
    ]
  }

  private async isAligned(): Promise<boolean> {
    if (this.disabledReason) return false
    if (this.capability !== undefined) return this.capability !== null
    this.capability = await this.fetchText(`${this.serverBaseUrl()}/api/v1/capabilities`).then(
      (text) => marketCapabilities(parseResponse(text)),
      () => null,
    )
    return this.capability !== null
  }

  async fetchAll(apiKey?: string): Promise<{ items: MarketplaceItem[]; errors: string[]; skillsFetched: boolean }> {
    if (this.disabledReason) {
      return { items: [], errors: [`ChipMate Server 配置无效：${this.disabledReason}`], skillsFetched: false }
    }
    const errors: string[] = []

    if (this.skillsOnly) {
      const skills = await this.fetchSkills(apiKey, (message) => errors.push(message)).then(
        (items) => ({ items, ok: true }),
        (err: unknown) => {
          errors.push(`获取技能市场失败：${fetchErrorMessage(err)}`)
          return { items: [] as SkillMarketplaceItem[], ok: false }
        },
      )
      return { items: skills.items, errors, skillsFetched: skills.ok }
    }

    const skills = this.fetchSkills(apiKey, (message) => errors.push(message)).then(
      (items) => ({ items, ok: true }),
      (err: unknown) => {
        errors.push(`获取技能市场失败：${fetchErrorMessage(err)}`)
        return { items: [] as SkillMarketplaceItem[], ok: false }
      },
    )
    const settled = await Promise.all([
      this.fetchAgents().catch((err: unknown) => {
        errors.push(`获取 Agent 市场失败：${fetchErrorMessage(err)}`)
        return [] as AgentMarketplaceItem[]
      }),
      this.fetchMcps().catch((err: unknown) => {
        errors.push(`获取 MCP 市场失败：${fetchErrorMessage(err)}`)
        return [] as McpMarketplaceItem[]
      }),
      skills,
    ])

    return {
      items: [...settled[0], ...settled[1], ...settled[2].items],
      errors,
      skillsFetched: settled[2].ok,
    }
  }

  async searchSkills(input: {
    query: string
    category?: string
    author?: string
    sort?: "updated" | "downloads" | "favorites" | "name"
    cursor?: string
    limit: number
  }): Promise<{ items: SkillMarketplaceItem[]; nextCursor?: string }> {
    if (!(await this.isAligned())) throw new Error("Skill Market search requires the aligned API")
    const query = new URLSearchParams({ q: input.query, limit: String(Math.min(20, Math.max(1, input.limit))) })
    if (input.category) query.set("category", input.category)
    if (input.author) query.set("author", input.author)
    if (input.sort) query.set("sort", input.sort)
    if (input.cursor) query.set("cursor", input.cursor)
    const value = parseResponse(await fetchWithRetry(`${this.serverBaseUrl()}/api/v1/skills?${query}`, this.fetchText))
    if (!isObject(value) || !Array.isArray(value.items)) throw new Error("aligned-market-invalid-search")
    const items = value.items.flatMap((item) => this.alignedSkill(item))
    return { items, ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}) }
  }

  async resolveUser(accessToken: string): Promise<MarketplaceUser> {
    const response = await this.protected(accessToken, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/auth/me`, { apiKey: token }),
    )
    if (!isObject(response) || typeof response.displayName !== "string" || !response.displayName.trim()) {
      throw new Error("marketplace-user-invalid")
    }
    return { name: response.displayName }
  }

  async starSkill(id: string, apiKey: string): Promise<{ stars?: number }> {
    if (await this.isAligned()) {
      const items = await this.fetchSkills(apiKey)
      const item = items.find((entry) => entry.id === id)
      await this.protected(apiKey, (token) =>
        requestJson(`${this.serverBaseUrl()}/api/v1/favorites/${encodeURIComponent(id)}`, {
          method: item?.favorite ? "DELETE" : "PUT",
          apiKey: token,
        }),
      )
      this.cache.delete("skills")
      return { stars: item?.stars }
    }
    const response = await postJson(`${this.baseUrl}/skills/${encodeURIComponent(id)}/stars`, undefined, apiKey)
    this.cache.delete("skills")
    if (!isObject(response)) return {}
    return { stars: typeof response.stars === "number" ? response.stars : undefined }
  }

  async uploadSkill(payload: MarketplaceUploadPayload, apiKey: string): Promise<void> {
    await postJson(`${this.baseUrl}/skills`, payload, apiKey)
    this.cache.delete("skills")
  }

  alignedMode() {
    return this.isAligned()
  }

  async capabilities() {
    await this.isAligned()
    return this.capability ?? undefined
  }

  async skill(id: string): Promise<SkillDetail> {
    return skillDetail(await requestJson(`${this.serverBaseUrl()}/api/v1/skills/${encodeURIComponent(id)}`))
  }

  async installations(apiKey: string): Promise<InstallationState[]> {
    const value = await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/me/installations`, { apiKey: token }),
    )
    return Array.isArray(value) ? value.filter(installationState) : []
  }

  async publications(apiKey: string): Promise<PublicationRun[]> {
    const value = await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/me/publications`, { apiKey: token }),
    )
    return Array.isArray(value) ? value.map(publication) : []
  }

  async unpublishSkill(id: string, apiKey: string): Promise<PublicationRun> {
    const value = await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/skills/${encodeURIComponent(id)}/unpublish`, {
        method: "POST",
        apiKey: token,
      }),
    )
    this.cache.delete("skills")
    return publication(value)
  }

  async undoPublication(runId: string, apiKey: string, idempotencyKey: string): Promise<PublicationRun> {
    const value = await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/publications/${encodeURIComponent(runId)}/undo`, {
        method: "POST",
        apiKey: token,
        idempotencyKey,
      }),
    )
    this.cache.delete("skills")
    return publication(value)
  }

  async status(): Promise<MarketStatus> {
    return marketStatus(await requestJson(`${this.serverBaseUrl()}/api/v1/status`))
  }

  async analytics(apiKey: string): Promise<AnalyticsSeries[]> {
    const value = await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/analytics/overview`, { apiKey: token }),
    )
    return Array.isArray(value) ? value.filter(analyticsSeries) : []
  }

  async events(items: MarketEvent[], apiKey: string): Promise<void> {
    await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/events/batch`, { method: "POST", apiKey: token, body: items }),
    )
  }

  async publishArchive(archive: Buffer, apiKey: string, idempotencyKey: string): Promise<PublicationRun> {
    const value = await this.protected(apiKey, (token) =>
      requestBinary(`${this.serverBaseUrl()}/api/v1/publications`, archive, token, idempotencyKey),
    )
    return publication(value)
  }

  async getPublication(id: string, apiKey: string): Promise<PublicationRun> {
    return publication(await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/publications/${encodeURIComponent(id)}`, { apiKey: token }),
    ))
  }

  async putPublicationPatches(id: string, patches: PublicationPatch[], apiKey: string): Promise<PublicationRun> {
    return publication(await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/publications/${encodeURIComponent(id)}/patches`, {
        method: "POST",
        apiKey: token,
        body: patches,
      }),
    ))
  }

  async applyPublicationPatches(id: string, patchIds: string[], apiKey: string): Promise<PublicationRun> {
    return publication(await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/publications/${encodeURIComponent(id)}/apply`, {
        method: "POST",
        apiKey: token,
        body: { patchIds },
      }),
    ))
  }

  async consumeInstallIntent(token: string, apiKey: string): Promise<InstallIntent> {
    const value = await this.protected(apiKey, (accessToken) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/install-intents/${encodeURIComponent(token)}/consume`, {
        method: "POST",
        apiKey: accessToken,
      }),
    )
    if (
      !isObject(value) ||
      typeof value.skillId !== "string" ||
      typeof value.revision !== "number" ||
      typeof value.sha256 !== "string" ||
      typeof value.downloadUrl !== "string"
    ) {
      throw new Error("Invalid install intent response")
    }
    return { skillId: value.skillId, revision: value.revision, sha256: value.sha256, downloadUrl: value.downloadUrl }
  }

  async syncInstallation(
    id: string,
    state: Omit<InstallationSync, "changedAt">,
    apiKey: string,
  ): Promise<InstallationSync> {
    const value = await this.protected(apiKey, (token) =>
      requestJson(`${this.serverBaseUrl()}/api/v1/installations/${encodeURIComponent(id)}`, {
        method: state.status === "removed" ? "DELETE" : "PUT",
        apiKey: token,
        body: state,
      }),
    )
    if (!isObject(value) || typeof value.changedAt !== "string") throw new Error("Invalid installation response")
    return value as unknown as InstallationSync
  }

  subscribe(change: (name: string) => void): () => void {
    if (this.disabledReason) return () => undefined
    const abort = new AbortController()
    void this.stream(change, abort.signal)
    return () => abort.abort()
  }

  private async stream(change: (name: string) => void, signal: AbortSignal) {
    const state = { id: "", version: this.capability?.catalogVersion ?? "", retry: 500 }
    while (!signal.aborted) {
      try {
        const query = state.version ? `?catalogVersion=${encodeURIComponent(state.version)}` : ""
        const response = await fetch(`${this.serverBaseUrl()}/api/v1/market/stream${query}`, {
          signal,
          headers: { accept: "text/event-stream", ...(state.id ? { "last-event-id": state.id } : {}) },
        })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        state.retry = 500
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const buffer = { text: "" }
        while (!signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer.text += decoder.decode(chunk.value, { stream: true })
          const frames = buffer.text.split("\n\n")
          buffer.text = frames.pop() ?? ""
          for (const frame of frames) this.frame(frame, state, change)
        }
      } catch (err) {
        if (signal.aborted) return
        console.warn("[ChipMate New] Marketplace event stream ended; reconnecting:", err)
      }
      await pause(state.retry, signal)
      state.retry = Math.min(10_000, state.retry * 2)
    }
  }

  private frame(frame: string, state: { id: string; version: string }, change: (name: string) => void) {
    const name = frame.match(/^event: (.+)$/m)?.[1]
    const id = frame.match(/^id: (.+)$/m)?.[1]
    if (id) state.id = id
    if (
      !name ||
      !/^(?:favorite|installation|publication)\.changed$|^skill\.(?:published|unpublished)$|^(?:catalog\.invalidated|analytics\.updated)$/.test(
        name,
      )
    )
      return
    if (name === "catalog.invalidated") {
      const data = frame.match(/^data: (.+)$/m)?.[1]
      const value = data ? (JSON.parse(data) as { catalogVersion?: unknown }) : {}
      if (typeof value.catalogVersion === "string") state.version = value.catalogVersion
      this.cache.delete("skills")
    }
    if (name.startsWith("skill.") || name === "favorite.changed") this.cache.delete("skills")
    change(name)
  }

  dispose(): void {
    this.cache.clear()
  }
}

async function requestJson(
  url: string,
  opts: {
    method?: "GET" | "POST" | "PUT" | "DELETE"
    apiKey?: string
    idempotencyKey?: string
    body?: unknown
  } = {},
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetch(url, {
      method: opts.method ?? "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    })
    const text = await response.text()
    const parsed = parseJson(text, response.status)
    if (!response.ok) {
      throw apiError(response, parsed)
    }
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

async function requestBinary(url: string, body: Buffer, apiKey: string, idempotencyKey: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/gzip",
        "idempotency-key": idempotencyKey,
      },
      body: Uint8Array.from(body),
    })
    const value = (await response.json()) as unknown
    if (!response.ok) {
      const code = isObject(value) && typeof value.code === "string" ? value.code : `HTTP ${response.status}`
      throw new Error(code)
    }
    return value
  } finally {
    clearTimeout(timer)
  }
}

function publication(value: unknown): PublicationRun {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string" ||
    !Array.isArray(value.patches)
  ) {
    throw new Error("Invalid publication response")
  }
  return value as unknown as PublicationRun
}

function marketCapabilities(value: unknown): MarketCapabilities | null {
  if (
    !isObject(value) ||
    value.mode !== "aligned-v1" ||
    typeof value.apiVersion !== "string" ||
    typeof value.catalogVersion !== "string"
  )
    return null
  if (value.skillSpecVersion !== undefined && typeof value.skillSpecVersion !== "string") return null
  const features = value.features
  if (!isObject(features)) return null
  const names = ["versions", "favorites", "installations", "publications", "repairs", "analytics", "events"] as const
  if (names.some((name) => typeof features[name] !== "boolean")) return null
  const optional = [
    "extensions",
    "extensionPublications",
    "extensionReviews",
    "extensionAnalytics",
    "extensionDirectoryImport",
  ] as const
  if (optional.some((name) => features[name] !== undefined && typeof features[name] !== "boolean")) return null
  return value as unknown as MarketCapabilities
}

function skillDetail(value: unknown): SkillDetail {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !Array.isArray(value.releases) ||
    !Array.isArray(value.files)
  ) {
    throw new Error("Invalid Skill detail response")
  }
  return {
    ...value,
    risk: skillRisk(value.risk),
  } as unknown as SkillDetail
}

function skillRisk(value: unknown) {
  if (!isObject(value)) return { level: "unknown" as const, issueCount: 0 }
  const levels = new Set(["none", "medium", "critical", "unknown"])
  if (typeof value.level !== "string" || !levels.has(value.level) || typeof value.issueCount !== "number") {
    return { level: "unknown" as const, issueCount: 0 }
  }
  return {
    level: value.level as "none" | "medium" | "critical" | "unknown",
    issueCount: value.issueCount,
    ...(typeof value.policyVersion === "string" ? { policyVersion: value.policyVersion } : {}),
  }
}

function installationState(value: unknown): value is InstallationState {
  return (
    isObject(value) &&
    typeof value.skillId === "string" &&
    typeof value.revision === "number" &&
    typeof value.status === "string"
  )
}

function marketStatus(value: unknown): MarketStatus {
  if (
    !isObject(value) ||
    typeof value.ok !== "boolean" ||
    typeof value.transport !== "string" ||
    typeof value.market !== "string"
  ) {
    throw new Error("Invalid Marketplace status response")
  }
  return value as unknown as MarketStatus
}

function analyticsSeries(value: unknown): value is AnalyticsSeries {
  return (
    isObject(value) &&
    typeof value.metric === "string" &&
    typeof value.scope === "string" &&
    Array.isArray(value.points)
  )
}

async function postJson(url: string, body?: unknown, apiKey?: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    })
    const text = await response.text()
    const parsed = parseJson(text, response.status)
    if (!response.ok) {
      throw apiError(response, parsed)
    }
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

function apiError(response: Response, value: unknown): MarketplaceApiError {
  const data = isObject(value) ? value : {}
  const code = typeof data.code === "string" && data.code.trim() ? data.code.trim() : `HTTP ${response.status}`
  const reason = errorReason(data.reason)
  const requestId = typeof data.requestId === "string" ? data.requestId : undefined
  const retryAfter =
    typeof data.retryAfter === "string" ? data.retryAfter : response.headers.get("retry-after") || undefined
  const upstreamStatus = typeof data.upstreamStatus === "number" ? data.upstreamStatus : undefined
  return new MarketplaceApiError(code, {
    status: response.status,
    reason,
    requestId,
    retryAfter,
    upstreamStatus,
  })
}

function parseJson(text: string, status: number): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new MarketplaceApiError("invalid-json", { status, reason: "invalid-json" })
  }
}

function errorReason(value: unknown): MarketplaceErrorReason | undefined {
  if (
    value === "invalid-url" ||
    value === "timeout" ||
    value === "invalid-json" ||
    value === "empty-response" ||
    value === "rate-limited" ||
    value === "upstream-http" ||
    value === "network" ||
    value === "unknown"
  )
    return value
  return undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, "")
}
