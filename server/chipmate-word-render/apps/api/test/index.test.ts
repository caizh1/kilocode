import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { build } from "../src/index.ts"

test("Fastify owns the health route and delegates the frozen payload", async () => {
  const app = build()
  const res = await app.inject({ method: "GET", url: "/health" })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().service, "chipmate-word-render")
  await app.close()
})

test("production Web routes serve the Vite build with CSP and immutable assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-market-web-"))
  await mkdir(join(root, "assets"))
  await writeFile(join(root, "index.html"), '<!doctype html><div id="root"></div>')
  await writeFile(join(root, "assets", "index-hash.js"), "console.log('market')")
  const prior = process.env.MARKET_WEB_ROOT
  process.env.MARKET_WEB_ROOT = root
  const app = build()
  try {
    const page = await app.inject({ method: "GET", url: "/analytics" })
    assert.equal(page.statusCode, 200)
    assert.match(page.body, /id="root"/)
    assert.match(String(page.headers["content-security-policy"]), /default-src 'self'/)
    const asset = await app.inject({ method: "GET", url: "/assets/index-hash.js" })
    assert.equal(asset.statusCode, 200)
    assert.match(String(asset.headers["cache-control"]), /immutable/)
    assert.match(String(asset.headers["content-type"]), /text\/javascript/)
  } finally {
    await app.close()
    if (prior === undefined) delete process.env.MARKET_WEB_ROOT
    else process.env.MARKET_WEB_ROOT = prior
    await rm(root, { recursive: true, force: true })
  }
})
