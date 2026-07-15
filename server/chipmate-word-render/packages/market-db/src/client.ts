import { Worker } from "node:worker_threads"
import type {
  AuthorItem,
  CategoryItem,
  DailyMetric,
  EventInput,
  ExportResult,
  FavoriteInput,
  FileItem,
  FilePreview,
  IdentityInput,
  ImportResult,
  InstallIntentInput,
  InstallIntentItem,
  InstallIntentLookup,
  InstallIntentResult,
  InstallationInput,
  MarketDbHealth,
  MarketDbOptions,
  MarketUserItem,
  PublicationInput,
  PublicationItem,
  PublicationLookup,
  PublicationPatchesInput,
  PublicationApplyInput,
  PublicationStart,
  ReleaseItem,
  RetentionResult,
  SearchInput,
  SearchItem,
  SessionInput,
  SessionItem,
  SessionLookup,
  UnpublishInput,
} from "./model.ts"
import type { DbRequest, DbResponse } from "./protocol.ts"

interface Pending {
  resolve(value: unknown): void
  reject(err: Error): void
}

export class MarketDb {
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private seq = 0
  private dead: Error | undefined
  private catalog: Promise<string> | undefined

  constructor(opts: MarketDbOptions) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
      workerData: { dir: opts.dir },
    })
    this.worker.on("message", (msg: DbResponse) => this.receive(msg))
    this.worker.on("error", (err) => this.fail(err instanceof Error ? err : new Error(String(err))))
    this.worker.on("exit", (code) => {
      if (code !== 0 && this.pending.size > 0) this.fail(new Error(`market-db worker exited with code ${code}`))
    })
  }

  health() {
    return this.call<MarketDbHealth>("health")
  }

  importLegacy(root: string) {
    this.catalog = undefined
    return this.call<ImportResult>("importLegacy", root)
  }

  exportLegacy(root: string) {
    return this.call<ExportResult>("exportLegacy", root)
  }

  search(input: SearchInput = {}) {
    return this.call<SearchItem[]>("search", input)
  }

  get(id: string) {
    return this.call<SearchItem | undefined>("get", id)
  }

  version() {
    this.catalog ??= this.call<string>("version")
    return this.catalog
  }

  releases(id: string) {
    return this.call<ReleaseItem[]>("releases", id)
  }

  release(id: string, revision?: number) {
    return this.call<ReleaseItem | undefined>("release", { id, ...(revision ? { revision } : {}) })
  }

  categories() {
    return this.call<CategoryItem[]>("categories")
  }

  author(id: string) {
    return this.call<AuthorItem | undefined>("author", id)
  }

  files(id: string, revision?: number) {
    return this.call<FileItem[]>("files", { id, ...(revision ? { revision } : {}) })
  }

  file(id: string, path: string, revision?: number) {
    return this.call<FilePreview | undefined>("file", { id, path, ...(revision ? { revision } : {}) })
  }

  identity(input: IdentityInput) {
    return this.call<MarketUserItem>("identity", input)
  }

  createSession(input: SessionInput) {
    return this.call<SessionItem>("createSession", input)
  }

  getSession(input: SessionLookup) {
    return this.call<SessionItem | undefined>("getSession", input)
  }

  deleteSession(hash: string) {
    return this.call<boolean>("deleteSession", hash)
  }

  favorite(input: FavoriteInput) {
    return this.call<{ skillId: string; favorite: boolean; changedAt: string }>("favorite", input)
  }

  favorites(userId: string) {
    return this.call<SearchItem[]>("favorites", userId)
  }

  installation(input: InstallationInput) {
    return this.call<InstallationInput & { changedAt: string }>("installation", input)
  }

  installations(userId: string) {
    return this.call<Array<InstallationInput & { changedAt: string }>>("installations", userId)
  }

  createIntent(input: InstallIntentInput) {
    return this.call<InstallIntentItem>("createIntent", input)
  }

  consumeIntent(input: InstallIntentLookup) {
    return this.call<InstallIntentResult>("consumeIntent", input)
  }

  publication(input: PublicationInput) {
    return this.call<PublicationInput & { createdAt: string; updatedAt: string }>("publication", input)
  }

  startPublication(input: PublicationStart) {
    this.catalog = undefined
    return this.call<PublicationItem>("startPublication", input)
  }

  getPublication(input: PublicationLookup) {
    return this.call<PublicationItem | undefined>("getPublication", input)
  }

  publications(ownerId: string) {
    return this.call<PublicationItem[]>("publications", ownerId)
  }

  putPublicationPatches(input: PublicationPatchesInput) {
    return this.call<PublicationItem>("putPublicationPatches", input)
  }

  applyPublicationPatches(input: PublicationApplyInput) {
    this.catalog = undefined
    return this.call<PublicationItem>("applyPublicationPatches", input)
  }

  unpublish(input: UnpublishInput) {
    this.catalog = undefined
    return this.call<PublicationItem>("unpublish", input)
  }

  events(items: EventInput[]) {
    return this.call<{ accepted: number }>("events", items)
  }

  aggregate() {
    return this.call<DailyMetric[]>("aggregate")
  }

  maintain(now: string) {
    return this.call<RetentionResult>("maintain", now)
  }

  async close() {
    if (this.dead) {
      await this.worker.terminate()
      return
    }
    await this.call<boolean>("close")
    await this.worker.terminate()
  }

  private call<T>(op: DbRequest["op"], payload?: unknown) {
    if (this.dead) return Promise.reject<T>(this.dead)
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
      this.worker.postMessage({ id, op, payload } satisfies DbRequest)
    })
  }

  private receive(msg: DbResponse) {
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    if (msg.ok) {
      pending.resolve(msg.value)
      return
    }
    pending.reject(new Error(msg.error ?? "market-db worker request failed"))
  }

  private fail(err: Error) {
    this.dead = err
    for (const pending of this.pending.values()) pending.reject(err)
    this.pending.clear()
  }
}
