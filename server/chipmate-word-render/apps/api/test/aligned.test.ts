import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { MarketDb } from "@chipmate/market-db"
import { build } from "../src/index.ts"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../..")
const repo = resolve(root, "../..")
const archive = resolve(repo, "docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz")

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-g4-api-"))
  const source = join(dir, "source")
  await mkdir(join(source, "skills"), { recursive: true })
  await copyFile(archive, join(source, "skills", "source-backed-detail-design.tar.gz"))
  await writeFile(
    join(source, "skills.json"),
    `${JSON.stringify({
      items: [
        {
          id: "source-backed-detail-design",
          name: "Source-backed Detail Design",
          description: "Generate source-backed module detail designs.",
          category: "documents",
          tags: ["design", "evidence"],
          author: "ChipMate",
          content: "skills/source-backed-detail-design.tar.gz",
          version: "1.0.0",
          artwork: {
            type: "icon",
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            mime: "image/png",
            width: 1,
            height: 1,
            sha256: "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
          },
          gallery: [
            {
              type: "screenshot",
              url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              mime: "image/png",
              width: 1,
              height: 1,
              sha256: "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
            },
          ],
        },
        {
          id: "code-evidence-map",
          name: "Code Evidence Map",
          description: "Map source symbols to reviewable evidence.",
          category: "development",
          tags: ["code", "evidence"],
          author: "ChipMate",
          content: "skills/source-backed-detail-design.tar.gz",
          version: "1.0.0",
        },
      ],
    })}\n`,
  )
  const db = new MarketDb({ dir: join(dir, "db") })
  await db.importLegacy(source)
  return { db, dir }
}

test("aligned-v1 catalog serves capabilities, detail, versions, files, status, and cache validators", async () => {
  const data = await fixture()
  const app = build(data.db)
  try {
    const capabilities = await app.inject({ method: "GET", url: "/api/v1/capabilities" })
    assert.equal(capabilities.statusCode, 200)
    assert.equal(capabilities.json().mode, "aligned-v1")
    assert.equal(capabilities.json().features.versions, true)
    assert.equal(capabilities.json().features.favorites, true)
    assert.equal(capabilities.json().features.installations, true)
    assert.equal(capabilities.json().features.analytics, true)

    const catalog = await app.inject({ method: "GET", url: "/api/v1/skills?q=source&limit=1" })
    assert.equal(catalog.statusCode, 200)
    assert.equal(catalog.json().items[0].id, "source-backed-detail-design")
    assert.equal(catalog.json().items[0].artwork.type, "icon")
    assert.deepEqual(catalog.json().items[0].risk, { level: "unknown", issueCount: 0 })
    const etag = catalog.headers.etag
    assert.ok(etag)
    const unchanged = await app.inject({
      method: "GET",
      url: "/api/v1/skills?q=source&limit=1",
      headers: { "if-none-match": etag },
    })
    assert.equal(unchanged.statusCode, 304)
    const page = await app.inject({ method: "GET", url: "/api/v1/skills?limit=1&sort=name" })
    assert.equal(page.json().items.length, 1)
    assert.equal(page.json().nextCursor, "1")
    const next = await app.inject({ method: "GET", url: "/api/v1/skills?limit=1&sort=name&cursor=1" })
    assert.equal(next.json().items.length, 1)
    assert.notEqual(next.json().items[0].id, page.json().items[0].id)

    const detail = await app.inject({ method: "GET", url: "/api/v1/skills/source-backed-detail-design" })
    assert.equal(detail.statusCode, 200)
    assert.match(detail.json().markdown, /source-backed/i)
    assert.equal(detail.json().gallery.length, 1)
    assert.equal(detail.json().releases[0].report.sourceSha256.length, 64)
    assert.equal(detail.json().risk.level, "unknown")
    assert.ok(detail.json().files.some((file: { path: string }) => file.path === "SKILL.md"))

    const releases = await app.inject({ method: "GET", url: "/api/v1/skills/source-backed-detail-design/releases" })
    assert.equal(releases.json()[0].revision, 1)
    const release = await app.inject({ method: "GET", url: "/api/v1/skills/source-backed-detail-design/releases/1" })
    assert.equal(release.json().semver, "1.0.0")

    const files = await app.inject({ method: "GET", url: "/api/v1/skills/source-backed-detail-design/files" })
    assert.ok(files.json().some((file: { path: string }) => file.path === "SKILL.md"))
    const preview = await app.inject({
      method: "GET",
      url: "/api/v1/skills/source-backed-detail-design/files/SKILL.md",
    })
    assert.match(preview.json().text, /source-backed/i)

    const categories = await app.inject({ method: "GET", url: "/api/v1/categories" })
    assert.deepEqual(categories.json(), [
      { id: "development", name: "development", count: 1 },
      { id: "documents", name: "documents", count: 1 },
    ])
    const author = await data.db.author((await data.db.get("source-backed-detail-design"))?.authorId ?? "")
    const authorPage = await app.inject({ method: "GET", url: `/api/v1/authors/${author?.id}` })
    assert.equal(authorPage.json().displayName, "ChipMate")
    const status = await app.inject({ method: "GET", url: "/api/v1/status" })
    assert.deepEqual(status.json(), {
      ok: true,
      transport: "trusted-http",
      render: "ready",
      market: "ready",
      packages: "ready",
      warnings: ["当前使用受信内网 HTTP，登录时的 New API key 不受传输加密保护。"],
    })
  } finally {
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("capability cache validator changes when the extension market is enabled", async () => {
  const data = await fixture()
  const disabled = build(data.db)
  try {
    const first = await disabled.inject({ method: "GET", url: "/api/v1/capabilities" })
    assert.equal(first.statusCode, 200)
    assert.equal(first.json().features.extensions, false)
    assert.ok(first.headers.etag)

    const enabled = build(data.db, { extensionMarket: true, extensionRoot: join(data.dir, "extensions") })
    try {
      const next = await enabled.inject({
        method: "GET",
        url: "/api/v1/capabilities",
        headers: { "if-none-match": first.headers.etag },
      })
      assert.equal(next.statusCode, 200)
      assert.equal(next.json().features.extensions, true)
      assert.notEqual(next.headers.etag, first.headers.etag)
    } finally {
      await enabled.close()
    }
  } finally {
    await disabled.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("market SSE sends an initial catalog invalidation event and closes cleanly", async () => {
  const data = await fixture()
  const app = build(data.db)
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  const abort = new AbortController()
  try {
    const response = await fetch(`${origin}/api/v1/market/stream`, { signal: abort.signal })
    assert.equal(response.status, 200)
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/)
    const reader = response.body?.getReader()
    if (!reader) throw new Error("SSE response has no body")
    const chunk = await reader.read()
    const text = new TextDecoder().decode(chunk.value)
    assert.match(text, /event: catalog\.invalidated/)
    assert.match(text, /catalogVersion/)
    const version = await data.db.version()
    const currentAbort = new AbortController()
    const current = await fetch(`${origin}/api/v1/market/stream?catalogVersion=${encodeURIComponent(version)}`, {
      signal: currentAbort.signal,
      headers: { "last-event-id": "event-before-reconnect" },
    })
    const currentReader = current.body?.getReader()
    if (!currentReader) throw new Error("SSE recovery response has no body")
    const currentChunk = await currentReader.read()
    const currentText = new TextDecoder().decode(currentChunk.value)
    assert.match(currentText, /catalog .* current/)
    assert.doesNotMatch(currentText, /catalog\.invalidated/)
    currentAbort.abort()
  } finally {
    abort.abort()
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("web session and Kilo bearer resolve to one user with protected favorites and installations", async () => {
  const data = await fixture()
  const resolveUser = async (key: string) =>
    key === "web-key" || key === "kilo-key"
      ? ({ ok: true, user: { name: "Alice", tokenName: "Alice@chipmate" }, status: 200 } as const)
      : ({ ok: false, code: "token-not-found", status: 404 } as const)
  const app = build(data.db, { resolveUser })
  try {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/session", payload: { apiKey: "web-key" } })
    assert.equal(login.statusCode, 200)
    assert.match(String(login.headers["set-cookie"] ?? ""), /HttpOnly; SameSite=Strict/)
    const cookie = String(login.headers["set-cookie"] ?? "").split(";", 1)[0]
    const csrf = String(login.headers["x-csrf-token"] ?? "")
    assert.ok(cookie)
    assert.ok(csrf)

    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } })
    const bearer = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer kilo-key" },
    })
    assert.equal(me.json().id, bearer.json().id)
    assert.equal(me.json().displayName, "Alice")
    assert.equal((await readFile(join(data.dir, "db", "market.sqlite"))).includes(Buffer.from("web-key")), false)

    const rejected = await app.inject({
      method: "PUT",
      url: "/api/v1/favorites/source-backed-detail-design",
      headers: { cookie, "x-csrf-token": csrf },
    })
    assert.equal(rejected.statusCode, 403)
    assert.equal(rejected.json().code, "ORIGIN_INVALID")

    const favorite = await app.inject({
      method: "PUT",
      url: "/api/v1/favorites/source-backed-detail-design",
      headers: { cookie, "x-csrf-token": csrf, host: "market.test", origin: "http://market.test" },
    })
    assert.equal(favorite.statusCode, 200)
    assert.equal(favorite.json().favorite, true)
    const favorites = await app.inject({
      method: "GET",
      url: "/api/v1/me/favorites",
      headers: { authorization: "Bearer kilo-key" },
    })
    assert.equal(favorites.json()[0].id, "source-backed-detail-design")
    assert.equal(favorites.json()[0].favorite, true)

    const item = await data.db.get("source-backed-detail-design")
    assert.ok(item)
    const installation = {
      skillId: item.id,
      revision: item.latestRevision,
      sha256: item.sha256,
      scope: "project",
      status: "installed",
      clientId: "client-1234567890",
      workspaceId: "workspace-123456",
      changedAt: new Date().toISOString(),
    }
    const installed = await app.inject({
      method: "PUT",
      url: `/api/v1/installations/${item.id}`,
      headers: { authorization: "Bearer kilo-key" },
      payload: installation,
    })
    assert.equal(installed.statusCode, 200)
    assert.equal(installed.json().status, "installed")
    const installations = await app.inject({
      method: "GET",
      url: "/api/v1/me/installations",
      headers: { cookie },
    })
    assert.deepEqual(installations.json(), [installed.json()])
  } finally {
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("identity rate limits preserve Retry-After and use the public rate-limit code", async () => {
  const data = await fixture()
  const resolveUser = async (key: string) => {
    if (key === "limited")
      return { ok: false, code: "new-api-rate-limited", status: 429, retryAfter: "3" } as const
    if (key === "unsafe")
      return { ok: false, code: "new-api-rate-limited", status: 429, retryAfter: "invalid\nvalue" } as const
    return { ok: false, code: "token-not-found", status: 404 } as const
  }
  const app = build(data.db, { resolveUser })
  try {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/session", payload: { apiKey: "limited" } })
    assert.equal(login.statusCode, 429)
    assert.equal(login.json().code, "RATE_LIMITED")
    assert.equal(login.headers["retry-after"], "3")

    const bearer = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer limited" },
    })
    assert.equal(bearer.statusCode, 429)
    assert.equal(bearer.json().code, "RATE_LIMITED")
    assert.equal(bearer.headers["retry-after"], "3")

    const unsafe = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer unsafe" },
    })
    assert.equal(unsafe.statusCode, 429)
    assert.equal(unsafe.json().code, "RATE_LIMITED")
    assert.equal(unsafe.headers["retry-after"], undefined)

    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer invalid" },
    })
    assert.equal(invalid.statusCode, 404)
    assert.equal(invalid.json().code, "AUTH_INVALID")
  } finally {
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("event batches derive identity, hash clients, reject sensitive context, and refresh analytics", async () => {
  const data = await fixture()
  const now = Date.parse("2026-07-12T12:00:00.000Z")
  const resolveUser = async (key: string) =>
    key === "kilo-key"
      ? ({ ok: true, user: { name: "Alice", tokenName: "Alice@chipmate" }, status: 200 } as const)
      : ({ ok: false, code: "token-not-found", status: 404 } as const)
  const app = build(data.db, { resolveUser, now: () => now })
  try {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/events/batch",
      headers: { authorization: "Bearer kilo-key" },
      payload: [
        {
          name: "skill_open",
          surface: "vscode",
          userId: "forged-user-0001",
          clientId: "raw-client-0000001",
          occurredAt: "2026-07-12T11:59:00.000Z",
          context: { apiKey: "must-not-be-stored" },
        },
      ],
    })
    assert.equal(invalid.statusCode, 400)

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/events/batch",
      headers: { authorization: "Bearer kilo-key" },
      payload: [
        {
          name: "market_search",
          surface: "vscode",
          userId: "forged-user-0001",
          clientId: "raw-client-0000001",
          skillId: "source-backed-detail-design",
          revision: 1,
          occurredAt: "2026-07-12T11:59:00.000Z",
          context: { hasQuery: true, queryLength: 8, category: "documents" },
        },
      ],
    })
    assert.equal(accepted.statusCode, 202)
    assert.equal(accepted.json().accepted, 1)
    assert.ok((await data.db.aggregate()).some((item) => item.name === "market_search"))

    const sqlite = new DatabaseSync(join(data.dir, "db", "market.sqlite"), { readOnly: true })
    const row = sqlite
      .prepare("SELECT user_id,client_id,context_json FROM events WHERE name='market_search'")
      .get() as unknown as {
      user_id: string
      client_id: string
      context_json: string
    }
    sqlite.close()
    assert.notEqual(row.user_id, "forged-user-0001")
    assert.notEqual(row.client_id, "raw-client-0000001")
    assert.deepEqual(JSON.parse(row.context_json), { hasQuery: true, queryLength: 8, category: "documents" })
  } finally {
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("favorite writes emit SSE invalidation consumed by the other surface", async () => {
  const data = await fixture()
  const resolveUser = async (key: string) =>
    key === "alice"
      ? ({ ok: true, user: { name: "Alice" }, status: 200 } as const)
      : ({ ok: false, code: "token-not-found", status: 404 } as const)
  const app = build(data.db, { resolveUser })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  const abort = new AbortController()
  try {
    const login = await fetch(`${origin}/api/v1/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "alice" }),
    })
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? ""
    const csrf = login.headers.get("x-csrf-token") ?? ""
    const stream = await fetch(`${origin}/api/v1/market/stream`, { signal: abort.signal })
    const reader = stream.body?.getReader()
    if (!reader) throw new Error("SSE response has no body")
    await reader.read()
    const favorite = await fetch(`${origin}/api/v1/favorites/source-backed-detail-design`, {
      method: "PUT",
      headers: { cookie, "x-csrf-token": csrf, origin },
    })
    assert.equal(favorite.status, 200)
    const changed = await reader.read()
    assert.match(new TextDecoder().decode(changed.value), /event: favorite\.changed/)
  } finally {
    abort.abort()
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("install intents are same-user, one-time, expiring, revision-pinned downloads", async () => {
  const data = await fixture()
  const clock = { value: Date.parse("2026-07-12T00:00:00.000Z") }
  const resolveUser = async (key: string) =>
    key === "alice"
      ? ({ ok: true, user: { name: "Alice" }, status: 200 } as const)
      : key === "bob"
        ? ({ ok: true, user: { name: "Bob" }, status: 200 } as const)
        : ({ ok: false, code: "token-not-found", status: 404 } as const)
  const app = build(data.db, { resolveUser, now: () => clock.value })
  try {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/session", payload: { apiKey: "alice" } })
    const cookie = String(login.headers["set-cookie"] ?? "").split(";", 1)[0]
    const csrf = String(login.headers["x-csrf-token"] ?? "")
    const headers = { cookie, "x-csrf-token": csrf, host: "market.test", origin: "http://market.test" }
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/skills/source-backed-detail-design/install-intents",
      headers,
      payload: { revision: 1 },
    })
    assert.equal(created.statusCode, 200)
    const token = created.json().token as string

    const wrong = await app.inject({
      method: "POST",
      url: `/api/v1/install-intents/${token}/consume`,
      headers: { authorization: "Bearer bob" },
    })
    assert.equal(wrong.statusCode, 404)

    const consumed = await app.inject({
      method: "POST",
      url: `/api/v1/install-intents/${token}/consume`,
      headers: { authorization: "Bearer alice" },
    })
    assert.equal(consumed.statusCode, 200)
    assert.equal(consumed.json().revision, 1)
    const archive = await app.inject({ method: "GET", url: consumed.json().downloadUrl })
    assert.equal(archive.statusCode, 200)
    assert.equal(archive.headers["x-content-sha256"], consumed.json().sha256)

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/install-intents/${token}/consume`,
      headers: { authorization: "Bearer alice" },
    })
    assert.equal(replay.statusCode, 409)
    assert.equal(replay.json().code, "INTENT_REPLAYED")

    const expiring = await app.inject({
      method: "POST",
      url: "/api/v1/skills/source-backed-detail-design/install-intents",
      headers,
      payload: { revision: 1 },
    })
    clock.value += 5 * 60 * 1000 + 1
    const expired = await app.inject({
      method: "POST",
      url: `/api/v1/install-intents/${expiring.json().token}/consume`,
      headers: { authorization: "Bearer alice" },
    })
    assert.equal(expired.statusCode, 410)
    assert.equal(expired.json().code, "INTENT_EXPIRED")
  } finally {
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("publication API validates once, repairs snapshots, publishes immutable revisions, and enforces ownership", async () => {
  const data = await fixture()
  const resolveUser = async (key: string) =>
    key === "alice"
      ? ({ ok: true, user: { name: "Alice" }, status: 200 } as const)
      : key === "bob"
        ? ({ ok: true, user: { name: "Bob" }, status: 200 } as const)
        : ({ ok: false, code: "token-not-found", status: 404 } as const)
  const app = build(data.db, { resolveUser })
  try {
    const archive = await publicationArchive(
      data.dir,
      "new-skill",
      "---\nname: New Skill\ndescription: Published from either surface\nversion: 1.0.0\n---\n\n# New Skill\n\nStable body.\n",
    )
    const headers = {
      authorization: "Bearer alice",
      "content-type": "application/gzip",
      "idempotency-key": "publication-key-0001",
    }
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/session", payload: { apiKey: "alice" } })
    const cookie = String(login.headers["set-cookie"] ?? "").split(";", 1)[0]
    const csrf = String(login.headers["x-csrf-token"] ?? "")
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/publications",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        host: "market.test",
        origin: "http://market.test",
        "content-type": "application/gzip",
        "idempotency-key": headers["idempotency-key"],
      },
      payload: archive,
    })
    assert.equal(created.statusCode, 200)
    assert.equal(created.json().status, "PUBLISHED")
    assert.equal(created.json().release.revision, 1)
    assert.equal(created.json().release.semver, "1.0.0")
    assert.equal(created.json().report.valid, true)
    assert.equal(created.json().report.risk.level, "none")
    assert.ok(created.json().patches.some((patch: { kind: string }) => patch.kind === "deterministic"))

    const retried = await app.inject({ method: "POST", url: "/api/v1/publications", headers, payload: archive })
    assert.equal(retried.json().id, created.json().id)
    const unchanged = await app.inject({
      method: "POST",
      url: "/api/v1/publications",
      headers: { ...headers, "idempotency-key": "publication-key-0002" },
      payload: archive,
    })
    assert.equal(unchanged.json().id, created.json().id)
    assert.equal(unchanged.json().status, "PUBLISHED")
    assert.equal(unchanged.json().release.revision, 1)
    assert.deepEqual(unchanged.json().report, created.json().report)

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/publications/${created.json().id}`,
      headers: { authorization: "Bearer alice" },
    })
    assert.equal(detail.statusCode, 200)
    const mine = await app.inject({
      method: "GET",
      url: "/api/v1/me/publications",
      headers: { authorization: "Bearer alice" },
    })
    assert.equal(mine.json().filter((item: { skillId?: string }) => item.skillId === "new-skill").length, 1)
    const other = await app.inject({
      method: "GET",
      url: "/api/v1/me/publications",
      headers: { authorization: "Bearer bob" },
    })
    assert.deepEqual(other.json(), [])
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/v1/publications/${created.json().id}`,
      headers: { authorization: "Bearer bob" },
    })
    assert.equal(forbidden.statusCode, 403)

    const unsafeArchive = await publicationArchive(
      data.dir,
      "unsafe-skill",
      "---\nname: Unsafe\ndescription: Unsafe\n---\n<script>alert(1)</script>\n",
    )
    const unsafe = await app.inject({
      method: "POST",
      url: "/api/v1/publications",
      headers: { ...headers, "idempotency-key": "publication-key-unsafe" },
      payload: unsafeArchive,
    })
    assert.equal(unsafe.statusCode, 200, unsafe.body)
    assert.equal(unsafe.json().status, "SECURITY_REJECTED")
    assert.equal(unsafe.json().report.risk.level, "critical")
    assert.ok(unsafe.json().report.issues.some((issue: { code: string }) => issue.code === "security-markdown-xss"))

    const riskyArchive = await publicationArchive(
      data.dir,
      "risky-skill",
      "---\nname: Risky\ndescription: Publishable warnings\n---\n\n# Risky\n\nUse this Skill only after reviewing its scripts.\n",
      {
        "README.md": "password=abcdefghijklmnop\n",
        "scripts/connect.sh": "-----BEGIN OPENSSH PRIVATE KEY-----\nexample\n",
      },
    )
    const risky = await app.inject({
      method: "POST",
      url: "/api/v1/publications",
      headers: { ...headers, "idempotency-key": "publication-key-risky" },
      payload: riskyArchive,
    })
    assert.equal(risky.statusCode, 200)
    assert.equal(risky.json().status, "PUBLISHED")
    assert.equal(risky.json().report.risk.level, "medium")
    assert.equal(risky.json().report.risk.issueCount, 2)
    assert.equal(risky.json().report.policyVersion, "skill-risk-v3")
    assert.ok(risky.json().report.issues.some((issue: { code: string }) => issue.code === "security-secret"))
    assert.ok(risky.json().report.issues.every((issue: { message: string }) => /[\u4e00-\u9fff]/.test(issue.message)))

    const sqlite = new DatabaseSync(join(data.dir, "db", "market.sqlite"))
    const stored = sqlite
      .prepare("SELECT validation_report_json,archive_path FROM releases WHERE skill_id=? AND revision=1")
      .get("risky-skill") as {
      validation_report_json: string
      archive_path: string
    }
    const legacy = JSON.parse(stored.validation_report_json) as Record<string, unknown> & {
      risk: Record<string, unknown>
    }
    legacy.policyVersion = "skill-risk-v2"
    legacy.risk.policyVersion = "skill-risk-v2"
    const owner = sqlite.prepare("SELECT author_id FROM skills WHERE id=?").get("risky-skill") as { author_id: string }
    const now = "2026-07-12T12:00:00.000Z"
    sqlite
      .prepare(
        "INSERT INTO skills(id,name,description,category,tags_json,author_id,status,latest_revision,created_at,updated_at,legacy_json) VALUES(?,?,?,?,?,?,?,1,?,?,?)",
      )
      .run(
        "historical-v2-skill",
        "Historical v2 Skill",
        "Preserve historical risk reports.",
        "general",
        "[]",
        owner.author_id,
        "published",
        now,
        now,
        "{}",
      )
    sqlite.prepare(
      "INSERT INTO releases(skill_id,revision,sha256,size_bytes,validation_report_json,archive_path,published_at,metadata_json) VALUES(?,1,?,1,?,?,?,?)",
    ).run(
      "historical-v2-skill",
      "f".repeat(64),
      JSON.stringify(legacy),
      stored.archive_path,
      now,
      "{}",
    )
    sqlite.close()
    const historical = await app.inject({ method: "GET", url: "/api/v1/skills/historical-v2-skill" })
    assert.equal(historical.statusCode, 200, historical.body)
    assert.equal(historical.json().risk.policyVersion, "skill-risk-v2")
    assert.ok(historical.json().releases[0].report.issues.length > 0)

    const tinyArchive = await publicationArchive(
      data.dir,
      "tiny-skill",
      "---\nname: Tiny\ndescription: Needs AI\n---\n\n# Tiny\n\nx\n",
    )
    const tiny = await app.inject({
      method: "POST",
      url: "/api/v1/publications",
      headers: { ...headers, "idempotency-key": "publication-key-tiny" },
      payload: tinyArchive,
    })
    assert.equal(tiny.json().status, "NEEDS_AI_CONFIRMATION")
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/skills/tiny-skill" })).statusCode, 404)
    const deterministic = tiny.json().patches[0].files.find((file: { path: string }) => file.path === "SKILL.md")
    const current = Buffer.from(String(deterministic.patch).slice("replace-base64:".length), "base64")
    const repaired = Buffer.from(
      `${current.toString("utf8").trimEnd()}\n\nGenerate a detailed, source-backed answer with explicit evidence and limitations.\n`,
    )
    const ai = {
      id: "ai-patch-0001",
      runId: tiny.json().id,
      kind: "ai",
      files: [
        {
          path: "SKILL.md",
          beforeSha256: createHash("sha256").update(current).digest("hex"),
          afterSha256: createHash("sha256").update(repaired).digest("hex"),
          patch: `replace-base64:${repaired.toString("base64")}`,
        },
      ],
      requiresConfirmation: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/publications/${tiny.json().id}/patches`,
      headers: { authorization: "Bearer alice" },
      payload: [ai],
    })
    assert.equal(submitted.statusCode, 200)
    assert.equal(submitted.json().status, "NEEDS_AI_CONFIRMATION")
    const foreignPatch = await app.inject({
      method: "POST",
      url: `/api/v1/publications/${tiny.json().id}/patches`,
      headers: { authorization: "Bearer bob" },
      payload: [ai],
    })
    assert.equal(foreignPatch.statusCode, 403)
    const expired = await app.inject({
      method: "POST",
      url: `/api/v1/publications/${tiny.json().id}/patches`,
      headers: { authorization: "Bearer alice" },
      payload: [{ ...ai, id: "ai-patch-expired", expiresAt: new Date(Date.now() - 1).toISOString() }],
    })
    assert.equal(expired.statusCode, 400)
    const unconfirmed = await app.inject({
      method: "POST",
      url: `/api/v1/publications/${tiny.json().id}/apply`,
      headers: { authorization: "Bearer alice" },
      payload: { patchIds: [] },
    })
    assert.equal(unconfirmed.statusCode, 409)
    const applied = await app.inject({
      method: "POST",
      url: `/api/v1/publications/${tiny.json().id}/apply`,
      headers: { authorization: "Bearer alice" },
      payload: { patchIds: [ai.id] },
    })
    assert.equal(applied.statusCode, 200)
    assert.equal(applied.json().status, "PUBLISHED")
    assert.equal(applied.json().release.revision, 1)

    const foreignUnpublish = await app.inject({
      method: "POST",
      url: "/api/v1/skills/new-skill/unpublish",
      headers: { authorization: "Bearer bob" },
    })
    assert.equal(foreignUnpublish.statusCode, 403)
    const unpublished = await app.inject({
      method: "POST",
      url: "/api/v1/skills/new-skill/unpublish",
      headers: { authorization: "Bearer alice" },
    })
    assert.equal(unpublished.statusCode, 200)
    assert.equal(unpublished.json().status, "UNPUBLISHED")
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/skills/new-skill" })).statusCode, 404)

    const corrected = await publicationArchive(
      data.dir,
      "new-skill",
      "---\nname: New Skill\ndescription: Corrected Markdown release\nversion: 1.1.0\n---\n\n# New Skill\n\nRaw Markdown body.\n",
    )
    const republished = await app.inject({
      method: "POST",
      url: "/api/v1/publications",
      headers: { ...headers, "idempotency-key": "publication-key-republish" },
      payload: corrected,
    })
    assert.equal(republished.statusCode, 200)
    assert.equal(republished.json().status, "PUBLISHED")
    assert.equal(republished.json().release.revision, 2)
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/skills/new-skill" })).statusCode, 200)
    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/publications/${republished.json().id}/undo`,
      headers: { ...headers, "idempotency-key": "publication-undo-republish" },
    })
    assert.equal(undone.statusCode, 200)
    assert.equal(undone.json().status, "UNDONE")
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/skills/new-skill" })).statusCode, 404)
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/publications/${republished.json().id}/undo`,
      headers: { ...headers, "idempotency-key": "publication-undo-republish" },
    })
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.json().status, "UNDONE")
  } finally {
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("authenticated analytics overview returns Worker-aggregated series", async () => {
  const data = await fixture()
  await data.db.events([
    {
      id: "event-analytics-1",
      name: "skill_open",
      surface: "web",
      userId: "user-analytics-0001",
      clientId: "client-analytics-01",
      skillId: "source-backed-detail-design",
      revision: 1,
      occurredAt: "2026-07-12T01:00:00.000Z",
    },
  ])
  const app = build(data.db, { resolveUser: async () => ({ ok: true, user: { name: "Alice" }, status: 200 }) as const })
  try {
    const denied = await app.inject({ method: "GET", url: "/api/v1/analytics/overview" })
    assert.equal(denied.statusCode, 401)
    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/overview",
      headers: { authorization: "Bearer alice" },
    })
    assert.deepEqual(overview.json(), [
      { metric: "skill_open", scope: "global", points: [{ date: "2026-07-12", value: 1 }] },
    ])
  } finally {
    await app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

async function publicationArchive(root: string, id: string, markdown: string, files: Record<string, string> = {}) {
  const source = join(root, `publication-${id}`)
  const dir = join(source, id)
  const archive = join(source, `${id}.tar.gz`)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "skill.md"), markdown)
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  execFileSync("tar", ["-czf", archive, "-C", source, id], { env: { ...process.env, COPYFILE_DISABLE: "1" } })
  return readFile(archive)
}
