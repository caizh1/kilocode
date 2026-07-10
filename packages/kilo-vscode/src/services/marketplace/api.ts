import { parse as parseYaml } from "yaml"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  AgentMarketplaceItem,
  SkillMarketplaceItem,
  RawSkill,
  MarketplaceUploadPayload,
  MarketplaceUser,
} from "./types"

const BASE_URL = "https://api.kilo.ai/api/marketplace"
const CACHE_TTL = 300_000
const MAX_RETRIES = 3
const TIMEOUT = 10_000

type FetchText = (url: string) => Promise<string>

export interface MarketplaceApiClientOptions {
	baseUrl?: string
	skillsOnly?: boolean
	fetchText?: FetchText
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
		if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		return await response.text()
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
	private readonly baseUrl: string
	private readonly skillsOnly: boolean
  private readonly fetchText: FetchText

  constructor(options: MarketplaceApiClientOptions = {}) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl) || BASE_URL
		this.skillsOnly = options.skillsOnly ?? false
		this.fetchText = options.fetchText ?? defaultFetchText
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

  private async fetchSkills(): Promise<SkillMarketplaceItem[]> {
    const cached = this.getCached("skills")
    if (cached) return cached as SkillMarketplaceItem[]

		const text = await fetchWithRetry(`${this.baseUrl}/skills`, this.fetchText)
    const parsed = parseResponse(text) as { items?: unknown[] }
    const items = (parsed.items ?? []) as RawSkill[]
    const result = items.map(transformSkill)
    this.setCache("skills", result)
    return result
  }

  async fetchAll(): Promise<{ items: MarketplaceItem[]; errors: string[]; skillsFetched: boolean }> {
		const errors: string[] = []

		if (this.skillsOnly) {
			const skills = await this.fetchSkills().then(
        (items) => ({ items, ok: true }),
        (err: unknown) => {
				  errors.push(`获取技能市场失败：${fetchErrorMessage(err)}`)
          return { items: [] as SkillMarketplaceItem[], ok: false }
        },
      )
			return { items: skills.items, errors, skillsFetched: skills.ok }
		}

    const skills = this.fetchSkills().then(
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

  async resolveUser(apiKey: string): Promise<MarketplaceUser> {
    const response = await postJson(`${this.serverBaseUrl()}/auth/new-api/resolve-user`, { apiKey })
    if (!isObject(response) || response.ok !== true || !isObject(response.user)) {
      const code = isObject(response) && typeof response.code === "string" ? response.code : "resolve-user-failed"
      throw new Error(code)
    }
    const name = typeof response.user.name === "string" ? response.user.name : ""
    if (!name) throw new Error("resolve-user-missing-name")
    return {
      name,
      tokenName: typeof response.user.tokenName === "string" ? response.user.tokenName : undefined,
    }
  }

  async starSkill(id: string, apiKey: string): Promise<{ stars?: number }> {
    const response = await postJson(`${this.baseUrl}/skills/${encodeURIComponent(id)}/stars`, undefined, apiKey)
    this.cache.delete("skills")
    if (!isObject(response)) return {}
    return { stars: typeof response.stars === "number" ? response.stars : undefined }
  }

  async uploadSkill(payload: MarketplaceUploadPayload, apiKey: string): Promise<void> {
    await postJson(`${this.baseUrl}/skills`, payload, apiKey)
    this.cache.delete("skills")
  }

  clearCache(): void {
    this.cache.clear()
  }

  dispose(): void {
    this.cache.clear()
  }
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
    const parsed = text ? JSON.parse(text) : {}
    if (!response.ok) {
      const code = isObject(parsed) && typeof parsed.code === "string" ? parsed.code : undefined
      throw new Error(code || `HTTP ${response.status}: ${response.statusText}`)
    }
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, "")
}
