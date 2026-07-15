import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { declareArtifact } from "@/kilocode/documents/artifacts"
import { insertWordPngImage } from "@/kilocode/documents/word"
import { Instance } from "@/project/instance"

type Photon = typeof import("@silvia-odwyer/photon-node")
type PhotonLoad = { module: Photon } | { error: unknown }

const photon = (() => {
  const state: { value?: Promise<PhotonLoad> } = {}
  return () => {
    state.value ??= (async () => {
      try {
        const wasm = (await import("@silvia-odwyer/photon-node/photon_rs_bg.wasm", { with: { type: "file" } }))
          .default
        ;(globalThis as typeof globalThis & { __KILOCODE_PHOTON_WASM_PATH?: string }).__KILOCODE_PHOTON_WASM_PATH =
          wasm
        return { module: await import("@silvia-odwyer/photon-node") }
      } catch (error) {
        return { error }
      }
    })()
    return state.value
  }
})()

export type MermaidDiagnosticCode =
  | "chrome-not-found"
  | "chrome-startup-failed"
  | "mermaid-render-failed"
  | "mermaid-render-timeout"
  | "mermaid-render-remote-failed"
  | "mermaid-render-content-bounds-suspicious"
  | "mermaid-render-image-processing-unavailable"
  | "png-invalid"
  | "artifact-write-failed"

export type MermaidDiagnostic = {
  code: MermaidDiagnosticCode
  severity: "warning" | "error"
  message: string
}

export type MermaidRenderIssue = {
  severity?: string
  code?: string
  message?: string
}

export type MermaidRenderBounds = {
  x?: number
  y?: number
  width?: number
  height?: number
}

export type ValidateMermaidDiagramInput = {
  source: string
  diagramType?: string
}

export type ValidatedMermaidDiagram = {
  valid: boolean
  diagramType?: string
  diagnostics: MermaidDiagnostic[]
  warnings: string[]
}

export type SaveMermaidArtifactInput = {
  source: string
  pngBase64?: string
  pngPath?: string
  title?: string
  taskSlug?: string
  sourceFile?: string
  pngFile?: string
  diagnostics?: MermaidDiagnostic[]
}

export type SavedMermaidArtifact = {
  artifactDir: string
  manifestPath: string
  sourcePath?: string
  pngPath?: string
  diagnosticsPath: string
  diagnostics: MermaidDiagnostic[]
  warnings: string[]
}

export type RenderMermaidDiagramInput = {
  source: string
  title?: string
  taskSlug?: string
  sourceFile?: string
  pngFile?: string
  remoteEndpoint?: string
  theme?: string
  background?: string
  scale?: number
  timeoutMs?: number
}

export type RenderedMermaidDiagram = SavedMermaidArtifact & {
  rendered: boolean
  width?: number
  height?: number
  pixelWidth?: number
  pixelHeight?: number
  scale?: number
  contentBounds?: MermaidRenderBounds
  cropBounds?: MermaidRenderBounds
  padding?: number
  contentCropRatio?: number
  elapsedMs?: number
  renderer?: Record<string, unknown>
  issues: MermaidRenderIssue[]
}

export type InsertMermaidIntoWordInput = {
  wordPath: string
  source: string
  pngBase64?: string
  pngPath?: string
  remoteEndpoint?: string
  heading?: string
  caption?: string
  outputFile?: string
  taskSlug?: string
  title?: string
  width?: number
  height?: number
  timeoutMs?: number
}

export type InsertedMermaidIntoWord = {
  inserted: boolean
  wordPath?: string
  artifactDir?: string
  manifestPath?: string
  mermaidArtifactDir?: string
  mermaidPngPath?: string
  diagnostics: MermaidDiagnostic[]
  warnings: string[]
}

type RemoteMermaidRenderResponse = {
  ok?: boolean
  pngBase64?: string
  png?: {
    contentType?: string
    base64?: string
  }
  issues?: Array<{
    severity?: string
    code?: string
    message?: string
  }>
  warnings?: string[]
  width?: number
  height?: number
  pixelWidth?: number
  pixelHeight?: number
  scale?: number
  contentBounds?: MermaidRenderBounds
  cropBounds?: MermaidRenderBounds
  padding?: number
  contentCropRatio?: number
  elapsedMs?: number
  renderer?: Record<string, unknown>
}

type LocalMermaidRender = {
  pngBase64?: string
  diagnostics: MermaidDiagnostic[]
  width?: number
  height?: number
  pixelWidth?: number
  pixelHeight?: number
  scale?: number
  contentBounds?: MermaidRenderBounds
  cropBounds?: MermaidRenderBounds
  padding?: number
  contentCropRatio?: number
  renderer?: Record<string, unknown>
  issues: MermaidRenderIssue[]
}

type PixelBounds = {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT_SCALE = 3
const MIN_SCALE = 1
const MAX_SCALE = 4
const CROP_PADDING_CSS = 32
const MAX_RENDER_PIXELS = 12_000

const DIAGRAM_STARTERS = [
  "graph",
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "gantt",
  "pie",
  "journey",
  "gitGraph",
  "mindmap",
  "timeline",
  "quadrantChart",
  "requirementDiagram",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "block-beta",
  "packet-beta",
  "xychart-beta",
  "sankey-beta",
]

export function validateMermaidDiagram(input: ValidateMermaidDiagramInput): ValidatedMermaidDiagram {
  const diagnostics: MermaidDiagnostic[] = []
  const source = stripMermaidFrontMatter(input.source).trim()
  if (!source) {
    diagnostics.push({ code: "mermaid-render-failed", severity: "error", message: "Mermaid source is empty." })
  }
  if (/<script\b/i.test(source) || /javascript:/i.test(source)) {
    diagnostics.push({
      code: "mermaid-render-failed",
      severity: "error",
      message: "Mermaid source contains unsafe script-like content.",
    })
  }
  const firstLine =
    source
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? ""
  const starter = DIAGRAM_STARTERS.find(
    (item) => firstLine === item || firstLine.startsWith(`${item} `) || firstLine.startsWith(`${item}\t`),
  )
  if (!starter) {
    diagnostics.push({
      code: "mermaid-render-failed",
      severity: "error",
      message: `Unsupported or missing Mermaid diagram starter: ${firstLine || "(empty)"}`,
    })
  }
  const balance = bracketBalance(source)
  if (!balance.valid) diagnostics.push({ code: "mermaid-render-failed", severity: "error", message: balance.message })
  return {
    valid: diagnostics.every((item) => item.severity !== "error"),
    diagramType: input.diagramType ?? starter,
    diagnostics,
    warnings: diagnostics.filter((item) => item.severity === "warning").map((item) => `${item.code}: ${item.message}`),
  }
}

export async function saveMermaidArtifact(input: SaveMermaidArtifactInput): Promise<SavedMermaidArtifact> {
  const validation = validateMermaidDiagram({ source: input.source })
  const diagnostics = [...(input.diagnostics ?? []), ...validation.diagnostics]
  const sourceFile = safeMmdName(input.sourceFile ?? "diagram.mmd")
  const pngFile = input.pngFile ? safePngName(input.pngFile) : "diagram.png"
  const diagnosticsFile = "mermaid-diagnostics.json"
  let pngBytes: Buffer | undefined
  if (input.pngBase64?.trim()) pngBytes = Buffer.from(input.pngBase64, "base64")
  if (!pngBytes && input.pngPath?.trim()) pngBytes = Buffer.from(await fs.readFile(resolveWorkspacePath(input.pngPath)))
  if (pngBytes && !isPng(pngBytes)) {
    diagnostics.push({ code: "png-invalid", severity: "error", message: "Mermaid PNG payload is not a valid PNG." })
    pngBytes = undefined
  }
  const warnings = diagnostics.map((item) => `${item.code}: ${item.message}`)
  try {
    const artifact = await declareArtifact({
      kind: "mermaid-diagram",
      title: input.title ?? "Mermaid Diagram",
      taskSlug: input.taskSlug ?? "mermaid-diagram",
      primaryFile: sourceFile,
      derivedFiles: [...(pngBytes ? [pngFile] : []), diagnosticsFile],
      warnings,
      qualityStatus: diagnostics.some((item) => item.severity === "error")
        ? "failed"
        : diagnostics.length
          ? "warning"
          : "ok",
    })
    const artifactDir = path.join(Instance.directory, artifact.artifactDir)
    const sourcePath = path.join(artifactDir, sourceFile)
    const diagnosticsPath = path.join(artifactDir, diagnosticsFile)
    assertInside(artifactDir, sourcePath, "sourceFile")
    assertInside(artifactDir, diagnosticsPath, "diagnosticsFile")
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    await fs.writeFile(sourcePath, input.source, "utf8")
    let pngPath: string | undefined
    if (pngBytes) {
      const output = path.join(artifactDir, pngFile)
      assertInside(artifactDir, output, "pngFile")
      await fs.mkdir(path.dirname(output), { recursive: true })
      await fs.writeFile(output, pngBytes)
      pngPath = normalizePortable(path.relative(Instance.directory, output))
    }
    await fs.writeFile(diagnosticsPath, `${JSON.stringify({ diagnostics, warnings, pngPath }, null, 2)}\n`, "utf8")
    return {
      artifactDir: artifact.artifactDir,
      manifestPath: artifact.manifestPath,
      sourcePath: normalizePortable(path.relative(Instance.directory, sourcePath)),
      pngPath,
      diagnosticsPath: normalizePortable(path.relative(Instance.directory, diagnosticsPath)),
      diagnostics,
      warnings,
    }
  } catch (err) {
    return {
      artifactDir: "",
      manifestPath: "",
      diagnosticsPath: "",
      diagnostics: [
        ...diagnostics,
        { code: "artifact-write-failed", severity: "error", message: err instanceof Error ? err.message : String(err) },
      ],
      warnings: [...warnings, `artifact-write-failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

export async function renderMermaidDiagram(input: RenderMermaidDiagramInput): Promise<RenderedMermaidDiagram> {
  const validation = validateMermaidDiagram({ source: input.source })
  if (!validation.valid) {
    const saved = await saveMermaidArtifact({ ...input, diagnostics: validation.diagnostics })
    return { ...saved, rendered: false, issues: [] }
  }
  const timeoutMs = input.timeoutMs ?? 120_000
  const endpoint = input.remoteEndpoint?.trim() || process.env["KILO_MERMAID_RENDER_ENDPOINT"]?.trim()
  const scale = clampScale(input.scale)
  const background = input.background?.trim() || "white"
  const request = { ...input, scale, background }
  const diagnostics: MermaidDiagnostic[] = []
  let pngBase64: string | undefined
  let response: RemoteMermaidRenderResponse | undefined
  let local: LocalMermaidRender | undefined
  if (endpoint) {
    try {
      response = await callRemoteRenderer(endpoint, request, timeoutMs)
      pngBase64 = remotePng(response)
      diagnostics.push(
        ...(response.warnings ?? []).map((message) => ({
          code: "mermaid-render-failed" as const,
          severity: "warning" as const,
          message,
        })),
        ...(response.issues ?? []).map(
          (issue): MermaidDiagnostic => ({
            code: "mermaid-render-failed",
            severity: issue.severity === "error" ? "error" : "warning",
            message: `${issue.code ? `${issue.code}: ` : ""}${issue.message ?? "Mermaid renderer reported an issue."}`,
          }),
        ),
      )
    } catch (err) {
      const remote = classifyRenderError(err)
      local = await renderWithMmdc(input.source, background, scale, timeoutMs)
      if (local.pngBase64) {
        diagnostics.push({
          code: "mermaid-render-remote-failed",
          severity: "warning",
          message: `Remote Mermaid render failed; local mmdc fallback succeeded: ${remote.message}`,
        })
        diagnostics.push(...local.diagnostics)
        pngBase64 = local.pngBase64
        response = undefined
      } else {
        diagnostics.push(remote, ...local.diagnostics)
      }
    }
  } else {
    local = await renderWithMmdc(input.source, background, scale, timeoutMs)
    pngBase64 = local.pngBase64
    diagnostics.push(...local.diagnostics)
  }
  const saved = await saveMermaidArtifact({ ...request, pngBase64, diagnostics })
  return {
    ...saved,
    rendered: Boolean(saved.pngPath && !saved.diagnostics.some((item) => item.severity === "error")),
    width: response?.width ?? local?.width,
    height: response?.height ?? local?.height,
    pixelWidth: response?.pixelWidth ?? local?.pixelWidth,
    pixelHeight: response?.pixelHeight ?? local?.pixelHeight,
    scale: response?.scale ?? local?.scale ?? scale,
    contentBounds: response?.contentBounds ?? local?.contentBounds,
    cropBounds: response?.cropBounds ?? local?.cropBounds,
    padding: response?.padding ?? local?.padding,
    contentCropRatio: response?.contentCropRatio ?? local?.contentCropRatio,
    elapsedMs: response?.elapsedMs,
    renderer: response?.renderer ?? local?.renderer,
    issues: response?.issues ?? local?.issues ?? [],
  }
}

export async function insertMermaidIntoWord(input: InsertMermaidIntoWordInput): Promise<InsertedMermaidIntoWord> {
  let pngPath = input.pngPath
  let pngBase64 = input.pngBase64
  let mermaidArtifactDir: string | undefined
  const diagnostics: MermaidDiagnostic[] = []
  if (!pngPath && !pngBase64) {
    const rendered = await renderMermaidDiagram({
      source: input.source,
      remoteEndpoint: input.remoteEndpoint,
      timeoutMs: input.timeoutMs,
      taskSlug: input.taskSlug ? `${input.taskSlug}-mermaid` : undefined,
      title: input.title ? `${input.title} Mermaid` : undefined,
    })
    diagnostics.push(...rendered.diagnostics)
    pngPath = rendered.pngPath
    mermaidArtifactDir = rendered.artifactDir || undefined
  } else {
    const saved = await saveMermaidArtifact({
      source: input.source,
      pngPath,
      pngBase64,
      taskSlug: input.taskSlug ? `${input.taskSlug}-mermaid` : undefined,
      title: input.title ? `${input.title} Mermaid` : undefined,
    })
    diagnostics.push(...saved.diagnostics)
    pngPath = saved.pngPath ?? pngPath
    mermaidArtifactDir = saved.artifactDir || undefined
  }
  if (!pngPath && !pngBase64) {
    return {
      inserted: false,
      mermaidArtifactDir,
      diagnostics,
      warnings: diagnostics.map((item) => `${item.code}: ${item.message}`),
    }
  }
  const inserted = await insertWordPngImage({
    sourcePath: input.wordPath,
    pngPath,
    pngBase64,
    heading: input.heading,
    caption: input.caption,
    outputFile: input.outputFile,
    taskSlug: input.taskSlug,
    title: input.title,
    width: input.width,
    height: input.height,
  })
  return {
    inserted: true,
    wordPath: inserted.path,
    artifactDir: inserted.artifactDir,
    manifestPath: inserted.manifestPath,
    mermaidArtifactDir,
    mermaidPngPath: pngPath,
    diagnostics,
    warnings: [...inserted.warnings, ...diagnostics.map((item) => `${item.code}: ${item.message}`)],
  }
}

async function callRemoteRenderer(
  endpoint: string,
  input: RenderMermaidDiagramInput,
  timeoutMs: number,
): Promise<RemoteMermaidRenderResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: input.source,
        filename: input.sourceFile ?? "diagram.mmd",
        scale: input.scale,
        timeoutMs,
        theme: input.theme,
        background: input.background,
      }),
      signal: controller.signal,
    })
    const body = (await response.json()) as RemoteMermaidRenderResponse
    if (response.ok) return body
    if (body.ok === false || body.issues?.length) return { ...body, ok: false }
    return {
      ...body,
      ok: false,
      issues: [
        {
          severity: "error",
          code: `http-${response.status}`,
          message: `renderer returned HTTP ${response.status}`,
        },
      ],
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("mermaid-render-timeout")
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function remotePng(response: RemoteMermaidRenderResponse): string {
  const png = response.pngBase64?.trim() || response.png?.base64?.trim()
  if (png && response.ok !== false) return png
  const issue = response.issues?.find((item) => item.message?.trim())
  const detail = issue?.message ? `${issue.code ? `${issue.code}: ` : ""}${issue.message}` : ""
  const reason =
    response.ok === false ? "remote Mermaid renderer rejected the request" : "remote Mermaid renderer returned no PNG"
  throw new Error(detail ? `${reason}: ${detail}` : reason)
}

async function renderWithMmdc(
  source: string,
  background: string,
  scale: number,
  timeoutMs: number,
): Promise<LocalMermaidRender> {
  const command = process.env["KILO_MERMAID_MMDC"]?.trim() || "mmdc"
  const tmp = path.join(
    Instance.directory,
    ".kilo",
    "tmp",
    `mermaid-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const input = path.join(tmp, "diagram.mmd")
  const output = path.join(tmp, "diagram.png")
  await fs.mkdir(tmp, { recursive: true })
  await fs.writeFile(input, source, "utf8")
  try {
    await execFileWithTimeout(command, ["-i", input, "-o", output, "-b", background, "-s", String(scale)], timeoutMs)
    const png = await fs.readFile(output)
    if (!isPng(png))
      return {
        diagnostics: [{ code: "png-invalid", severity: "error", message: "mmdc output is not a valid PNG." }],
        issues: [],
      }
    return cropLocalPng(png, background, scale)
  } catch (err) {
    return { diagnostics: [classifyRenderError(err)], issues: [] }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

async function cropLocalPng(png: Uint8Array, background: string, scale: number): Promise<LocalMermaidRender> {
  const loaded = await photon()
  if ("error" in loaded) return unprocessedPng(png, scale, loaded.error)

  const image = loaded.module.PhotonImage.new_from_byteslice(png)
  try {
    const width = image.get_width()
    const height = image.get_height()
    if (width > MAX_RENDER_PIXELS || height > MAX_RENDER_PIXELS) {
      return {
        diagnostics: [
          {
            code: "mermaid-render-failed",
            severity: "error",
            message: `mmdc output ${width}x${height} exceeds the ${MAX_RENDER_PIXELS}px render bound.`,
          },
        ],
        issues: [],
      }
    }
    const content = scanContentBounds(image.get_raw_pixels(), width, height, background)
    if (!content) {
      return {
        pngBase64: Buffer.from(png).toString("base64"),
        diagnostics: [
          {
            code: "mermaid-render-content-bounds-suspicious",
            severity: "warning",
            message: "mmdc output has no detectable non-background content; visual review is required.",
          },
        ],
        width: width / scale,
        height: height / scale,
        pixelWidth: width,
        pixelHeight: height,
        scale,
        padding: CROP_PADDING_CSS,
        contentCropRatio: 0,
        renderer: { kind: "local-mmdc", diagramToPng: "mmdc" },
        issues: [
          {
            severity: "warning",
            code: "mermaid-render-content-bounds-suspicious",
            message: "No non-background content bounds were detected.",
          },
        ],
      }
    }
    const pad = Math.round(CROP_PADDING_CSS * scale)
    const bounds = paddedBounds(content, width, height, pad)
    const ratio = (content.width * content.height) / (bounds.width * bounds.height)
    const cropped = loaded.module.crop(image, bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height)
    try {
      const bytes = cropped.get_bytes()
      const issues: MermaidRenderIssue[] = []
      const diagnostics: MermaidDiagnostic[] = []
      if (ratio < 0.2) {
        const message = `Mermaid rendered content only occupies ${(ratio * 100).toFixed(1)}% of the cropped PNG bounds.`
        issues.push({
          severity: "warning",
          code: "mermaid-render-content-bounds-suspicious",
          message,
        })
        diagnostics.push({
          code: "mermaid-render-content-bounds-suspicious",
          severity: "warning",
          message,
        })
      }
      return {
        pngBase64: Buffer.from(bytes).toString("base64"),
        diagnostics,
        width: bounds.width / scale,
        height: bounds.height / scale,
        pixelWidth: bounds.width,
        pixelHeight: bounds.height,
        scale,
        contentBounds: cssBounds(content, scale),
        cropBounds: cssBounds(bounds, scale),
        padding: CROP_PADDING_CSS,
        contentCropRatio: ratio,
        renderer: { kind: "local-mmdc", diagramToPng: "mmdc", crop: "pixel-content-bounds" },
        issues,
      }
    } finally {
      cropped.free()
    }
  } finally {
    image.free()
  }
}

function unprocessedPng(png: Uint8Array, scale: number, error: unknown): LocalMermaidRender {
  const detail = error instanceof Error ? error.message : String(error)
  const message = `Photon image processing is unavailable; preserving the original Mermaid PNG without content cropping: ${detail.slice(0, 500)}`
  return {
    pngBase64: Buffer.from(png).toString("base64"),
    diagnostics: [{ code: "mermaid-render-image-processing-unavailable", severity: "warning", message }],
    scale,
    renderer: { kind: "local-mmdc", diagramToPng: "mmdc", crop: "unavailable" },
    issues: [{ severity: "warning", code: "mermaid-render-image-processing-unavailable", message }],
  }
}

function scanContentBounds(
  pixels: Uint8Array,
  width: number,
  height: number,
  background: string,
): PixelBounds | undefined {
  const bg = backgroundColor(background)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (!isContentPixel(pixels, offset, bg)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return undefined
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function isContentPixel(pixels: Uint8Array, offset: number, background: [number, number, number, number]): boolean {
  const alpha = pixels[offset + 3] ?? 0
  if (background[3] === 0) return alpha > 8
  return (
    Math.abs((pixels[offset] ?? 0) - background[0]) > 12 ||
    Math.abs((pixels[offset + 1] ?? 0) - background[1]) > 12 ||
    Math.abs((pixels[offset + 2] ?? 0) - background[2]) > 12 ||
    Math.abs(alpha - background[3]) > 12
  )
}

function backgroundColor(input: string): [number, number, number, number] {
  const value = input.trim().toLowerCase()
  if (value === "transparent") return [0, 0, 0, 0]
  if (value === "white" || value === "#fff" || value === "#ffffff") return [255, 255, 255, 255]
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (short)
    return [
      Number.parseInt(short[1]! + short[1]!, 16),
      Number.parseInt(short[2]! + short[2]!, 16),
      Number.parseInt(short[3]! + short[3]!, 16),
      255,
    ]
  const full = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (full) return [Number.parseInt(full[1]!, 16), Number.parseInt(full[2]!, 16), Number.parseInt(full[3]!, 16), 255]
  return [255, 255, 255, 255]
}

function paddedBounds(content: PixelBounds, width: number, height: number, padding: number): PixelBounds {
  const x = Math.max(0, content.x - padding)
  const y = Math.max(0, content.y - padding)
  const right = Math.min(width, content.x + content.width + padding)
  const bottom = Math.min(height, content.y + content.height + padding)
  return { x, y, width: right - x, height: bottom - y }
}

function cssBounds(bounds: PixelBounds, scale: number): MermaidRenderBounds {
  return {
    x: bounds.x / scale,
    y: bounds.y / scale,
    width: bounds.width / scale,
    height: bounds.height / scale,
  }
}

function clampScale(input: number | undefined): number {
  if (!Number.isFinite(input)) return DEFAULT_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, input!))
}

function execFileWithTimeout(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stderr }))
        return
      }
      resolve()
    })
    child.on("error", reject)
  })
}

function classifyRenderError(err: unknown): MermaidDiagnostic {
  const message = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string } | undefined)?.code
  const stderr = (err as { stderr?: string } | undefined)?.stderr ?? ""
  if (message === "mermaid-render-timeout" || /timed out|timeout/i.test(message))
    return { code: "mermaid-render-timeout", severity: "error", message: "Mermaid rendering timed out." }
  if (code === "ENOENT")
    return {
      code: "chrome-not-found",
      severity: "error",
      message:
        "Mermaid renderer executable was not found. Configure KILO_MERMAID_RENDER_ENDPOINT or install mmdc externally.",
    }
  if (/chrome|chromium|browser/i.test(`${message}\n${stderr}`))
    return { code: "chrome-startup-failed", severity: "error", message: `${message}${stderr ? `: ${stderr}` : ""}` }
  return { code: "mermaid-render-failed", severity: "error", message: `${message}${stderr ? `: ${stderr}` : ""}` }
}

function stripMermaidFrontMatter(source: string): string {
  const trimmed = source.trimStart()
  if (!trimmed.startsWith("---")) return source
  const close = trimmed.indexOf("\n---", 3)
  return close >= 0 ? trimmed.slice(close + 4) : source
}

function bracketBalance(source: string): { valid: boolean; message: string } {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" }
  const stack: string[] = []
  for (const char of source) {
    if (pairs[char]) stack.push(pairs[char])
    if ((char === ")" || char === "]" || char === "}") && stack.pop() !== char)
      return { valid: false, message: `Unbalanced Mermaid bracket near "${char}".` }
  }
  return stack.length ? { valid: false, message: "Unbalanced Mermaid brackets." } : { valid: true, message: "" }
}

function safeMmdName(input: string): string {
  const base =
    input
      .replace(/\.mmd$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "diagram"
  return `${base}.mmd`
}

function safePngName(input: string): string {
  const base =
    normalizePortable(input)
      .replace(/^\/+/, "")
      .replace(/\.png$/i, "")
      .split("/")
      .filter(Boolean)
      .map((part) =>
        part
          .replace(/[\\:*?"<>|]+/g, "-")
          .replace(/\s+/g, "-")
          .replace(/^-+|-+$/g, ""),
      )
      .filter(Boolean)
      .join("/")
      .slice(0, 160) || "diagram"
  return `${base}.png`
}

function resolveWorkspacePath(input: string): string {
  if (!input.trim()) throw new Error("path is required")
  const absolute = path.resolve(Instance.directory, input)
  assertInside(Instance.directory, absolute, "path")
  return absolute
}

function assertInside(base: string, target: string, label: string): void {
  const relative = path.relative(base, target)
  if (relative === "") return
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must be inside workspace`)
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
}

function normalizePortable(input: string): string {
  return input.split(path.sep).join("/")
}
