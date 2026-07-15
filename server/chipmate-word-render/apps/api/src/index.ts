import Fastify from "fastify"
import type { MarketDb } from "@chipmate/market-db"
import { registerAligned } from "./aligned.ts"
import type { ResolveUser } from "./identity.ts"
import { register } from "./legacy.ts"
import { registerWeb } from "./web.ts"

export function build(db?: MarketDb, opts: { resolveUser?: ResolveUser; now?: () => number } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 })
  app.addContentTypeParser(
    ["application/gzip", "application/octet-stream"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  )
  const web = registerWeb(app)
  register(app, !web)
  if (db) registerAligned(app, db, opts)
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({
      ok: false,
      issues: [{ severity: "error", code: "not-found", message: "Route not found." }],
    }),
  )
  return app
}
