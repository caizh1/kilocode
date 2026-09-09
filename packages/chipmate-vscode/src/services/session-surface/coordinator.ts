import * as crypto from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type * as vscode from "vscode"
import {
  type ChatSurfaceKind,
  type MainEditorPanelStateV1,
  type SessionOwnershipToken,
  type SessionSurfaceDraft,
  type SessionSurfaceDraftContent,
  type SessionSurfaceExtensionMessage,
  type SessionSurfaceKey,
  type SessionSurfaceMutationRejectionReason,
  type SessionSurfacePhase,
  type SessionSurfaceState,
  type SessionSurfaceWebviewMessage,
  isSessionSurfaceMutation,
  sameSessionSurfaceKey,
  sessionSurfaceKey,
} from "../../shared/session-surface"

type Surface = {
  id: string
  kind: ChatSurfaceKind
  pinnedKey?: SessionSurfaceKey
  post: (message: SessionSurfaceExtensionMessage) => void
}

type RecordState = {
  key: SessionSurfaceKey
  phase: SessionSurfacePhase
  ownerSurfaceId?: string
  epoch: number
  draftRevision: number
  title?: string
  directory?: string
  mode: "qa" | "deepseek-harness"
  taskId?: string
  panel?: vscode.WebviewPanel
  panelSurfaceId?: string
  dshLeaseSurfaceId?: string
  deleted: boolean
}

type PersistedImage = Omit<SessionSurfaceDraftContent["images"][number], "dataUrl"> & { sha256: string }

type PersistedDraftValue = Omit<SessionSurfaceDraft, "content"> & {
  content: Omit<SessionSurfaceDraftContent, "images"> & { images: PersistedImage[] }
}

type PersistedDraft = {
  checksum: string
  draft: PersistedDraftValue
}

type OpenMainHandler = (key: SessionSurfaceKey) => Promise<void>
type ReturnHandler = (key: SessionSurfaceKey) => Promise<void>
type FocusHandler = (key: SessionSurfaceKey, ownerSurfaceId?: string) => Promise<void>
type ReadyWaiter = {
  key: SessionSurfaceKey
  revision: number
  ownershipEpoch?: number
  resolve: () => void
  reject: (error: Error) => void
}
type FlushWaiter = { key: SessionSurfaceKey; resolve: () => void; reject: (error: Error) => void }
type ProjectionWaiter = { key: SessionSurfaceKey; resolve: () => void; reject: (error: Error) => void }

const EMPTY_CONTENT: SessionSurfaceDraftContent = {
  boxId: "prompt:default",
  text: "",
  reviewComments: [],
  images: [],
  references: [],
  inputScrollTop: 0,
}

export class SessionSurfaceCoordinator implements vscode.Disposable {
  readonly generation = crypto.randomUUID()
  private readonly surfaces = new Map<string, Surface>()
  private readonly active = new Map<string, SessionSurfaceKey>()
  private readonly records = new Map<string, RecordState>()
  private readonly aliases = new Map<string, SessionSurfaceKey>()
  private readonly drafts = new Map<string, SessionSurfaceDraft>()
  private readonly draftLoads = new Map<string, Promise<SessionSurfaceDraft | undefined>>()
  private readonly clients = new Map<string, number>()
  private readonly writes = new Map<string, Promise<void>>()
  private readonly ready = new Map<string, { key: SessionSurfaceKey; revision: number; ownershipEpoch?: number }>()
  private readonly readyWaiters = new Map<string, Set<ReadyWaiter>>()
  private readonly flushWaiters = new Map<string, Set<FlushWaiter>>()
  private readonly projectionWaiters = new Map<string, Set<ProjectionWaiter>>()
  private readonly detachWaiters = new Map<string, Set<ProjectionWaiter>>()
  private readonly draftOperations = new Map<string, Promise<void>>()
  private openMainHandler?: OpenMainHandler
  private returnHandler?: ReturnHandler
  private focusHandler?: FocusHandler
  private sidebarSurfaceId?: string
  private dshLease?: { surfaceId: string; recordId: string }
  private epoch = 0
  private disposed = false

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveKey(key: SessionSurfaceKey): SessionSurfaceKey {
    const seen = new Set<string>()
    let current = key
    while (!seen.has(sessionSurfaceKey(current))) {
      const id = sessionSurfaceKey(current)
      seen.add(id)
      const next = this.aliases.get(id)
      if (!next) return current
      current = next
    }
    return current
  }

  setHandlers(handlers: { openMain: OpenMainHandler; returnToSidebar: ReturnHandler; focusOwner: FocusHandler }): void {
    this.openMainHandler = handlers.openMain
    this.returnHandler = handlers.returnToSidebar
    this.focusHandler = handlers.focusOwner
  }

  registerSurface(surface: Surface): vscode.Disposable {
    if (surface.pinnedKey) surface.pinnedKey = this.resolveKey(surface.pinnedKey)
    this.surfaces.set(surface.id, surface)
    if (surface.kind === "sidebar") this.sidebarSurfaceId = surface.id
    if (surface.pinnedKey) this.active.set(surface.id, surface.pinnedKey)
    surface.post({
      type: "sessionSurface.bootstrap",
      surfaceId: surface.id,
      kind: surface.kind,
      pinnedKey: surface.pinnedKey,
    })
    const key = surface.pinnedKey
    if (key) {
      const record = this.ensure(key)
      this.sendState(surface, record)
      void this.sendDraft(surface, key)
    }
    return {
      dispose: () => this.unregisterSurface(surface.id),
    }
  }

  unregisterSurface(surfaceId: string): void {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) return
    this.surfaces.delete(surfaceId)
    this.active.delete(surfaceId)
    this.ready.delete(surfaceId)
    this.rejectWaiters(surfaceId, new Error("会话界面已关闭"))
    this.rejectProjectionWaiters(surfaceId, new Error("官方 DSH 会话界面已关闭"))
    this.rejectDshDetachWaiters(surfaceId, new Error("官方 DSH 会话界面已关闭"))
    for (const record of this.records.values()) {
      if (record.dshLeaseSurfaceId === surfaceId) this.clearDshLease(record)
      if (record.ownerSurfaceId !== surfaceId) continue
      record.ownerSurfaceId = this.sidebarSurfaceId
      record.phase = record.deleted ? "deleted" : "sidebar"
      record.epoch = this.nextEpoch()
      if (
        record.mode === "deepseek-harness" &&
        this.sidebarSurfaceId &&
        sameSessionSurfaceKey(this.active.get(this.sidebarSurfaceId), record.key)
      ) {
        this.assignDshLease(record, this.sidebarSurfaceId)
      }
      this.broadcast(record)
    }
  }

  bindSurface(
    surfaceId: string,
    key: SessionSurfaceKey,
    metadata: Partial<Pick<RecordState, "title" | "directory" | "mode" | "taskId">> = {},
  ): SessionSurfaceState {
    key = this.resolveKey(key)
    const surface = this.surfaces.get(surfaceId)
    if (surface?.kind === "main-editor" && surface.pinnedKey && !sameSessionSurfaceKey(surface.pinnedKey, key)) {
      const pinned = this.ensure(surface.pinnedKey)
      this.sendState(surface, pinned)
      return this.toState(pinned, surfaceId)
    }
    const previous = this.active.get(surfaceId)
    this.active.set(surfaceId, key)
    const record = this.ensure(key)
    if (!sameSessionSurfaceKey(previous, key) && record.ownerSurfaceId === surfaceId) record.epoch = this.nextEpoch()
    if (metadata.title !== undefined) record.title = metadata.title
    if (metadata.directory !== undefined) record.directory = metadata.directory
    if (metadata.mode !== undefined) record.mode = metadata.mode
    if (metadata.taskId !== undefined) record.taskId = metadata.taskId
    if (record.mode === "deepseek-harness" && record.ownerSurfaceId === surfaceId) {
      this.assignDshLease(record, surfaceId)
    }
    if (surface) {
      this.sendState(surface, record)
      void this.sendDraft(surface, key)
    }
    return this.toState(record, surfaceId)
  }

  prepareMain(key: SessionSurfaceKey): SessionSurfaceState {
    const record = this.ensure(key)
    if (record.deleted) return this.toState(record)
    record.phase = "opening-main"
    this.broadcast(record)
    return this.toState(record)
  }

  prepareRestore(key: SessionSurfaceKey): SessionSurfaceState {
    const record = this.ensure(key)
    if (record.deleted) return this.toState(record)
    record.phase = "restoring"
    record.ownerSurfaceId = undefined
    this.clearDshLease(record)
    record.epoch = this.nextEpoch()
    this.broadcast(record)
    return this.toState(record)
  }

  registerPanel(
    key: SessionSurfaceKey,
    panel: vscode.WebviewPanel,
    surfaceId: string,
    metadata: Partial<Pick<RecordState, "title" | "directory" | "mode" | "taskId">> = {},
  ): boolean {
    const record = this.ensure(key)
    if (record.panel && record.panel !== panel) return false
    record.panel = panel
    record.panelSurfaceId = surfaceId
    this.bindSurface(surfaceId, key, metadata)
    return true
  }

  panel(key: SessionSurfaceKey): vscode.WebviewPanel | undefined {
    key = this.resolveKey(key)
    return this.records.get(sessionSurfaceKey(key))?.panel
  }

  panelState(key: SessionSurfaceKey): MainEditorPanelStateV1 {
    const record = this.ensure(key)
    return {
      sessionSurfaceVersion: 1,
      key: record.key,
      directory: record.directory,
      mode: record.mode,
      taskId: record.taskId,
      title: record.title,
      draftRevision: record.draftRevision,
    }
  }

  async loadDraftRevision(key: SessionSurfaceKey): Promise<number> {
    key = this.resolveKey(key)
    return (await this.getDraft(key)).revision
  }

  async draftSnapshot(key: SessionSurfaceKey): Promise<SessionSurfaceDraft> {
    key = this.resolveKey(key)
    return this.getDraft(key)
  }

  waitForSurfaceReady(surfaceId: string, key: SessionSurfaceKey, revision: number, ownershipEpoch?: number): Promise<void> {
    key = this.resolveKey(key)
    const current = this.ready.get(surfaceId)
    if (
      current &&
      sameSessionSurfaceKey(current.key, key) &&
      current.revision >= revision &&
      (ownershipEpoch === undefined || current.ownershipEpoch === ownershipEpoch)
    )
      return Promise.resolve()
    return this.waitForAcknowledgement(
      this.readyWaiters,
      surfaceId,
      { key, revision, ownershipEpoch },
      "会话界面准备超时",
    )
  }

  async flushOwner(key: SessionSurfaceKey): Promise<void> {
    key = this.resolveKey(key)
    const record = this.ensure(key)
    const ownerSurfaceId = record.ownerSurfaceId
    const owner = ownerSurfaceId ? this.surfaces.get(ownerSurfaceId) : undefined
    if (!ownerSurfaceId || !owner || !sameSessionSurfaceKey(this.active.get(ownerSurfaceId), key)) {
      return
    }
    const ownerEpoch = record.epoch
    await this.waitForSurfaceReady(ownerSurfaceId, key, record.draftRevision, ownerEpoch)
    if (record.ownerSurfaceId !== ownerSurfaceId || record.epoch !== ownerEpoch) return this.flushOwner(record.key)
    const pending = this.waitForAcknowledgement(
      this.flushWaiters,
      ownerSurfaceId,
      { key: record.key },
      "草稿提交超时",
    )
    owner.post({ type: "sessionSurface.draft.flushRequested", key: record.key })
    return pending
  }

  waitForDshProjection(surfaceId: string, key: SessionSurfaceKey): Promise<void> {
    key = this.resolveKey(key)
    return this.waitForAcknowledgement(this.projectionWaiters, surfaceId, { key }, "官方 DSH 投影准备超时")
  }

  detachDshOwner(key: SessionSurfaceKey): Promise<void> {
    const record = this.ensure(key)
    key = record.key
    const surfaceId = record.dshLeaseSurfaceId
    const surface = surfaceId ? this.surfaces.get(surfaceId) : undefined
    if (!surfaceId || !surface || !record.taskId || !this.canUseDshTransport(surfaceId)) return Promise.resolve()
    const pending = this.waitForAcknowledgement(this.detachWaiters, surfaceId, { key }, "官方 DSH 客户端释放超时")
    surface.post({ type: "sessionSurface.dsh.detachRequested", key, taskId: record.taskId })
    return pending
  }

  claimMain(key: SessionSurfaceKey, surfaceId: string): SessionSurfaceState {
    const record = this.ensure(key)
    key = record.key
    if (record.deleted) return this.toState(record, surfaceId)
    record.ownerSurfaceId = surfaceId
    record.panelSurfaceId = surfaceId
    record.phase = "main"
    record.epoch = this.nextEpoch()
    if (record.mode === "deepseek-harness") this.assignDshLease(record, surfaceId)
    this.broadcast(record)
    return this.toState(record, surfaceId)
  }

  beginReturn(key: SessionSurfaceKey): SessionSurfaceState {
    const record = this.ensure(key)
    if (!record.deleted) record.phase = "returning-sidebar"
    this.broadcast(record)
    return this.toState(record)
  }

  claimSidebar(key: SessionSurfaceKey): SessionSurfaceState {
    const record = this.ensure(key)
    key = record.key
    record.ownerSurfaceId = this.sidebarSurfaceId
    record.phase = record.deleted ? "deleted" : "sidebar"
    record.epoch = this.nextEpoch()
    if (
      record.mode === "deepseek-harness" &&
      this.sidebarSurfaceId &&
      sameSessionSurfaceKey(this.active.get(this.sidebarSurfaceId), key)
    ) {
      this.assignDshLease(record, this.sidebarSurfaceId)
    } else {
      this.clearDshLease(record)
    }
    this.broadcast(record)
    return this.toState(record, this.sidebarSurfaceId)
  }

  releasePanel(key: SessionSurfaceKey, panel: vscode.WebviewPanel): void {
    key = this.resolveKey(key)
    const record = this.records.get(sessionSurfaceKey(key))
    if (!record || record.panel !== panel) return
    const surfaceId = record.panelSurfaceId
    record.panel = undefined
    record.panelSurfaceId = undefined
    if (surfaceId && record.ownerSurfaceId === surfaceId) this.claimSidebar(key)
  }

  promote(from: SessionSurfaceKey, to: SessionSurfaceKey, metadata: Partial<RecordState> = {}): void {
    from = this.resolveKey(from)
    to = this.resolveKey(to)
    if (sameSessionSurfaceKey(from, to)) return
    const beforeKey = sessionSurfaceKey(from)
    const afterKey = sessionSurfaceKey(to)
    const before = this.records.get(beforeKey)
    const record: RecordState = before
      ? Object.assign(before, metadata, { key: to })
      : Object.assign(this.ensure(to), metadata, { key: to })
    this.records.delete(beforeKey)
    this.records.set(afterKey, record)
    this.aliases.set(beforeKey, to)
    for (const [alias, target] of this.aliases) {
      if (sameSessionSurfaceKey(target, from)) this.aliases.set(alias, to)
    }
    if (this.dshLease?.recordId === beforeKey) this.dshLease.recordId = afterKey
    const draft = this.drafts.get(beforeKey)
    if (draft) {
      this.drafts.delete(beforeKey)
      this.drafts.set(afterKey, { ...draft, key: to })
      void this.persistDraft({ ...draft, key: to })
        .then(() => this.removePersistedDraft(from))
        .catch(() => console.warn("[ChipMate New] 共享会话草稿 key 迁移持久化失败"))
    }
    for (const [surfaceId, key] of this.active) {
      if (!sameSessionSurfaceKey(key, from)) continue
      this.active.set(surfaceId, to)
      const surface = this.surfaces.get(surfaceId)
      if (surface?.kind === "main-editor") surface.pinnedKey = to
      surface?.post({ type: "sessionSurface.select", key: to })
    }
    for (const [surfaceId, current] of this.ready) {
      if (sameSessionSurfaceKey(current.key, from)) this.ready.set(surfaceId, { ...current, key: to })
    }
    for (const collection of [
      this.readyWaiters,
      this.flushWaiters,
      this.projectionWaiters,
      this.detachWaiters,
    ]) {
      for (const waiters of collection.values()) {
        for (const waiter of waiters) {
          if (sameSessionSurfaceKey(waiter.key, from)) waiter.key = to
        }
      }
    }
    this.broadcast(record)
  }

  releasePanelFor(panel: vscode.WebviewPanel): void {
    const record = [...this.records.values()].find((value) => value.panel === panel)
    if (record) this.releasePanel(record.key, panel)
  }

  delete(key: SessionSurfaceKey): void {
    key = this.resolveKey(key)
    const record = this.ensure(key)
    if (record.deleted) return
    record.deleted = true
    record.phase = "deleted"
    record.ownerSurfaceId = undefined
    record.epoch = this.nextEpoch()
    this.clearDshLease(record)
    this.drafts.delete(sessionSurfaceKey(key))
    void this.removePersistedDraftAfterWrites(key).catch(() =>
      console.warn("[ChipMate New] 删除共享会话草稿持久化文件失败"),
    )
    this.broadcast(record)
  }

  stateForSurface(surfaceId: string): SessionSurfaceState | undefined {
    const key = this.active.get(surfaceId)
    if (!key) return
    const record = this.records.get(sessionSurfaceKey(key))
    return record ? this.toState(record, surfaceId) : undefined
  }

  async acceptDraft(surfaceId: string, key: SessionSurfaceKey, expectedRevision?: number): Promise<void> {
    if (expectedRevision === undefined) return
    key = this.resolveKey(key)
    await this.enqueueSurfaceDraftOperation(surfaceId, async () => {
      const id = sessionSurfaceKey(key)
      const record = this.records.get(id)
      const previous = this.drafts.get(id)
      if (!record || record.deleted || !previous || record.draftRevision !== expectedRevision) return
      const draft: SessionSurfaceDraft = {
        ...previous,
        revision: expectedRevision + 1,
        updatedAt: Date.now(),
        content: {
          ...previous.content,
          text: "",
          reviewComments: [],
          images: [],
          references: [],
          inputScrollTop: 0,
        },
      }
      record.draftRevision = draft.revision
      this.drafts.set(id, draft)
      try {
        await this.persistDraft(draft)
      } catch {
        if (this.drafts.get(id) === draft) {
          record.draftRevision = previous.revision
          this.drafts.set(id, previous)
        }
        console.warn("[ChipMate New] 后端接受消息后清空共享草稿失败，已保留原草稿")
        return
      }
      if (record.deleted || this.records.get(id) !== record || this.drafts.get(id) !== draft) return
      for (const surface of this.surfaces.values()) {
        if (sameSessionSurfaceKey(this.active.get(surface.id), key)) {
          surface.post({ type: "sessionSurface.draft.snapshot", draft })
        }
      }
      this.broadcast(record)
    })
  }

  keyForSurface(surfaceId: string): SessionSurfaceKey | undefined {
    return this.active.get(surfaceId)
  }

  canUseDshTransport(surfaceId: string): boolean {
    const key = this.active.get(surfaceId)
    if (!key) return false
    return this.dshLease?.surfaceId === surfaceId && this.dshLease.recordId === sessionSurfaceKey(key)
  }

  authorize(surfaceId: string, message: Record<string, unknown>): boolean {
    if (!isSessionSurfaceMutation(message.type)) return true
    const key = this.active.get(surfaceId)
    if (!key) return false
    const record = this.records.get(sessionSurfaceKey(key))
    const token = message.sessionSurfaceToken as SessionOwnershipToken | undefined
    const target = mutationTarget(message)
    const taskBound = isDshTaskBoundMutation(message.type)
    const reason = this.mutationRejectionReason(surfaceId, record, target, taskBound, message.taskId, token)
    if (reason && record) {
      this.surfaces.get(surfaceId)?.post({
        type: "sessionSurface.mutationRejected",
        key: record.key,
        state: this.toState(record, surfaceId),
        mutationType: String(message.type),
        messageID: typeof message.messageID === "string" ? message.messageID : undefined,
        reason,
      })
    }
    if (!reason && record) {
      this.applyDeepSeekHarnessLifecycle(record, surfaceId, message)
      this.applyDeepSeekHarnessProjection(record, surfaceId, message)
    }
    return reason === undefined
  }

  private mutationRejectionReason(
    surfaceId: string,
    record: RecordState | undefined,
    target: SessionSurfaceKey | undefined,
    taskBound: boolean,
    taskId: unknown,
    token: SessionOwnershipToken | undefined,
  ): SessionSurfaceMutationRejectionReason | undefined {
    if (!record) return "invalid-token"
    if (taskBound && (typeof taskId !== "string" || taskId !== record.taskId)) return "task-mismatch"
    if (taskBound && !this.canUseDshTransport(surfaceId)) return "lease-mismatch"
    if (target && !sameSessionSurfaceKey(record.key, target)) return "target-mismatch"
    if (!this.validToken(surfaceId, record, token)) return "invalid-token"
    return undefined
  }

  async handleMessage(surfaceId: string, message: SessionSurfaceWebviewMessage): Promise<void> {
    const key = this.resolveKey(message.key)
    if (!sameSessionSurfaceKey(key, message.key)) {
      message = { ...message, key }
      this.surfaces.get(surfaceId)?.post({ type: "sessionSurface.select", key })
    }
    if (message.type === "sessionSurface.active") {
      await this.enqueueSurfaceDraftOperation(surfaceId, async () => {
        this.bindSurface(surfaceId, message.key)
      })
      return
    }
    if (message.type === "sessionSurface.ready") {
      await this.enqueueSurfaceDraftOperation(surfaceId, async () => {
        this.bindSurface(surfaceId, message.key)
        if (!sameSessionSurfaceKey(this.active.get(surfaceId), message.key)) return
        this.ready.set(surfaceId, {
          key: message.key,
          revision: message.draftRevision,
          ownershipEpoch: message.ownershipEpoch,
        })
        this.resolveReadyWaiters(surfaceId, message.key, message.draftRevision, message.ownershipEpoch)
      })
      return
    }
    if (message.type === "sessionSurface.openMain") {
      await this.openMainHandler?.(message.key)
      return
    }
    if (message.type === "sessionSurface.returnToSidebar") {
      await this.returnHandler?.(message.key)
      return
    }
    if (message.type === "sessionSurface.focusOwner") {
      await this.focusHandler?.(message.key, this.ensure(message.key).ownerSurfaceId)
      return
    }
    if (message.type === "sessionSurface.draft.update" || message.type === "sessionSurface.draft.flush") {
      await this.enqueueDraftOperation(surfaceId, message)
      return
    }
    if (message.type === "sessionSurface.draft.flushFailed") {
      this.rejectFlushWaiters(surfaceId, message.key, new Error("草稿未能保存，已保留当前输入"))
      return
    }
  }

  dispose(): void {
    this.disposed = true
    this.surfaces.clear()
    this.active.clear()
    this.records.clear()
    this.aliases.clear()
    this.drafts.clear()
    this.draftLoads.clear()
    for (const surfaceId of new Set([...this.readyWaiters.keys(), ...this.flushWaiters.keys()])) {
      this.rejectWaiters(surfaceId, new Error("会话协调器已关闭"))
    }
    for (const surfaceId of this.projectionWaiters.keys()) {
      this.rejectProjectionWaiters(surfaceId, new Error("会话协调器已关闭"))
    }
    for (const surfaceId of this.detachWaiters.keys()) {
      this.rejectDshDetachWaiters(surfaceId, new Error("会话协调器已关闭"))
    }
  }

  private ensure(key: SessionSurfaceKey): RecordState {
    key = this.resolveKey(key)
    const id = sessionSurfaceKey(key)
    const existing = this.records.get(id)
    if (existing) return existing
    const record: RecordState = {
      key,
      phase: "sidebar",
      ownerSurfaceId: this.sidebarSurfaceId,
      epoch: this.nextEpoch(),
      draftRevision: 0,
      mode: "qa",
      deleted: false,
    }
    this.records.set(id, record)
    return record
  }

  private async updateDraft(
    surfaceId: string,
    message: Extract<SessionSurfaceWebviewMessage, { type: "sessionSurface.draft.update" }>,
  ): Promise<void> {
    const surface = this.surfaces.get(surfaceId)
    if (!surface) return
    const record = this.ensure(message.key)
    const clientKey = `${surfaceId}:${sessionSurfaceKey(message.key)}`
    const last = this.clients.get(clientKey) ?? -1
    if (!this.validToken(surfaceId, record, message.token) || message.clientSeq <= last) {
      surface.post({
        type: "sessionSurface.draft.rejected",
        key: message.key,
        clientSeq: message.clientSeq,
        state: this.toState(record, surfaceId),
      })
      return
    }
    const previousClient = last
    const previousRevision = record.draftRevision
    const previousDraft = this.drafts.get(sessionSurfaceKey(message.key))
    let normalized: SessionSurfaceDraftContent
    try {
      normalized = this.normalizeImages(message.content)
    } catch {
      surface.post({
        type: "sessionSurface.draft.rejected",
        key: message.key,
        clientSeq: message.clientSeq,
        state: this.toState(record, surfaceId),
      })
      return
    }
    this.clients.set(clientKey, message.clientSeq)
    record.draftRevision = previousRevision + 1
    const draft: SessionSurfaceDraft = {
      schemaVersion: 1,
      key: message.key,
      revision: record.draftRevision,
      updatedAt: Date.now(),
      content: normalized,
    }
    this.drafts.set(sessionSurfaceKey(message.key), draft)
    try {
      await this.persistDraft(draft)
    } catch {
      if (this.drafts.get(sessionSurfaceKey(message.key)) === draft) {
        record.draftRevision = previousRevision
        if (previousDraft) this.drafts.set(sessionSurfaceKey(message.key), previousDraft)
        else this.drafts.delete(sessionSurfaceKey(message.key))
        if (previousClient < 0) this.clients.delete(clientKey)
        else this.clients.set(clientKey, previousClient)
      }
      surface.post({
        type: "sessionSurface.draft.rejected",
        key: message.key,
        clientSeq: message.clientSeq,
        state: this.toState(record, surfaceId),
      })
      console.warn("[ChipMate New] 共享会话草稿持久化失败，已保留 Webview 草稿")
      return
    }
    if (record.deleted || this.records.get(sessionSurfaceKey(message.key)) !== record) {
      await this.removePersistedDraftAfterWrites(message.key)
      return
    }
    for (const target of this.surfaces.values()) {
      const active = this.active.get(target.id)
      if (sameSessionSurfaceKey(active, message.key)) target.post({ type: "sessionSurface.draft.snapshot", draft })
    }
    surface.post({
      type: "sessionSurface.draft.ack",
      key: message.key,
      clientSeq: message.clientSeq,
      revision: draft.revision,
    })
    this.broadcast(record)
  }

  private validToken(surfaceId: string, record: RecordState, token: SessionOwnershipToken | undefined): boolean {
    return Boolean(
      token &&
        sameSessionSurfaceKey(this.active.get(surfaceId), record.key) &&
        !record.deleted &&
        record.ownerSurfaceId === surfaceId &&
        token.generation === this.generation &&
        token.surfaceId === surfaceId &&
        token.epoch === record.epoch,
    )
  }

  private async enqueueDraftOperation(
    surfaceId: string,
    message: Extract<
      SessionSurfaceWebviewMessage,
      { type: "sessionSurface.draft.update" | "sessionSurface.draft.flush" }
    >,
  ): Promise<void> {
    await this.enqueueSurfaceDraftOperation(surfaceId, () => this.handleDraftOperation(surfaceId, message))
  }

  private async enqueueSurfaceDraftOperation(surfaceId: string, operation: () => Promise<void>): Promise<void> {
    const prior = this.draftOperations.get(surfaceId) ?? Promise.resolve()
    const next = prior.catch(() => undefined).then(operation)
    this.draftOperations.set(surfaceId, next)
    await next.finally(() => {
      if (this.draftOperations.get(surfaceId) === next) this.draftOperations.delete(surfaceId)
    })
  }

  private async handleDraftOperation(
    surfaceId: string,
    message: Extract<
      SessionSurfaceWebviewMessage,
      { type: "sessionSurface.draft.update" | "sessionSurface.draft.flush" }
    >,
  ): Promise<void> {
    if (message.type === "sessionSurface.draft.update") {
      await this.updateDraft(surfaceId, message)
      return
    }
    const record = this.ensure(message.key)
    const surface = this.surfaces.get(surfaceId)
    if (!surface) return
    if (!this.validToken(surfaceId, record, message.token)) {
      surface.post({
        type: "sessionSurface.draft.rejected",
        key: message.key,
        clientSeq: message.clientSeq,
        state: this.toState(record, surfaceId),
      })
      this.rejectFlushWaiters(surfaceId, message.key, new Error("草稿所有权已变化，已保留当前输入"))
      return
    }
    const last = this.clients.get(`${surfaceId}:${sessionSurfaceKey(message.key)}`) ?? 0
    if (last < message.clientSeq) {
      surface.post({
        type: "sessionSurface.draft.rejected",
        key: message.key,
        clientSeq: message.clientSeq,
        state: this.toState(record, surfaceId),
      })
      this.rejectFlushWaiters(surfaceId, message.key, new Error("草稿保存未完成，已保留当前输入"))
      return
    }
    const pendingWrite = this.writes.get(sessionSurfaceKey(message.key))
    if (pendingWrite) await pendingWrite
    surface.post({
      type: "sessionSurface.draft.ack",
      key: message.key,
      clientSeq: message.clientSeq,
      revision: record.draftRevision,
    })
    this.resolveFlushWaiters(surfaceId, message.key)
  }

  private nextEpoch(): number {
    this.epoch++
    return this.epoch
  }

  private applyDeepSeekHarnessLifecycle(
    record: RecordState,
    surfaceId: string,
    message: Record<string, unknown>,
  ): void {
    if (message.type === "chipmateDeepSeekHarness.activate") {
      record.mode = "deepseek-harness"
      if (typeof message.taskId === "string") record.taskId = message.taskId
      this.assignDshLease(record, surfaceId)
      this.broadcast(record)
      return
    }
    if (message.type !== "chipmateDeepSeekHarness.deactivate" || record.dshLeaseSurfaceId !== surfaceId) return
    record.mode = "qa"
    record.taskId = undefined
    this.clearDshLease(record)
    this.broadcast(record)
  }

  private applyDeepSeekHarnessProjection(
    record: RecordState,
    surfaceId: string,
    message: Record<string, unknown>,
  ): void {
    if (message.type === "chipmateDeepSeekHarness.projectionReady") {
      this.resolveProjectionWaiters(surfaceId, record.key)
      return
    }
    if (message.type === "chipmateDeepSeekHarness.projectionFailed") {
      this.rejectProjectionWaiters(surfaceId, new Error("官方 DSH 投影失败"), record.key)
      return
    }
    if (message.type === "chipmateDeepSeekHarness.detached") {
      this.resolveDshDetachWaiters(surfaceId, record.key)
    }
  }

  private toState(record: RecordState, targetSurfaceId?: string): SessionSurfaceState {
    const token =
      targetSurfaceId &&
      record.ownerSurfaceId === targetSurfaceId &&
      sameSessionSurfaceKey(this.active.get(targetSurfaceId), record.key)
        ? { generation: this.generation, surfaceId: targetSurfaceId, epoch: record.epoch }
        : undefined
    return {
      key: record.key,
      phase: record.phase,
      ownerSurfaceId: record.ownerSurfaceId,
      token,
      draftRevision: record.draftRevision,
      title: record.title,
      directory: record.directory,
      mode: record.mode,
      taskId: record.taskId,
      dshLease:
        targetSurfaceId !== undefined &&
        this.dshLease?.surfaceId === targetSurfaceId &&
        this.dshLease.recordId === sessionSurfaceKey(record.key),
    }
  }

  private assignDshLease(record: RecordState, surfaceId: string): void {
    const recordId = sessionSurfaceKey(record.key)
    const previous = this.dshLease
    if (previous?.surfaceId === surfaceId && previous.recordId === recordId) {
      record.dshLeaseSurfaceId = surfaceId
      return
    }
    if (previous) {
      const old = this.records.get(previous.recordId)
      if (old) {
        old.dshLeaseSurfaceId = undefined
        this.broadcast(old)
      }
    }
    record.dshLeaseSurfaceId = surfaceId
    this.dshLease = { surfaceId, recordId }
  }

  private clearDshLease(record: RecordState): void {
    const recordId = sessionSurfaceKey(record.key)
    record.dshLeaseSurfaceId = undefined
    if (this.dshLease?.recordId === recordId) this.dshLease = undefined
  }

  private sendState(surface: Surface, record: RecordState): void {
    surface.post({ type: "sessionSurface.state", state: this.toState(record, surface.id) })
  }

  private broadcast(record: RecordState): void {
    for (const surface of this.surfaces.values()) {
      const active = this.active.get(surface.id)
      if (sameSessionSurfaceKey(active, record.key)) this.sendState(surface, record)
    }
  }

  private async sendDraft(surface: Surface, key: SessionSurfaceKey): Promise<void> {
    const draft = await this.getDraft(key)
    surface.post({ type: "sessionSurface.draft.snapshot", draft })
  }

  private async getDraft(key: SessionSurfaceKey): Promise<SessionSurfaceDraft> {
    key = this.resolveKey(key)
    const id = sessionSurfaceKey(key)
    const cached = this.drafts.get(id)
    if (cached) return cached
    const pending = this.draftLoads.get(id) ?? this.loadPersistedDraft(key)
    this.draftLoads.set(id, pending)
    const loaded = await pending.finally(() => {
      if (this.draftLoads.get(id) === pending) this.draftLoads.delete(id)
    })
    const updated = this.drafts.get(id)
    if (updated) return updated
    const draft =
      loaded ??
      ({ schemaVersion: 1, key, revision: 0, updatedAt: 0, content: EMPTY_CONTENT } satisfies SessionSurfaceDraft)
    const record = this.ensure(key)
    if (record.deleted) return { ...draft, revision: 0, updatedAt: 0, content: EMPTY_CONTENT }
    this.drafts.set(id, draft)
    record.draftRevision = Math.max(record.draftRevision, draft.revision)
    return draft
  }

  private draftDirectory(): string {
    return path.join(this.context.globalStorageUri.fsPath, "session-surface-drafts")
  }

  private draftPath(key: SessionSurfaceKey): string {
    const digest = crypto.createHash("sha256").update(sessionSurfaceKey(key)).digest("hex")
    return path.join(this.draftDirectory(), `${digest}.json`)
  }

  private previousDraftPath(key: SessionSurfaceKey): string {
    return `${this.draftPath(key)}.previous`
  }

  private blobDirectory(): string {
    return path.join(this.draftDirectory(), "blobs")
  }

  private async persistDraft(draft: SessionSurfaceDraft): Promise<void> {
    if (this.disposed) return
    const id = sessionSurfaceKey(draft.key)
    const prior = this.writes.get(id) ?? Promise.resolve()
    const next = prior
      .catch(() => undefined)
      .then(async () => {
        const dir = this.draftDirectory()
        await fs.mkdir(dir, { recursive: true })
        const target = this.draftPath(draft.key)
        const temp = `${target}.${crypto.randomUUID()}.tmp`
        const images: PersistedImage[] = []
        await fs.mkdir(this.blobDirectory(), { recursive: true })
        for (const image of draft.content.images) {
          const data = imageData(image.dataUrl)
          const sha256 = crypto.createHash("sha256").update(data).digest("hex")
          const blob = path.join(this.blobDirectory(), sha256)
          try {
            await fs.writeFile(blob, data, { flag: "wx", mode: 0o600 })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
          }
          images.push({ id: image.id, filename: image.filename, mime: image.mime, sha256 })
        }
        const stored: PersistedDraftValue = {
          ...draft,
          content: { ...draft.content, images },
        }
        const payload = JSON.stringify(stored)
        const persisted: PersistedDraft = {
          checksum: crypto.createHash("sha256").update(payload).digest("hex"),
          draft: stored,
        }
        await fs.writeFile(temp, JSON.stringify(persisted), { mode: 0o600 })
        const previous = this.previousDraftPath(draft.key)
        await fs.unlink(previous).catch(ignoreMissing)
        await fs.rename(target, previous).catch(ignoreMissing)
        try {
          await fs.rename(temp, target)
        } catch (error) {
          await fs.rename(previous, target).catch(ignoreMissing)
          await fs.unlink(temp).catch(ignoreMissing)
          throw error
        }
      })
    this.writes.set(id, next)
    await next.finally(() => {
      if (this.writes.get(id) === next) this.writes.delete(id)
    })
  }

  private async loadPersistedDraft(key: SessionSurfaceKey): Promise<SessionSurfaceDraft | undefined> {
    for (const candidate of [this.draftPath(key), this.previousDraftPath(key)]) {
      try {
        const raw = await fs.readFile(candidate, "utf8")
        const persisted = JSON.parse(raw) as PersistedDraft
        const payload = JSON.stringify(persisted.draft)
        const checksum = crypto.createHash("sha256").update(payload).digest("hex")
        if (checksum !== persisted.checksum || persisted.draft.schemaVersion !== 1) continue
        const images = await Promise.all(
          persisted.draft.content.images.map(async (image) => {
            const data = await fs.readFile(path.join(this.blobDirectory(), image.sha256))
            const sha256 = crypto.createHash("sha256").update(data).digest("hex")
            if (sha256 !== image.sha256) throw new Error("共享草稿附件校验失败")
            return { ...image, dataUrl: `data:${image.mime};base64,${data.toString("base64")}` }
          }),
        )
        return { ...persisted.draft, key, content: { ...persisted.draft.content, images } }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          console.warn("[ChipMate New] 共享会话草稿快照无效，正在尝试备份快照")
      }
    }
    return
  }

  private async removePersistedDraft(key: SessionSurfaceKey): Promise<void> {
    await Promise.all([
      fs.unlink(this.draftPath(key)).catch(ignoreMissing),
      fs.unlink(this.previousDraftPath(key)).catch(ignoreMissing),
    ])
    await this.cleanupOrphanBlobs()
  }

  private async removePersistedDraftAfterWrites(key: SessionSurfaceKey): Promise<void> {
    await this.writes.get(sessionSurfaceKey(key))?.catch(() => undefined)
    await this.removePersistedDraft(key)
  }

  private normalizeImages(content: SessionSurfaceDraftContent): SessionSurfaceDraftContent {
    return {
      ...content,
      images: content.images.map((image) => {
        const sha256 = crypto.createHash("sha256").update(imageData(image.dataUrl)).digest("hex")
        return { ...image, sha256 }
      }),
    }
  }

  private async cleanupOrphanBlobs(): Promise<void> {
    await Promise.all([...this.writes.values()].map((write) => write.catch(() => undefined)))
    const referenced = new Set<string>()
    let entries: string[]
    try {
      entries = await fs.readdir(this.draftDirectory())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json") && !entry.endsWith(".json.previous")) continue
      try {
        const raw = await fs.readFile(path.join(this.draftDirectory(), entry), "utf8")
        const value = JSON.parse(raw) as PersistedDraft
        for (const image of value.draft.content.images ?? []) referenced.add(image.sha256)
      } catch {
        // 损坏快照不能为附件续期；有效的上一份快照仍会单独参与扫描。
      }
    }
    let blobs: string[]
    try {
      blobs = await fs.readdir(this.blobDirectory())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    await Promise.all(
      blobs.filter((blob) => !referenced.has(blob)).map((blob) => fs.unlink(path.join(this.blobDirectory(), blob))),
    )
  }

  private waitForAcknowledgement<
    T extends { key: SessionSurfaceKey; resolve: () => void; reject: (error: Error) => void },
  >(
    collection: Map<string, Set<T>>,
    surfaceId: string,
    value: Omit<T, "resolve" | "reject">,
    timeoutMessage: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const values = collection.get(surfaceId)
        values?.delete(waiter)
        if (values?.size === 0) collection.delete(surfaceId)
        reject(new Error(timeoutMessage))
      }, 15_000)
      const waiter = {
        ...value,
        resolve: () => {
          clearTimeout(timeout)
          resolve()
        },
        reject: (error: Error) => {
          clearTimeout(timeout)
          reject(error)
        },
      } as T
      const values = collection.get(surfaceId) ?? new Set<T>()
      values.add(waiter)
      collection.set(surfaceId, values)
    })
  }

  private resolveReadyWaiters(
    surfaceId: string,
    key: SessionSurfaceKey,
    revision: number,
    ownershipEpoch?: number,
  ): void {
    const waiters = this.readyWaiters.get(surfaceId)
    if (!waiters) return
    for (const waiter of waiters) {
      if (
        !sameSessionSurfaceKey(waiter.key, key) ||
        waiter.revision > revision ||
        (waiter.ownershipEpoch !== undefined && waiter.ownershipEpoch !== ownershipEpoch)
      )
        continue
      waiters.delete(waiter)
      waiter.resolve()
    }
    if (waiters.size === 0) this.readyWaiters.delete(surfaceId)
  }

  private resolveFlushWaiters(surfaceId: string, key: SessionSurfaceKey): void {
    const waiters = this.flushWaiters.get(surfaceId)
    if (!waiters) return
    for (const waiter of waiters) {
      if (!sameSessionSurfaceKey(waiter.key, key)) continue
      waiters.delete(waiter)
      waiter.resolve()
    }
    if (waiters.size === 0) this.flushWaiters.delete(surfaceId)
  }

  private rejectFlushWaiters(surfaceId: string, key: SessionSurfaceKey, error: Error): void {
    const waiters = this.flushWaiters.get(surfaceId)
    if (!waiters) return
    for (const waiter of waiters) {
      if (!sameSessionSurfaceKey(waiter.key, key)) continue
      waiters.delete(waiter)
      waiter.reject(error)
    }
    if (waiters.size === 0) this.flushWaiters.delete(surfaceId)
  }

  private rejectWaiters(surfaceId: string, error: Error): void {
    for (const collection of [this.readyWaiters, this.flushWaiters]) {
      const waiters = collection.get(surfaceId)
      if (!waiters) continue
      collection.delete(surfaceId)
      for (const waiter of waiters) waiter.reject(error)
    }
  }

  private resolveProjectionWaiters(surfaceId: string, key: SessionSurfaceKey): void {
    const waiters = this.projectionWaiters.get(surfaceId)
    if (!waiters) return
    for (const waiter of waiters) {
      if (!sameSessionSurfaceKey(waiter.key, key)) continue
      waiters.delete(waiter)
      waiter.resolve()
    }
    if (waiters.size === 0) this.projectionWaiters.delete(surfaceId)
  }

  private rejectProjectionWaiters(surfaceId: string, error: Error, key?: SessionSurfaceKey): void {
    const waiters = this.projectionWaiters.get(surfaceId)
    if (!waiters) return
    for (const waiter of waiters) {
      if (key && !sameSessionSurfaceKey(waiter.key, key)) continue
      waiters.delete(waiter)
      waiter.reject(error)
    }
    if (waiters.size === 0) this.projectionWaiters.delete(surfaceId)
  }

  private resolveDshDetachWaiters(surfaceId: string, key: SessionSurfaceKey): void {
    const waiters = this.detachWaiters.get(surfaceId)
    if (!waiters) return
    for (const waiter of waiters) {
      if (!sameSessionSurfaceKey(waiter.key, key)) continue
      waiters.delete(waiter)
      waiter.resolve()
    }
    if (waiters.size === 0) this.detachWaiters.delete(surfaceId)
  }

  private rejectDshDetachWaiters(surfaceId: string, error: Error): void {
    const waiters = this.detachWaiters.get(surfaceId)
    if (!waiters) return
    this.detachWaiters.delete(surfaceId)
    for (const waiter of waiters) waiter.reject(error)
  }
}

function isDshTaskBoundMutation(value: unknown): boolean {
  return (
    value === "chipmateDeepSeekHarness.transport.request" ||
    value === "chipmateDeepSeekHarness.projectionReady" ||
    value === "chipmateDeepSeekHarness.projectionFailed" ||
    value === "chipmateDeepSeekHarness.detached"
  )
}

function mutationTarget(message: Record<string, unknown>): SessionSurfaceKey | undefined {
  if (typeof message.type === "string" && message.type.startsWith("chipmateDeepSeekHarness.")) return undefined
  if (typeof message.sessionID === "string") return { kind: "session", id: message.sessionID }
  if (typeof message.sessionId === "string") return { kind: "session", id: message.sessionId }
  if (typeof message.draftID === "string") return { kind: "draft", id: message.draftID }
  return undefined
}

function imageData(dataUrl: string): Buffer {
  const match = /^data:[^;,]+;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
  if (!match) throw new Error("共享草稿包含无效的图片附件")
  return Buffer.from(match[1], "base64")
}

function ignoreMissing(error: unknown): void {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
}
