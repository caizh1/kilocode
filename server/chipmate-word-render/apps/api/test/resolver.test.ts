import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import test from "node:test"

const require = createRequire(import.meta.url)
const resolver = require("../../../server.js") as {
  createTokenResolverState(): unknown
  resolveNewApiUser(
    key: string,
    opts: { env: Record<string, string>; state: unknown },
  ): Promise<{
    ok: boolean
    code?: string
    status: number
    user?: { name: string; tokenName?: string }
    reason?: string
    requestId?: string
    retryAfter?: string
    upstreamStatus?: number
  }>
}

async function upstream(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("failed to start test upstream")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers })
  res.end(JSON.stringify(body))
}

async function capture<T>(run: () => Promise<T>) {
  const lines: string[] = []
  const info = console.info
  const warn = console.warn
  console.info = (...values: unknown[]) => lines.push(values.map(String).join(" "))
  console.warn = (...values: unknown[]) => lines.push(values.map(String).join(" "))
  try {
    return { result: await run(), lines }
  } finally {
    console.info = info
    console.warn = warn
  }
}

test("resolves a token name directly and coalesces concurrent requests for the same key", async () => {
  const seen: string[] = []
  const api = await upstream(async (req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`)
    await new Promise((resolve) => setTimeout(resolve, 30))
    json(res, 200, { success: true, data: { name: "Alice@chipmate" } })
  })
  try {
    const state = resolver.createTokenResolverState()
    const env = { NEW_API_BASE_URL: api.origin }
    const [first, second] = await Promise.all([
      resolver.resolveNewApiUser("sk-direct", { env, state }),
      resolver.resolveNewApiUser("sk-direct", { env, state }),
    ])
    assert.equal(first.ok, true)
    assert.deepEqual(first.user, { name: "Alice", tokenName: "Alice@chipmate" })
    assert.deepEqual(second, first)
    assert.deepEqual(seen, ["GET /api/usage/token/ Bearer sk-direct"])

    const cached = await resolver.resolveNewApiUser("sk-direct", { env, state })
    assert.equal(cached.ok, true)
    assert.equal(seen.length, 1)
  } finally {
    await api.close()
  }
})

test("returns a stable rate-limit code without falling back to admin requests", async () => {
  const seen: string[] = []
  const api = await upstream((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    json(res, 429, { message: "too many requests" }, { "retry-after": "3" })
  })
  try {
    const recorded = await capture(() =>
      resolver.resolveNewApiUser("sk-limited", {
        env: {
          NEW_API_BASE_URL: api.origin,
          NEW_API_ADMIN_ACCESS_TOKEN: "admin-secret",
          NEW_API_USER_ID: "7",
        },
        state: resolver.createTokenResolverState(),
      }),
    )
    const result = recorded.result
    assert.equal(result.ok, false)
    assert.equal(result.code, "new-api-rate-limited")
    assert.equal(result.status, 429)
    assert.equal(result.reason, "rate-limited")
    assert.equal(result.retryAfter, "3")
    assert.equal(result.upstreamStatus, 429)
    assert.match(result.requestId || "", /^[a-f0-9]{8}$/)
    assert.deepEqual(seen, ["GET /api/usage/token/"])
    const logs = recorded.lines.join("\n")
    for (const event of [
      "resolve.start",
      "config.ready",
      "upstream.request.start",
      "upstream.request.finish",
      "direct.identity.error",
      "resolve.failure",
      "resolve.finish",
    ])
      assert.match(logs, new RegExp(`"event":"${event.replaceAll(".", "\\.")}"`))
    assert.match(logs, /"status":429/)
    assert.match(logs, /"retryAfter":"3"/)
    assert.doesNotMatch(logs, /sk-limited|admin-secret|authorization/i)
  } finally {
    await api.close()
  }
})

test("drops an invalid upstream Retry-After value", async () => {
  const api = await upstream((_req, res) => {
    json(res, 429, { message: "too many requests" }, { "retry-after": "not-a-delay" })
  })
  try {
    const result = await resolver.resolveNewApiUser("sk-limited", {
      env: { NEW_API_BASE_URL: api.origin },
      state: resolver.createTokenResolverState(),
    })
    assert.equal(result.code, "new-api-rate-limited")
    assert.equal(result.reason, "rate-limited")
    assert.equal(result.retryAfter, undefined)
  } finally {
    await api.close()
  }
})

test("returns a safe invalid-url reason and request id without exposing credentials", async () => {
  const recorded = await capture(() =>
    resolver.resolveNewApiUser("sk-invalid-url", {
      env: {
        NEW_API_BASE_URL: "https://exa mple.com/?token=query-secret",
        NEW_API_ADMIN_ACCESS_TOKEN: "admin-secret",
        NEW_API_USER_ID: "7",
      },
      state: resolver.createTokenResolverState(),
    }),
  )

  assert.equal(recorded.result.ok, false)
  assert.equal(recorded.result.code, "new-api-error")
  assert.equal(recorded.result.status, 502)
  assert.equal(recorded.result.reason, "invalid-url")
  assert.match(recorded.result.requestId || "", /^[a-f0-9]{8}$/)
  assert.doesNotMatch(JSON.stringify(recorded.result), /sk-invalid-url|admin-secret/)
  assert.doesNotMatch(recorded.lines.join("\n"), /sk-invalid-url|admin-secret|query-secret/)
})

test("falls back to one shared admin catalog request for older New API servers", async () => {
  const seen: string[] = []
  const api = await upstream(async (req, res) => {
    seen.push(`${req.method} ${req.url}`)
    if (req.url === "/api/usage/token/") {
      json(res, 404, { message: "not found" })
      return
    }
    if (req.url === "/api/token/?p=1&page_size=100") {
      await new Promise((resolve) => setTimeout(resolve, 30))
      json(res, 200, {
        success: true,
        data: {
          items: [
            { id: 1, name: "Alice@chipmate", key: "sk-alpha" },
            { id: 2, name: "Bob@chipmate", key: "sk-beta" },
          ],
          total: 2,
        },
      })
      return
    }
    json(res, 500, { message: "unexpected request" })
  })
  try {
    const state = resolver.createTokenResolverState()
    const env = {
      NEW_API_BASE_URL: api.origin,
      NEW_API_ADMIN_ACCESS_TOKEN: "admin-secret",
      NEW_API_USER_ID: "7",
    }
    const [alice, bob] = await Promise.all([
      resolver.resolveNewApiUser("sk-alpha", { env, state }),
      resolver.resolveNewApiUser("sk-beta", { env, state }),
    ])
    assert.equal(alice.user?.name, "Alice")
    assert.equal(bob.user?.name, "Bob")
    assert.equal(seen.filter((item) => item.includes("/api/token/")).length, 1)
  } finally {
    await api.close()
  }
})

test("does not retry a rate-limited admin catalog with another pagination parameter", async () => {
  const seen: string[] = []
  const api = await upstream((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    if (req.url === "/api/usage/token/") {
      json(res, 404, { message: "not found" })
      return
    }
    json(res, 429, { message: "slow down" })
  })
  try {
    const result = await resolver.resolveNewApiUser("sk-fallback", {
      env: {
        NEW_API_BASE_URL: api.origin,
        NEW_API_ADMIN_ACCESS_TOKEN: "admin-secret",
        NEW_API_USER_ID: "7",
      },
      state: resolver.createTokenResolverState(),
    })
    assert.equal(result.code, "new-api-rate-limited")
    assert.deepEqual(seen, ["GET /api/usage/token/", "GET /api/token/?p=1&page_size=100"])
  } finally {
    await api.close()
  }
})
