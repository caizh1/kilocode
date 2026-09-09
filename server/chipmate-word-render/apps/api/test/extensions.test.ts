import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import JSZip from "jszip"
import { MarketDb } from "@chipmate/market-db"
import { build } from "../src/index.ts"
import { authentication, webLogin } from "./auth-fixture.ts"

async function fixture(opts: { active?: number; free?: number; idle?: number; maximum?: number; bindings?: Record<string, string>; packages?: Array<{ name: string; data: Buffer }> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-extension-market-"))
  const packages = join(dir, "packages")
  await mkdir(packages, { recursive: true })
  for (const item of opts.packages ?? []) await writeFile(join(packages, item.name), item.data)
  const db = new MarketDb({ dir: join(dir, "db") })
  const auth = await authentication(db)
  for (const name of Object.values(opts.bindings ?? {})) {
    const user = await db.identity({
      id: `market-${createHash("sha256").update(name.toLocaleLowerCase()).digest("hex").slice(0, 40)}`,
      displayName: name,
    })
    await db.putExternalIdentity({
      sourceId: "ldap",
      subject: `guid-${name.toLocaleLowerCase()}`,
      userId: user.id,
      username: name.toLocaleLowerCase(),
      email: `${name.toLocaleLowerCase()}@test.local`,
      displayName: name,
      isAdmin: false,
      verifiedAt: new Date().toISOString(),
    })
  }
  const app = build(db, {
    auth,
    extensionMarket: true,
    extensionRoot: join(dir, "extensions"),
    packageRoot: packages,
    ...(opts.bindings ? { extensionOwnerBindings: opts.bindings } : {}),
    extensionScanMs: 60_000,
    ...(opts.active === undefined ? {} : { extensionActiveUploads: opts.active }),
    ...(opts.free === undefined ? {} : { extensionMinimumFreeBytes: opts.free }),
    ...(opts.idle === undefined ? {} : { extensionUploadIdleMs: opts.idle }),
    ...(opts.maximum === undefined ? {} : { extensionUploadMaxMs: opts.maximum }),
  })
  return { app, db, dir }
}

async function vsix(opts: { publisher?: string; name?: string; version?: string; target?: string; updateTarget?: string; description?: string; releaseNotes?: string | Buffer; manifest?: boolean; unsafe?: boolean; bomb?: boolean } = {}) {
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
      ...(opts.updateTarget ? { chipmatePackageTarget: opts.updateTarget } : {}),
    }),
  )
  if (opts.manifest !== false) {
    zip.file(
      "extension.vsixmanifest",
      `<PackageManifest><Metadata><Identity Publisher="${publisher}" Id="${name}" Version="${opts.version ?? "2.4.0-beta.2"}" TargetPlatform="${opts.target ?? "linux-x64"}" /></Metadata></PackageManifest>`,
    )
  }
  zip.file("extension/README.md", "# C/C++ Hybrid Intelligence\n\nSource-backed analysis.")
  if (opts.releaseNotes !== undefined) zip.file("extension/RELEASE_NOTES.md", opts.releaseNotes)
  if (opts.unsafe) zip.file("../outside.txt", "unsafe")
  if (opts.bomb) zip.file("extension/bomb.bin", Buffer.alloc(12 * 1024 * 1024))
  zip.file(
    "extension/icon.png",
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  )
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}

test("official ChipMate upload immediately drives the dynamic update manifest and owner-only fallback", async () => {
  const data = await fixture()
  try {
    const alice = await login(data.app)
    const bob = await login(data.app, "bob-key")
    const notes = "# ChipMate 1.2.3\n\n- Manual update checks\n- Verified installation"
    const source = await vsix({
      name: "chipmate",
      version: "1.2.3",
      updateTarget: "darwin-arm64",
      releaseNotes: notes,
    })
    const first = await upload(data.app, alice, source, "official-00000001")
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(first.json().artifact.releaseNotesAvailable, true)
    const manifest = await data.app.inject({ method: "GET", url: "/packages/manifest.json" })
    assert.equal(manifest.statusCode, 200, manifest.body)
    assert.equal(manifest.json().schemaVersion, 2)
    assert.equal(manifest.json().latestByTarget["darwin-arm64"].version, "1.2.3")
    assert.equal(manifest.json().latestByTarget["darwin-arm64"].releaseNotes, notes)
    assert.match(manifest.json().latestByTarget["darwin-arm64"].publishedAt, /^20\d\d-/)
    assert.equal(manifest.json().packages[0].releaseNotes, undefined)
    assert.match(manifest.json().latestByTarget["darwin-arm64"].url, /^\/packages\/artifacts\/.+\.vsix$/)
    const download = await data.app.inject({
      method: "GET",
      url: manifest.json().latestByTarget["darwin-arm64"].url,
    })
    assert.equal(download.statusCode, 200)
    assert.equal(download.rawPayload.equals(source), true)
    assert.equal(createHash("sha256").update(download.rawPayload).digest("hex"), first.json().artifact.sha256)

    const conflict = await upload(
      data.app,
      alice,
      await vsix({ name: "chipmate", version: "1.2.3", updateTarget: "darwin-arm64", description: "changed" }),
      "official-00000002",
    )
    assert.equal(conflict.statusCode, 409)
    assert.equal(conflict.json().code, "EXTENSION_VERSION_CONFLICT")
    assert.deepEqual(await readdir(join(data.dir, "extensions", ".tmp")), [])
    assert.equal((await data.app.inject({ method: "GET", url: "/packages/manifest.json" })).json().packages.length, 1)

    const notesConflict = await upload(
      data.app,
      alice,
      await vsix({
        name: "chipmate",
        version: "1.2.3",
        updateTarget: "linux-x64-baseline",
        releaseNotes: "# ChipMate 1.2.3\n\n- Different notes",
      }),
      "official-00000005",
    )
    assert.equal(notesConflict.statusCode, 409)
    assert.equal(notesConflict.json().code, "EXTENSION_RELEASE_NOTES_CONFLICT")

    const withoutNotes = await upload(
      data.app,
      alice,
      await vsix({ name: "chipmate", version: "1.2.3", updateTarget: "linux-x64-baseline" }),
      "official-00000006",
    )
    assert.equal(withoutNotes.statusCode, 200, withoutNotes.body)
    assert.equal(withoutNotes.json().artifact.releaseNotesAvailable, false)
    const fallback = (await data.app.inject({ method: "GET", url: "/packages/manifest.json" })).json()
    assert.equal(fallback.latestByTarget["linux-x64-baseline"].releaseNotes, notes)

    const forbidden = await upload(
      data.app,
      bob,
      await vsix({ name: "chipmate", version: "1.2.4", updateTarget: "darwin-arm64" }),
      "official-00000003",
    )
    assert.equal(forbidden.statusCode, 403)
    const second = await upload(
      data.app,
      alice,
      await vsix({ name: "chipmate", version: "1.2.4", updateTarget: "darwin-arm64" }),
      "official-00000004",
    )
    assert.equal(second.statusCode, 200)
    assert.equal((await data.app.inject({ method: "GET", url: "/packages/manifest.json" })).json().latestByTarget["darwin-arm64"].version, "1.2.4")
    const removed = await data.app.inject({
      method: "DELETE",
      url: `/api/v1/extension-artifacts/${second.json().artifact.id}`,
      headers: { cookie: alice.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": alice.csrf },
    })
    assert.equal(removed.statusCode, 200)
    assert.equal((await data.app.inject({ method: "GET", url: "/packages/manifest.json" })).json().latestByTarget["darwin-arm64"].version, "1.2.3")
  } finally {
    await data.app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("legacy system ChipMate records require owner binding and explicit LDAP identity mapping", async () => {
  const legacy = await vsix({ name: "chipmate", version: "1.0.0", updateTarget: "linux-x64-baseline" })
  const blocked = await fixture({ packages: [{ name: "chipmate-1.0.0-linux.vsix", data: legacy }] })
  try {
    const alice = await login(blocked.app)
    const response = await upload(
      blocked.app,
      alice,
      await vsix({ name: "chipmate", version: "1.0.1", updateTarget: "linux-x64-baseline" }),
      "binding-00000001",
    )
    assert.equal(response.statusCode, 409)
    assert.equal(response.json().code, "EXTENSION_OWNER_UNASSIGNED")
  } finally {
    await blocked.app.close()
    await blocked.db.close()
    await rm(blocked.dir, { recursive: true, force: true })
  }

  const bound = await fixture({
    packages: [{ name: "chipmate-1.0.0-linux.vsix", data: legacy }],
    bindings: { "chipmate.chipmate": "Alice" },
  })
  try {
    const alice = await login(bound.app)
    const response = await upload(
      bound.app,
      alice,
      await vsix({ name: "chipmate", version: "1.0.1", updateTarget: "linux-x64-baseline" }),
      "binding-00000002",
    )
    assert.equal(response.statusCode, 200, response.body)
    const manifest = (await bound.app.inject({ method: "GET", url: "/packages/manifest.json" })).json()
    assert.equal(manifest.packages.length, 2)
    assert.equal(manifest.latestByTarget["linux-x64-baseline"].version, "1.0.1")
  } finally {
    await bound.app.close()
    await bound.db.close()
    await rm(bound.dir, { recursive: true, force: true })
  }
})

test("an invalid legacy package is quarantined without blocking a new web release", async () => {
  const data = await fixture({ packages: [{ name: "broken.vsix", data: Buffer.from("not a zip") }] })
  try {
    const alice = await login(data.app)
    const response = await upload(
      data.app,
      alice,
      await vsix({ name: "chipmate", version: "1.3.0", updateTarget: "win32-x64-baseline" }),
      "broken-legacy-0001",
    )
    assert.equal(response.statusCode, 200, response.body)
    const manifest = (await data.app.inject({ method: "GET", url: "/packages/manifest.json" })).json()
    assert.equal(manifest.packages.length, 1)
    assert.equal(manifest.latestByTarget["win32-x64-baseline"].version, "1.3.0")
  } finally {
    await data.app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

async function login(app: Awaited<ReturnType<typeof fixture>>["app"], key = "alice-key") {
  return webLogin(app, key)
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
    assert.equal(conflict.statusCode, 409)
    assert.equal(conflict.json().code, "EXTENSION_VERSION_CONFLICT")
    assert.equal(conflict.json().conflict.existing.sha256, first.json().artifact.sha256)
    assert.notEqual(conflict.json().conflict.incoming.sha256, first.json().artifact.sha256)
    const next = await upload(
      data.app,
      alice,
      await vsix({ version: "2.5.0-beta.1", description: "New owner release" }),
      "0000000000000007",
    )
    assert.equal(next.json().status, "PUBLISHED")

    const detail = await data.app.inject({ method: "GET", url: "/api/v1/extensions/chipmate.cpp-hybrid" })
    assert.equal(detail.statusCode, 200)
    assert.equal(detail.json().artifacts.length, 2)
    assert.equal(detail.json().artifacts.every((item: { conflict: boolean }) => !item.conflict), true)
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
    assert.equal(bobDuplicate.statusCode, 403)
    assert.equal(bobDuplicate.json().code, "OWNERSHIP_REQUIRED")
    const forbidden = await data.app.inject({
      method: "DELETE",
      url: `/api/v1/extension-artifacts/${next.json().artifact.id}`,
      headers: { cookie: bob.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": bob.csrf },
    })
    assert.equal(forbidden.statusCode, 403)
    const removed = await data.app.inject({
      method: "DELETE",
      url: `/api/v1/extension-artifacts/${next.json().artifact.id}`,
      headers: { cookie: alice.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": alice.csrf },
    })
    assert.equal(removed.statusCode, 200)
    const recomputed = await data.app.inject({ method: "GET", url: "/api/v1/extensions/chipmate.cpp-hybrid" })
    assert.equal(recomputed.json().artifacts.length, 1)
    assert.equal(recomputed.json().artifacts[0].conflict, false)
    assert.equal(recomputed.json().description, "Hybrid C/C++ intelligence")
    const bobVersion = await upload(
      data.app,
      bob,
      await vsix({ version: "3.0.0-beta.1", target: "universal", description: "Bob prerelease" }),
      "0000000000000006",
    )
    assert.equal(bobVersion.statusCode, 403)
    assert.equal(bobVersion.json().code, "OWNERSHIP_REQUIRED")
    const latest = await data.app.inject({ method: "GET", url: "/api/v1/extensions/chipmate.cpp-hybrid" })
    assert.equal(latest.json().version, "2.4.0-beta.2")
    assert.equal(latest.json().uploader, "Alice")
    assert.equal(latest.json().prerelease, true)
    const owned = await data.app.inject({
      method: "DELETE",
      url: `/api/v1/extension-artifacts/${first.json().artifact.id}`,
      headers: { cookie: alice.cookie, origin: "http://market.test", host: "market.test", "x-csrf-token": alice.csrf },
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
      await vsix({ version: "1.0.0-01" }),
      await vsix({ version: "1.0.0-alpha..1" }),
      await vsix({ version: "1.0.0", releaseNotes: "# ChipMate 2.0.0\n\n- Wrong version" }),
      await vsix({ version: "1.0.0", releaseNotes: "\n# ChipMate 1.0.0\n\n- Heading is not first" }),
      await vsix({ version: "1.0.0", releaseNotes: `# ChipMate 1.0.0\n\n${"x".repeat(65_537)}` }),
      await vsix({ version: "1.0.0", releaseNotes: Buffer.from([0xc3, 0x28]) }),
    ]
    for (const [index, payload] of cases.entries()) {
      const response = await upload(data.app, auth, payload, `invalid-${String(index).padStart(8, "0")}`)
      assert.equal(response.statusCode, 400, response.body)
      assert.equal(response.json().code, "VALIDATION_FAILED")
    }
    const target = await upload(
      data.app,
      auth,
      await vsix({ name: "chipmate", version: "1.0.0" }),
      "invalid-target-00000001",
    )
    assert.equal(target.statusCode, 400)
    assert.match(target.json().message, /chipmatePackageTarget/)
    assert.deepEqual(await readdir(join(data.dir, "extensions", ".tmp")), [])
  } finally {
    await data.app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("extension uploads are not limited by a per-user rolling-hour quota", async () => {
  const data = await fixture()
  try {
    const auth = await login(data.app)
    for (let index = 0; index < 100; index += 1) {
      const response = await upload(data.app, auth, Buffer.from("not-a-vsix"), `limit-${String(index).padStart(8, "0")}`)
      assert.equal(response.statusCode, 400)
    }
    const next = await upload(data.app, auth, Buffer.from("not-a-vsix"), "limit-00000100")
    assert.equal(next.statusCode, 400)
    assert.equal(next.json().code, "VALIDATION_FAILED")
  } finally {
    await data.app.close()
    await data.db.close()
    await rm(data.dir, { recursive: true, force: true })
  }
})

test("extension upload admission reports busy slots and storage pressure before creating a run", async () => {
  for (const item of [
    { opts: { active: 0 }, status: 503, code: "PUBLICATION_BUSY", retry: "5" },
    { opts: { free: Number.MAX_SAFE_INTEGER }, status: 507, code: "STORAGE_PRESSURE", retry: undefined },
  ]) {
    const data = await fixture(item.opts)
    try {
      const auth = await login(data.app)
      const response = await upload(data.app, auth, await vsix(), `admission-${item.status}-00000000`)
      assert.equal(response.statusCode, item.status, response.body)
      assert.equal(response.json().code, item.code)
      assert.equal(response.headers["retry-after"], item.retry)
      const runs = await data.app.inject({
        method: "GET",
        url: "/api/v1/me/extensions/publications",
        headers: { cookie: auth.cookie },
      })
      assert.deepEqual(runs.json(), [])
    } finally {
      await data.app.close()
      await data.db.close()
      await rm(data.dir, { recursive: true, force: true })
    }
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
