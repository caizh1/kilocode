export type MarketEventName =
  | "market_impression"
  | "market_search"
  | "market_filter"
  | "skill_open"
  | "skill_file_preview"
  | "skill_favorite"
  | "skill_install_intent"
  | "skill_install"
  | "skill_update"
  | "skill_remove"
  | "publication_start"
  | "publication_validation_failed"
  | "publication_ai_repair"
  | "publication_success"

export interface MarketEventInput {
  skillId?: string
  revision?: number
  context?: Record<string, string | number | boolean>
}

export interface MarketEvent extends MarketEventInput {
  name: MarketEventName
  surface: "vscode"
  userId: string
  clientId: string
  occurredAt: string
}

export class MarketplaceAnalytics {
  private readonly items: MarketEvent[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly send: (items: MarketEvent[], key: string) => Promise<void>,
    private readonly client: () => Promise<string>,
    private readonly key: () => Promise<string | undefined>,
  ) {}

  async track(name: MarketEventName, input: MarketEventInput = {}) {
    this.items.push({
      name,
      surface: "vscode",
      userId: "server-derived-user",
      clientId: await this.client(),
      occurredAt: new Date().toISOString(),
      ...input,
    })
    if (this.items.length >= 20) return this.flush()
    this.timer ??= setTimeout(() => void this.flush(), 750)
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.items.length === 0) return
    const key = await this.key()
    if (!key) {
      this.items.length = 0
      return
    }
    const items = this.items.splice(0, 100)
    try {
      await this.send(items, key)
    } catch (err) {
      console.warn("[ChipMate New] Marketplace analytics batch dropped:", err)
    }
    if (this.items.length > 0) this.timer = setTimeout(() => void this.flush(), 750)
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    void this.flush()
  }
}
