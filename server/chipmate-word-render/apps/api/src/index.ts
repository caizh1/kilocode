import Fastify from "fastify"
import type { MarketDb } from "@chipmate/market-db"
import { registerAligned } from "./aligned.ts"
import type { ResolveUser } from "./identity.ts"
import { register } from "./legacy.ts"
import { registerWeb } from "./web.ts"
import { MarketEvents } from "./events.ts"
import { registerExtensions } from "./extensions.ts"
import { registerUpdatePackages } from "./update-packages.ts"
import { registerReviewRules } from "./review-rules.ts"
import type { FastifyRequest } from "fastify"

export function build(
  db?: MarketDb,
  opts: {
    resolveUser?: ResolveUser
    now?: () => number
    extensionMarket?: boolean
    extensionRoot?: string
    extensionScanMs?: number
    extensionActiveUploads?: number
    extensionMinimumFreeBytes?: number
    extensionUploadIdleMs?: number
    extensionUploadMaxMs?: number
    extensionOwnerBindings?: Record<string, string>
    packageRoot?: string
    reviewRoot?: string
    reviewAuthorize?: (req: FastifyRequest) => Promise<void>
    reviewPublishers?: string[]
  } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 })
  app.addContentTypeParser(
    ["application/gzip", "application/octet-stream"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  )
  app.addContentTypeParser(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  )
  const web = registerWeb(app)
  const enabled = Boolean(db) && (opts.extensionMarket ?? process.env.EXTENSION_MARKET_ENABLED === "1")
  register(app, !web, !enabled)
  registerReviewRules(app, db, {
    root: opts.reviewRoot ?? process.env.REVIEW_RULE_ROOT?.trim() ?? "/data/review-rules",
    ...(opts.resolveUser ? { resolveUser: opts.resolveUser } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.reviewAuthorize ? { authorize: opts.reviewAuthorize } : {}),
    publishers: opts.reviewPublishers ?? list(process.env.REVIEW_RULE_PUBLISHERS),
  })
  if (db) {
    const events = new MarketEvents()
    const scan = Number(process.env.EXTENSION_DROP_SCAN_MS)
    const runtime = enabled
      ? registerExtensions(app, db, {
          events,
          root: opts.extensionRoot ?? process.env.EXTENSION_MARKET_ROOT?.trim() ?? "/data/skill-market/extensions",
          ...(opts.resolveUser ? { resolveUser: opts.resolveUser } : {}),
          ...(opts.now ? { now: opts.now } : {}),
          ...(opts.extensionScanMs
            ? { scanMs: opts.extensionScanMs }
            : Number.isFinite(scan) && scan >= 1_000
              ? { scanMs: scan }
              : {}),
          activeUploads: opts.extensionActiveUploads ?? number(process.env.EXTENSION_UPLOAD_MAX_ACTIVE, 20),
          minimumFreeBytes:
            opts.extensionMinimumFreeBytes ??
            number(process.env.EXTENSION_UPLOAD_MIN_FREE_BYTES, 2 * 1024 * 1024 * 1024),
          uploadIdleMs: opts.extensionUploadIdleMs ?? number(process.env.EXTENSION_UPLOAD_IDLE_MS, 60_000),
          uploadMaxMs: opts.extensionUploadMaxMs ?? number(process.env.EXTENSION_UPLOAD_MAX_MS, 2 * 60 * 60 * 1_000),
          ownerBindings: opts.extensionOwnerBindings ?? bindings(process.env.EXTENSION_OWNER_BINDINGS_JSON),
          packageRoot: opts.packageRoot ?? process.env.PACKAGE_ROOT?.trim() ?? "/packages",
        })
      : undefined
    if (runtime)
      registerUpdatePackages(app, db, runtime, opts.packageRoot ?? process.env.PACKAGE_ROOT?.trim() ?? "/packages")
    registerAligned(app, db, {
      events,
      extensionMarket: enabled,
      ...(runtime ? { extensionStatus: () => runtime.health() } : {}),
      ...(opts.resolveUser ? { resolveUser: opts.resolveUser } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    })
  }
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({
      ok: false,
      issues: [{ severity: "error", code: "not-found", message: "Route not found." }],
    }),
  )
  return app
}

function number(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function bindings(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[0].trim().length > 0,
      ),
    )
  } catch (err) {
    console.warn("EXTENSION_OWNER_BINDINGS_JSON is invalid", err)
    return {}
  }
}

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}
