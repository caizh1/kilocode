"use strict"

const http = require("node:http")
const crypto = require("node:crypto")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { spawn, spawnSync } = require("node:child_process")
const { pathToFileURL } = require("node:url")
const zlib = require("node:zlib")
const JSZip = require("jszip")
const yauzl = require("yauzl")
const { PNG } = require("pngjs")

const PORT = Number(process.env.PORT || 6001)
const PACKAGE_ROOT = process.env.PACKAGE_ROOT || "/packages"
const SKILL_MARKET_ROOT = process.env.SKILL_MARKET_ROOT || path.join(PACKAGE_ROOT, "skill-market")
const UPDATE_EXTENSION_ID = "chipmate.chipmate"
const UPDATE_TARGETS = new Set(["win32-x64-baseline", "linux-x64-baseline", "darwin-x64", "darwin-arm64"])
const MAX_VSIX_MANIFEST_BYTES = 2 * 1024 * 1024
const VSIX_MANIFEST_ENTRY = "extension/package.json"
const packageEntryCache = new Map()
const packageEntryInflight = new Map()
const packageManifestCache = new Map()
const packageManifestInflight = new Map()
const PACKAGE_FINGERPRINT = Symbol("packageFingerprint")
const NEW_API_TOKEN_NAME_SUFFIX = process.env.NEW_API_TOKEN_NAME_SUFFIX || "@chipmate"
const NEW_API_TOKEN_CACHE_TTL_MS = Number(process.env.NEW_API_TOKEN_CACHE_TTL_MS || 5 * 60 * 1000)
const NEW_API_TOKEN_PAGE_SIZE = Number(process.env.NEW_API_TOKEN_PAGE_SIZE || 100)
const NEW_API_TOKEN_MAX_PAGES = Number(process.env.NEW_API_TOKEN_MAX_PAGES || 50)
const MAX_SKILL_UPLOAD_FILES = Number(process.env.MAX_SKILL_UPLOAD_FILES || 500)
const MAX_SKILL_UPLOAD_TOTAL_BYTES = Number(process.env.MAX_SKILL_UPLOAD_TOTAL_BYTES || 50 * 1024 * 1024)
const MAX_SKILL_UPLOAD_FILE_BYTES = Number(process.env.MAX_SKILL_UPLOAD_FILE_BYTES || 10 * 1024 * 1024)
const MAX_DOCX_BYTES = Number(process.env.MAX_DOCX_BYTES || 50 * 1024 * 1024)
const MAX_MERMAID_SOURCE_BYTES = Number(process.env.MAX_MERMAID_SOURCE_BYTES || 512 * 1024)
const MAX_PLANTUML_SOURCE_BYTES = Number(process.env.MAX_PLANTUML_SOURCE_BYTES || 128 * 1024)
const MAX_PLANTUML_PNG_BYTES = Number(process.env.MAX_PLANTUML_PNG_BYTES || 16 * 1024 * 1024)
const MAX_PLANTUML_DIMENSION = Number(process.env.MAX_PLANTUML_DIMENSION || 4096)
const MAX_PLANTUML_CONCURRENCY = Number(process.env.MAX_PLANTUML_CONCURRENCY || 2)
const MAX_PLANTUML_QUEUE = Number(process.env.MAX_PLANTUML_QUEUE || 16)
const PLANTUML_JAR = process.env.PLANTUML_JAR || "/app/plantuml-asl.jar"
const PLANTUML_VERSION = process.env.PLANTUML_VERSION || ""
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 120000)
const MAX_RESPONSE_PAGE_BYTES = Number(process.env.MAX_RESPONSE_PAGE_BYTES || 16 * 1024 * 1024)
const MAX_WORD_RENDER_PAGES = Number(process.env.MAX_WORD_RENDER_PAGES || 500)
const MAX_RENDER_PDF_BYTES = Number(process.env.MAX_RENDER_PDF_BYTES || 128 * 1024 * 1024)
const MAX_RENDER_PAGE_TOTAL_BYTES = Number(process.env.MAX_RENDER_PAGE_TOTAL_BYTES || 256 * 1024 * 1024)
const MAX_RENDER_RESPONSE_BYTES = Number(process.env.MAX_RENDER_RESPONSE_BYTES || 384 * 1024 * 1024)
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBSOCKET_OPEN = 1
const WEBSOCKET_CLOSED = 3
const defaultTokenResolverState = createTokenResolverState()
const plantumlSlots = { active: 0, queue: [] }

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
    if (request.method === "POST" && request.url === "/render/plantuml") {
      await handleRenderPlantUml(request, response)
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
  const maxPages = clampNumber(payload.maxPages, 1, MAX_WORD_RENDER_PAGES, MAX_WORD_RENDER_PAGES)
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "chipmate-word-render-"))
  const inDir = path.join(tempRoot, "in")
  const refreshDir = path.join(tempRoot, "refreshed")
  const outDir = path.join(tempRoot, "out")
  const pagesDir = path.join(tempRoot, "pages")
  const profileDir = path.join(tempRoot, "lo-profile")
  const refreshProfileDir = path.join(tempRoot, "lo-refresh-profile")
  const homeDir = path.join(tempRoot, "home")
  try {
    await Promise.all(
      [inDir, refreshDir, outDir, pagesDir, profileDir, refreshProfileDir, homeDir].map((dir) =>
        fsp.mkdir(dir, { recursive: true }),
      ),
    )
    const docxPath = path.join(inDir, filename)
    await fsp.writeFile(docxPath, docxBytes)

    const sofficePath = commandPath("soffice") || commandPath("libreoffice") || "soffice"
    const refreshedPath = path.join(refreshDir, filename)
    const source = await inspectWordDocx(docxBytes)
    if (!source.valid) throw new Error("DOCX does not contain readable word/document.xml and word/styles.xml parts.")
    const refresh = await refreshWordFields({
      docxPath,
      refreshedPath,
      profileDir: refreshProfileDir,
      sofficePath,
      timeoutMs,
      source,
    })
    const renderPath = refresh.ok ? refreshedPath : docxPath
    const issues = []
    if (refresh.status === "failed") {
      issues.push({
        severity: "warning",
        code: "word-field-refresh-failed",
        message: `LibreOffice UNO field refresh failed semantic validation; rendered the original document: ${refresh.diagnostics.join("; ")}`,
      })
    }
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
        renderPath,
      ],
      timeoutMs,
      { HOME: homeDir },
    )
    if (!convertResult.ok) throw new Error(`LibreOffice failed: ${convertResult.message}`)

    const pdfPath = path.join(outDir, `${path.basename(filename, ".docx")}.pdf`)
    const pdfStat = await fsp.stat(pdfPath).catch(() => undefined)
    if (!pdfStat || pdfStat.size <= 0) throw new Error("LibreOffice did not produce a readable PDF.")

    const pdfinfoPath = commandPath("pdfinfo") || "pdfinfo"
    const pdfinfo = await runCommand(pdfinfoPath, [pdfPath], timeoutMs)
    const exactPageCount = pdfinfo.ok ? pdfInfoPageCount(pdfinfo.stdout) : undefined
    const pdftoppmPath = commandPath("pdftoppm") || "pdftoppm"
    const prefix = path.join(pagesDir, "page")
    const upper = exactPageCount ? Math.min(exactPageCount, maxPages) : maxPages + 1
    const pngResult = await runCommand(
      pdftoppmPath,
      ["-png", "-r", "144", "-f", "1", "-l", String(upper), pdfPath, prefix],
      timeoutMs,
    )
    if (!pngResult.ok) throw new Error(`pdftoppm failed: ${pngResult.message}`)

    const renderedPageFiles = (await fsp.readdir(pagesDir))
      .filter((entry) => /^page-\d+\.png$/i.test(entry))
      .sort((left, right) => pageIndex(left) - pageIndex(right))
    if (renderedPageFiles.length === 0) throw new Error("pdftoppm completed but produced no page PNG files.")
    const overflow = exactPageCount ? exactPageCount > maxPages : renderedPageFiles.length > maxPages
    const pageFiles = renderedPageFiles.slice(0, maxPages)
    const pageCount = exactPageCount ?? (overflow ? maxPages + 1 : pageFiles.length)
    const pageCountKind = exactPageCount ? "exact" : overflow ? "lower-bound" : "exact"

    const pdfBytes = await fsp.readFile(pdfPath)
    if (pdfBytes.length > MAX_RENDER_PDF_BYTES)
      throw httpRenderError(413, "word-render-pdf-too-large", `PDF exceeds ${MAX_RENDER_PDF_BYTES} bytes`)
    const pdftotextPath = commandPath("pdftotext") || "pdftotext"
    const extracted = await runCommand(pdftotextPath, ["-layout", "-enc", "UTF-8", pdfPath, "-"], timeoutMs)
    const textQa = wordPdfTextQa(refresh.ok ? refresh.inspection : source, extracted)
    if (!textQa.ok) {
      issues.push({
        severity: "error",
        code: "word-render-text-loss-suspected",
        message: textQa.diagnostics.join("; "),
      })
    }
    const pages = []
    let totalPageBytes = 0
    for (const file of pageFiles) {
      const absolute = path.join(pagesDir, file)
      const pngBytes = await fsp.readFile(absolute)
      if (pngBytes.length > MAX_RESPONSE_PAGE_BYTES) throw new Error(`${file} exceeds ${MAX_RESPONSE_PAGE_BYTES} bytes`)
      totalPageBytes += pngBytes.length
      if (totalPageBytes > MAX_RENDER_PAGE_TOTAL_BYTES)
        throw httpRenderError(
          413,
          "word-render-pages-too-large",
          `Page PNG payloads exceed ${MAX_RENDER_PAGE_TOTAL_BYTES} bytes`,
        )
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

    if (overflow)
      issues.push({
        severity: "warning",
        code: "page-count-exceeds-limit",
        message: `PDF has ${pageCountKind === "exact" ? pageCount : `at least ${pageCount}`} pages; returned the first ${pages.length} because maxPages is ${maxPages}.`,
      })
    const responseBytes = base64Size(pdfBytes.length) + base64Size(totalPageBytes) + (refresh.ok ? base64Size(refresh.bytes.length) : 0)
    if (responseBytes > MAX_RENDER_RESPONSE_BYTES)
      throw httpRenderError(
        413,
        "word-render-response-too-large",
        `Encoded render response exceeds ${MAX_RENDER_RESPONSE_BYTES} bytes`,
      )

    sendJson(response, 200, {
      ok: true,
      pageCount,
      returnedPageCount: pages.length,
      pageCountKind,
      fieldRefreshStatus: refresh.status,
      fieldRefreshDiagnostics: refresh.diagnostics,
      tocHeadingCount: source.headingCount,
      tocEntryCount: refresh.inspection.tocEntryCount,
      tocPageNumberCount: refresh.inspection.tocPageNumberCount,
      ...(refresh.ok ? { updatedDocxBase64: refresh.bytes.toString("base64") } : {}),
      pdf: { contentType: "application/pdf", base64: pdfBytes.toString("base64") },
      pages,
      issues,
      textQa,
      renderer: {
        kind: "remote-opencode",
        docxToPdf: "libreoffice",
        pdfToPng: "pdftoppm",
        wordFieldRefresh: refresh.ok ? "libreoffice" : refresh.status,
        fieldRefreshStatus: refresh.status,
        sofficePath,
        pdftoppmPath,
        pdfinfoPath,
        pdftotextPath,
      },
    })
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function refreshWordFields(opts) {
  if (!opts.source.hasToc) {
    return {
      ok: false,
      status: "not-required",
      bytes: undefined,
      diagnostics: ["document has no native TOC field or TOC gallery part"],
      inspection: opts.source,
    }
  }

  const python = process.env.PYTHON_UNO_BIN || commandPath("python3")
  const script = path.join(__dirname, "scripts", "refresh-word-fields.py")
  if (!python) return failedRefresh(opts.source, "python3 with python3-uno is unavailable")
  const scriptStat = await fsp.stat(script).catch(() => undefined)
  if (!scriptStat?.isFile()) return failedRefresh(opts.source, `UNO refresh script is missing: ${script}`)
  const result = await runCommand(
    python,
    [
      script,
      "--input",
      opts.docxPath,
      "--output",
      opts.refreshedPath,
      "--profile",
      opts.profileDir,
      "--soffice",
      opts.sofficePath,
      "--timeout",
      String(Math.max(5, Math.floor(opts.timeoutMs / 1000) - 2)),
    ],
    opts.timeoutMs,
  )
  if (!result.ok) return failedRefresh(opts.source, result.message)
  const bytes = await fsp.readFile(opts.refreshedPath).catch(() => undefined)
  if (!bytes) return failedRefresh(opts.source, "UNO completed without producing a refreshed DOCX")
  const verified = await verifyRefreshedWordDocx(opts.source, bytes)
  if (!verified.ok) return { ...verified, status: "failed", bytes: undefined }
  return { ...verified, status: "completed", bytes }
}

function failedRefresh(source, message) {
  return {
    ok: false,
    status: "failed",
    bytes: undefined,
    diagnostics: [bounded(message)],
    inspection: source,
  }
}

async function verifyRefreshedWordDocx(source, bytes) {
  const refreshed = await inspectWordDocx(bytes)
  const diagnostics = []
  if (!refreshed.valid) diagnostics.push("refreshed DOCX is structurally invalid")
  if (!refreshed.hasToc) diagnostics.push("native TOC field or TOC gallery part disappeared during refresh")
  if (source.headingCount <= 0) diagnostics.push("source native TOC has no Heading 1-3 denominator")
  if (source.titleCount !== 1 || !source.titles[0]) diagnostics.push("source DOCX must contain exactly one non-empty Title")
  if (!sameJson(source.manifest.body, refreshed.manifest.body))
    diagnostics.push("non-TOC body paragraph sequence changed during refresh")
  if (!sameJson(source.manifest.tables, refreshed.manifest.tables))
    diagnostics.push("table geometry or cell text changed during refresh")
  if (!sameJson(source.manifest.images, refreshed.manifest.images))
    diagnostics.push("drawing identity, placement, alt text, or media changed during refresh")
  if (!sameJson(source.manifest.controls, refreshed.manifest.controls))
    diagnostics.push("content-control text or identity changed during refresh")
  if (!sameJson(source.manifest.headers, refreshed.manifest.headers) || !sameJson(source.manifest.footers, refreshed.manifest.footers))
    diagnostics.push("header or footer semantic text changed during refresh")
  if (!sameStrings(source.titles, refreshed.titles)) diagnostics.push("title text or order changed during refresh")
  if (!sameStrings(source.headings, refreshed.headings)) diagnostics.push("Heading 1-3 text or order changed during refresh")
  if (!sameTocHeadings(source.headings, refreshed.tocEntries.map((item) => item.text)))
    diagnostics.push("TOC entries do not exactly match Heading 1-3 text and order")
  if (refreshed.tocEntryCount !== source.headingCount)
    diagnostics.push(`TOC entry count ${refreshed.tocEntryCount} does not match Heading 1-3 count ${source.headingCount}`)
  if (refreshed.tocPageNumberCount !== refreshed.tocEntryCount)
    diagnostics.push(
      `TOC page-number count ${refreshed.tocPageNumberCount} does not match entry count ${refreshed.tocEntryCount}`,
    )
  return { ok: diagnostics.length === 0, diagnostics, inspection: refreshed }
}

async function inspectWordDocx(bytes) {
  try {
    const zip = await JSZip.loadAsync(bytes)
    const documentPart = zip.file("word/document.xml")
    const stylesPart = zip.file("word/styles.xml")
    if (!documentPart || !stylesPart) return invalidWordInspection()
    const [documentXml, stylesXml] = await Promise.all([documentPart.async("string"), stylesPart.async("string")])
    const styles = wordStyles(stylesXml)
    const paragraphs = wordParagraphs(documentXml, styles)
    const headings = paragraphs.filter((item) => item.kind === "heading").map((item) => item.text)
    const titles = paragraphs.filter((item) => item.kind === "title").map((item) => item.text)
    const toc = paragraphs.filter((item) => item.kind === "toc")
    const tocEntries = toc.map((item) => {
      const match = item.text.match(/^(.*?)(?:\t|\s)+(\d+)\s*$/u)
      return { text: normalizeWordText(match?.[1] || item.text), page: match ? Number(match[2]) : 0 }
    })
    const manifest = {
      body: paragraphs
        .filter((item) => item.kind !== "toc" && item.text && !onlyMutableWordField(item.xml, item.text))
        .map((item) => ({ kind: item.kind, text: normalizeWordText(item.text) })),
      tables: wordTables(documentXml),
      images: await wordImages(zip, documentXml, styles),
      controls: wordControls(documentXml),
      headers: await wordPartText(zip, "word/header"),
      footers: await wordPartText(zip, "word/footer"),
    }
    return {
      valid: true,
      hasToc:
        /<w:instrText\b[^>]*>[^<]*\bTOC\b[^<]*<\/w:instrText>/i.test(documentXml) ||
        /<w:fldSimple\b[^>]*w:instr=(?:"[^"]*\bTOC\b[^"]*"|'[^']*\bTOC\b[^']*')/i.test(documentXml) ||
        /<w:docPartGallery\b[^>]*w:val=(?:"Table of Contents"|'Table of Contents')/i.test(documentXml),
      headingCount: headings.length,
      headings,
      titles,
      titleCount: titles.length,
      drawingCount: manifest.images.length,
      tocEntryCount: toc.length,
      tocPageNumberCount: toc.filter((item) => item.hasPageNumber).length,
      tocEntries,
      manifest,
      text: paragraphs.map((item) => item.text).join("\n"),
    }
  } catch (error) {
    return { ...invalidWordInspection(), error: formatError(error) }
  }
}

function invalidWordInspection() {
  return {
    valid: false,
    hasToc: false,
    headingCount: 0,
    headings: [],
    titles: [],
    titleCount: 0,
    drawingCount: 0,
    tocEntryCount: 0,
    tocPageNumberCount: 0,
    tocEntries: [],
    manifest: { body: [], tables: [], images: [], controls: [], headers: [], footers: [] },
    text: "",
  }
}

function wordPdfTextQa(source, result) {
  const pages = cleanPdfTextPages(result.ok ? result.stdout : "")
  const text = normalizeWordText(pages.join("\n"))
  const title = source.titles[0] || ""
  const heading = source.headings[0] || ""
  const sourceCjkCount = cjkCount(source.text)
  const pdfCjkCount = cjkCount(text)
  const cjkCoverage = sourceCjkCount > 0 ? Math.min(1, pdfCjkCount / sourceCjkCount) : 1
  const titlePresent = source.titleCount === 1 && Boolean(title) && normalizeWordText(pages[0] || "").includes(normalizeWordText(title))
  const entry = source.tocEntries.find((item) => item.text === heading)
  const firstHeadingPresent = Boolean(
    heading && entry?.page && pages[entry.page - 1] && normalizeWordText(pages[entry.page - 1]).includes(normalizeWordText(heading)),
  )
  const sentinels = wordQaSentinels(source)
  const matchedSentinelCount = sentinels.filter((item) => text.includes(item)).length
  const sentinelCoverage = sentinels.length > 0 ? matchedSentinelCount / sentinels.length : 1
  const diagnostics = []
  if (!result.ok) diagnostics.push(`pdftotext failed: ${result.message}`)
  if (source.titleCount !== 1) diagnostics.push("source DOCX must contain exactly one non-empty Title")
  if (!titlePresent) diagnostics.push("document title is missing from the first-page body region")
  if (!entry?.page) diagnostics.push("first Heading has no materialized TOC page mapping")
  if (!firstHeadingPresent) diagnostics.push("first Heading is missing from its TOC-mapped body page")
  if (sourceCjkCount >= 10 && cjkCoverage < 0.5)
    diagnostics.push(`rendered CJK coverage ${cjkCoverage.toFixed(3)} is below 0.500`)
  if (sentinels.length >= 3 && sentinelCoverage < 0.8)
    diagnostics.push(`rendered sentinel coverage ${sentinelCoverage.toFixed(3)} is below 0.800`)
  return {
    ok: diagnostics.length === 0,
    titlePresent,
    firstHeadingPresent,
    sourceCjkCount,
    pdfCjkCount,
    cjkCoverage,
    sentinelCount: sentinels.length,
    matchedSentinelCount,
    sentinelCoverage,
    diagnostics,
  }
}

function cleanPdfTextPages(output) {
  const pages = String(output).split("\f").filter((page, index, all) => page.trim() || index < all.length - 1)
  const lines = pages.map((page) => page.split(/\r?\n/).map(normalizeWordText).filter(Boolean))
  const counts = new Map()
  for (const page of lines) {
    const boundary = [...page.slice(0, 2), ...page.slice(-2)]
    for (const line of new Set(boundary)) counts.set(line, (counts.get(line) || 0) + 1)
  }
  const threshold = Math.max(2, Math.ceil(lines.length * 0.6))
  const repeated = new Set([...counts.entries()].filter(([, count]) => count >= threshold).map(([line]) => line))
  return lines.map((page) => {
    const removed = new Set()
    return page
      .filter((line) => {
        if (!repeated.has(line) || removed.has(line)) return true
        removed.add(line)
        return false
      })
      .join("\n")
  })
}

function wordQaSentinels(source) {
  const body = source.manifest.body.map((item) => item.text).filter((item) => item.length >= 8)
  const samples = body.length
    ? [body[0], body[Math.floor(body.length / 2)], body[body.length - 1]].filter(Boolean)
    : []
  return [...new Set([...source.headings, ...samples].map(normalizeWordText).filter(Boolean))]
}

function normalizeWordText(value) {
  return String(value).normalize("NFKC").replace(/\s+/gu, " ").trim()
}

function cjkCount(value) {
  return (String(value).match(/[\u3400-\u4dbf\u4e00-\u9fff]/gu) || []).length
}

function wordStyles(xml) {
  const styles = new Map()
  for (const match of xml.matchAll(/<w:style\b[^>]*w:styleId=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/w:style>/gi)) {
    const block = match[0]
    const id = decodeXml(match[1] || match[2] || "")
    const name = decodeXml(wordAttribute(block, "name", "val") || id)
    const outlineValue = wordAttribute(block, "outlineLvl", "val")
    const outline = outlineValue === "" ? undefined : Number(outlineValue)
    const label = `${id} ${name}`.trim()
    const title = /^(?:title|标题)$/i.test(name.trim()) || /^(?:title|标题)$/i.test(id.trim())
    const tocMatch = label.match(/(?:^|\s)(?:toc|contents|目录)\s*([1-3])(?:\s|$)/i)
    const headingMatch = label.match(/(?:^|\s)(?:heading|标题)\s*([1-3])(?:\s|$)/i)
    const level =
      title || tocMatch
        ? undefined
        : headingMatch
          ? Number(headingMatch[1])
          : Number.isInteger(outline) && outline >= 0 && outline <= 2
            ? outline + 1
            : undefined
    styles.set(id, { title, toc: Boolean(tocMatch), level })
  }
  return styles
}

function wordParagraphs(xml, styles) {
  const paragraphs = []
  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gi)) {
    const block = match[0]
    const style = wordAttribute(block, "pStyle", "val") || ""
    const info = styles.get(style) || {}
    const text = wordText(block).trim()
    if (!text) continue
    const hasTab = /<w:(?:tab|ptab)\b/i.test(block)
    paragraphs.push({
      xml: block,
      style,
      text,
      kind: info.title ? "title" : info.toc ? "toc" : info.level ? "heading" : "body",
      hasPageNumber: Boolean(info.toc && hasTab && /(?:^|\s|\t)\d+\s*$/u.test(text)),
    })
  }
  return paragraphs
}

function wordTables(xml) {
  return [...xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/gi)].map((table) =>
    [...table[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gi)].map((row) =>
      [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gi)].map((cell) => normalizeWordText(wordText(cell[0]))),
    ),
  )
}

function wordControls(xml) {
  return [...xml.matchAll(/<w:sdt\b[\s\S]*?<\/w:sdt>/gi)]
    .filter((match) => !hasNativeTocMarkup(match[0]))
    .map((match) => ({
      tag: wordAttribute(match[0], "tag", "val") || undefined,
      title: wordAttribute(match[0], "alias", "val") || undefined,
      text: normalizeWordText(wordText(match[0])),
    }))
}

function hasNativeTocMarkup(xml) {
  return (
    /<w:instrText\b[^>]*>[^<]*\bTOC\b[^<]*<\/w:instrText>/i.test(xml) ||
    /<w:fldSimple\b[^>]*w:instr=(?:"[^"]*\bTOC\b[^"]*"|'[^']*\bTOC\b[^']*')/i.test(xml) ||
    /<w:docPartGallery\b[^>]*w:val=(?:"Table of Contents"|'Table of Contents')/i.test(xml)
  )
}

function sameTocHeadings(expected, actual) {
  return expected.length === actual.length && expected.every((value, index) => {
    const heading = normalizeWordText(value)
    const entry = normalizeWordText(actual[index] || "")
    return heading === entry || heading === tocHeadingText(entry)
  })
}

function tocHeadingText(value) {
  return normalizeWordText(value).replace(/^\d+(?:[.\-]\d+)*(?:[.)、．])?\s*/u, "")
}

async function wordPartText(zip, prefix) {
  const result = []
  for (const part of Object.values(zip.files).filter((item) => !item.dir && item.name.startsWith(prefix) && item.name.endsWith(".xml"))) {
    const xml = await part.async("string")
    result.push(normalizeWordText(wordText(xml).replace(/\b\d+\b/g, "")))
  }
  return result
}

async function wordImages(zip, xml, styles) {
  const relsPart = zip.file("word/_rels/document.xml.rels")
  const relsXml = relsPart ? await relsPart.async("string") : ""
  const rels = new Map(
    [...relsXml.matchAll(/<Relationship\b[^>]*Type="[^"]*\/image"[^>]*>/gi)].map((match) => [
      match[0].match(/\bId="([^"]+)"/)?.[1] || "",
      match[0].match(/\bTarget="([^"]+)"/)?.[1] || "",
    ]),
  )
  const blocks = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gi)].map((match) => {
    const block = match[0]
    const style = wordAttribute(block, "pStyle", "val") || ""
    return { xml: block, text: normalizeWordText(wordText(block)), style, info: styles.get(style) || {} }
  })
  const headingPath = []
  const paths = []
  for (const block of blocks) {
    if (block.info.level && block.text) {
      headingPath[block.info.level - 1] = block.text
      headingPath.length = block.info.level
    }
    paths.push([...headingPath])
  }
  const images = []
  for (const [index, block] of blocks.entries()) {
    for (const drawing of block.xml.matchAll(/<w:drawing\b(?:[^>]*\/>|[\s\S]*?<\/w:drawing>)/gi)) {
      const relId = drawing[0].match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1] || ""
      const target = rels.get(relId) || ""
      const clean = target.replace(/^\.\.\//, "").replace(/^\//, "")
      const media = clean.startsWith("word/") ? clean : `word/${clean}`
      const part = zip.file(media)
      const bytes = part ? await part.async("nodebuffer") : undefined
      const alt = drawing[0].match(/<wp:docPr\b[^>]*(?:descr|title)="([^"]*)"/)?.[1]
      const previous = blocks[index - 1]
      const next = blocks[index + 1]
      images.push({
        headingPath: paths[index],
        title: previous?.style === "Caption" ? previous.text : undefined,
        caption: next?.style === "Caption" ? next.text : undefined,
        altText: alt ? decodeXml(alt) : undefined,
        sha256: bytes ? crypto.createHash("sha256").update(bytes).digest("hex") : undefined,
      })
    }
  }
  return images
}

function onlyMutableWordField(xml, text) {
  return /<w:instrText\b[^>]*>[^<]*(?:PAGE|NUMPAGES|SEQ)[^<]*<\/w:instrText>/i.test(xml) && /^\d+$/u.test(text)
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function wordAttribute(xml, element, attribute) {
  const match = xml.match(
    new RegExp(`<w:${element}\\b[^>]*w:${attribute}=(?:"([^"]*)"|'([^']*)')`, "i"),
  )
  return match ? match[1] || match[2] || "" : ""
}

function wordText(xml) {
  const parts = []
  for (const match of xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(?:tab|ptab)\b[^>]*\/>/gi)) {
    parts.push(match[1] === undefined ? "\t" : decodeXml(match[1]))
  }
  return parts.join("").replace(/\u00a0/g, " ")
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
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

async function handleRenderPlantUml(request, response) {
  const startedAt = Date.now()
  const timeoutMs = clampNumber(undefined, 5000, 60000, 60000)
  try {
    const payload = JSON.parse(await readBody(request, MAX_PLANTUML_SOURCE_BYTES + 4096))
    const source = normalizePlantUmlSource(typeof payload.source === "string" ? payload.source : "")
    if (!source) throw renderError("plantuml-source-empty", "source is required")
    if (Buffer.byteLength(source, "utf8") > MAX_PLANTUML_SOURCE_BYTES) {
      throw renderError(
        "plantuml-source-too-large",
        `source exceeds ${MAX_PLANTUML_SOURCE_BYTES} bytes`,
      )
    }
    assertSinglePlantUml(source)
    const requested = clampNumber(payload.timeoutMs, 5000, 60000, timeoutMs)
    const bytes = await withPlantUmlSlot(requested, (remaining) => renderPlantUml(source, remaining))
    assertPng(bytes)
    if (bytes.length > MAX_PLANTUML_PNG_BYTES) {
      throw renderError("plantuml-png-too-large", `PNG exceeds ${MAX_PLANTUML_PNG_BYTES} bytes`)
    }
    const dimensions = pngDimensions(bytes)
    if (
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > MAX_PLANTUML_DIMENSION ||
      dimensions.height > MAX_PLANTUML_DIMENSION
    ) {
      throw renderError(
        "plantuml-dimensions-invalid",
        `PNG dimensions ${dimensions.width}x${dimensions.height} exceed ${MAX_PLANTUML_DIMENSION}`,
      )
    }
    const metadata = extractPlantUmlMetadata(bytes, MAX_PLANTUML_SOURCE_BYTES)
    if (!metadata || normalizePlantUmlSource(metadata.source) !== source) {
      throw renderError("plantuml-metadata-mismatch", "Generated PNG did not preserve the requested PlantUML source.")
    }
    sendJson(response, 200, {
      ok: true,
      png: { contentType: "image/png", base64: bytes.toString("base64") },
      width: dimensions.width,
      height: dimensions.height,
      issues: [],
      elapsedMs: Date.now() - startedAt,
      metadata: {
        format: "png-itxt",
        keyword: "plantuml",
        version: metadata.version,
        verified: true,
      },
      renderer: {
        kind: "remote-opencode",
        diagramToPng: "plantuml-java",
        plantumlVersion: plantUmlVersion(),
        javaPath: commandPath("java") || "java",
        graphvizPath: commandPath("dot") || undefined,
        securityProfile: "SANDBOX",
      },
    })
  } catch (error) {
    const code =
      error && typeof error === "object" && typeof error.code === "string" ? error.code : "plantuml-render-failed"
    sendJson(response, 200, {
      ok: false,
      issues: [{ severity: "error", code, message: formatError(error) }],
      elapsedMs: Date.now() - startedAt,
      renderer: {
        kind: "remote-opencode",
        diagramToPng: "plantuml-java",
        plantumlVersion: plantUmlVersion(),
        securityProfile: "SANDBOX",
      },
    })
  }
}

async function withPlantUmlSlot(timeoutMs, task) {
  const started = Date.now()
  const release = await acquirePlantUmlSlot(timeoutMs)
  try {
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0) throw renderError("plantuml-render-timeout", `timed out after ${timeoutMs}ms`)
    return await task(remaining)
  } finally {
    release()
  }
}

function acquirePlantUmlSlot(timeoutMs) {
  if (plantumlSlots.active < MAX_PLANTUML_CONCURRENCY) {
    plantumlSlots.active += 1
    return Promise.resolve(releasePlantUmlSlot)
  }
  if (plantumlSlots.queue.length >= MAX_PLANTUML_QUEUE) {
    throw renderError("plantuml-render-busy", "PlantUML renderer queue is full.")
  }
  return new Promise((resolve, reject) => {
    const entry = {
      resolve,
      timer: setTimeout(() => {
        const index = plantumlSlots.queue.indexOf(entry)
        if (index >= 0) plantumlSlots.queue.splice(index, 1)
        reject(renderError("plantuml-render-timeout", `timed out after ${timeoutMs}ms`))
      }, timeoutMs),
    }
    plantumlSlots.queue.push(entry)
  })
}

function releasePlantUmlSlot() {
  const next = plantumlSlots.queue.shift()
  if (next) {
    clearTimeout(next.timer)
    next.resolve(releasePlantUmlSlot)
    return
  }
  plantumlSlots.active = Math.max(0, plantumlSlots.active - 1)
}

function renderPlantUml(source, timeoutMs) {
  return new Promise((resolve, reject) => {
    const java = commandPath("java") || "java"
    if (!fs.existsSync(PLANTUML_JAR)) {
      reject(renderError("plantuml-runtime-missing", `PlantUML runtime missing: ${PLANTUML_JAR}`))
      return
    }
    const child = spawn(
      java,
      [
        "-DPLANTUML_SECURITY_PROFILE=SANDBOX",
        `-DPLANTUML_LIMIT_SIZE=${MAX_PLANTUML_DIMENSION}`,
        "-Xmx512m",
        "-jar",
        PLANTUML_JAR,
        "--pipe",
        "--format",
        "png",
        "--no-error-image",
        "--stop-on-error",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: plantUmlEnv(),
      },
    )
    const out = []
    const err = []
    let size = 0
    let settled = false
    let overflow = false
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      killProcessTree(child)
      finish(() => reject(renderError("plantuml-render-timeout", `timed out after ${timeoutMs}ms`)))
    }, timeoutMs)
    child.stdout.on("data", (chunk) => {
      if (overflow) return
      size += chunk.length
      if (size > MAX_PLANTUML_PNG_BYTES) {
        overflow = true
        killProcessTree(child)
        return
      }
      out.push(chunk)
    })
    child.stderr.on("data", (chunk) => {
      const used = err.reduce((total, item) => total + item.length, 0)
      if (used < 64 * 1024) err.push(chunk.subarray(0, 64 * 1024 - used))
    })
    child.once("error", (error) => {
      finish(() => reject(renderError("plantuml-render-failed", error.message)))
    })
    child.stdin.on("error", (error) => {
      if (error && error.code === "EPIPE") return
      finish(() => reject(renderError("plantuml-render-failed", formatError(error))))
    })
    child.once("close", (code) => {
      if (overflow) {
        finish(() =>
          reject(renderError("plantuml-png-too-large", `PNG exceeds ${MAX_PLANTUML_PNG_BYTES} bytes`)),
        )
        return
      }
      if (code !== 0) {
        const detail = bounded(Buffer.concat(err).toString("utf8") || `PlantUML exited with code ${code}`)
        finish(() => reject(renderError("plantuml-syntax-error", detail)))
        return
      }
      finish(() => resolve(Buffer.concat(out)))
    })
    child.stdin.end(`${source}\n`)
  })
}

function plantUmlEnv() {
  const locale = process.env.LC_ALL || process.env.LANG || "C.UTF-8"
  return {
    HOME: os.tmpdir(),
    LANG: process.env.LANG || locale,
    LC_ALL: locale,
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    PLANTUML_LIMIT_SIZE: String(MAX_PLANTUML_DIMENSION),
    PLANTUML_SECURITY_PROFILE: "SANDBOX",
    TMPDIR: os.tmpdir(),
    ...(process.env.JAVA_HOME ? { JAVA_HOME: process.env.JAVA_HOME } : {}),
  }
}

function killProcessTree(child) {
  if (child.killed) return
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL")
      return
    } catch (error) {
      if (!error || error.code !== "ESRCH") console.warn(`Failed to kill PlantUML process group: ${formatError(error)}`)
    }
  }
  child.kill("SIGKILL")
}

function assertSinglePlantUml(source) {
  const starts = [...source.matchAll(/@startuml\b/gi)]
  const ends = [...source.matchAll(/@enduml\b/gi)]
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index !== 0) {
    throw renderError("plantuml-source-invalid", "source must contain exactly one @startuml/@enduml diagram")
  }
  const finish = (ends[0].index || 0) + ends[0][0].length
  if (source.slice(finish).trim()) {
    throw renderError("plantuml-source-invalid", "source must end after @enduml")
  }
}

function normalizePlantUmlSource(source) {
  return String(source).replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim()
}

function extractPlantUmlMetadata(bytes, maxBytes) {
  for (let offset = PNG_SIGNATURE.length; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw renderError("plantuml-metadata-invalid", "PNG contains a truncated chunk.")
    const kind = bytes.subarray(offset + 4, offset + 8).toString("ascii")
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    offset = end
    if (kind !== "iTXt") continue
    const keywordEnd = data.indexOf(0)
    if (keywordEnd < 1) continue
    if (data.subarray(0, keywordEnd).toString("latin1").toLowerCase() !== "plantuml") continue
    let cursor = keywordEnd + 1
    const compressed = data[cursor++]
    const method = data[cursor++]
    const languageEnd = data.indexOf(0, cursor)
    if (languageEnd < 0) throw renderError("plantuml-metadata-invalid", "PlantUML iTXt language is invalid.")
    cursor = languageEnd + 1
    const translatedEnd = data.indexOf(0, cursor)
    if (translatedEnd < 0) throw renderError("plantuml-metadata-invalid", "PlantUML iTXt keyword is invalid.")
    cursor = translatedEnd + 1
    if (compressed !== 0 && compressed !== 1) {
      throw renderError("plantuml-metadata-invalid", "PlantUML iTXt compression flag is invalid.")
    }
    if (compressed === 1 && method !== 0) {
      throw renderError("plantuml-metadata-invalid", "PlantUML iTXt compression method is unsupported.")
    }
    const raw =
      compressed === 1
        ? zlib.inflateSync(data.subarray(cursor), { maxOutputLength: maxBytes + 4096 })
        : data.subarray(cursor)
    const decoded = normalizePlantUmlSource(raw.toString("utf8"))
    const start = decoded.search(/@startuml\b/i)
    const endMatch = /@enduml\b/i.exec(decoded)
    if (start < 0 || !endMatch) {
      throw renderError("plantuml-metadata-invalid", "PlantUML iTXt does not contain a UML diagram.")
    }
    const finish = (endMatch.index || 0) + endMatch[0].length
    return {
      source: decoded.slice(start, finish).trim(),
      version: decoded.slice(finish).trim().split(/\n/)[0]?.trim() || undefined,
    }
  }
  return undefined
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
    result.ok
      ? { ok: true, user: result.user }
      : {
          ok: false,
          code: result.code,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.requestId ? { requestId: result.requestId } : {}),
          ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
          ...(result.upstreamStatus ? { upstreamStatus: result.upstreamStatus } : {}),
        },
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
  const entries = await fsp.readdir(root).catch((error) => {
    if (error && error.code === "ENOENT") return []
    throw error
  })
  const files = []
  for (const entry of entries.sort()) {
    if (!entry.toLowerCase().endsWith(".vsix")) continue
    const absolute = path.join(root, entry)
    const stat = await fsp.stat(absolute).catch((error) => {
      if (error && error.code === "ENOENT") return undefined
      throw error
    })
    if (!stat || !stat.isFile()) continue
    files.push({ absolute, filename: entry, stat, fingerprint: packageFingerprint(stat) })
  }
  prunePackageEntryCache(root, new Set(files.map((item) => item.absolute)))
  const signature = files.map((item) => `${item.filename}:${item.fingerprint}`).join("|")
  const key = `${root}\0${extensionId}`
  const cached = packageManifestCache.get(key)
  if (cached && cached.signature === signature) return cached.manifest
  const token = `${key}\0${signature}`
  const running = packageManifestInflight.get(token)
  if (running) return running

  const task = (async () => {
    const packages = []
    for (const file of files) {
      const info = await cachedPackageEntry(file)
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
    const manifest = {
      ok: true,
      schemaVersion: 2,
      service: "chipmate-word-render",
      generatedAt: new Date().toISOString(),
      latest: packages[0] || null,
      latestByTarget,
      packages,
    }
    boundedSet(packageManifestCache, key, { signature, manifest }, 64)
    return manifest
  })()
  packageManifestInflight.set(token, task)
  try {
    return await task
  } finally {
    packageManifestInflight.delete(token)
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

async function cachedPackageEntry(file) {
  const cached = packageEntryCache.get(file.absolute)
  if (cached && cached.fingerprint === file.fingerprint) return cached.info
  const key = `${file.absolute}\0${file.fingerprint}`
  const running = packageEntryInflight.get(key)
  if (running) return running
  const task = packageEntryFromVsix(file.absolute, file.filename, file.stat)
    .then(async (info) => {
      const stat = await fsp.stat(file.absolute)
      const fingerprint = packageFingerprint(stat)
      if (fingerprint !== info[PACKAGE_FINGERPRINT]) {
        console.warn(`[packages] skipped ${file.filename}: VSIX changed after validation`)
        return undefined
      }
      boundedSet(packageEntryCache, file.absolute, { fingerprint, info }, 512)
      return info
    })
    .catch(async (error) => {
      const stat = await fsp.stat(file.absolute).catch(() => file.stat)
      const fingerprint = packageFingerprint(stat)
      if (fingerprint !== file.fingerprint) {
        console.warn(`[packages] skipped ${file.filename}: VSIX changed while validation failed`)
        return undefined
      }
      boundedSet(packageEntryCache, file.absolute, { fingerprint, info: undefined }, 512)
      console.warn(`[packages] skipped ${file.filename}: ${formatError(error)}`)
      return undefined
    })
  packageEntryInflight.set(key, task)
  try {
    return await task
  } finally {
    packageEntryInflight.delete(key)
  }
}

async function packageEntryFromVsix(absolute, filename, initial) {
  const first = initial || (await fsp.stat(absolute))
  if (!first.isFile()) throw new Error("not a file")
  try {
    return await packageEntryAttempt(absolute, filename, first)
  } catch (error) {
    if (!error || error.code !== "VSIX_CHANGED") throw error
    const second = await fsp.stat(absolute)
    if (!second.isFile()) throw new Error("not a file", { cause: error })
    return packageEntryAttempt(absolute, filename, second)
  }
}

async function packageEntryAttempt(absolute, filename, before) {
  const manifest = await readVsixExtensionManifest(absolute)
  const publisher = requireManifestString(manifest.publisher, "publisher")
  const name = requireManifestString(manifest.name, "name")
  const version = requireManifestString(manifest.version, "version")
  if (!parseExtensionVersion(version))
    throw new Error("extension/package.json version must be a valid semantic version")
  const target = requireManifestString(manifest.chipmatePackageTarget, "chipmatePackageTarget")
  const result = {
    extensionId: `${publisher}.${name}`,
    publisher,
    name,
    version,
    target,
    filename,
    url: `/packages/${encodeURIComponent(filename)}`,
    sha256: await hashPackageFile(absolute),
    sizeBytes: before.size,
    mtimeMs: before.mtimeMs,
  }
  const after = await fsp.stat(absolute)
  if (packageFingerprint(before) !== packageFingerprint(after)) {
    const error = new Error("VSIX changed while its manifest was being generated")
    error.code = "VSIX_CHANGED"
    throw error
  }
  Object.defineProperty(result, PACKAGE_FINGERPRINT, { value: packageFingerprint(after) })
  return result
}

function readVsixExtensionManifest(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError || new Error("could not open VSIX archive"))
        return
      }
      let count = 0
      let raw
      let settled = false
      const fail = (error) => {
        if (settled) return
        settled = true
        zip.close()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      zip.on("error", fail)
      zip.on("entry", (entry) => {
        if (entry.fileName.includes("\\")) {
          fail(new Error("VSIX contains a backslash entry path"))
          return
        }
        if (entry.fileName !== VSIX_MANIFEST_ENTRY) {
          zip.readEntry()
          return
        }
        count += 1
        if (count !== 1) {
          fail(new Error(`${VSIX_MANIFEST_ENTRY} must appear exactly once`))
          return
        }
        if (entry.uncompressedSize > MAX_VSIX_MANIFEST_BYTES) {
          fail(new Error(`${VSIX_MANIFEST_ENTRY} is too large`))
          return
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError || new Error(`could not read ${VSIX_MANIFEST_ENTRY}`))
            return
          }
          const chunks = []
          let size = 0
          stream.on("data", (chunk) => {
            size += chunk.length
            if (size > MAX_VSIX_MANIFEST_BYTES) {
              stream.destroy(new Error(`${VSIX_MANIFEST_ENTRY} is too large`))
              return
            }
            chunks.push(chunk)
          })
          stream.on("error", fail)
          stream.on("end", () => {
            raw = Buffer.concat(chunks)
            zip.readEntry()
          })
        })
      })
      zip.on("end", () => {
        if (settled) return
        if (count !== 1 || !raw) {
          fail(new Error(`${VSIX_MANIFEST_ENTRY} missing`))
          return
        }
        try {
          const manifest = JSON.parse(raw.toString("utf8"))
          if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
            fail(new Error(`${VSIX_MANIFEST_ENTRY} must contain a JSON object`))
            return
          }
          settled = true
          resolve(manifest)
        } catch (error) {
          fail(new Error(`${VSIX_MANIFEST_ENTRY} is invalid JSON: ${formatError(error)}`))
        }
      })
      zip.readEntry()
    })
  })
}

function hashPackageFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(file)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

function packageFingerprint(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`
}

function prunePackageEntryCache(root, files) {
  const prefix = `${root}${path.sep}`
  for (const file of packageEntryCache.keys()) {
    if (file.startsWith(prefix) && !files.has(file)) packageEntryCache.delete(file)
  }
}

function boundedSet(cache, key, value, max) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > max) cache.delete(cache.keys().next().value)
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
      "/render/plantuml",
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
      pythonUno: commandVersion(process.env.PYTHON_UNO_BIN || "python3"),
      chromium: commandVersion("chromium") || commandVersion("chromium-browser") || commandVersion("google-chrome"),
      mermaid: packageVersion("mermaid"),
      java: commandVersion("java"),
      graphviz: commandVersion("dot"),
      plantuml: plantUmlVersion(),
      soffice: commandVersion("soffice") || commandVersion("libreoffice"),
      pdftoppm: commandVersion("pdftoppm"),
      pdfinfo: commandVersion("pdfinfo"),
      microsoftYaHeiMatch: fontMatch("Microsoft YaHei"),
    },
    capabilities: {
      mermaid: {
        endpoint: "/render/mermaid",
        scale: { min: 1, max: 4, default: 2 },
        cssSizeFields: ["width", "height"],
        pixelSizeFields: ["pixelWidth", "pixelHeight"],
        crop: { mode: "svg-content-bounds", padding: 32, fields: ["contentBounds", "cropBounds"] },
      },
      plantuml: {
        endpoint: "/render/plantuml",
        available: Boolean(commandPath("java") && commandPath("dot") && plantUmlVersion()),
        format: "png",
        metadata: "iTXt/plantuml",
        maxSourceBytes: MAX_PLANTUML_SOURCE_BYTES,
        maxPngBytes: MAX_PLANTUML_PNG_BYTES,
        maxDimension: MAX_PLANTUML_DIMENSION,
        concurrency: MAX_PLANTUML_CONCURRENCY,
        queue: MAX_PLANTUML_QUEUE,
        active: plantumlSlots.active,
        queued: plantumlSlots.queue.length,
        securityProfile: "SANDBOX",
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
    const result = { ok: false, code: "invalid-api-key", status: 400, requestId: trace.id }
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
    const result = { ok: false, code: "token-resolver-disabled", status: 503, requestId: trace.id }
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
    if (!user) return { ok: false, code: "token-not-found", status: 404, requestId: trace.id }
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
    if (status === 401 || status === 403)
      return { ok: false, code: "token-not-found", status: 404, requestId: trace.id }
    if (status === 429) return newApiResolverFailure(error, "new-api-rate-limited", 429, trace)
    if (status !== 404 && status !== 405) return newApiResolverFailure(error, "new-api-error", 502, trace)
  }

  if (!config.adminEnabled) {
    resolverLog("warn", "admin.fallback.unavailable", { requestId: trace.id })
    return { ok: false, code: "token-resolver-disabled", status: 503, requestId: trace.id }
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

    return { ok: false, code: "token-not-found", status: 404, requestId: trace.id }
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
    const retry = normalizeRetryAfter(retryAfter)
    const suffix = retry ? ` retry-after=${retry}` : ""
    super(`new-api-http-${status || "failed"}: ${message || "request-failed"}${suffix}`)
    this.status = status
    this.retryAfter = retry
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
  const reason = newApiResolverReason(error)
  resolverLog("warn", "resolve.failure", {
    requestId: trace.id,
    code,
    status,
    error: sanitizeResolverError(error),
  })
  const retryAfter = error instanceof NewApiHttpError ? error.retryAfter : ""
  const upstreamStatus = newApiHttpStatus(error)
  return {
    ok: false,
    code,
    status,
    reason,
    requestId: trace.id,
    ...(retryAfter ? { retryAfter } : {}),
    ...(upstreamStatus ? { upstreamStatus } : {}),
  }
}

function newApiResolverReason(error) {
  const message = formatError(error)
  if (/invalid[ -]?url|err_invalid_url/i.test(message)) return "invalid-url"
  if (/aborted|aborterror|timed? ?out|timeout/i.test(message)) return "timeout"
  if (/invalid-json|unexpected token|json/i.test(message)) return "invalid-json"
  if (/empty-response|no-response/i.test(message)) return "empty-response"
  if (newApiHttpStatus(error) === 429) return "rate-limited"
  if (error instanceof NewApiHttpError) return "upstream-http"
  if (/fetch failed|econnrefused|enotfound|eai_again|network/i.test(message)) return "network"
  return "unknown"
}

function normalizeRetryAfter(value) {
  const text = String(value || "").trim()
  if (/^\d{1,10}$/.test(text)) return text
  const time = Date.parse(text)
  return Number.isFinite(time) ? new Date(time).toUTCString() : ""
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
    .replace(/https?:\/\/[^\s]+/gi, "<url>")
    .replace(/(?:admin|access)[-_ ]?token\s*[=:]\s*[^\s,;]+/gi, "admin-token=<redacted>")
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
      resolve({ ok: false, message: `timed out after ${timeoutMs}ms`, stdout, stderr })
    }, timeoutMs)
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ ok: false, message: error.message, stdout, stderr })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        message: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n") || `exit ${code}`,
        stdout,
        stderr,
      })
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

function pdfInfoPageCount(output) {
  const match = String(output).match(/^Pages:\s+(\d+)\s*$/m)
  const count = match ? Number(match[1]) : 0
  return Number.isInteger(count) && count > 0 ? count : undefined
}

function base64Size(bytes) {
  return Math.ceil(bytes / 3) * 4
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
    throw renderError("png-invalid", "Diagram renderer did not return a valid PNG.")
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
    bodyInkPixels: 0,
    bodyInkRatio: 0,
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
  let bodyInkPixels = 0
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  const edgeSize = Math.max(2, Math.ceil(Math.min(width, height) * 0.02))
  const edgeInk = { top: false, right: false, bottom: false, left: false }
  const bodyTop = Math.floor(height * 0.08)
  const bodyBottom = Math.ceil(height * 0.92)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (!isInkPixel(rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3])) continue
      inkPixels += 1
      if (y >= bodyTop && y < bodyBottom) bodyInkPixels += 1
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
    bodyInkPixels,
    bodyInkRatio: width * Math.max(0, bodyBottom - bodyTop) > 0
      ? bodyInkPixels / (width * Math.max(0, bodyBottom - bodyTop))
      : 0,
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
  const args = command === "dot" ? ["-V"] : command === "pdftoppm" || command === "pdfinfo" ? ["-v"] : ["--version"]
  const result = spawnSync(command, args, {
    encoding: "utf8",
  })
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim().split("\n")[0] || pathValue
}

function fontMatch(family) {
  const fc = commandPath("fc-match")
  if (!fc) return undefined
  const result = spawnSync(fc, ["--format", "%{family[0]}\n", family], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim().split("\n")[0] || undefined : undefined
}

function packageVersion(packageName) {
  try {
    return require(path.join(__dirname, "node_modules", packageName, "package.json")).version
  } catch {
    return undefined
  }
}

function plantUmlVersion() {
  if (!fs.existsSync(PLANTUML_JAR)) return undefined
  return PLANTUML_VERSION || path.basename(PLANTUML_JAR)
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

function httpRenderError(status, code, message) {
  const error = renderError(code, message)
  error.status = status
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
  assertSinglePlantUml,
  compareExtensionVersions,
  contentTypeFor,
  createTokenResolverState,
  extractPlantUmlMetadata,
  generateSkillMarketCatalog,
  generatePackageManifest,
  plantUmlEnv,
  publishSkillMarketUpload,
  skillMarketFilesPayload,
  starSkillMarketItem,
  healthPayload,
  inspectWordDocx,
  normalizePlantUmlSource,
  normalizeNewApiKey,
  packageEntryFromVsix,
  readVsixExtensionManifest,
  resolveNewApiUser,
  server,
  verifyRefreshedWordDocx,
  withPlantUmlSlot,
}
