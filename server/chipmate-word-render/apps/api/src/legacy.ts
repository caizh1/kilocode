import type { IncomingMessage, ServerResponse } from "node:http"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { LEGACY_ROUTES } from "@chipmate/market-contracts"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

interface LegacyServer {
  listeners(name: "request"): Array<(req: IncomingMessage, res: ServerResponse) => Promise<void> | void>
}

interface LegacyModule {
  server: LegacyServer
}

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const legacy = require(resolve(here, "../../../server.js")) as LegacyModule
const listener = (() => {
  const value = legacy.server.listeners("request")[0]
  if (!value) throw new Error("legacy request handler is missing")
  return value
})()

async function delegate(req: FastifyRequest, reply: FastifyReply) {
  reply.hijack()
  await listener(req.raw, reply.raw)
}

export function register(app: FastifyInstance, root = true) {
  for (const route of LEGACY_ROUTES) {
    if (!root && route.method === "GET" && route.url === "/") continue
    app.route({
      method: route.method,
      url: route.url,
      schema: route.schema,
      onRequest: delegate,
      handler: async () => undefined,
    })
  }
}
