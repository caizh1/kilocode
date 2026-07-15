"use strict"

const http = require("node:http")
const crypto = require("node:crypto")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")
const { pathToFileURL } = require("node:url")
const JSZip = require("jszip")
const { PNG } = require("pngjs")

const PORT = Number(process.env.PORT || 6001)
const PACKAGE_ROOT = process.env.PACKAGE_ROOT || "/packages"
const SKILL_MARKET_ROOT = process.env.SKILL_MARKET_ROOT || path.join(PACKAGE_ROOT, "skill-market")
const UPDATE_EXTENSION_ID = "chipmate.chipmate"
const UPDATE_TARGETS = new Set(["win32-x64-baseline", "linux-x64-baseline", "darwin-x64", "darwin-arm64"])
const NEW_API_TOKEN_NAME_SUFFIX = process.env.NEW_API_TOKEN_NAME_SUFFIX || "@chipmate"
const NEW_API_TOKEN_CACHE_TTL_MS = Number(process.env.NEW_API_TOKEN_CACHE_TTL_MS || 5 * 60 * 1000)
const NEW_API_TOKEN_PAGE_SIZE = Number(process.env.NEW_API_TOKEN_PAGE_SIZE || 100)
const NEW_API_TOKEN_MAX_PAGES = Number(process.env.NEW_API_TOKEN_MAX_PAGES || 50)
const MAX_SKILL_UPLOAD_FILES = Number(process.env.MAX_SKILL_UPLOAD_FILES || 500)
const MAX_SKILL_UPLOAD_TOTAL_BYTES = Number(process.env.MAX_SKILL_UPLOAD_TOTAL_BYTES || 50 * 1024 * 1024)
const MAX_SKILL_UPLOAD_FILE_BYTES = Number(process.env.MAX_SKILL_UPLOAD_FILE_BYTES || 10 * 1024 * 1024)
const MAX_DOCX_BYTES = Number(process.env.MAX_DOCX_BYTES || 50 * 1024 * 1024)
const MAX_MERMAID_SOURCE_BYTES = Number(process.env.MAX_MERMAID_SOURCE_BYTES || 512 * 1024)
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 120000)
const MAX_RESPONSE_PAGE_BYTES = Number(process.env.MAX_RESPONSE_PAGE_BYTES || 16 * 1024 * 1024)
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBSOCKET_OPEN = 1
const WEBSOCKET_CLOSED = 3
const defaultTokenResolverState = createTokenResolverState()

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && (request.url === "/" || request.url === "/health")) {
      sendJson(response, 200, healthPayload())
      return
    }
    if (request.method === "POST" && request.url === "/render/word") {
      await handleRenderWord(request, response)
      return
    }
    if (request.method === "POST" && request.url === "/render/mermaid") {
      await handleRenderMermaid(request, response)
      return
    }
    if (request.method === "POST" && request.url === "/auth/new-api/resolve-user") {
      await handleResolveNewApiUser(request, response)
      return
    }
    if (request.method === "GET" && request.url === "/packages/manifest.json") {
      await handlePackageManifest(response)
      return
    }
    if (request.method === "GET" && request.url === "/marketplace/skills") {
      await handleSkillMarketSkills(request, response)
      return
    }
    if (request.method === "POST" && request.url === "/marketplace/skills") {
      await handleSkillMarketUpload(request, response)
      return
    }
    if (request.method === "GET" && request.url === "/marketplace/manifest.json") {
      await handleSkillMarketManifest(request, response)
      return
    }
    if (request.method === "GET" && request.url && /^\/marketplace\/skills\/[^/]+\/files(?:\?|$)/.test(request.url)) {
      await handleSkillMarketFiles(request, response)
      return
    }
    if (request.method === "POST" && request.url && /^\/marketplace\/skills\/[^/]+\/stars(?:\?|$)/.test(request.url)) {
      await handleSkillMarketStar(request, response)
      return
    }
    if (request.method === "GET" && request.url && request.url.startsWith("/marketplace/skills/")) {
      await handleSkillMarketFile(request, response)
      return
    }
    if (request.method === "GET" && request.url && request.url.startsWith("/packages/")) {
      await handlePackageFile(request, response)
      return
    }
    sendJson(response, 404, {
      ok: false,
      issues: [{ severity: "error", code: "not-found", message: "Route not found." }],
    })
  } catch (error) {
    const status = error && typeof error === "object" && Number.isInteger(error.status) ? error.status : 500
    sendJson(response, status, {
      ok: false,
      code: status === 500 ? "server-error" : formatError(error),
      issues: [
        {
          severity: status === 500 ? "error" : "warning",
          code: status === 500 ? "server-error" : formatError(error),
          message: status === 500 ? formatError(error) : formatError(error),
        },
      ],
    })
  }
})

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`chipmate-word-render listening on 0.0.0.0:${PORT}`)
  })
}

async function handleRenderWord(request, response) {
  const payload = JSON.parse(await readBody(request, MAX_DOCX_BYTES * 2))
  const filename = safeFilename(payload.filename || "document.docx")
  if (!filename.toLowerCase().endsWith(".docx")) throw new Error("filename must end with .docx")
  const docxBytes = decodeBase64(payload.docxBase64, "docxBase64")
  if (docxBytes.length > MAX_DOCX_BYTES) throw new Error(`docx exceeds ${MAX_DOCX_BYTES} bytes`)

  const timeoutMs = clampNumber(payload.timeoutMs, 5000, RENDER_TIMEOUT_MS, RENDER_TIMEOUT_MS)
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "chipmate-word-render-"))
  const inDir = path.join(tempRoot, "in")
  const outDir = path.join(tempRoot, "out")
  const pagesDir = path.join(tempRoot, "pages")
  const profileDir = path.join(tempRoot, "lo-profile")
  const homeDir = path.join(tempRoot, "home")
  try {
    await Promise.all([inDir, outDir, pagesDir, profileDir, homeDir].map((dir) => fsp.mkdir(dir, { recursive: true })))
    const docxPath = path.join(inDir, filename)
    await fsp.writeFile(docxPath, docxBytes)

    const sofficePath = commandPath("soffice") || commandPath("libreoffice") || "soffice"
    const convertResult = await runCommand(
      sofficePath,
      [
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        `-env:UserInstallation=file://${profileDir}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        docxPath,
      ],
      timeoutMs,
      { HOME: homeDir },
    )
    if (!convertResult.ok) throw new Error(`LibreOffice failed: ${convertResult.message}`)

    const pdfPath = path.join(outDir, `${path.basename(filename, ".docx")}.pdf`)
    const pdfStat = await fsp.stat(pdfPath).catch(() => undefined)
    if (!pdfStat || pdfStat.size <= 0) throw new Error("LibreOffice did not produce a readable PDF.")

    const pdftoppmPath = commandPath("pdftoppm") || "pdftoppm"
    const prefix = path.join(pagesDir, "page")
    const pngResult = await runCommand(pdftoppmPath, ["-png", "-r", "144", pdfPath, prefix], timeoutMs)
    if (!pngResult.ok) throw new Error(`pdftoppm failed: ${pngResult.message}`)

    const pageFiles = (await fsp.readdir(pagesDir))
      .filter((entry) => /^page-\d+\.png$/i.test(entry))
      .sort((left, right) => pageIndex(left) - pageIndex(right))
    if (pageFiles.length === 0) throw new Error("pdftoppm completed but produced no page PNG files.")

    const pdfBytes = await fsp.readFile(pdfPath)
    const pages = []
    for (const file of pageFiles) {
      const absolute = path.join(pagesDir, file)
      const pngBytes = await fsp.readFile(absolute)
      if (pngBytes.length > MAX_RESPONSE_PAGE_BYTES) throw new Error(`${file} exceeds ${MAX_RESPONSE_PAGE_BYTES} bytes`)
      const dimensions = pngDimensions(pngBytes)
      const page = pageIndex(file)
      pages.push({
        page,
        contentType: "image/png",
        base64: pngBytes.toString("base64"),
        width: dimensions.width,
        height: dimensions.height,
        visualSummary: pngVisualSummary(page, pngBytes, dimensions.width, dimensions.height),
      })
    }

    sendJson(response, 200, {
      ok: true,
      pageCount: pages.length,
      pdf: { contentType: "application/pdf", base64: pdfBytes.toString("base64") },
      pages,
      issues: [],
      renderer: {
        kind: "remote-opencode",
        docxToPdf: "libreoffice",
        pdfToPng: "pdftoppm",
        sofficePath,
        pdftoppmPath,
      },
    })
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function handleRenderMermaid(request, response) {
  const startedAt = Date.now()
  const timeoutMs = clampNumber(undefined, 5000, RENDER_TIMEOUT_MS, 60000)
  let tempRoot
  let browserPath
  try {
    const payload = JSON.parse(await readBody(request, MAX_MERMAID_SOURCE_BYTES + 4096))
    const source = typeof payload.source === "string" ? payload.source : ""
    const sourceBytes = Buffer.byteLength(source, "utf8")
    if (!source.trim()) throw renderError("mermaid-source-empty", "source is required")
    if (sourceBytes > MAX_MERMAID_SOURCE_BYTES)
      throw renderError("mermaid-source-too-large", `source exceeds ${MAX_MERMAID_SOURCE_BYTES} bytes`)
    const requestedTimeoutMs = clampNumber(payload.timeoutMs, 5000, RENDER_TIMEOUT_MS, timeoutMs)
    const scale = clampNumber(payload.scale, 1, 4, 2)
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "chipmate-mermaid-render-"))
    const pagePath = path.join(tempRoot, `${safeFilename(payload.filename || "diagram")}.html`)
    const userDataDir = path.join(tempRoot, "chromium-profile")
    const mermaidPath = path.join(__dirname, "node_modules", "mermaid", "dist", "mermaid.esm.min.mjs")
    const mermaidStat = await fsp.stat(mermaidPath).catch(() => undefined)
    if (!mermaidStat || !mermaidStat.isFile())
      throw renderError("mermaid-runtime-missing", `Mermaid runtime missing: ${mermaidPath}`)
    browserPath =
      commandPath("chromium") || commandPath("chromium-browser") || commandPath("google-chrome") || "chromium"
    await fsp.writeFile(pagePath, renderMermaidHtml(pathToFileHref(mermaidPath), source))
    const rendered = await runChromiumMermaidRender({
      browserPath,
      pageUrl: pathToFileHref(pagePath),
      userDataDir,
      timeoutMs: requestedTimeoutMs,
      scale,
    })
    assertPng(rendered.bytes)
    sendJson(response, 200, {
      ok: true,
      png: {
        contentType: "image/png",
        base64: rendered.bytes.toString("base64"),
      },
      width: rendered.width,
      height: rendered.height,
      pixelWidth: rendered.pixelWidth,
      pixelHeight: rendered.pixelHeight,
      scale: rendered.scale,
      contentBounds: rendered.contentBounds,
      cropBounds: rendered.cropBounds,
      padding: rendered.padding,
      contentCropRatio: rendered.contentCropRatio,
      issues: rendered.issues,
      elapsedMs: Date.now() - startedAt,
      renderer: {
        kind: "remote-opencode",
        diagramToPng: "mermaid-chromium",
        chromiumPath: browserPath,
        mermaidRuntime: "mermaid",
        scale: rendered.scale,
        crop: "svg-content-bounds",
      },
    })
  } catch (error) {
    const code =
      error && typeof error === "object" && typeof error.code === "string" ? error.code : "mermaid-render-failed"
    sendJson(response, 200, {
      ok: false,
      issues: [{ severity: "error", code, message: formatError(error) }],
      elapsedMs: Date.now() - startedAt,
      renderer: {
        kind: "remote-opencode",
        diagramToPng: "mermaid-chromium",
        chromiumPath: browserPath,
        mermaidRuntime: "mermaid",
      },
    })
  } finally {
    if (tempRoot) await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function handlePackageFile(request, response) {
  const parsed = new URL(request.url, "http://localhost")
  const relative = decodeURIComponent(parsed.pathname.replace(/^\/packages\/+/, ""))
  const target = path.resolve(PACKAGE_ROOT, relative || "manifest.json")
  const root = path.resolve(PACKAGE_ROOT)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    sendJson(response, 403, {
      ok: false,
      issues: [{ severity: "error", code: "package-path-forbidden", message: "Forbidden package path." }],
    })
    return
  }
  const stat = await fsp.stat(target).catch(() => undefined)
  if (!stat || !stat.isFile()) {
    sendJson(response, 404, {
      ok: false,
      issues: [{ severity: "error", code: "package-not-found", message: "Package file not found." }],
    })
    return
  }
  response.writeHead(200, {
    "content-type": contentTypeFor(target),
    "content-length": stat.size,
    "cache-control": "no-store",
  })
  fs.createReadStream(target).pipe(response)
}

async function handlePackageManifest(response) {
  const manifest = await generatePackageManifest(PACKAGE_ROOT, UPDATE_EXTENSION_ID)
  sendJson(response, 200, manifest)
}

async function handleResolveNewApiUser(request, response) {
  const payload = JSON.parse(await readBody(request, 16 * 1024))
  const apiKey = normalizeNewApiKey(payload.apiKey || payload.key || "")
  if (!apiKey) {
    sendJson(response, 400, { ok: false, code: "invalid-api-key" })
    return
  }
  const result = await resolveNewApiUser(apiKey, { state: defaultTokenResolverState })
  sendJson(
    response,
    result.status || (result.ok ? 200 : 404),
    result.ok ? { ok: true, user: result.user } : { ok: false, code: result.code },
  )
}

async function handleSkillMarketSkills(request, response) {
  const catalog = await generateSkillMarketCatalog(SKILL_MARKET_ROOT, requestOrigin(request))
  sendJson(response, 200, catalog)
}

async function handleSkillMarketManifest(request, response) {
  const catalog = await generateSkillMarketCatalog(SKILL_MARKET_ROOT, requestOrigin(request))
  sendJson(response, 200, {
    ok: catalog.ok,
    schemaVersion: catalog.schemaVersion,
    service: catalog.service,
    generatedAt: catalog.generatedAt,
    marketplace: catalog.marketplace,
    skillCount: catalog.items.length,
    warnings: catalog.warnings,
  })
}

async function handleSkillMarketUpload(request, response) {
  const auth = bearerTokenFromRequest(request)
  if (!auth) {
    sendJson(response, 401, { ok: false, code: "missing-authorization" })
    return
  }
  const userResult = await resolveNewApiUser(auth, { state: defaultTokenResolverState })
  if (!userResult.ok) {
    sendJson(response, userResult.status || 401, { ok: false, code: userResult.code })
    return
  }
  const payload = JSON.parse(await readBody(request, MAX_SKILL_UPLOAD_TOTAL_BYTES * 2))
  const result = await publishSkillMarketUpload(SKILL_MARKET_ROOT, payload, userResult.user, requestOrigin(request))
  sendJson(response, result.created ? 201 : 200, {
    ok: true,
    item: result.item,
    generatedSkillJson: result.generatedSkillJson,
  })
}

async function handleSkillMarketFiles(request, response) {
  const id = skillIdFromMarketplacePath(request.url, "files")
  if (!id || !isSafeSkillId(id)) {
    sendJson(response, 400, { ok: false, code: "skill-id-invalid" })
    return
  }
  const files = await skillMarketFilesPayload(SKILL_MARKET_ROOT, id)
  if (!files) {
    sendJson(response, 404, { ok: false, code: "skill-files-not-found" })
    return
  }
  await incrementSkillMarketDownloadCount(SKILL_MARKET_ROOT, id)
  sendJson(response, 200, { ok: true, id, files })
}

async function handleSkillMarketStar(request, response) {
  const id = skillIdFromMarketplacePath(request.url, "stars")
  if (!id || !isSafeSkillId(id)) {
    sendJson(response, 400, { ok: false, code: "skill-id-invalid" })
    return
  }
  const auth = bearerTokenFromRequest(request)
  if (!auth) {
    sendJson(response, 401, { ok: false, code: "missing-authorization" })
    return
  }
  const userResult = await resolveNewApiUser(auth, { state: defaultTokenResolverState })
  if (!userResult.ok) {
    sendJson(response, userResult.status || 401, { ok: false, code: userResult.code })
    return
  }
  const result = await starSkillMarketItem(SKILL_MARKET_ROOT, id, userResult.user)
  sendJson(
    response,
    result.found ? 200 : 404,
    result.found
      ? { ok: true, id, stars: result.stars, starred: result.starred }
      : { ok: false, code: "skill-not-found" },
  )
}

async function handleSkillMarketFile(request, response) {
  const parsed = new URL(request.url, "http://localhost")
  const filename = decodeURIComponent(parsed.pathname.replace(/^\/marketplace\/skills\/+/, ""))
  if (!isSafeSkillArchiveFilename(filename)) {
    sendJson(response, 400, {
      ok: false,
      issues: [{ severity: "error", code: "skill-archive-invalid", message: "Invalid skill archive filename." }],
    })
    return
  }
  const root = path.resolve(SKILL_MARKET_ROOT, "skills")
  const target = path.resolve(root, filename)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    sendJson(response, 403, {
      ok: false,
      issues: [{ severity: "error", code: "skill-archive-forbidden", message: "Forbidden skill archive path." }],
    })
    return
  }
  const stat = await fsp.stat(target).catch(() => undefined)
  if (!stat || !stat.isFile()) {
    sendJson(response, 404, {
      ok: false,
      issues: [{ severity: "error", code: "skill-archive-not-found", message: "Skill archive not found." }],
    })
    return
  }
  await incrementSkillMarketDownloadCount(SKILL_MARKET_ROOT, path.basename(filename, ".tar.gz"))
  response.writeHead(200, {
    "content-type": contentTypeFor(target),
    "content-length": stat.size,
    "cache-control": "no-store",
  })
  fs.createReadStream(target).pipe(response)
}

async function generatePackageManifest(packageRoot = PACKAGE_ROOT, extensionId = UPDATE_EXTENSION_ID) {
  const root = path.resolve(packageRoot)
  const packages = []
  const entries = await fsp.readdir(root).catch((error) => {
    if (error && error.code === "ENOENT") return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".vsix")) continue
    const absolute = path.join(root, entry)
    const info = await packageEntryFromVsix(absolute, entry).catch((error) => {
      console.warn(`[packages] skipped ${entry}: ${formatError(error)}`)
      return undefined
    })
    if (!info || info.extensionId !== extensionId || !UPDATE_TARGETS.has(info.target)) continue
    packages.push(info)
  }
  packages.sort((left, right) => {
    const versionDelta = compareExtensionVersions(right.version, left.version)
    if (versionDelta !== 0) return versionDelta
    return right.mtimeMs - left.mtimeMs
  })
  const latestByTarget = {}
  for (const item of packages) {
    if (!latestByTarget[item.target]) latestByTarget[item.target] = item
  }
  return {
    ok: true,
    schemaVersion: 2,
    service: "chipmate-word-render",
    generatedAt: new Date().toISOString(),
    latest: packages[0] || null,
    latestByTarget,
    packages,
  }
}

async function generateSkillMarketCatalog(skillMarketRoot = SKILL_MARKET_ROOT, origin = "http://localhost:6001") {
  const root = path.resolve(skillMarketRoot)
  const catalogFile = path.join(root, "skills.json")
  const generatedAt = new Date().toISOString()
  const warnings = []
  const raw = await fsp.readFile(catalogFile, "utf8").catch((error) => {
    if (error && error.code === "ENOENT") {
      warnings.push({
        severity: "warning",
        code: "skill-market-missing",
        message: `Skill market catalog not found: ${catalogFile}`,
      })
      return undefined
    }
    throw error
  })
  if (!raw) return skillMarketPayload(generatedAt, root, [], warnings)

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    warnings.push({
      severity: "warning",
      code: "skill-market-invalid-json",
      message: `Could not parse skills.json: ${formatError(error)}`,
    })
    return skillMarketPayload(generatedAt, root, [], warnings)
  }

  const sourceItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : []
  if (!Array.isArray(sourceItems)) {
    warnings.push({
      severity: "warning",
      code: "skill-market-invalid-items",
      message: "skills.json must be an array or an object with an items array.",
    })
    return skillMarketPayload(generatedAt, root, [], warnings)
  }

  const items = []
  const seen = new Set()
  for (const item of sourceItems) {
    const normalized = normalizeSkillMarketItem(item, origin, warnings)
    if (!normalized) continue
    if (seen.has(normalized.id)) {
      warnings.push({
        severity: "warning",
        code: "skill-market-duplicate-id",
        message: `Duplicate skill id skipped: ${normalized.id}`,
      })
      continue
    }
    seen.add(normalized.id)
    items.push(normalized)
  }
  return skillMarketPayload(generatedAt, root, items, warnings)
}

function skillMarketPayload(generatedAt, root, items, warnings) {
  return {
    ok: true,
    schemaVersion: 1,
    service: "chipmate-word-render",
    generatedAt,
    marketplace: {
      kind: "skill-market",
      root,
      catalog: "skills.json",
      archiveRoot: "skills",
    },
    items,
    warnings,
  }
}

function normalizeSkillMarketItem(item, origin, warnings) {
  if (!item || typeof item !== "object") {
    warnings.push({ severity: "warning", code: "skill-market-invalid-item", message: "Skipped non-object skill item." })
    return undefined
  }
  const id = String(item.id || "").trim()
  if (!isSafeSkillId(id)) {
    warnings.push({
      severity: "warning",
      code: "skill-market-invalid-id",
      message: `Skipped skill with invalid id: ${id || "<empty>"}`,
    })
    return undefined
  }
  const archive = skillArchiveFilename(item.content, id)
  if (!archive) {
    warnings.push({
      severity: "warning",
      code: "skill-market-invalid-content",
      message: `Skipped skill ${id}: content must point to a .tar.gz under /marketplace/skills.`,
    })
    return undefined
  }
  return {
    id,
    name: String(item.name || id),
    description: String(item.description || ""),
    category: String(item.category || "general"),
    githubUrl: String(item.githubUrl || ""),
    content: `${origin}/marketplace/skills/${encodeURIComponent(archive)}`,
    uploadedBy: String(item.uploadedBy || ""),
    uploadedAt: String(item.uploadedAt || ""),
    updatedAt: String(item.updatedAt || ""),
    downloadCount: Math.max(0, Number(item.downloadCount || 0)),
    stars: Math.max(0, Number(item.stars || 0)),
  }
}

function skillArchiveFilename(content, id) {
  const fallback = `${id}.tar.gz`
  const raw = String(content || "").trim()
  if (!raw) return fallback
  let pathname = raw
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname
    } catch {
      return undefined
    }
  }
  if (pathname.startsWith("/marketplace/skills/")) pathname = pathname.slice("/marketplace/skills/".length)
  if (pathname.startsWith("marketplace/skills/")) pathname = pathname.slice("marketplace/skills/".length)
  if (pathname.startsWith("skills/")) pathname = pathname.slice("skills/".length)
  if (pathname.includes("/") || pathname.includes("\\") || pathname.includes("..")) return undefined
  const filename = path.posix.basename(pathname)
  return isSafeSkillArchiveFilename(filename) && filename === pathname.split("/").pop() ? filename : undefined
}

async function packageEntryFromVsix(absolute, filename) {
  const [stat, bytes] = await Promise.all([fsp.stat(absolute), fsp.readFile(absolute)])
  if (!stat.isFile()) throw new Error("not a file")
  const manifest = await readVsixExtensionManifest(bytes)
  const publisher = requireManifestString(manifest.publisher, "publisher")
  const name = requireManifestString(manifest.name, "name")
  const version = requireManifestString(manifest.version, "version")
  if (!parseExtensionVersion(version))
    throw new Error("extension/package.json version must be a valid semantic version")
  const target = requireManifestString(manifest.chipmatePackageTarget, "chipmatePackageTarget")
  return {
    extensionId: `${publisher}.${name}`,
    publisher,
    name,
    version,
    target,
    filename,
    url: `/packages/${encodeURIComponent(filename)}`,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}

async function readVsixExtensionManifest(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const packageJson = zip.file("extension/package.json")
  if (!packageJson) throw new Error("extension/package.json missing")
  const raw = await packageJson.async("string")
  return JSON.parse(raw)
}

function requireManifestString(value, field) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`extension/package.json ${field} must be a non-empty string`)
  return value.trim()
}

function healthPayload() {
  const tokenResolverConfig = readNewApiResolverConfig()
  const skillMarketStatus = skillMarketHealthStatus()
  return {
    ok: true,
    service: "chipmate-word-render",
    endpoints: [
      "/render/word",
      "/render/mermaid",
      "/auth/new-api/resolve-user",
      "/packages/manifest.json",
      "/packages/<file>",
      "/marketplace/skills",
      "/marketplace/skills/<file>",
      "/marketplace/skills/<id>/files",
      "/marketplace/skills/<id>/stars",
      "/marketplace/manifest.json",
    ],
    tools: {
      node: process.version,
      chromium: commandVersion("chromium") || commandVersion("chromium-browser") || commandVersion("google-chrome"),
      mermaid: packageVersion("mermaid"),
      soffice: commandVersion("soffice") || commandVersion("libreoffice"),
      pdftoppm: commandVersion("pdftoppm"),
      pdfinfo: commandVersion("pdfinfo"),
    },
    capabilities: {
      mermaid: {
        endpoint: "/render/mermaid",
        scale: { min: 1, max: 4, default: 2 },
        cssSizeFields: ["width", "height"],
        pixelSizeFields: ["pixelWidth", "pixelHeight"],
        crop: { mode: "svg-content-bounds", padding: 32, fields: ["contentBounds", "cropBounds"] },
      },
      autoUpdateManifest: {
        endpoint: "/packages/manifest.json",
        packageRoot: PACKAGE_ROOT,
        extensionId: UPDATE_EXTENSION_ID,
      },
      skillMarket: {
        endpoint: "/marketplace/skills",
        manifestEndpoint: "/marketplace/manifest.json",
        root: SKILL_MARKET_ROOT,
        catalog: "skills.json",
        catalogExists: skillMarketStatus.catalogExists,
        skillsCount: skillMarketStatus.skillsCount,
        warnings: skillMarketStatus.warnings,
        defaultHostCatalogHint: "/home/share/chipmate/packages/skill-market/skills.json",
        archiveEndpoint: "/marketplace/skills/<skill-id>.tar.gz",
        filesEndpoint: "/marketplace/skills/<skill-id>/files",
        uploadEndpoint: "/marketplace/skills",
        starsEndpoint: "/marketplace/skills/<skill-id>/stars",
        writable: true,
        metrics: ["downloadCount", "stars"],
      },
      newApiTokenResolver: {
        endpoint: "/auth/new-api/resolve-user",
        enabled: tokenResolverConfig.enabled,
        baseUrlConfigured: Boolean(tokenResolverConfig.baseUrl),
        adminAccessTokenConfigured: Boolean(tokenResolverConfig.adminAccessToken),
        userIdConfigured: Boolean(tokenResolverConfig.userId),
        tokenNameSuffix: tokenResolverConfig.tokenNameSuffix,
      },
    },
  }
}

function skillMarketHealthStatus() {
  const root = path.resolve(SKILL_MARKET_ROOT)
  const catalogFile = path.join(root, "skills.json")
  const warnings = []
  if (!fs.existsSync(catalogFile)) {
    warnings.push({
      severity: "warning",
      code: "skill-market-missing",
      message: `Skill market catalog not found: ${catalogFile}. Create /home/share/chipmate/packages/skill-market/skills.json or reinstall with a seeded offline bundle.`,
    })
    return { catalogExists: false, skillsCount: 0, warnings }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogFile, "utf8") || "{}")
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : []
    if (!Array.isArray(items)) {
      warnings.push({
        severity: "warning",
        code: "skill-market-invalid-items",
        message: "skills.json must be an array or an object with an items array.",
      })
      return { catalogExists: true, skillsCount: 0, warnings }
    }
    return { catalogExists: true, skillsCount: items.length, warnings }
  } catch (error) {
    warnings.push({
      severity: "warning",
      code: "skill-market-invalid-json",
      message: `Could not parse skills.json: ${formatError(error)}`,
    })
    return { catalogExists: true, skillsCount: 0, warnings }
  }
}

async function resolveNewApiUser(apiKey, options = {}) {
  const trace = { id: crypto.randomBytes(4).toString("hex"), startedAt: Date.now() }
  const normalizedApiKey = normalizeNewApiKey(apiKey)
  resolverLog("info", "resolve.start", { requestId: trace.id, keyPresent: Boolean(normalizedApiKey) })
  if (!normalizedApiKey) {
    const result = { ok: false, code: "invalid-api-key", status: 400 }
    resolverFinish(trace, result, "validation")
    return result
  }
  const config = readNewApiResolverConfig(options.env || process.env)
  resolverLog("info", "config.ready", {
    requestId: trace.id,
    directEnabled: config.enabled,
    adminFallbackEnabled: config.adminEnabled,
  })
  if (!config.enabled) {
    const result = { ok: false, code: "token-resolver-disabled", status: 503 }
    resolverFinish(trace, result, "configuration")
    return result
  }

  const state = options.state || defaultTokenResolverState
  const now = typeof options.now === "function" ? options.now() : Date.now()
  const keyHash = sha256Hex(canonicalNewApiKeyForHash(normalizedApiKey))
  const cachedUser = readCacheEntry(state.userByKeyHash, keyHash, now)
  if (cachedUser) {
    const result = { ok: true, user: cachedUser, status: 200, cache: "user" }
    resolverLog("info", "identity.cache.hit", { requestId: trace.id })
    resolverFinish(trace, result, "identity-cache")
    return result
  }

  const pending = state.pendingByKeyHash.get(keyHash)
  if (pending) {
    resolverLog("info", "identity.singleflight.join", { requestId: trace.id })
    const result = await pending
    resolverFinish(trace, result, "identity-singleflight")
    return result
  }

  const fetchImpl = options.fetchImpl || fetch
  const request = resolveNewApiUserFresh(normalizedApiKey, config, state, fetchImpl, now, keyHash, trace)
  state.pendingByKeyHash.set(keyHash, request)
  try {
    const result = await request
    resolverFinish(trace, result, result.cache || "resolver")
    return result
  } finally {
    if (state.pendingByKeyHash.get(keyHash) === request) state.pendingByKeyHash.delete(keyHash)
  }
}

async function resolveNewApiUserFresh(apiKey, config, state, fetchImpl, now, keyHash, trace) {
  try {
    const user = await fetchNewApiTokenUser(config, apiKey, fetchImpl, trace)
    resolverLog("info", "direct.identity.result", { requestId: trace.id, matched: Boolean(user) })
    if (!user) return { ok: false, code: "token-not-found", status: 404 }
    writeCacheEntry(state.userByKeyHash, keyHash, user, now + config.cacheTtlMs)
    return { ok: true, user, status: 200, cache: "token-usage" }
  } catch (error) {
    const status = newApiHttpStatus(error)
    resolverLog(status === 429 ? "warn" : "info", "direct.identity.error", {
      requestId: trace.id,
      status: status || "network",
      fallbackEligible: status === 404 || status === 405,
      error: sanitizeResolverError(error),
    })
    if (status === 401 || status === 403) return { ok: false, code: "token-not-found", status: 404 }
    if (status === 429) return newApiResolverFailure(error, "new-api-rate-limited", 429, trace)
    if (status !== 404 && status !== 405) return newApiResolverFailure(error, "new-api-error", 502, trace)
  }

  if (!config.adminEnabled) {
    resolverLog("warn", "admin.fallback.unavailable", { requestId: trace.id })
    return { ok: false, code: "token-resolver-disabled", status: 503 }
  }
  resolverLog("info", "admin.fallback.start", { requestId: trace.id })

  try {
    const entries = await getNewApiTokenCatalog(config, state, fetchImpl, now, trace)
    const inputCandidates = new Set(newApiKeyCandidates(apiKey))
    const candidates = entries.filter((entry) => userFromTokenName(entry.name, config.tokenNameSuffix))
    resolverLog("info", "admin.catalog.candidates", {
      requestId: trace.id,
      entries: entries.length,
      candidates: candidates.length,
    })

    for (const entry of entries) {
      const user = userFromTokenName(entry.name, config.tokenNameSuffix)
      if (!user) continue
      if (entry.key && keyCandidateSetsIntersect(inputCandidates, newApiKeyCandidates(entry.key))) {
        writeCacheEntry(state.userByKeyHash, keyHash, user, now + config.cacheTtlMs)
        return { ok: true, user, status: 200, cache: "catalog-key" }
      }
    }

    let candidate = 0
    for (const entry of entries) {
      const user = userFromTokenName(entry.name, config.tokenNameSuffix)
      if (!user || entry.id === undefined || entry.id === null || entry.id === "") continue
      candidate += 1
      const fullKey = await fetchNewApiTokenKey(config, entry.id, fetchImpl, trace, candidate, candidates.length)
      if (fullKey && keyCandidateSetsIntersect(inputCandidates, newApiKeyCandidates(fullKey))) {
        writeCacheEntry(state.userByKeyHash, keyHash, user, now + config.cacheTtlMs)
        return { ok: true, user, status: 200, cache: "token-key" }
      }
    }

    return { ok: false, code: "token-not-found", status: 404 }
  } catch (error) {
    if (newApiHttpStatus(error) === 429) return newApiResolverFailure(error, "new-api-rate-limited", 429, trace)
    return newApiResolverFailure(error, "new-api-error", 502, trace)
  }
}

function createTokenResolverState() {
  return {
    userByKeyHash: new Map(),
    pendingByKeyHash: new Map(),
    catalog: undefined,
    catalogPromise: undefined,
  }
}

function readNewApiResolverConfig(env = process.env) {
  const baseUrl = String(env.NEW_API_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "")
  const adminAccessToken = String(env.NEW_API_ADMIN_ACCESS_TOKEN || "").trim()
  const userId = String(env.NEW_API_USER_ID || "").trim()
  const tokenNameSuffix =
    String(env.NEW_API_TOKEN_NAME_SUFFIX || NEW_API_TOKEN_NAME_SUFFIX || "@chipmate").trim() || "@chipmate"
  const cacheTtlMs = clampNumber(
    Number(env.NEW_API_TOKEN_CACHE_TTL_MS || NEW_API_TOKEN_CACHE_TTL_MS),
    0,
    60 * 60 * 1000,
    5 * 60 * 1000,
  )
  const pageSize = clampNumber(Number(env.NEW_API_TOKEN_PAGE_SIZE || NEW_API_TOKEN_PAGE_SIZE), 1, 500, 100)
  const maxPages = clampNumber(Number(env.NEW_API_TOKEN_MAX_PAGES || NEW_API_TOKEN_MAX_PAGES), 1, 500, 50)
  return {
    enabled: Boolean(baseUrl),
    adminEnabled: Boolean(baseUrl && adminAccessToken && userId),
    baseUrl,
    adminAccessToken,
    userId,
    tokenNameSuffix,
    cacheTtlMs,
    pageSize,
    maxPages,
  }
}

async function getNewApiTokenCatalog(config, state, fetchImpl, now, trace) {
  if (state.catalog && state.catalog.expiresAt > now) {
    resolverLog("info", "admin.catalog.cache.hit", { requestId: trace.id, entries: state.catalog.entries.length })
    return state.catalog.entries
  }
  if (state.catalogPromise) {
    resolverLog("info", "admin.catalog.singleflight.join", { requestId: trace.id })
    return state.catalogPromise
  }
  const request = (async () => {
    let entries
    try {
      entries = await fetchAllNewApiTokens(config, fetchImpl, "page_size", trace)
    } catch (error) {
      const status = newApiHttpStatus(error)
      if (status !== 400 && status !== 422) throw error
      resolverLog("warn", "admin.catalog.pagination.fallback", {
        requestId: trace.id,
        from: "page_size",
        to: "size",
        status,
      })
      entries = await fetchAllNewApiTokens(config, fetchImpl, "size", trace)
    }
    state.catalog = { entries, expiresAt: now + config.cacheTtlMs }
    resolverLog("info", "admin.catalog.loaded", {
      requestId: trace.id,
      entries: entries.length,
      ttlMs: config.cacheTtlMs,
    })
    return entries
  })()
  state.catalogPromise = request
  try {
    return await request
  } finally {
    if (state.catalogPromise === request) state.catalogPromise = undefined
  }
}

async function fetchNewApiTokenUser(config, apiKey, fetchImpl, trace) {
  const url = new URL(`${config.baseUrl}/api/usage/token/`)
  const payload = await fetchNewApiRequest(
    fetchImpl,
    url,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${canonicalNewApiKeyForHash(apiKey)}`,
      },
    },
    trace,
    { layer: "direct", endpoint: "token-usage" },
  )
  const name = String(payload?.data?.name || payload?.name || "").trim()
  return userFromTokenName(name, config.tokenNameSuffix)
}

async function fetchAllNewApiTokens(config, fetchImpl, sizeParam, trace) {
  const entries = []
  let total
  for (let page = 1; page <= config.maxPages; page += 1) {
    const pageResult = await fetchNewApiTokenPage(config, fetchImpl, page, sizeParam, trace)
    entries.push(...pageResult.items)
    resolverLog("info", "admin.catalog.page", {
      requestId: trace.id,
      page,
      sizeParam,
      items: pageResult.items.length,
      accumulated: entries.length,
      total: pageResult.total,
    })
    if (Number.isFinite(pageResult.total)) total = Number(pageResult.total)
    if (pageResult.items.length === 0) break
    if (total !== undefined && entries.length >= total) break
    if (pageResult.items.length < config.pageSize) break
  }
  return entries
}

async function fetchNewApiTokenPage(config, fetchImpl, page, sizeParam, trace) {
  const url = new URL(`${config.baseUrl}/api/token/`)
  url.searchParams.set("p", String(page))
  url.searchParams.set(sizeParam, String(config.pageSize))
  const payload = await fetchNewApiJson(fetchImpl, url, config, { method: "GET" }, trace, {
    layer: "admin",
    endpoint: "token-catalog",
    page,
    sizeParam,
  })
  if (payload && payload.success === false) throw new Error("new-api-token-list-failed")
  const data = payload && payload.data
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
  const total = Number(data?.total)
  return {
    items: items.map(normalizeNewApiTokenItem).filter(Boolean),
    total: Number.isFinite(total) ? total : undefined,
  }
}

async function fetchNewApiTokenKey(config, tokenId, fetchImpl, trace, candidate, candidates) {
  const encodedId = encodeURIComponent(String(tokenId))
  const url = new URL(`${config.baseUrl}/api/token/${encodedId}/key`)
  const payload = await fetchNewApiJson(fetchImpl, url, config, { method: "POST" }, trace, {
    layer: "admin",
    endpoint: "token-key",
    candidate,
    candidates,
  })
  if (payload && payload.success === false) return ""
  return String(payload?.data?.key || payload?.key || "").trim()
}

async function fetchNewApiJson(fetchImpl, url, config, init, trace, meta) {
  return fetchNewApiRequest(
    fetchImpl,
    url,
    {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.adminAccessToken}`,
        "new-api-user": config.userId,
      },
    },
    trace,
    meta,
  )
}

async function fetchNewApiRequest(fetchImpl, url, init, trace, meta) {
  const startedAt = Date.now()
  resolverLog("info", "upstream.request.start", {
    requestId: trace.id,
    layer: meta.layer,
    endpoint: meta.endpoint,
    method: init.method || "GET",
    page: meta.page,
    sizeParam: meta.sizeParam,
    candidate: meta.candidate,
    candidates: meta.candidates,
  })
  try {
    const response = await fetchImpl(url, init)
    resolverLog(response.status === 429 ? "warn" : "info", "upstream.request.finish", {
      requestId: trace.id,
      layer: meta.layer,
      endpoint: meta.endpoint,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      retryAfter: String(response.headers?.get?.("retry-after") || "").trim() || undefined,
      page: meta.page,
      sizeParam: meta.sizeParam,
      candidate: meta.candidate,
      candidates: meta.candidates,
    })
    return readNewApiResponse(response)
  } catch (error) {
    if (error instanceof NewApiHttpError) throw error
    resolverLog("warn", "upstream.request.error", {
      requestId: trace.id,
      layer: meta.layer,
      endpoint: meta.endpoint,
      durationMs: Date.now() - startedAt,
      error: sanitizeResolverError(error),
    })
    throw error
  }
}

async function readNewApiResponse(response) {
  if (!response) throw new NewApiHttpError(undefined, "no-response")
  const text = await response.text()
  const retryAfter = String(response.headers?.get?.("retry-after") || "").trim()
  if (!text) {
    if (!response.ok) throw new NewApiHttpError(response.status, "empty-response", retryAfter)
    return {}
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    if (!response.ok) throw new NewApiHttpError(response.status, "invalid-json", retryAfter)
    throw new Error("new-api-invalid-json")
  }
  if (!response.ok) throw new NewApiHttpError(response.status, newApiResponseMessage(payload), retryAfter)
  return payload
}

class NewApiHttpError extends Error {
  constructor(status, message, retryAfter = "") {
    const suffix = retryAfter ? ` retry-after=${retryAfter}` : ""
    super(`new-api-http-${status || "failed"}: ${message || "request-failed"}${suffix}`)
    this.status = status
  }
}

function newApiHttpStatus(error) {
  return error instanceof NewApiHttpError ? error.status : undefined
}

function newApiResponseMessage(payload) {
  if (!payload || typeof payload !== "object") return "request-failed"
  return String(payload.message || payload.error?.message || payload.code || "request-failed")
    .trim()
    .slice(0, 200)
}

function newApiResolverFailure(error, code, status, trace) {
  resolverLog("warn", "resolve.failure", {
    requestId: trace.id,
    code,
    status,
    error: sanitizeResolverError(error),
  })
  return { ok: false, code, status }
}

function normalizeNewApiTokenItem(item) {
  if (!item || typeof item !== "object") return undefined
  return {
    id: item.id,
    name: String(item.name || "").trim(),
    key: String(item.key || "").trim(),
  }
}

function userFromTokenName(tokenName, suffix = "@chipmate") {
  const name = String(tokenName || "").trim()
  if (!name || !name.endsWith(suffix)) return undefined
  const userName = name.slice(0, -suffix.length).trim()
  if (!userName) return undefined
  return { name: userName, tokenName: name }
}

function normalizeNewApiKey(apiKey) {
  return String(apiKey || "")
    .replace(/^Bearer\s+/i, "")
    .trim()
}

function canonicalNewApiKeyForHash(apiKey) {
  const normalized = normalizeNewApiKey(apiKey)
  return normalized.startsWith("sk-") ? normalized : `sk-${normalized}`
}

function newApiKeyCandidates(apiKey) {
  const normalized = normalizeNewApiKey(apiKey)
  if (!normalized) return []
  const values = new Set([normalized])
  if (normalized.startsWith("sk-")) values.add(normalized.slice(3))
  else values.add(`sk-${normalized}`)
  return Array.from(values)
}

function keyCandidateSetsIntersect(left, right) {
  for (const value of left) {
    if (right.includes(value)) return true
  }
  return false
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex")
}

function readCacheEntry(cache, key, now) {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= now) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

function writeCacheEntry(cache, key, value, expiresAt) {
  cache.set(key, { value, expiresAt })
}

function sanitizeResolverError(error) {
  const message = formatError(error)
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/sk-[A-Za-z0-9._~+/=-]{6,}/gi, "sk-<redacted>")
    .slice(0, 300)
}

function resolverFinish(trace, result, source) {
  resolverLog(result.ok ? "info" : "warn", "resolve.finish", {
    requestId: trace.id,
    ok: result.ok,
    status: result.status,
    code: result.code,
    source,
    durationMs: Date.now() - trace.startedAt,
  })
}

function resolverLog(level, event, fields = {}) {
  const payload = { event, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) }
  const line = `[new-api-token-resolver] ${JSON.stringify(payload)}`
  if (level === "warn") console.warn(line)
  else console.info(line)
}

function bearerTokenFromRequest(request) {
  const value = request.headers.authorization || request.headers.Authorization || ""
  const normalized = normalizeNewApiKey(value)
  return normalized || ""
}

function skillIdFromMarketplacePath(requestUrl, tail) {
  const parsed = new URL(requestUrl, "http://localhost")
  const match = parsed.pathname.match(new RegExp(`^/marketplace/skills/([^/]+)/${tail}$`))
  return match ? decodeURIComponent(match[1]) : ""
}

async function publishSkillMarketUpload(root, payload, user, origin) {
  const normalized = normalizeSkillUploadPayload(payload, user)
  await fsp.mkdir(path.join(root, "skills"), { recursive: true })
  await fsp.mkdir(path.join(root, "sources"), { recursive: true })
  const catalog = await readSkillMarketCatalogFile(root)
  const existing = catalog.items.find((item) => item.id === normalized.id)
  if (existing && existing.uploadedBy && existing.uploadedBy !== user.name) {
    const error = new Error("skill-owner-conflict")
    error.status = 409
    throw error
  }

  const now = new Date().toISOString()
  const sourceDir = path.join(root, "sources", normalized.id)
  const tempDir = path.join(root, ".upload", `${normalized.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`)
  await fsp.rm(tempDir, { recursive: true, force: true })
  await fsp.mkdir(tempDir, { recursive: true })
  try {
    for (const file of normalized.files) {
      const target = path.join(tempDir, file.relativePath)
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, file.bytes)
    }
    if (!normalized.hasSkillJson) {
      await fsp.writeFile(
        path.join(tempDir, "skill.json"),
        JSON.stringify(generatedSkillJson(normalized, user, now), null, 2) + "\n",
      )
    }
    await fsp.rm(sourceDir, { recursive: true, force: true })
    await fsp.mkdir(path.dirname(sourceDir), { recursive: true })
    await fsp.rename(tempDir, sourceDir)
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }

  const archive = `${normalized.id}.tar.gz`
  await createSkillArchive(sourceDir, path.join(root, "skills", archive))
  const nextItem = {
    ...(existing || {}),
    id: normalized.id,
    name: normalized.name,
    description: normalized.description,
    category: normalized.category,
    githubUrl: String(payload.githubUrl || existing?.githubUrl || ""),
    content: `skills/${archive}`,
    uploadedBy: existing?.uploadedBy || user.name,
    uploadedAt: existing?.uploadedAt || now,
    updatedAt: now,
    downloadCount: Math.max(0, Number(existing?.downloadCount || 0)),
    stars: Math.max(0, Number(existing?.stars || 0)),
    ownerKeyHash: sha256Hex(user.name),
  }
  const index = catalog.items.findIndex((item) => item.id === normalized.id)
  if (index >= 0) catalog.items[index] = nextItem
  else catalog.items.push(nextItem)
  catalog.items.sort((left, right) => String(left.id).localeCompare(String(right.id)))
  await writeSkillMarketCatalogFile(root, catalog.items)
  return {
    created: index < 0,
    generatedSkillJson: !normalized.hasSkillJson,
    item: normalizeSkillMarketItem(nextItem, origin, []),
  }
}

function normalizeSkillUploadPayload(payload, user) {
  if (!payload || typeof payload !== "object") throw uploadError("upload-payload-invalid")
  const filesInput = Array.isArray(payload.files) ? payload.files : []
  if (filesInput.length === 0) throw uploadError("upload-files-empty")
  if (filesInput.length > MAX_SKILL_UPLOAD_FILES) throw uploadError("upload-too-many-files")
  const files = []
  let totalBytes = 0
  for (const input of filesInput) {
    const relativePath = normalizeSkillUploadPath(input && input.path)
    const bytes = decodeUploadFileBytes(input)
    if (bytes.length > MAX_SKILL_UPLOAD_FILE_BYTES) throw uploadError("upload-file-too-large")
    totalBytes += bytes.length
    if (totalBytes > MAX_SKILL_UPLOAD_TOTAL_BYTES) throw uploadError("upload-total-too-large")
    files.push({ relativePath, bytes })
  }
  if (!files.some((file) => file.relativePath === "SKILL.md")) throw uploadError("skill-md-missing")
  const skillMarkdown = files.find((file) => file.relativePath === "SKILL.md").bytes.toString("utf8")
  const frontmatter = parseSimpleSkillFrontmatter(skillMarkdown)
  const rawId = String(payload.id || payload.name || frontmatter.name || "").trim()
  const id = safeSkillSlug(rawId)
  if (!id || !isSafeSkillId(id)) throw uploadError("skill-id-invalid")
  const name = String(payload.name || frontmatter.name || id).trim() || id
  const description = String(payload.description || frontmatter.description || "").trim()
  const category = String(payload.category || frontmatter.category || "general").trim() || "general"
  return {
    id,
    name,
    description,
    category,
    uploadedBy: user.name,
    files,
    hasSkillJson: files.some((file) => file.relativePath === "skill.json"),
  }
}

function normalizeSkillUploadPath(value) {
  const raw = String(value || "")
    .replace(/\\+/g, "/")
    .trim()
  if (!raw || raw.startsWith("/") || raw.includes("\0")) throw uploadError("upload-path-invalid")
  const normalized = path.posix.normalize(raw)
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized.includes("/../")
  )
    throw uploadError("upload-path-forbidden")
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === ".."))
    throw uploadError("upload-path-invalid")
  if (segments.some((segment) => [".git", "node_modules", ".DS_Store"].includes(segment)))
    throw uploadError("upload-path-forbidden")
  return normalized
}

function decodeUploadFileBytes(input) {
  if (!input || typeof input !== "object") throw uploadError("upload-file-invalid")
  const base64 =
    typeof input.contentBase64 === "string" ? input.contentBase64 : typeof input.base64 === "string" ? input.base64 : ""
  if (base64) return Buffer.from(base64, "base64")
  if (typeof input.content === "string") return Buffer.from(input.content, "utf8")
  throw uploadError("upload-file-content-missing")
}

function generatedSkillJson(skill, user, uploadedAt) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    author: user.name,
    uploadedBy: user.name,
    uploadedAt,
    schemaVersion: 1,
  }
}

function parseSimpleSkillFrontmatter(markdown) {
  const match = String(markdown || "").match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const result = {}
  for (const line of match[1].split(/\r?\n/)) {
    const found = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (!found) continue
    const value = found[2].trim().replace(/^['"]|['"]$/g, "")
    result[found[1]] = value
  }
  return result
}

function safeSkillSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function uploadError(code) {
  const error = new Error(code)
  error.status = 400
  return error
}

async function createSkillArchive(sourceDir, archivePath) {
  await fsp.mkdir(path.dirname(archivePath), { recursive: true })
  const result = spawnSync("tar", ["-czf", archivePath, "-C", sourceDir, "."], { encoding: "utf8" })
  if (result.status !== 0)
    throw new Error(`skill-archive-create-failed: ${bounded(result.stderr || result.stdout || result.status)}`)
}

async function skillMarketFilesPayload(root, id) {
  const sourceDir = path.join(root, "sources", id)
  const rootPath = path.resolve(sourceDir)
  const stat = await fsp.stat(rootPath).catch(() => undefined)
  if (!stat || !stat.isDirectory()) return undefined
  const files = []
  await collectSkillSourceFiles(rootPath, rootPath, files)
  files.sort((left, right) => left.path.localeCompare(right.path))
  return files
}

async function collectSkillSourceFiles(rootPath, current, files) {
  const entries = await fsp.readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue
    const absolute = path.join(current, entry.name)
    const relative = path.relative(rootPath, absolute).replace(/\\/g, "/")
    if (entry.isDirectory()) {
      await collectSkillSourceFiles(rootPath, absolute, files)
      continue
    }
    if (!entry.isFile()) continue
    const normalized = normalizeSkillUploadPath(relative)
    const bytes = await fsp.readFile(absolute)
    files.push({ path: normalized, contentBase64: bytes.toString("base64"), sizeBytes: bytes.length })
  }
}

async function incrementSkillMarketDownloadCount(root, id) {
  const catalog = await readSkillMarketCatalogFile(root)
  const item = catalog.items.find((entry) => entry.id === id)
  if (!item) return false
  item.downloadCount = Math.max(0, Number(item.downloadCount || 0)) + 1
  item.updatedAt = item.updatedAt || new Date().toISOString()
  await writeSkillMarketCatalogFile(root, catalog.items)
  return true
}

async function starSkillMarketItem(root, id, user) {
  const catalog = await readSkillMarketCatalogFile(root)
  const item = catalog.items.find((entry) => entry.id === id)
  if (!item) return { found: false, stars: 0, starred: false }
  const stars = await readSkillMarketStars(root)
  const key = sha256Hex(user.name)
  const record = stars[id] || { users: {} }
  const already = Boolean(record.users[key])
  if (!already) record.users[key] = { name: user.name, starredAt: new Date().toISOString() }
  stars[id] = record
  item.stars = Object.keys(record.users).length
  await Promise.all([writeSkillMarketStars(root, stars), writeSkillMarketCatalogFile(root, catalog.items)])
  return { found: true, stars: item.stars, starred: true, alreadyStarred: already }
}

async function readSkillMarketCatalogFile(root) {
  const file = path.join(root, "skills.json")
  const raw = await fsp.readFile(file, "utf8").catch((error) => {
    if (error && error.code === "ENOENT") return ""
    throw error
  })
  if (!raw.trim()) return { items: [] }
  const parsed = JSON.parse(raw)
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : []
  return { items: items.filter((item) => item && typeof item === "object") }
}

async function writeSkillMarketCatalogFile(root, items) {
  await fsp.mkdir(root, { recursive: true })
  const file = path.join(root, "skills.json")
  await fsp.writeFile(file, JSON.stringify({ items }, null, 2) + "\n")
}

async function readSkillMarketStars(root) {
  const file = path.join(root, "stars.json")
  const raw = await fsp.readFile(file, "utf8").catch((error) => {
    if (error && error.code === "ENOENT") return "{}"
    throw error
  })
  const parsed = JSON.parse(raw || "{}")
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
}

async function writeSkillMarketStars(root, stars) {
  await fsp.mkdir(root, { recursive: true })
  await fsp.writeFile(path.join(root, "stars.json"), JSON.stringify(stars, null, 2) + "\n")
}

async function runChromiumMermaidRender(input) {
  const scale = clampNumber(input.scale, 1, 4, 2)
  await fsp.mkdir(input.userDataDir, { recursive: true })
  const child = spawn(
    input.browserPath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--allow-file-access-from-files",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${input.userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  let stdout = ""
  let stderr = ""
  let processError
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk)
  })
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk)
  })
  child.once("error", (error) => {
    processError = error
  })
  try {
    const wsUrl = await waitForDevtoolsWsUrl(
      child,
      () => `${stderr}\n${stdout}`,
      () => processError,
      input.timeoutMs,
    )
    const cdp = await ChromeCdpConnection.open(wsUrl)
    try {
      const target = await cdp.send("Target.createTarget", { url: input.pageUrl })
      const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })
      const sessionId = attached.sessionId
      await cdp.send("Runtime.enable", {}, sessionId)
      await cdp.send("Page.enable", {}, sessionId)
      const deadline = Date.now() + input.timeoutMs
      while (Date.now() < deadline) {
        const status = await evaluateString(
          cdp,
          sessionId,
          "document.body ? (document.body.getAttribute('data-status') || 'pending') : 'pending'",
        )
        const text = await evaluateString(cdp, sessionId, "document.body ? (document.body.textContent || '') : ''")
        if (status === "ok") {
          let bounds = await mermaidScreenshotBounds(cdp, sessionId)
          let viewportWidth = Math.min(
            12000,
            Math.max(64, Math.ceil(bounds.cropBounds.x + bounds.cropBounds.width + 4)),
          )
          let viewportHeight = Math.min(
            12000,
            Math.max(64, Math.ceil(bounds.cropBounds.y + bounds.cropBounds.height + 4)),
          )
          await cdp.send(
            "Emulation.setDeviceMetricsOverride",
            { width: viewportWidth, height: viewportHeight, deviceScaleFactor: scale, mobile: false },
            sessionId,
          )
          await sleep(100)
          bounds = await mermaidScreenshotBounds(cdp, sessionId)
          viewportWidth = Math.min(12000, Math.max(64, Math.ceil(bounds.cropBounds.x + bounds.cropBounds.width + 4)))
          viewportHeight = Math.min(12000, Math.max(64, Math.ceil(bounds.cropBounds.y + bounds.cropBounds.height + 4)))
          await cdp.send(
            "Emulation.setDeviceMetricsOverride",
            { width: viewportWidth, height: viewportHeight, deviceScaleFactor: scale, mobile: false },
            sessionId,
          )
          await sleep(50)
          const screenshot = await cdp.send(
            "Page.captureScreenshot",
            {
              format: "png",
              fromSurface: true,
              clip: {
                x: bounds.cropBounds.x,
                y: bounds.cropBounds.y,
                width: bounds.cropBounds.width,
                height: bounds.cropBounds.height,
                scale: 1,
              },
            },
            sessionId,
          )
          const bytes = Buffer.from(screenshot.data, "base64")
          const dimensions = pngDimensions(bytes)
          const issues = []
          if (bounds.contentCropRatio < 0.2) {
            issues.push({
              severity: "warning",
              code: "mermaid-render-content-bounds-suspicious",
              message: `Mermaid rendered content only occupies ${(bounds.contentCropRatio * 100).toFixed(1)}% of the cropped PNG bounds.`,
            })
          }
          return {
            bytes,
            width: bounds.cropBounds.width,
            height: bounds.cropBounds.height,
            pixelWidth: dimensions.width,
            pixelHeight: dimensions.height,
            scale,
            contentBounds: bounds.contentBounds,
            cropBounds: bounds.cropBounds,
            padding: bounds.padding,
            contentCropRatio: bounds.contentCropRatio,
            issues,
          }
        }
        if (status === "error") throw renderError("mermaid-render-failed", bounded(text))
        if (status === "timeout") throw renderError("mermaid-render-timeout", bounded(text))
        await sleep(250)
      }
      throw renderError("mermaid-render-timeout", bounded(stderr || stdout || "Chromium Mermaid render timed out."))
    } finally {
      await cdp.close().catch(() => undefined)
    }
  } finally {
    await terminateProcess(child)
  }
}

async function mermaidScreenshotBounds(cdp, sessionId) {
  const value = await evaluateJson(cdp, sessionId, mermaidBoundsExpression(32))
  if (!value || value.ok !== true || !value.cropBounds || !value.contentBounds) {
    const reason = value && value.reason ? value.reason : "Mermaid SVG bounds could not be measured."
    throw renderError("mermaid-render-failed", bounded(reason))
  }
  return {
    padding: value.padding,
    contentBounds: normalizeBounds(value.contentBounds),
    cropBounds: normalizeBounds(value.cropBounds),
    contentCropRatio: Number.isFinite(value.contentCropRatio) ? value.contentCropRatio : 1,
  }
}

function mermaidBoundsExpression(padding) {
  return `(() => {
    const pad = ${Number(padding) || 32};
    const finite = (value) => Number.isFinite(value) && value > 0;
    const bounds = (x, y, width, height) => ({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    });
    const numericAttr = (value) => {
      const match = String(value || "").match(/^-?\\d+(?:\\.\\d+)?/);
      return match ? Number(match[0]) : 0;
    };
    const host = document.getElementById("host");
    const svg = host && host.querySelector("svg");
    if (!svg) return { ok: false, reason: "Mermaid SVG was not found." };
    svg.style.maxWidth = "none";
    const viewBox = svg.viewBox && svg.viewBox.baseVal && finite(svg.viewBox.baseVal.width) && finite(svg.viewBox.baseVal.height)
      ? svg.viewBox.baseVal
      : undefined;
    const intrinsicWidth = viewBox ? viewBox.width : numericAttr(svg.getAttribute("width"));
    const intrinsicHeight = viewBox ? viewBox.height : numericAttr(svg.getAttribute("height"));
    if (finite(intrinsicWidth) && finite(intrinsicHeight)) {
      svg.setAttribute("width", String(Math.ceil(intrinsicWidth)));
      svg.setAttribute("height", String(Math.ceil(intrinsicHeight)));
      svg.style.width = Math.ceil(intrinsicWidth) + "px";
      svg.style.height = Math.ceil(intrinsicHeight) + "px";
    }
    if (host) {
      host.style.display = "inline-block";
      host.style.width = "max-content";
      host.style.height = "max-content";
    }
    document.documentElement.style.width = "max-content";
    document.documentElement.style.height = "max-content";
    document.body.style.display = "inline-block";
    document.body.style.width = "max-content";
    document.body.style.height = "max-content";
    const rect = svg.getBoundingClientRect();
    if (!finite(rect.width) || !finite(rect.height)) return { ok: false, reason: "Mermaid SVG has empty layout bounds." };
    let content = {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    };
    try {
      const bbox = svg.getBBox();
      const currentViewBox = svg.viewBox && svg.viewBox.baseVal && finite(svg.viewBox.baseVal.width) && finite(svg.viewBox.baseVal.height)
        ? svg.viewBox.baseVal
        : undefined;
      if (finite(bbox.width) && finite(bbox.height) && currentViewBox) {
        const sx = rect.width / currentViewBox.width;
        const sy = rect.height / currentViewBox.height;
        content = {
          x: rect.left + window.scrollX + ((bbox.x - currentViewBox.x) * sx),
          y: rect.top + window.scrollY + ((bbox.y - currentViewBox.y) * sy),
          width: bbox.width * sx,
          height: bbox.height * sy
        };
      }
    } catch {
      // Fall back to the SVG layout rectangle when getBBox is unavailable.
    }
    const cropLeft = Math.max(0, Math.floor(content.x - pad));
    const cropTop = Math.max(0, Math.floor(content.y - pad));
    const cropRight = Math.ceil(content.x + content.width + pad);
    const cropBottom = Math.ceil(content.y + content.height + pad);
    const crop = bounds(cropLeft, cropTop, Math.min(12000, Math.max(64, cropRight - cropLeft)), Math.min(12000, Math.max(64, cropBottom - cropTop)));
    const normalizedContent = bounds(content.x, content.y, content.width, content.height);
    const contentArea = normalizedContent.width * normalizedContent.height;
    const cropArea = crop.width * crop.height;
    return {
      ok: true,
      padding: pad,
      contentBounds: normalizedContent,
      cropBounds: crop,
      contentCropRatio: cropArea > 0 ? contentArea / cropArea : 1
    };
  })()`
}

function normalizeBounds(value) {
  return {
    x: Math.max(0, Math.round(Number(value.x) || 0)),
    y: Math.max(0, Math.round(Number(value.y) || 0)),
    width: Math.max(1, Math.round(Number(value.width) || 1)),
    height: Math.max(1, Math.round(Number(value.height) || 1)),
  }
}

async function waitForDevtoolsWsUrl(child, output, processError, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 15000)
  while (Date.now() < deadline) {
    const startupError = processError && processError()
    if (startupError) throw renderError("chromium-startup-failed", startupError.message)
    const text = output()
    const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text)
    if (match && match[1]) return match[1]
    if (child.exitCode !== null) throw renderError("chromium-startup-failed", bounded(text || `exit ${child.exitCode}`))
    await sleep(100)
  }
  throw renderError(
    "chromium-devtools-failed",
    bounded(output() || "Timed out waiting for Chromium DevTools endpoint."),
  )
}

async function evaluateString(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false }, sessionId)
  return String((result.result && result.result.value) || "")
}

async function evaluateNumber(cdp, sessionId, expression) {
  const value = Number(await evaluateString(cdp, sessionId, expression))
  return Number.isFinite(value) ? value : 0
}

async function evaluateJson(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false }, sessionId)
  return result.result && result.result.value
}

class ChromeCdpConnection {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.socket.addEventListener("message", (event) => this.handleMessage(String(event.data)))
    this.socket.addEventListener("error", () => this.rejectAll(new Error("Chromium DevTools websocket error.")))
    this.socket.addEventListener("close", () => this.rejectAll(new Error("Chromium DevTools websocket closed.")))
  }

  static async open(url) {
    const WebSocketCtor = globalThis.WebSocket || require("ws")
    const socket = new WebSocketCtor(url)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to Chromium DevTools websocket.")), 10000)
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout)
          reject(new Error("Failed to connect to Chromium DevTools websocket."))
        },
        { once: true },
      )
    })
    return new ChromeCdpConnection(socket)
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify(message))
    })
  }

  async close() {
    if (this.socket.readyState === WEBSOCKET_OPEN) {
      await this.send("Browser.close").catch(() => undefined)
    }
    if (this.socket.readyState === WEBSOCKET_CLOSED) return
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 500)
      this.socket.addEventListener(
        "close",
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      this.socket.close()
    })
    this.rejectAll(new Error("Chromium DevTools websocket closed."))
  }

  handleMessage(data) {
    const message = JSON.parse(data)
    if (message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message || "Chromium DevTools command failed."))
    else pending.resolve(message.result)
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

async function readBody(request, maxBytes) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function runCommand(command, args, timeoutMs, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve({ ok: false, message: `timed out after ${timeoutMs}ms` })
    }, timeoutMs)
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ ok: false, message: error.message })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, message: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n") || `exit ${code}` })
    })
  })
}

function decodeBase64(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`)
  const bytes = Buffer.from(value, "base64")
  if (!bytes.length) throw new Error(`${label} decoded to empty bytes`)
  return bytes
}

function safeFilename(input) {
  return (
    String(input)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 96) || "document.docx"
  )
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.floor(numeric)))
}

function pageIndex(file) {
  return Number(file.match(/page-(\d+)\.png/i)?.[1] || 0)
}

function pngDimensions(bytes) {
  if (bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  return { width: 1, height: 1 }
}

function assertPng(bytes) {
  if (!bytes || bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw renderError("png-invalid", "Mermaid renderer did not return a valid PNG.")
  }
}

function minimalVisualSummary(page, width, height) {
  return {
    page,
    width,
    height,
    totalPixels: width * height,
    inkPixels: 0,
    inkRatio: 0,
    edgeInk: { top: false, right: false, bottom: false, left: false },
  }
}

function pngVisualSummary(page, bytes, fallbackWidth, fallbackHeight) {
  try {
    const png = PNG.sync.read(bytes)
    return pixelInkSummary(page, png.width || fallbackWidth, png.height || fallbackHeight, png.data)
  } catch (error) {
    return {
      ...minimalVisualSummary(page, fallbackWidth, fallbackHeight),
      summaryError: formatError(error),
    }
  }
}

function pixelInkSummary(page, width, height, rgba) {
  const totalPixels = Math.max(0, width * height)
  let inkPixels = 0
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  const edgeSize = Math.max(2, Math.ceil(Math.min(width, height) * 0.02))
  const edgeInk = { top: false, right: false, bottom: false, left: false }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (!isInkPixel(rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3])) continue
      inkPixels += 1
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
      if (y < edgeSize) edgeInk.top = true
      if (y >= height - edgeSize) edgeInk.bottom = true
      if (x < edgeSize) edgeInk.left = true
      if (x >= width - edgeSize) edgeInk.right = true
    }
  }
  const contentBounds =
    inkPixels > 0 ? { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 } : undefined
  return {
    page,
    width,
    height,
    totalPixels,
    inkPixels,
    inkRatio: totalPixels > 0 ? inkPixels / totalPixels : 0,
    contentBounds,
    edgeInk,
  }
}

function isInkPixel(r, g, b, a) {
  if ((a ?? 255) <= 16) return false
  const red = r ?? 255
  const green = g ?? 255
  const blue = b ?? 255
  return !(red >= 246 && green >= 246 && blue >= 246)
}

function commandPath(command) {
  const result = spawnSync("/bin/sh", ["-c", 'command -v "$1"', "sh", command], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : ""
}

function commandVersion(command) {
  const pathValue = commandPath(command)
  if (!pathValue) return undefined
  const result = spawnSync(command, command === "pdftoppm" || command === "pdfinfo" ? ["-v"] : ["--version"], {
    encoding: "utf8",
  })
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim().split("\n")[0] || pathValue
}

function packageVersion(packageName) {
  try {
    return require(path.join(__dirname, "node_modules", packageName, "package.json")).version
  } catch {
    return undefined
  }
}

function renderMermaidHtml(mermaidRuntimeUrl, source) {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"/>',
    "<style>",
    "html,body{margin:0;padding:0;background:#fff;color:#111;}",
    "body{display:inline-block;min-width:64px;min-height:64px;font-family:Arial,sans-serif;}",
    "#host{display:inline-block;background:#fff;padding:24px;}",
    "#host svg{display:block;background:#fff;max-width:none;}",
    "</style>",
    '</head><body data-status="pending"><div id="host"></div>',
    '<script type="module">',
    `import mermaid from ${JSON.stringify(mermaidRuntimeUrl)};`,
    `const source = ${JSON.stringify(source)};`,
    "const host = document.getElementById('host');",
    "const fail = (status, value) => { document.body.setAttribute('data-status', status); document.body.textContent = String(value && (value.stack || value.message) || value || 'unknown error'); };",
    "const timeout = setTimeout(() => fail('timeout', 'Mermaid render timed out.'), 30000);",
    "try {",
    "  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', deterministicIds: true, fontFamily: 'Arial, sans-serif' });",
    "  const rendered = await mermaid.render('chipmate_mermaid_render', source);",
    "  host.innerHTML = rendered.svg;",
    "  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));",
    "  clearTimeout(timeout);",
    "  document.body.setAttribute('data-status', 'ok');",
    "} catch (error) {",
    "  clearTimeout(timeout);",
    "  fail('error', error);",
    "}",
    "</script></body></html>",
  ].join("")
}

function pathToFileHref(file) {
  return pathToFileURL(file).href
}

function renderError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function terminateProcess(child) {
  const waitForClose = new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve()
      return
    }
    child.once("close", resolve)
  })
  if (child.exitCode === null) child.kill("SIGTERM")
  await Promise.race([waitForClose, sleep(2000)])
  if (child.exitCode === null) {
    child.kill("SIGKILL")
    await Promise.race([waitForClose, sleep(1000)])
  }
  child.stdout.destroy()
  child.stderr.destroy()
}

function contentTypeFor(file) {
  const lower = file.toLowerCase()
  if (lower.endsWith(".json")) return "application/json; charset=utf-8"
  if (lower.endsWith(".vsix")) return "application/octet-stream"
  if (lower.endsWith(".sha256")) return "text/plain; charset=utf-8"
  if (lower.endsWith(".sh")) return "text/x-shellscript; charset=utf-8"
  if (lower.endsWith(".gz")) return "application/gzip"
  if (lower.endsWith(".tar")) return "application/x-tar"
  return "application/octet-stream"
}

function requestOrigin(request) {
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || `127.0.0.1:${PORT}`)
    .split(",")[0]
    .trim()
  const proto =
    String(request.headers["x-forwarded-proto"] || "http")
      .split(",")[0]
      .trim() || "http"
  return `${proto}://${host}`
}

function isSafeSkillId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
}

function isSafeSkillArchiveFilename(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.tar\.gz$/.test(value)
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload, null, 2)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  })
  response.end(body)
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

function bounded(input) {
  return String(input).replace(/\s+/g, " ").trim().slice(0, 2000)
}

const EXTENSION_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/

function compareExtensionVersions(left, right) {
  const leftVersion = parseExtensionVersion(left)
  const rightVersion = parseExtensionVersion(right)
  if (!leftVersion || !rightVersion) return left === right ? 0 : 1

  const coreDelta =
    leftVersion.major - rightVersion.major ||
    leftVersion.minor - rightVersion.minor ||
    leftVersion.patch - rightVersion.patch
  if (coreDelta !== 0) return coreDelta

  return comparePrereleaseIdentifiers(leftVersion.prerelease, rightVersion.prerelease)
}

function parseExtensionVersion(version) {
  const match = String(version).trim().match(EXTENSION_VERSION_PATTERN)
  if (!match) return undefined
  const prerelease = match[4] ? match[4].split(".") : []
  if (prerelease.some((identifier) => identifier.length === 0)) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  }
}

function comparePrereleaseIdentifiers(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index]
    const rightIdentifier = right[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1

    const delta = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier)
    if (delta !== 0) return delta
  }
  return 0
}

function comparePrereleaseIdentifier(left, right) {
  const leftIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(left)
  const rightIsNumeric = NUMERIC_IDENTIFIER_PATTERN.test(right)

  if (leftIsNumeric && rightIsNumeric) return Number(left) - Number(right)
  if (leftIsNumeric !== rightIsNumeric) return leftIsNumeric ? -1 : 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

module.exports = {
  compareExtensionVersions,
  contentTypeFor,
  createTokenResolverState,
  generateSkillMarketCatalog,
  generatePackageManifest,
  publishSkillMarketUpload,
  skillMarketFilesPayload,
  starSkillMarketItem,
  healthPayload,
  normalizeNewApiKey,
  packageEntryFromVsix,
  readVsixExtensionManifest,
  resolveNewApiUser,
  server,
}
