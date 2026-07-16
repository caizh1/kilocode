import Fastify from "fastify"
import type { MarketDb } from "@chipmate/market-db"
import { registerAligned } from "./aligned.ts"
import type { ResolveUser } from "./identity.ts"
import { register } from "./legacy.ts"
import { registerWeb } from "./web.ts"
import { MarketEvents } from "./events.ts"
import { registerExtensions } from "./extensions.ts"

export function build(
  db?: MarketDb,
  opts: {
    resolveUser?: ResolveUser
    now?: () => number
    extensionMarket?: boolean
    extensionRoot?: string
    extensionScanMs?: number
  } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 })
  app.addContentTypeParser(
    ["application/gzip", "application/octet-stream"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  )
  const web = registerWeb(app)
  register(app, !web)
  if (db) {
    const events = new MarketEvents()
    const enabled = opts.extensionMarket ?? process.env.EXTENSION_MARKET_ENABLED === "1"
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
        })
      : undefined
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
