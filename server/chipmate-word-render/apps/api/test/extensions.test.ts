import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import JSZip from "jszip"
import { MarketDb } from "@chipmate/market-db"
import { build } from "../src/index.ts"

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-extension-market-"))
  const db = new MarketDb({ dir: join(dir, "db") })
  const resolveUser = async (key: string) =>
    key === "alice-key" || key === "bob-key"
      ? ({
          ok: true,
          user: { name: key === "alice-key" ? "Alice" : "Bob", tokenName: `${key}@chipmate` },
          status: 200,
        } as const)
      : ({ ok: false, code: "token-not-found", status: 404 } as const)
  const app = build(db, {
    resolveUser,
    extensionMarket: true,
    extensionRoot: join(dir, "extensions"),
    extensionScanMs: 60_000,
  })
  return { app, db, dir }
}

async function vsix(opts: { publisher?: string; name?: string; version?: string; target?: string; description?: string; manifest?: boolean; unsafe?: boolean; bomb?: boolean } = {}) {
  const zip = new JSZip()
  const publisher = opts.publisher ?? "chipmate"
  const name = opts.name ?? "cpp-hybrid"
  zip.file(
    "extension/package.json",
    JSON.stringify({
      publisher,
      name,
      displayName: "C/C++ Hybrid Intelligence",
      description: opts.description ?? "Hybrid C/C++ intelligence",
      version: opts.version ?? "2.4.0-beta.2",
      engines: { vscode: ">=1.87.0" },
      categories: ["Programming Languages"],
      keywords: ["C++", "analysis"],
      icon: "icon.png",
      extensionDependencies: ["ms-vscode.cpptools"],
    }),
  )
  if (opts.manifest !== false) {
    zip.file(
      "extension.vsixmanifest",
      `<PackageManifest><Metadata><Identity Publisher="${publisher}" Id="${name}" Version="${opts.version ?? "2.4.0-beta.2"}" TargetPlatform="${opts.target ?? "linux-x64"}" /></Metadata></PackageManifest>`,
    )
  }
  zip.file("extension/README.md", "# C/C++ Hybrid Intelligence\n\nSource-backed analysis.")
  if (opts.unsafe) zip.file("../outside.txt", "unsafe")
  if (opts.bomb) zip.file("extension/bomb.bin", Buffer.alloc(12 * 1024 * 1024))
  zip.file(
    "extension/icon.png",
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  )
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}

async function login(app: Awaited<ReturnType<typeof fixture>>["app"], key = "alice-key") {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/session", payload: { apiKey: key } })
  assert.equal(response.statusCode, 200)
  return {
    cookie: String(response.headers["set-cookie"]).split(";", 1)[0],
    csrf: String(response.headers["x-csrf-token"]),
  }
}

async function upload(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  auth: Awaited<ReturnType<typeof login>>,
  payload: Buffer,
  id: string,
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/extension-publications",
    headers: {
      cookie: auth.cookie,
      origin: "http://market.test",
      host: "market.test",
      "x-csrf-token": auth.csrf,
      "content-type": "application/vnd.microsoft.vscode.vsix",
      "content-length": String(payload.length),
      "x-publication-run-id": `extension-run-${id}`,
      "idempotency-key": `extension-key-${id}`,
      "x-vsix-filename": encodeURIComponent("cpp-hybrid-2.4.0-beta.2-linux-x64.vsix"),
    },
    payload,
  })
}

test("VSIX upload publishes metadata, preserves variants, social state, and completed downloads", async () => {
  const data = await fixture()
  try {
    const capabilities = await data.app.inject({ method: "GET", url: "/api/v1/capabilities" })
    assert.equal(capabilities.json().features.extensions, true)
    const status = await data.app.inject({ method: "GET", url: "/api/v1/status" })
    assert.equal(status.json().extensions.database, "ready")
    assert.equal(status.json().extensions.drop, true)
    assert.equal(status.json().extensions.artifacts, true)
    assert.equal(status.json().extensions.temporary, true)
    const alice = await login(data.app)
    const source = await vsix()
    const first = await upload(data.app, alice, source, "0000000000000001")
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(first.json().status, "PUBLISHED")
    assert.equal(first.json().artifact.extensionId, "chipmate.cpp-hybrid")
    assert.equal(first.json().artifact.target, "linux-x64")
    assert.equal(first.json().artifact.uploader.displayName, "Alice")
    assert.equal("path" in first.json().artifact, false)

    const duplicate = await upload(data.app, alice, source, "0000000000000002")
    assert.equal(duplicate.json().status, "DUPLICATE")
    assert.equal(duplicate.json().artifact.id, first.json().artifact.id)
    const replay = await upload(data.app, alice, source, "0000000000000001")
    assert.equal(replay.json().status, "PUBLISHED")

    const conflict = await upload(
      data.app,
      alice,
      await vsix({ description: "Different build with the same version" }),
      "0000000000000003",
    )
    assert.equal(conflict.json().status, "PUBLISHED")
    assert.notEqual(conflict.json().artifact.sha256, first.json().artifact.sha256)

    const detail = await data.app.inject({ method: "GET", url: "/api/v1/extensions/chipmate.cpp-hybrid" })
    assert.equal(detail.statusCode, 200)
    assert.equal(detail.json().artifacts.length, 2)
    assert.equal(detail.json().artifacts.every((item: { conflict: boolean }) => item.conflict), true)
    assert.equal(detail.json().artifacts.every((item: Record<string, unknown>) => !("path" in item)), true)
    assert.deepEqual(detail.json().targets, ["linux-x64"])
    assert.match(detail.json().iconData, /^data:image\/png;base64,/)

    const favorite = await data.app.inject({
      method: "PUT",
      url: "/api/v1/extension-favorites/chipmate.cpp-hybrid",
      headers: { cookie: alice.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": alice.csrf },
    })
    assert.equal(favorite.statusCode, 200)
    const review = await data.app.inject({
      method: "PUT",
      url: "/api/v1/extensions/chipmate.cpp-hybrid/review",
      headers: { cookie: alice.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": alice.csrf },
      payload: { rating: 5, comment: "结构清晰，适合大型 C++ 项目。", artifactId: first.json().artifact.id },
    })
    assert.equal(review.statusCode, 200)
    assert.equal(review.json().rating, 5)

    const range = await data.app.inject({
      method: "GET",
      url: `/api/v1/extensions/chipmate.cpp-hybrid/artifacts/${first.json().artifact.id}/download`,
      headers: { range: "bytes=0-10" },
    })
    assert.equal(range.statusCode, 416)
    const download = await data.app.inject({
      method: "GET",
      url: `/api/v1/extensions/chipmate.cpp-hybrid/artifacts/${first.json().artifact.id}/download?source=detail`,
    })
    assert.equal(download.statusCode, 200)
    assert.equal(download.rawPayload.equals(source), true)
    await new Promise((resolve) => setImmediate(resolve))
    const analytics = await data.app.inject({ method: "GET", url: "/api/v1/analytics/extensions/overview" })
    assert.equal(analytics.json().totals.downloads, 1)
    assert.equal(analytics.json().totals.favorites, 1)
    assert.equal(analytics.json().totals.rating, 5)
    assert.equal(analytics.json().totals.growth30d, 100)
    assert.equal(analytics.json().activity[0].extensionId, "chipmate.cpp-hybrid")

    const other = await upload(
      data.app,
      alice,
      await vsix({ name: "other-extension", version: "1.0.0", target: "universal" }),
      "0000000000000005",
    )
    const mismatch = await data.app.inject({
      method: "PUT",
      url: "/api/v1/extensions/chipmate.cpp-hybrid/review",
      headers: { cookie: alice.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": alice.csrf },
      payload: { rating: 4, artifactId: other.json().artifact.id },
    })
    assert.equal(mismatch.statusCode, 400)

    const bob = await login(data.app, "bob-key")
    const bobDuplicate = await upload(data.app, bob, source, "0000000000000004")
    assert.equal(bobDuplicate.json().status, "DUPLICATE")
    const forbidden = await data.app.inject({
      method: "DELETE",
      url: `/api/v1/extension-artifacts/${first.json().artifact.id}`,
      headers: { cookie: bob.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": bob.csrf },
    })
    assert.equal(forbidden.statusCode, 403)
    const removed = await data.app.inject({
      method: "DELETE",
      url: `/api/v1/extension-artifacts/${first.json().artifact.id}`,
      headers: { cookie: alice.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": alice.csrf },
    })
    assert.equal(removed.statusCode, 200)
    const recomputed = await data.app.inject({ method: "GET", url: "/api/v1/extensions/chipmate.cpp-hybrid" })
    assert.equal(recomputed.json().artifacts.length, 1)
    assert.equal(recomputed.json().artifacts[0].conflict, false)
    assert.equal(recomputed.json().description, "Different build with the same version")
    const bobVersion = await upload(
      data.app,
      bob,
      await vsix({ version: "3.0.0-beta.1", target: "universal", description: "Bob prerelease" }),
      "0000000000000006",
    )
    assert.equal(bobVersion.json().status, "PUBLISHED")
    const latest = await data.app.inject({ method: "GET", url: "/api/v1/extensions/chipmate.cpp-hybrid" })
    assert.equal(latest.json().version, "3.0.0-beta.1")
    assert.equal(latest.json().uploader, "Bob")
    assert.equal(latest.json().prerelease, true)
    const owned = await data.app.inject({
      method: "DELETE",
      url: `/api/v1/extension-artifacts/${bobVersion.json().artifact.id}`,
      headers: { cookie: bob.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": bob.csrf },
    })
    assert.equal(owned.statusCode, 200)
  } finally {
    await data.app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("VSIX validation rejects missing, unsafe, bomb, and invalid-version archives and cleans temporary files", async () => {
  const data = await fixture()
  try {
    const auth = await login(data.app)
    const cases = [
      await vsix({ manifest: false }),
      await vsix({ unsafe: true }),
      await vsix({ bomb: true }),
      await vsix({ version: "release-next" }),
    ]
    for (const [index, payload] of cases.entries()) {
      const response = await upload(data.app, auth, payload, `invalid-${String(index).padStart(8, "0")}`)
      assert.equal(response.statusCode, 400, response.body)
      assert.equal(response.json().code, "VALIDATION_FAILED")
    }
    assert.deepEqual(await readdir(join(data.dir, "extensions", ".tmp")), [])
  } finally {
    await data.app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("extension upload rate limiting counts failed structural submissions", async () => {
  const data = await fixture()
  try {
    const auth = await login(data.app)
    for (let index = 0; index < 100; index += 1) {
      const response = await upload(data.app, auth, Buffer.from("not-a-vsix"), `limit-${String(index).padStart(8, "0")}`)
      assert.equal(response.statusCode, 400)
    }
    const limited = await upload(data.app, auth, Buffer.from("not-a-vsix"), "limit-00000100")
    assert.equal(limited.statusCode, 429)
  } finally {
    await data.app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("drop directory imports a stable VSIX and deletion unlists it", async () => {
  const data = await fixture()
  try {
    const root = join(data.dir, "extensions", "drop")
    await mkdir(root, { recursive: true })
    await writeFile(join(root, "cpp-hybrid.vsix"), await vsix({ target: "universal" }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const runtime = (await import("../src/extensions.ts")).ExtensionRuntime
    const events = new (await import("../src/events.ts")).MarketEvents()
    const scanner = new runtime(data.db, events, 60_000, join(data.dir, "extensions"))
    await scanner.scan()
    await scanner.scan()
    const item = await data.db.getExtension("chipmate.cpp-hybrid")
    assert.ok(item)
    assert.equal(item.artifacts[0]?.source, "system")
    assert.equal(item.artifacts[0]?.uploaderName, "系统导入")
    await rm(join(root, "cpp-hybrid.vsix"))
    await scanner.scan()
    assert.equal(await data.db.getExtension("chipmate.cpp-hybrid"), undefined)
    await writeFile(join(root, "cpp-hybrid.vsix"), await vsix({ target: "universal" }))
    await scanner.scan()
    await scanner.scan()
    assert.ok(await data.db.getExtension("chipmate.cpp-hybrid"))
    await writeFile(join(root, "invalid.vsix"), Buffer.from("not-a-vsix"))
    await scanner.scan()
    await scanner.scan()
    assert.match(scanner.health().warnings.join("\n"), /invalid\.vsix/)
    await rm(join(root, "invalid.vsix"))
    await scanner.scan()
    assert.doesNotMatch(scanner.health().warnings.join("\n"), /invalid\.vsix/)
    scanner.stop()
    assert.equal((await readFile(join(data.dir, "db", "market.sqlite"))).length > 0, true)
  } finally {
    await data.app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})
