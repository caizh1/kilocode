import { createReadStream, existsSync } from "node:fs"
import { extname, resolve, sep } from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"

const ROUTES = ["/", "/skills", "/skills/*", "/publish", "/me", "/analytics", "/status", "/login"] as const
const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

export function registerWeb(app: FastifyInstance, root = process.env.MARKET_WEB_ROOT?.trim()) {
  if (!root) return false
  const dir = resolve(root)
  const index = resolve(dir, "index.html")
  if (!existsSync(index)) {
    app.log.warn({ root: dir }, "market web build is unavailable")
    return false
  }
  app.get("/assets/*", async (req, reply) => {
    const path = resolve(dir, "assets", String((req.params as { "*"?: unknown })["*"] ?? ""))
    if (!path.startsWith(`${resolve(dir, "assets")}${sep}`) || !existsSync(path))
      return reply.code(404).send({ ok: false, code: "NOT_FOUND", message: "Asset not found." })
    return file(reply, path, "public, max-age=31536000, immutable")
  })
  for (const route of ROUTES) app.get(route, async (_req, reply) => file(reply, index, "no-cache"))
  return true
}

function file(reply: FastifyReply, path: string, cache: string) {
  return reply
    .header("cache-control", cache)
    .header(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    )
    .header("content-type", TYPES[extname(path)] ?? "application/octet-stream")
    .header("x-content-type-options", "nosniff")
    .header("referrer-policy", "no-referrer")
    .send(createReadStream(path))
}
