import * as vscode from "vscode"
import { compareVersions } from "./version"
import { CHIPMATE_UPDATE_TARGETS, type ChipmateUpdateTarget } from "../../shared/update-check"

export const PENDING_ACTIVATION_KEY = "chipmate.v2.updateCheck.pendingActivation"
export const LAST_ACTIVATION_KEY = "chipmate.v2.updateCheck.lastActivation"

export const LAST_SUPERSEDED_KEY = "chipmate.v2.updateCheck.lastSuperseded"

const SCHEMA_VERSION = 1

export type PendingUpdateActivation = {
  schemaVersion: typeof SCHEMA_VERSION
  transactionId: string
  extensionId: string
  fromVersion: string
  expectedVersion: string
  target: ChipmateUpdateTarget
  sha256: string
  installedAt: number
  reloadRequestedAt?: number
  reloadAttempts?: number
  lastMismatch?: {
    version: string
    target?: ChipmateUpdateTarget
    observedAt: number
  }
}

export type UpdateActivationRecord = PendingUpdateActivation & {
  hostActivatedAt: number
  webviewReadyAt?: number
  webviewVersion?: string
  motionBaseUri?: string
  reducedMotion?: boolean
}

type ExtensionIdentity = {
  extensionId: string
  version: string
  target?: ChipmateUpdateTarget
}

export type PendingActivationResult =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "host-active"; record: UpdateActivationRecord }
  | { status: "superseded"; pending: PendingUpdateActivation; actual: ExtensionIdentity }
  | { status: "mismatch"; pending: PendingUpdateActivation; actual: ExtensionIdentity }

export type UpdateWebviewReceipt = {
  version?: unknown
  motionBaseUri?: unknown
  reducedMotion?: unknown
}

type StateContext = Pick<vscode.ExtensionContext, "extension" | "globalState">

export async function writePendingUpdateActivation(
  context: StateContext,
  pending: PendingUpdateActivation,
): Promise<void> {
  await context.globalState.update(PENDING_ACTIVATION_KEY, pending)
}

export async function markPendingUpdateReloadRequested(
  context: StateContext,
  now = Date.now(),
): Promise<PendingUpdateActivation | undefined> {
  const pending = pendingActivation(context)
  if (!pending) return
  const next = {
    ...pending,
    reloadRequestedAt: now,
    reloadAttempts: (pending.reloadAttempts ?? 0) + 1,
  }
  await writePendingUpdateActivation(context, next)
  return next
}

export async function confirmPendingUpdateActivation(
  context: StateContext,
  now = Date.now(),
): Promise<PendingActivationResult> {
  const raw = context.globalState.get<unknown>(PENDING_ACTIVATION_KEY)
  if (raw === undefined) return { status: "none" }
  const pending = parsePendingActivation(raw)
  if (!pending) {
    await context.globalState.update(PENDING_ACTIVATION_KEY, undefined)
    return { status: "invalid" }
  }

  const actual = extensionIdentity(context)
  if (actual.extensionId === pending.extensionId && actual.version === pending.expectedVersion && actual.target === pending.target) {
    const record: UpdateActivationRecord = { ...pending, hostActivatedAt: now }
    await context.globalState.update(LAST_ACTIVATION_KEY, record)
    await context.globalState.update(PENDING_ACTIVATION_KEY, undefined)
    return { status: "host-active", record }
  }

  if (
    actual.extensionId === pending.extensionId &&
    actual.target === pending.target &&
    compareVersions(actual.version, pending.expectedVersion) > 0
  ) {
    await context.globalState.update(LAST_SUPERSEDED_KEY, { pending, actual, supersededAt: now })
    await context.globalState.update(PENDING_ACTIVATION_KEY, undefined)
    return { status: "superseded", pending, actual }
  }

  const next: PendingUpdateActivation = {
    ...pending,
    lastMismatch: {
      version: actual.version,
      ...(actual.target ? { target: actual.target } : {}),
      observedAt: now,
    },
  }
  await writePendingUpdateActivation(context, next)
  return { status: "mismatch", pending: next, actual }
}

export async function recordUpdateWebviewReady(
  context: StateContext,
  receipt: UpdateWebviewReceipt,
  now = Date.now(),
): Promise<boolean> {
  const previous = parseActivationRecord(context.globalState.get<unknown>(LAST_ACTIVATION_KEY))
  if (!previous) return false

  const actual = extensionIdentity(context)
  const version = string(receipt.version)
  const motionBaseUri = string(receipt.motionBaseUri)
  if (
    actual.extensionId !== previous.extensionId ||
    actual.version !== previous.expectedVersion ||
    actual.target !== previous.target ||
    version !== previous.expectedVersion ||
    !motionBaseUri
  ) {
    return false
  }

  await context.globalState.update(LAST_ACTIVATION_KEY, {
    ...previous,
    webviewReadyAt: now,
    webviewVersion: version,
    motionBaseUri,
    ...(typeof receipt.reducedMotion === "boolean" ? { reducedMotion: receipt.reducedMotion } : {}),
  } satisfies UpdateActivationRecord)
  return true
}

export function pendingActivation(context: Pick<vscode.ExtensionContext, "globalState">): PendingUpdateActivation | undefined {
  return parsePendingActivation(context.globalState.get<unknown>(PENDING_ACTIVATION_KEY))
}

function extensionIdentity(context: Pick<vscode.ExtensionContext, "extension">): ExtensionIdentity {
  const raw = context.extension.packageJSON as Record<string, unknown>
  const publisher = string(raw.publisher)
  const name = string(raw.name)
  return {
    extensionId: publisher && name ? `${publisher}.${name}` : "",
    version: string(raw.version),
    target: target(raw.chipmatePackageTarget),
  }
}

function parseActivationRecord(value: unknown): UpdateActivationRecord | undefined {
  const pending = parsePendingActivation(value)
  if (!pending || !record(value) || !positive(value.hostActivatedAt)) return
  const webviewReadyAt = positive(value.webviewReadyAt) ? value.webviewReadyAt : undefined
  const webviewVersion = string(value.webviewVersion)
  const motionBaseUri = string(value.motionBaseUri)
  const reducedMotion = typeof value.reducedMotion === "boolean" ? value.reducedMotion : undefined
  return {
    ...pending,
    hostActivatedAt: value.hostActivatedAt,
    ...(webviewReadyAt ? { webviewReadyAt } : {}),
    ...(webviewVersion ? { webviewVersion } : {}),
    ...(motionBaseUri ? { motionBaseUri } : {}),
    ...(reducedMotion === undefined ? {} : { reducedMotion }),
  }
}

function parsePendingActivation(value: unknown): PendingUpdateActivation | undefined {
  if (!record(value)) return
  const targetValue = target(value.target)
  const installedAt = positive(value.installedAt) ? value.installedAt : undefined
  const reloadRequestedAt = positive(value.reloadRequestedAt) ? value.reloadRequestedAt : undefined
  const reloadAttempts = positive(value.reloadAttempts) ? value.reloadAttempts : undefined
  const lastMismatch = parseMismatch(value.lastMismatch)
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    !nonempty(value.transactionId) ||
    !nonempty(value.extensionId) ||
    !version(value.fromVersion) ||
    !version(value.expectedVersion) ||
    !targetValue ||
    !sha256(value.sha256) ||
    !installedAt
  ) {
    return
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    transactionId: value.transactionId,
    extensionId: value.extensionId,
    fromVersion: value.fromVersion,
    expectedVersion: value.expectedVersion,
    target: targetValue,
    sha256: value.sha256.toLowerCase(),
    installedAt,
    ...(reloadRequestedAt ? { reloadRequestedAt } : {}),
    ...(reloadAttempts ? { reloadAttempts } : {}),
    ...(lastMismatch ? { lastMismatch } : {}),
  }
}

function parseMismatch(value: unknown): PendingUpdateActivation["lastMismatch"] | undefined {
  if (!record(value) || !version(value.version) || !positive(value.observedAt)) return
  const targetValue = target(value.target)
  return {
    version: value.version,
    ...(targetValue ? { target: targetValue } : {}),
    observedAt: value.observedAt,
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function version(value: unknown): value is string {
  return typeof value === "string" && /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value)
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function target(value: unknown): ChipmateUpdateTarget | undefined {
  return typeof value === "string" && (CHIPMATE_UPDATE_TARGETS as readonly string[]).includes(value)
    ? (value as ChipmateUpdateTarget)
    : undefined
}
