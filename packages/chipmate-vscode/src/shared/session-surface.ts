import type { ReviewCommentData } from "./review-comments"

export type ChatSurfaceKind = "sidebar" | "main-editor"

export type SessionSurfaceKey = { kind: "session"; id: string } | { kind: "draft"; id: string }

export type SessionSurfacePhase = "sidebar" | "opening-main" | "main" | "returning-sidebar" | "restoring" | "deleted"

export type SessionOwnershipToken = {
  generation: string
  surfaceId: string
  epoch: number
}

export type SessionSurfaceCredential = {
  key: SessionSurfaceKey
  token: SessionOwnershipToken
}

export type SessionSurfaceMutationRejectionReason =
  | "target-mismatch"
  | "task-mismatch"
  | "lease-mismatch"
  | "invalid-token"

export type SessionSurfaceImage = {
  id: string
  filename: string
  mime: string
  dataUrl: string
  sha256?: string
}

export type SessionSurfaceDraftContent = {
  boxId: string
  text: string
  reviewComments: ReviewCommentData[]
  images: SessionSurfaceImage[]
  references: string[]
  inputScrollTop: number
  selection?: {
    providerID: string
    modelID: string
    agent?: string
    variant?: string
    override?: boolean
  }
  deepSeekHarness?: {
    text: string
    mode: "queue" | "steer"
    answers: Record<string, { selected: string[]; custom: string; skipped: boolean }>
  }
}

export type SessionSurfaceDraft = {
  schemaVersion: 1
  key: SessionSurfaceKey
  revision: number
  updatedAt: number
  content: SessionSurfaceDraftContent
}

export type SessionSurfaceState = {
  key: SessionSurfaceKey
  phase: SessionSurfacePhase
  ownerSurfaceId?: string
  token?: SessionOwnershipToken
  draftRevision: number
  title?: string
  directory?: string
  mode: "qa" | "deepseek-harness"
  taskId?: string
  dshLease: boolean
}

export type MainEditorPanelStateV1 = {
  sessionSurfaceVersion: 1
  key: SessionSurfaceKey
  directory?: string
  mode: "qa" | "deepseek-harness"
  taskId?: string
  title?: string
  draftRevision: number
}

export type SessionSurfaceWebviewMessage =
  | { type: "sessionSurface.active"; key: SessionSurfaceKey }
  | { type: "sessionSurface.ready"; key: SessionSurfaceKey; draftRevision: number; ownershipEpoch?: number }
  | { type: "sessionSurface.openMain"; key: SessionSurfaceKey }
  | { type: "sessionSurface.returnToSidebar"; key: SessionSurfaceKey }
  | { type: "sessionSurface.focusOwner"; key: SessionSurfaceKey }
  | {
      type: "sessionSurface.draft.update"
      key: SessionSurfaceKey
      clientSeq: number
      token?: SessionOwnershipToken
      content: SessionSurfaceDraftContent
    }
  | {
      type: "sessionSurface.draft.flush"
      key: SessionSurfaceKey
      clientSeq: number
      token?: SessionOwnershipToken
    }
  | { type: "sessionSurface.draft.flushFailed"; key: SessionSurfaceKey }

export type SessionSurfaceExtensionMessage =
  | {
      type: "sessionSurface.bootstrap"
      surfaceId: string
      kind: ChatSurfaceKind
      pinnedKey?: SessionSurfaceKey
    }
  | { type: "sessionSurface.state"; state: SessionSurfaceState }
  | { type: "sessionSurface.select"; key: SessionSurfaceKey }
  | { type: "sessionSurface.draft.flushRequested"; key: SessionSurfaceKey }
  | { type: "sessionSurface.dsh.detachRequested"; key: SessionSurfaceKey; taskId: string }
  | { type: "sessionSurface.draft.snapshot"; draft: SessionSurfaceDraft }
  | {
      type: "sessionSurface.draft.ack"
      key: SessionSurfaceKey
      clientSeq: number
      revision: number
    }
  | {
      type: "sessionSurface.draft.rejected"
      key: SessionSurfaceKey
      clientSeq: number
      state: SessionSurfaceState
    }
  | {
      type: "sessionSurface.mutationRejected"
      key: SessionSurfaceKey
      state: SessionSurfaceState
      mutationType: string
      messageID?: string
      reason: SessionSurfaceMutationRejectionReason
    }

const SESSION_SURFACE_MUTATIONS = new Set([
  "sendMessage",
  "sendCommand",
  "importAndSend",
  "createSession",
  "abort",
  "compact",
  "revertSession",
  "turnChangesMutate",
  "unrevertSession",
  "deleteMessage",
  "permissionResponse",
  "questionReply",
  "questionReject",
  "sessionCostAlertResponse",
  "suggestionAccept",
  "suggestionDismiss",
  "deleteSession",
  "renameSession",
  "forkSession",
  "sidebar.forkSession",
  "toggleSandbox",
  "setSandboxDefault",
  "setWorkStyle",
  "setDocumentAgentScope",
  "persistModelSelection",
  "clearModelSelection",
  "persistVariant",
  "chipmateDeepSeekHarness.activate",
  "chipmateDeepSeekHarness.deactivate",
  "chipmateDeepSeekHarness.refresh",
  "chipmateDeepSeekHarness.transport.request",
  "chipmateDeepSeekHarness.projectionReady",
  "chipmateDeepSeekHarness.projectionFailed",
  "chipmateDeepSeekHarness.detached",
  "chipmateDeepSeekHarness.modelSelected",
  "chipmateDeepSeekHarness.selectionRequested",
  "chipmateDeepSeekHarness.confirmProviderSwitch",
  "chipmateDeepSeekHarness.cancelProviderSwitch",
  "chipmateDeepSeekHarness.stop",
  "chipmateDeepSeekHarness.restart",
  "chipmateDeepSeekHarness.retryRuntime",
  "chipmateDeepSeekHarness.createPreferredSession",
  "chipmateDeepSeekHarness.createMinimalSession",
  "chipmateDeepSeekHarness.openMappedSession",
  "chipmateDeepSeekHarness.returnToActiveSession",
])

export function isSessionSurfaceMutation(value: unknown): value is string {
  return typeof value === "string" && SESSION_SURFACE_MUTATIONS.has(value)
}

export function sessionSurfaceKey(value: SessionSurfaceKey): string {
  return `${value.kind}:${value.id}`
}

export function sameSessionSurfaceKey(left: SessionSurfaceKey | undefined, right: SessionSurfaceKey | undefined) {
  return left?.kind === right?.kind && left?.id === right?.id
}

export function isSessionSurfaceWebviewMessage(value: unknown): value is SessionSurfaceWebviewMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof value.type === "string" &&
      value.type.startsWith("sessionSurface."),
  )
}
