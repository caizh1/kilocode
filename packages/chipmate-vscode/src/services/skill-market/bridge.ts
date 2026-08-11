import * as path from "node:path"
import * as fs from "node:fs/promises"
import type {
  EventChipmateSkillMarketCancelled,
  EventChipmateSkillMarketRequested,
  ChipMateClient,
  SkillMarketFailure,
  SkillMarketRequest,
  SkillMarketResult,
} from "@chipmate/sdk/v2/client"
import type { ExtensionContext } from "vscode"
import type { ConnectionState, ChipMateConnectionService } from "../cli-backend/connection-service"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import { MarketplaceService } from "../marketplace"
import { LocalImportRegistry } from "../marketplace/local-import-registry"
import { MarketTransactionError, MarketTransactionManager } from "./transaction"

interface SkillMarketConnection {
  onEvent(listener: (event: SSEPayload, directory?: string) => void): () => void
  onStateChange(listener: (state: ConnectionState, error?: Error) => void): () => void
  getClient(): ChipMateClient
  getKnownDirectories(): string[]
}

export class SkillMarketBridge {
  private readonly active = new Map<string, AbortController>()
  private readonly unsubscribeEvent: () => void
  private readonly unsubscribeState: () => void
  private manager: MarketTransactionManager | undefined
  private market: MarketplaceService | undefined
  private disposed = false
  private revision = 0

  constructor(
    private readonly connection: SkillMarketConnection,
    private readonly context: ExtensionContext,
  ) {
    this.unsubscribeEvent = connection.onEvent((event, directory) => this.event(event, directory))
    this.unsubscribeState = connection.onStateChange((state) => {
      if (state !== "connected") return
      const revision = ++this.revision
      if (!this.manager) {
        void this.activateRecovery(revision)
        return
      }
      void this.recover(revision)
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.revision += 1
    this.unsubscribeEvent()
    this.unsubscribeState()
    for (const controller of this.active.values()) controller.abort()
    this.active.clear()
    this.market?.dispose()
  }

  private event(event: SSEPayload, directory?: string) {
    if (event.type === "chipmate.skill_market.requested") {
      if (!directory) return
      this.start((event as EventChipmateSkillMarketRequested).properties, directory)
      return
    }
    if (event.type !== "chipmate.skill_market.cancelled") return
    const id = (event as EventChipmateSkillMarketCancelled).properties.requestID
    this.active.get(id)?.abort()
  }

  private start(request: SkillMarketRequest, directory: string) {
    if (this.disposed || this.active.has(request.id) || !this.connection.getKnownDirectories().includes(directory))
      return
    const controller = new AbortController()
    this.active.set(request.id, controller)
    void this.run(request, directory, controller).finally(() => this.active.delete(request.id))
  }

  private async run(request: SkillMarketRequest, directory: string, controller: AbortController) {
    try {
      const value = await this.service().execute(request, directory)
      if (controller.signal.aborted || this.disposed) return
      if (request.operation === "commit" || request.operation === "undo") {
        await this.connection
          .getClient()
          .chipmate.refreshSkills({ directory, scope: value.scope ?? "global" })
          .catch((error: unknown) => console.warn("[ChipMate New] SkillMarketBridge: Skill cache refresh failed:", error))
      }
      await this.reply(request.id, directory, value)
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return
      await this.reject(request.id, directory, failure(error))
    }
  }

  private service() {
    if (this.manager) return this.manager
    this.market = new MarketplaceService(path.join(this.context.globalStorageUri.fsPath, "config"))
    this.manager = new MarketTransactionManager({
      global: path.join(this.context.globalStorageUri.fsPath, "config"),
      market: this.market,
      key: () => this.apiKey(),
      workspaces: () => this.connection.getKnownDirectories(),
      registry: new LocalImportRegistry(this.context),
    })
    return this.manager
  }

  private async apiKey() {
    const client = this.connection.getClient()
    const directory = this.connection.getKnownDirectories()[0]
    if (!directory) return undefined
    const [{ data: config }, { data: providers }] = await Promise.all([
      client.config.get({ directory }, { throwOnError: true }),
      client.provider.list({ directory }, { throwOnError: true }),
    ])
    const provider = typeof config?.model === "string" ? config.model.split("/")[0] : undefined
    const entries = providers?.all ?? []
    const selected = entries.find((item) => item.id === provider)
    if (selected && typeof selected.key === "string" && selected.key.trim()) return selected.key.trim()
    const keys = entries.flatMap((item) => (typeof item.key === "string" && item.key.trim() ? [item.key.trim()] : []))
    return keys.length === 1 ? keys[0] : undefined
  }

  private async reply(requestID: string, directory: string, result: SkillMarketResult) {
    const response = await this.connection.getClient().chipmate.skillMarket.reply({ requestID, directory, result })
    if (response.error) console.error(`[ChipMate New] SkillMarketBridge: reply ${requestID} failed:`, response.error)
  }

  private async reject(requestID: string, directory: string, error: SkillMarketFailure) {
    const response = await this.connection.getClient().chipmate.skillMarket.reject({ requestID, directory, error })
    if (response.error) console.error(`[ChipMate New] SkillMarketBridge: rejection ${requestID} failed:`, response.error)
  }

  private async recover(revision: number) {
    const client = this.connection.getClient()
    for (const directory of this.connection.getKnownDirectories()) {
      const response = await client.chipmate.skillMarket.list({ directory }).catch(() => undefined)
      if (!response || response.error || this.disposed || revision !== this.revision) continue
      for (const request of response.data ?? []) this.start(request, directory)
    }
  }

  private async activateRecovery(revision: number) {
    const roots = [
      path.join(this.context.globalStorageUri.fsPath, "config"),
      ...this.connection.getKnownDirectories().map((directory) => path.join(directory, ".chipmate-v2")),
    ]
    const found = await Promise.all(
      roots.map((root) =>
        fs.readdir(path.join(root, ".marketplace-transactions"), { withFileTypes: true }).then(
          (entries) => entries.some((entry) => entry.isDirectory()),
          () => false,
        ),
      ),
    )
    if (!found.some(Boolean) || this.disposed || revision !== this.revision) return
    this.service()
    await this.recover(revision)
  }
}

function failure(error: unknown): SkillMarketFailure {
  if (error instanceof MarketTransactionError) {
    return { code: error.code, message: error.message.slice(0, 10_000), transactionId: error.transactionId }
  }
  return { code: "host_error", message: (error instanceof Error ? error.message : String(error)).slice(0, 10_000) }
}

export function createSkillMarketBridge(connection: ChipMateConnectionService, context: ExtensionContext) {
  return new SkillMarketBridge(connection, context)
}
