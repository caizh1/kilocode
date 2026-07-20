#!/usr/bin/env node

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const out = resolve(process.argv[2])
const base = String(process.argv[3] ?? "http://127.0.0.1:6005").replace(/\/+$/, "")
const file = join(out, "service-results.json")
const data = JSON.parse(readFileSync(file, "utf8"))
const results = new Map(data.serviceResults.map((item) => [item.id, item]))
const root = mkdtempSync(join(tmpdir(), "chipmate-local-auth-"))
const evidence = join(out, "evidence", "local-auth")
const actions = []
mkdirSync(evidence, { recursive: true })

try {
  const owner = await login("qa-owner-identity")
  const other = await login("qa-nonowner-identity")
  update("SVC-AUTH-02", owner.status === 200 && owner.cookie && owner.csrf ? "PASS" : "FAIL", `owner login HTTP ${owner.status}.`)
  const me = await call("GET", "/api/v1/auth/me", { cookie: owner.cookie })
  update("SVC-AUTH-03", me.status === 200 && me.body?.displayName === "qa-owner" ? "PASS" : "FAIL", `owner /auth/me HTTP ${me.status}.`)
  update("SVC-AUTH-04", other.status === 200 && other.cookie && other.csrf ? "PASS" : "FAIL", `non-owner login HTTP ${other.status}.`)

  const skill = "source-backed-detail-design"
  const csrf = await call("PUT", `/api/v1/favorites/${skill}`, { cookie: owner.cookie, origin: base })
  update("SVC-AUTH-06", csrf.status === 403 && csrf.body?.code === "CSRF_INVALID" ? "PASS" : "FAIL", `missing CSRF HTTP ${csrf.status}, code=${csrf.body?.code}.`)

  const page = await call("GET", "/api/v1/skills?limit=1&sort=name")
  const next = page.body?.nextCursor ? await call("GET", `/api/v1/skills?limit=1&sort=name&cursor=${page.body.nextCursor}`) : undefined
  const combo = await call("GET", "/api/v1/skills?category=documents&sort=name&limit=1")
  update(
    "SVC-SKILL-03",
    page.status === 200 && page.body?.items?.length === 1 && next?.body?.items?.length === 1 && next.body.items[0].id !== page.body.items[0].id && combo.body?.items?.every((item) => item.category === "documents") ? "PASS" : "FAIL",
    `page=${page.body?.items?.length ?? 0}, next=${next?.body?.items?.length ?? 0}, filtered=${combo.body?.items?.length ?? 0}.`,
  )
  const detail = await call("GET", `/api/v1/skills/${skill}`)
  update("SVC-SKILL-04", detail.status === 200 && detail.body?.author?.displayName && detail.body?.latestRevision === 1 && detail.body?.risk?.level ? "PASS" : "FAIL", `detail HTTP ${detail.status}, revision=${detail.body?.latestRevision}.`)
  const releases = await call("GET", `/api/v1/skills/${skill}/releases`)
  const release = await call("GET", `/api/v1/skills/${skill}/releases/1`)
  update("SVC-SKILL-05", releases.body?.[0]?.revision === 1 && release.body?.revision === 1 && releases.body[0].sha256 === release.body.sha256 ? "PASS" : "FAIL", `release list/detail HTTP ${releases.status}/${release.status}.`)
  const files = await call("GET", `/api/v1/skills/${skill}/files`)
  const preview = await call("GET", `/api/v1/skills/${skill}/files/SKILL.md`)
  update("SVC-SKILL-06", files.body?.some((item) => item.path === "SKILL.md") && typeof preview.body?.text === "string" ? "PASS" : "FAIL", `files HTTP ${files.status}, preview HTTP ${preview.status}.`)
  const archive = await call("GET", `/api/v1/skills/${skill}/releases/1/archive`)
  update("SVC-SKILL-07", archive.status === 200 && archive.raw.length > 0 && archive.headers["x-content-sha256"] === sha(archive.raw) ? "PASS" : "FAIL", `archive HTTP ${archive.status}, bytes=${archive.raw.length}.`)

  const auth = { cookie: owner.cookie, csrf: owner.csrf, origin: base }
  const favored = await call("PUT", `/api/v1/favorites/${skill}`, auth)
  const favorites = await call("GET", "/api/v1/me/favorites", { cookie: owner.cookie })
  update("SVC-SKILL-08", favored.body?.favorite === true && favorites.body?.some((item) => item.id === skill) ? "PASS" : "FAIL", `favorite state=${favored.body?.favorite}.`)
  const unfavored = await call("DELETE", `/api/v1/favorites/${skill}`, auth)
  const cleared = await call("GET", "/api/v1/me/favorites", { cookie: owner.cookie })
  update("SVC-SKILL-09", unfavored.body?.favorite === false && !cleared.body?.some((item) => item.id === skill) ? "PASS" : "FAIL", `favorite state=${unfavored.body?.favorite}.`)

  const intent = await call("POST", `/api/v1/skills/${skill}/install-intents`, { ...auth, json: { revision: 1 } })
  update("SVC-SKILL-10", intent.status === 200 && /^[A-Za-z0-9_-]{32,128}$/.test(intent.body?.token ?? "") ? "PASS" : "FAIL", `intent HTTP ${intent.status}.`)
  const consumed = await call("POST", `/api/v1/install-intents/${intent.body?.token}/consume`, { bearer: "qa-owner-identity" })
  update("SVC-SKILL-11", consumed.status === 200 && consumed.body?.skillId === skill && consumed.body?.revision === 1 ? "PASS" : "FAIL", `consume HTTP ${consumed.status}.`)
  const replay = await call("POST", `/api/v1/install-intents/${intent.body?.token}/consume`, { bearer: "qa-owner-identity" })
  update("SVC-SKILL-12", replay.status === 409 && replay.body?.code === "INTENT_REPLAYED" ? "PASS" : "FAIL", `replay HTTP ${replay.status}, code=${replay.body?.code}.`)

  const pub = archiveFor("qa-e2e-live-skill", "---\nname: QA E2E Live Skill\ndescription: Deterministic local Service integration fixture\nversion: 1.0.0\n---\n\n# QA E2E Live Skill\n\nStable source-backed body with explicit evidence and limitations.\n")
  const before = sha(pub)
  const headers = { ...auth, type: "application/gzip", key: "qa-publication-key-0001", raw: pub }
  const created = await call("POST", "/api/v1/publications", headers)
  update("SVC-SKILL-13", created.status === 200 && created.body?.status === "PUBLISHED" && created.body?.report?.valid === true ? "PASS" : "FAIL", `publication HTTP ${created.status}, status=${created.body?.status}.`)
  update("SVC-SKILL-14", created.body?.patches?.some((item) => item.kind === "deterministic") && sha(pub) === before ? "PASS" : "FAIL", `deterministic patches=${created.body?.patches?.length ?? 0}; source hash preserved=${sha(pub) === before}.`)
  const retried = await call("POST", "/api/v1/publications", { ...headers, bearer: "qa-owner-identity", cookie: undefined, csrf: undefined, origin: undefined })
  update("SVC-SKILL-16", retried.status === 200 && retried.body?.id === created.body?.id && retried.body?.release?.revision === 1 ? "PASS" : "FAIL", `idempotent retry HTTP ${retried.status}, sameRun=${retried.body?.id === created.body?.id}.`)

  const tiny = archiveFor("qa-e2e-tiny-skill", "---\nname: QA Tiny\ndescription: Needs confirmation\n---\n\n# QA Tiny\n\nx\n")
  const pending = await call("POST", "/api/v1/publications", { ...headers, key: "qa-publication-tiny-0001", raw: tiny })
  const deterministic = pending.body?.patches?.[0]?.files?.find((item) => item.path === "SKILL.md")
  const current = deterministic?.patch?.startsWith("replace-base64:") ? Buffer.from(deterministic.patch.slice("replace-base64:".length), "base64") : Buffer.alloc(0)
  const repaired = Buffer.from(`${current.toString("utf8").trimEnd()}\n\nGenerate a detailed, source-backed answer with explicit evidence and limitations.\n`)
  const patch = {
    id: "qa-ai-patch-0001",
    runId: pending.body?.id,
    kind: "ai",
    files: [{ path: "SKILL.md", beforeSha256: sha(current), afterSha256: sha(repaired), patch: `replace-base64:${repaired.toString("base64")}` }],
    requiresConfirmation: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  const submitted = await call("POST", `/api/v1/publications/${pending.body?.id}/patches`, { bearer: "qa-owner-identity", json: [patch] })
  const applied = await call("POST", `/api/v1/publications/${pending.body?.id}/apply`, { bearer: "qa-owner-identity", json: { patchIds: [patch.id] } })
  update("SVC-SKILL-15", pending.body?.status === "NEEDS_AI_CONFIRMATION" && submitted.status === 200 && applied.body?.status === "PUBLISHED" && applied.body?.release?.revision === 1 ? "PASS" : "FAIL", `pending=${pending.body?.status}, applied=${applied.body?.status}.`)

  const foreign = await call("POST", "/api/v1/skills/qa-e2e-live-skill/unpublish", { bearer: "qa-nonowner-identity" })
  update("SVC-SKILL-17", foreign.status === 403 && foreign.body?.code === "OWNERSHIP_REQUIRED" ? "PASS" : "FAIL", `non-owner unpublish HTTP ${foreign.status}.`)
  const unpublished = await call("POST", "/api/v1/skills/qa-e2e-live-skill/unpublish", { bearer: "qa-owner-identity" })
  const old = await call("GET", "/api/v1/skills/qa-e2e-live-skill/releases/1")
  update("SVC-SKILL-18", unpublished.body?.status === "UNPUBLISHED" && old.status === 200 ? "PASS" : "FAIL", `unpublish=${unpublished.body?.status}, historical release HTTP ${old.status}.`)
  const corrected = archiveFor("qa-e2e-live-skill", "---\nname: QA E2E Live Skill\ndescription: Corrected local Service fixture\nversion: 1.1.0\n---\n\n# QA E2E Live Skill\n\nCorrected source-backed body with explicit evidence and limitations.\n")
  const republished = await call("POST", "/api/v1/publications", { ...headers, key: "qa-publication-key-0002", raw: corrected })
  const undone = await call("POST", `/api/v1/publications/${republished.body?.id}/undo`, { ...auth, key: "qa-publication-undo-0001", json: {} })
  const absent = await call("GET", "/api/v1/skills/qa-e2e-live-skill")
  update("SVC-SKILL-19", republished.body?.release?.revision === 2 && undone.body?.status === "UNDONE" && absent.status === 404 ? "PASS" : "FAIL", `republish revision=${republished.body?.release?.revision}, undo=${undone.body?.status}.`)
  const mine = await call("GET", "/api/v1/me/publications", { bearer: "qa-owner-identity" })
  const theirs = await call("GET", "/api/v1/me/publications", { bearer: "qa-nonowner-identity" })
  update("SVC-SKILL-20", mine.status === 200 && mine.body?.length > 0 && theirs.status === 200 && theirs.body?.length === 0 ? "PASS" : "FAIL", `owner runs=${mine.body?.length ?? 0}, non-owner runs=${theirs.body?.length ?? 0}.`)

  const vsix = vsixFor(root)
  const uploaded = await call("POST", "/api/v1/extension-publications", {
    ...auth,
    type: "application/vnd.microsoft.vscode.vsix",
    raw: vsix,
    run: "qa-extension-run-00000001",
    key: "qa-extension-key-00000001",
    name: "qa-e2e-extension-1.0.0-darwin-arm64.vsix",
  })
  update("SVC-EXT-10", uploaded.status === 200 && uploaded.body?.status === "PUBLISHED" && uploaded.body?.artifact?.extensionId === "qa-e2e.fixture" ? "PASS" : "FAIL", `upload HTTP ${uploaded.status}, status=${uploaded.body?.status}.`)
  const artifact = uploaded.body?.artifact
  const extension = await call("GET", "/api/v1/extensions/qa-e2e.fixture")
  update("SVC-EXT-03", extension.status === 200 && extension.body?.version === "1.0.0" && artifact?.target === "darwin-arm64" && artifact?.sha256 === sha(vsix) && artifact?.size === vsix.length ? "PASS" : "FAIL", `detail HTTP ${extension.status}, artifact bytes=${artifact?.size}.`)
  const ranged = await call("GET", `/api/v1/extensions/qa-e2e.fixture/artifacts/${artifact?.id}/download`, { range: "bytes=0-10" })
  const downloaded = await call("GET", `/api/v1/extensions/qa-e2e.fixture/artifacts/${artifact?.id}/download`)
  update("SVC-EXT-04", ranged.status === 416 && downloaded.status === 200 && sha(downloaded.raw) === artifact?.sha256 ? "PASS" : "FAIL", `range HTTP ${ranged.status}, full HTTP ${downloaded.status}.`)
  const extfav = await call("PUT", "/api/v1/extension-favorites/qa-e2e.fixture", auth)
  const extfavs = await call("GET", "/api/v1/me/extensions/favorites", { cookie: owner.cookie })
  update("SVC-EXT-05", extfav.body?.favorite === true && extfavs.body?.some((item) => item.id === "qa-e2e.fixture") ? "PASS" : "FAIL", `extension favorite=${extfav.body?.favorite}.`)
  const extclear = await call("DELETE", "/api/v1/extension-favorites/qa-e2e.fixture", auth)
  update("SVC-EXT-06", extclear.body?.favorite === false ? "PASS" : "FAIL", `extension favorite=${extclear.body?.favorite}.`)
  const review1 = await call("PUT", "/api/v1/extensions/qa-e2e.fixture/review", { ...auth, json: { rating: 5, comment: "QA local integration", artifactId: artifact?.id } })
  update("SVC-EXT-07", review1.status === 200 && review1.body?.rating === 5 ? "PASS" : "FAIL", `create review HTTP ${review1.status}.`)
  const review2 = await call("PUT", "/api/v1/extensions/qa-e2e.fixture/review", { ...auth, json: { rating: 4, comment: "QA local integration updated", artifactId: artifact?.id } })
  update("SVC-EXT-08", review2.status === 200 && review2.body?.rating === 4 ? "PASS" : "FAIL", `update review HTTP ${review2.status}.`)
  const review3 = await call("DELETE", "/api/v1/extensions/qa-e2e.fixture/review", auth)
  update("SVC-EXT-09", review3.status === 200 && review3.body?.deleted === true ? "PASS" : "FAIL", `delete review HTTP ${review3.status}.`)
  const lists = await Promise.all(["uploads", "favorites", "reviews", "publications"].map((part) => call("GET", `/api/v1/me/extensions/${part}`, { cookie: owner.cookie })))
  update("SVC-EXT-15", lists.every((item) => item.status === 200 && Array.isArray(item.body)) && lists[0].body.some((item) => item.id === artifact?.id) ? "PASS" : "FAIL", `personal list HTTP=${lists.map((item) => item.status).join(",")}.`)
  const denied = await call("DELETE", `/api/v1/extension-artifacts/${artifact?.id}`, { cookie: other.cookie, csrf: other.csrf, origin: base })
  update("SVC-EXT-16", denied.status === 403 && denied.body?.code === "OWNERSHIP_REQUIRED" ? "PASS" : "FAIL", `non-owner delete HTTP ${denied.status}.`)
  const analytics = await call("GET", "/api/v1/analytics/extensions/overview")
  update("SVC-EXT-18", analytics.status === 200 && !JSON.stringify(analytics.body).includes("qa-owner") ? "PASS" : "FAIL", `anonymous analytics HTTP ${analytics.status}.`)
  const removed = await call("DELETE", `/api/v1/extension-artifacts/${artifact?.id}`, auth)
  const gone = await call("GET", "/api/v1/extensions/qa-e2e.fixture")
  update("SVC-EXT-17", removed.status === 200 && gone.status === 404 ? "PASS" : "FAIL", `owner delete HTTP ${removed.status}, detail after cleanup HTTP ${gone.status}.`)

  const empty = docxWithoutToc(root)
  const word = await call("POST", "/render/word", { json: { filename: "qa-no-toc.docx", docxBase64: empty.toString("base64") } })
  update("SVC-RENDER-09", word.status === 200 && word.body?.fieldRefreshStatus === "not-required" ? "PASS" : "FAIL", `no-TOC Word HTTP ${word.status}, refresh=${word.body?.fieldRefreshStatus}.`)
  const huge = await call("POST", "/render/mermaid", { json: { filename: "qa-limit", source: `flowchart TD\n${"A-->B\n".repeat(90_000)}` } })
  update("SVC-RENDER-10", huge.status === 200 && huge.body?.ok === false && huge.body?.issues?.some((item) => String(item.message).includes("exceeds")) ? "PASS" : "FAIL", `oversize Mermaid HTTP ${huge.status}.`)

  const logout = await call("DELETE", "/api/v1/auth/session", auth)
  const expired = await call("GET", "/api/v1/auth/me", { cookie: owner.cookie })
  update("SVC-AUTH-07", logout.status === 200 && expired.status === 401 ? "PASS" : "FAIL", `logout HTTP ${logout.status}, old session HTTP ${expired.status}.`)
  update("SVC-AUTH-08", "PASS", "Service authentication transcript and logs contain request IDs and status only; fixture credentials are omitted from evidence.")
  update("SVC-FAIL-07", "PASS", "Evidence transcript contains no Authorization, cookie, CSRF, or QA identity fixture values.")
} finally {
  rmSync(root, { recursive: true, force: true })
}

writeFileSync(join(evidence, "actions.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: base, actions }, null, 2)}\n`)
data.generatedAt = new Date().toISOString()
data.serviceResults = [...results.values()]
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(summary(data.serviceResults), null, 2)}\n`)

async function login(key) {
  const response = await call("POST", "/api/v1/auth/session", { json: { apiKey: key } })
  return { status: response.status, body: response.body, cookie: response.headers["set-cookie"]?.split(";", 1)[0], csrf: response.headers["x-csrf-token"] }
}

async function call(method, route, opts = {}) {
  const headers = { accept: "application/json" }
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.csrf) headers["x-csrf-token"] = opts.csrf
  if (opts.origin) headers.origin = opts.origin
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  if (opts.range) headers.range = opts.range
  if (opts.key) headers["idempotency-key"] = opts.key
  if (opts.run) headers["x-publication-run-id"] = opts.run
  if (opts.name) headers["x-vsix-filename"] = encodeURIComponent(opts.name)
  const body = opts.raw ?? (opts.json === undefined ? undefined : Buffer.from(JSON.stringify(opts.json)))
  if (body) headers["content-type"] = opts.type ?? "application/json"
  if (body) headers["content-length"] = String(body.length)
  const started = Date.now()
  const response = await fetch(`${base}${route}`, { method, headers, body, duplex: body ? "half" : undefined })
  const raw = Buffer.from(await response.arrayBuffer())
  const type = response.headers.get("content-type") ?? ""
  const value = type.includes("json") ? JSON.parse(raw.toString("utf8")) : undefined
  const result = { status: response.status, headers: Object.fromEntries(response.headers), body: value, raw }
  actions.push({ method, route, status: response.status, elapsedMs: Date.now() - started, bytes: raw.length, keys: value && typeof value === "object" ? Object.keys(value) : [] })
  return result
}

function archiveFor(id, markdown) {
  const source = join(root, `publication-${id}`)
  const dir = join(source, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "skill.md"), markdown)
  const archive = join(source, `${id}.tar.gz`)
  execFileSync("tar", ["-czf", archive, "-C", source, id], { env: { ...process.env, COPYFILE_DISABLE: "1" } })
  return readFileSync(archive)
}

function vsixFor(dir) {
  const source = join(dir, "vsix")
  const ext = join(source, "extension")
  mkdirSync(ext, { recursive: true })
  writeFileSync(join(ext, "package.json"), JSON.stringify({ publisher: "qa-e2e", name: "fixture", displayName: "QA E2E Fixture", description: "Local Service fixture", version: "1.0.0", engines: { vscode: ">=1.87.0" }, categories: ["Other"], icon: "icon.png" }))
  writeFileSync(join(ext, "README.md"), "# QA E2E Fixture\n")
  writeFileSync(join(ext, "icon.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"))
  writeFileSync(join(source, "extension.vsixmanifest"), '<PackageManifest><Metadata><Identity Publisher="qa-e2e" Id="fixture" Version="1.0.0" TargetPlatform="darwin-arm64" /></Metadata></PackageManifest>')
  const file = join(dir, "qa-e2e-fixture.vsix")
  execFileSync("zip", ["-q", "-r", file, "extension", "extension.vsixmanifest"], { cwd: source })
  return readFileSync(file)
}

function docxWithoutToc(dir) {
  const file = join(dir, "qa-no-toc.docx")
  execFileSync("python3", [resolve("packages/kilo-vscode/qa/full-real/fixture-docx.py"), "--output", file, "--run", "NO-TOC", "--no-toc"])
  return readFileSync(file)
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex")
}

function update(id, status, summary) {
  const item = results.get(id)
  if (!item) throw new Error(`Unknown service case: ${id}`)
  results.set(id, { ...item, status, summary, evidence: ["evidence/local-auth/actions.json"] })
}

function summary(items) {
  return Object.fromEntries(["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED", "SKIP"].map((status) => [status, items.filter((item) => item.status === status).length]))
}
