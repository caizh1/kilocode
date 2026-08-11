import { execFile } from "child_process"
import { createHash } from "node:crypto"
import fs from "fs/promises"
import path from "path"
import { DOMParser, type Element } from "@xmldom/xmldom"
import { declareArtifact } from "@/chipmate/documents/artifacts"
import { insertWordPngImage } from "@/chipmate/documents/word"
import { Instance } from "@/chipmate/instance"
import { ProductProfile } from "@/chipmate/product-profile"
import { userEnv } from "@/chipmate/product-env"
import {
  type MermaidSemanticFingerprint,
  type MermaidSemanticIssue,
  type MermaidSemanticQuery,
  type MermaidSemanticResult,
  type MermaidSemanticStatus,
  mermaidContainers,
  validateSourceBackedMermaid,
} from "@/chipmate/documents/mermaid-semantics"
import * as SemanticGuard from "@/chipmate/documents/mermaid-semantic-guard"

type Photon = typeof import("@silvia-odwyer/photon-node")
type PhotonLoad = { module: Photon } | { error: unknown }

const photon = (() => {
  const state: { value?: Promise<PhotonLoad> } = {}
  return () => {
    state.value ??= (async () => {
      try {
        const wasm = (await import("@silvia-odwyer/photon-node/photon_rs_bg.wasm", { with: { type: "file" } })).default
        ;(globalThis as typeof globalThis & { __CHIPMATE_PHOTON_WASM_PATH?: string }).__CHIPMATE_PHOTON_WASM_PATH = wasm
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
  | "mermaid-render-label-collision"
  | "mermaid-render-collision-check-unavailable"
  | "mermaid-render-image-processing-unavailable"
  | "png-invalid"
  | "artifact-write-failed"
  | "mermaid-semantic-invalid"

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

export type MermaidWordFitFingerprint = {
  diagramId?: string
  splitFromDiagramId?: string
  nodeIds: readonly string[]
  edges: ReadonlyArray<{ from: string; to: string }>
  nodeCount?: number
  edgeCount?: number
  labelCharacterCount?: number
  longLabelCount?: number
  longNodeLabelCount?: number
  longEdgeLabelCount?: number
  branchingNodeCount?: number
  maxOutgoingEdges?: number
  diagramType?: string
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

export type ValidateMermaidDiagramRequest = ValidateMermaidDiagramInput & {
  semanticMode?: "source-backed"
  semanticEvidencePath?: string
  semanticQuery?: MermaidSemanticQuery
  semanticSessionId?: string
  allowSourceHashPlaceholder?: boolean
}

export type ValidatedMermaidDiagram = {
  valid: boolean
  diagramType?: string
  diagnostics: MermaidDiagnostic[]
  warnings: string[]
}

export type ValidatedMermaidDiagramRequest = ValidatedMermaidDiagram & MermaidSemanticResult

export type SaveMermaidArtifactInput = {
  source: string
  /** Internal caller-owned artifact directory. Public Mermaid tools intentionally do not expose this. */
  artifactDir?: string
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
  /** Internal caller-owned artifact directory. Public Mermaid tools intentionally do not expose this. */
  artifactDir?: string
  title?: string
  taskSlug?: string
  sourceFile?: string
  pngFile?: string
  remoteEndpoint?: string
  theme?: string
  background?: string
  scale?: number
  timeoutMs?: number
  semanticMode?: "source-backed"
  semanticEvidencePath?: string
  semanticSessionId?: string
  allowSourceHashPlaceholder?: boolean
}

export type RenderMermaidPngInput = Pick<
  RenderMermaidDiagramInput,
  "source" | "remoteEndpoint" | "theme" | "background" | "scale" | "timeoutMs"
>

export type RenderedMermaidPng = {
  rendered: boolean
  png?: Uint8Array
  diagnostics: MermaidDiagnostic[]
  issues: MermaidRenderIssue[]
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

export type SourceBackedMermaidBatchInput = {
  manifestPath: string
  remoteEndpoint?: string
  theme?: string
  background?: string
  scale?: number
  timeoutMs?: number
  semanticSessionId: string
}

export type SourceBackedMermaidBatchItem = {
  diagramId: string
  sourcePath: string
  semanticEvidencePath: string
  title?: string
  taskSlug?: string
  sourceFile?: string
  pngFile?: string
  scale?: number
}

export type SourceBackedMermaidBatchItemResult = {
  index: number
  diagramId: string
  sourcePath: string
  semanticEvidencePath: string
  rendered: boolean
  semanticStatus: MermaidSemanticStatus
  sourceHash?: string
  semanticEvidenceHash?: string
  pngPath?: string
  diagnosticsPath?: string
  semanticDiagnosticsPath?: string
  wordFitStatus?: "readable" | "split-required"
  wordFitReasons?: string[]
  documentReady: boolean
  claimCount?: number
  validatedClaimCount?: number
  issues: MermaidSemanticIssue[]
  warnings: string[]
}

export type RenderedSourceBackedMermaidBatch = {
  generatedAt: number
  manifestPath: string
  basePath?: string
  resultPath: string
  requestedCount: number
  processedCount: number
  renderedCount: number
  readyCount: number
  invalidCount: number
  splitRequiredCount: number
  complete: boolean
  resolvedSplitDiagramIds: string[]
  pendingSplitDiagramIds: string[]
  pendingSplitDetails: Array<{
    diagramId: string
    missingNodes: Array<{ id: string; symbol?: string; designUnitId?: string }>
    missingEdges: MermaidSemanticFingerprint["edges"]
    suggestedChildren: Array<{
      suggestedDiagramId: string
      splitFromDiagramId: string
      nodes: Array<{ id: string; symbol?: string; designUnitId?: string }>
      edges: MermaidSemanticFingerprint["edges"]
    }>
  }>
  items: SourceBackedMermaidBatchItemResult[]
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
  semanticStatus: MermaidSemanticStatus
  sourceHash: string
  claimCount: number
  validatedClaimCount: number
  semanticIssues: MermaidSemanticIssue[]
  semanticDiagnosticsPath?: string
  semanticFingerprint?: MermaidSemanticFingerprint
  wordFitScale?: number
  wordFitDensity?: number
  wordFitAspectRatio?: number
  wordFitStatus?: "readable" | "split-required"
  wordFitReasons?: string[]
  documentReady?: boolean
}

export type InsertMermaidIntoWordInput = {
  wordPath: string
  source: string
  pngBase64?: string
  pngPath?: string
  remoteEndpoint?: string
  heading?: string
  caption?: string
  figureTitle?: string
  altText?: string
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

type SvgMatrix = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

type SvgLabelBounds = PixelBounds & {
  id: string
  kind: "edge-label" | "node-label"
}

const DEFAULT_SCALE = 3
const MIN_SCALE = 1
const MAX_SCALE = 4
const CROP_PADDING_CSS = 32
const MAX_RENDER_PIXELS = 12_000
const WORD_WIDTH = 624
const WORD_HEIGHT = 720
const WORD_MIN_SCALE = 0.65
const WORD_MAX_DENSITY = 30
const WORD_MAX_ASPECT = 4

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
  if (/\\["']/.test(source)) {
    diagnostics.push({
      code: "mermaid-render-failed",
      severity: "error",
      message: "Mermaid labels must not use backslash-escaped quotes; use a plain quoted label or an HTML entity.",
    })
  }
  return {
    valid: diagnostics.every((item) => item.severity !== "error"),
    diagramType: input.diagramType ?? starter,
    diagnostics,
    warnings: diagnostics.filter((item) => item.severity === "warning").map((item) => `${item.code}: ${item.message}`),
  }
}

export async function validateMermaidDiagramRequest(
  input: ValidateMermaidDiagramRequest,
): Promise<ValidatedMermaidDiagramRequest> {
  const syntax = validateMermaidDiagram(input)
  const sourceHash = createHash("sha256").update(input.source).digest("hex")
  if (!input.semanticMode) {
    return { ...syntax, semanticStatus: "not-requested", sourceHash, claimCount: 0, validatedClaimCount: 0, issues: [] }
  }
  if (!syntax.valid) {
    return { ...syntax, semanticStatus: "invalid", sourceHash, claimCount: 0, validatedClaimCount: 0, issues: [] }
  }
  if (!input.semanticEvidencePath?.trim()) {
    return {
      ...syntax,
      valid: false,
      semanticStatus: "invalid",
      sourceHash,
      claimCount: 0,
      validatedClaimCount: 0,
      issues: [
        {
          code: "semantic-evidence-missing",
          severity: "error",
          message: "semanticEvidencePath is required for source-backed validation.",
        },
      ],
    }
  }
  const semantic = await validateSourceBackedMermaid({
    source: input.source,
    semanticEvidencePath: input.semanticEvidencePath,
    query: input.semanticQuery,
    allowSourceHashPlaceholder: input.allowSourceHashPlaceholder,
  })
  const pending =
    input.semanticSessionId && semantic.semanticStatus !== "invalid"
      ? SemanticGuard.advance(input.semanticSessionId, semantic.semanticFingerprint)
      : undefined
  if (pending) {
    return {
      ...syntax,
      ...semantic,
      valid: false,
      semanticStatus: "invalid",
      issues: [...semantic.issues, pending],
    }
  }
  return { ...syntax, ...semantic, valid: syntax.valid && semantic.semanticStatus !== "invalid" }
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
      artifactDir: input.artifactDir,
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
  const validation = await validateMermaidDiagramRequest(input)
  if (!validation.valid) {
    const diagnostics = [
      ...validation.diagnostics,
      ...validation.issues.map((item) => ({
        code: "mermaid-semantic-invalid" as const,
        severity: item.severity,
        message: `${item.code}: ${item.message}`,
      })),
    ]
    const saved = await saveMermaidArtifact({ ...input, diagnostics })
    return {
      ...saved,
      rendered: false,
      issues: [],
      semanticStatus: validation.semanticStatus,
      sourceHash: validation.sourceHash,
      claimCount: validation.claimCount,
      validatedClaimCount: validation.validatedClaimCount,
      semanticIssues: validation.issues,
      semanticDiagnosticsPath: validation.diagnosticsPath,
      semanticFingerprint: validation.semanticFingerprint,
    }
  }
  const regression = input.semanticSessionId
    ? SemanticGuard.coverage(input.semanticSessionId, validation.semanticFingerprint)
    : undefined
  if (regression) {
    const diagnostics = [
      ...validation.diagnostics,
      {
        code: "mermaid-semantic-invalid" as const,
        severity: regression.severity,
        message: `${regression.code}: ${regression.message}`,
      },
    ]
    const saved = await saveMermaidArtifact({ ...input, diagnostics })
    return {
      ...saved,
      rendered: false,
      issues: [],
      semanticStatus: "invalid",
      sourceHash: validation.sourceHash,
      claimCount: validation.claimCount,
      validatedClaimCount: validation.validatedClaimCount,
      semanticIssues: [...validation.issues, regression],
      semanticDiagnosticsPath: validation.diagnosticsPath,
      semanticFingerprint: validation.semanticFingerprint,
    }
  }
  const budget =
    input.semanticSessionId && input.semanticMode && input.semanticEvidencePath
      ? SemanticGuard.render(input.semanticSessionId, input.semanticEvidencePath)
      : undefined
  if (budget) {
    const diagnostics = [
      ...validation.diagnostics,
      {
        code: "mermaid-semantic-invalid" as const,
        severity: budget.severity,
        message: `${budget.code}: ${budget.message}`,
      },
    ]
    const saved = await saveMermaidArtifact({ ...input, diagnostics })
    return {
      ...saved,
      rendered: false,
      issues: [],
      semanticStatus: "invalid",
      sourceHash: validation.sourceHash,
      claimCount: validation.claimCount,
      validatedClaimCount: validation.validatedClaimCount,
      semanticIssues: [...validation.issues, budget],
      semanticDiagnosticsPath: validation.diagnosticsPath,
      semanticFingerprint: validation.semanticFingerprint,
    }
  }
  const image = await renderMermaidImage(input)
  const saved = await saveMermaidArtifact({
    ...input,
    pngBase64: image.pngBase64,
    diagnostics: image.diagnostics,
  })
  const response = image.response
  const local = image.local
  const scale = image.scale
  const width = response?.width ?? local?.width
  const height = response?.height ?? local?.height
  const renderIssues = response?.issues ?? local?.issues ?? []
  const fit = mermaidWordFit({
    width,
    height,
    status: validation.semanticStatus,
    fingerprint: validation.semanticFingerprint,
    issues: renderIssues,
  })
  return {
    ...saved,
    rendered: Boolean(saved.pngPath && !saved.diagnostics.some((item) => item.severity === "error")),
    width,
    height,
    pixelWidth: response?.pixelWidth ?? local?.pixelWidth,
    pixelHeight: response?.pixelHeight ?? local?.pixelHeight,
    scale: response?.scale ?? local?.scale ?? scale,
    contentBounds: response?.contentBounds ?? local?.contentBounds,
    cropBounds: response?.cropBounds ?? local?.cropBounds,
    padding: response?.padding ?? local?.padding,
    contentCropRatio: response?.contentCropRatio ?? local?.contentCropRatio,
    elapsedMs: response?.elapsedMs,
    renderer: response?.renderer ?? local?.renderer,
    issues: renderIssues,
    semanticStatus: validation.semanticStatus,
    sourceHash: validation.sourceHash,
    claimCount: validation.claimCount,
    validatedClaimCount: validation.validatedClaimCount,
    semanticIssues: validation.issues,
    semanticDiagnosticsPath: validation.diagnosticsPath,
    semanticFingerprint: validation.semanticFingerprint,
    ...fit,
  }
}

export async function renderMermaidPng(input: RenderMermaidPngInput): Promise<RenderedMermaidPng> {
  const validation = validateMermaidDiagram(input)
  if (!validation.valid) {
    return { rendered: false, diagnostics: validation.diagnostics, issues: [] }
  }
  const image = await renderMermaidImage(input)
  const png = image.pngBase64 ? Buffer.from(image.pngBase64, "base64") : undefined
  const validPng = png ? isPng(png) : false
  if (png && !validPng) {
    image.diagnostics.push({ code: "png-invalid", severity: "error", message: "Mermaid PNG payload is not a valid PNG." })
  }
  const response = image.response
  const local = image.local
  return {
    rendered: validPng && !image.diagnostics.some((item) => item.severity === "error"),
    png: validPng ? png : undefined,
    diagnostics: image.diagnostics,
    issues: response?.issues ?? local?.issues ?? [],
    width: response?.width ?? local?.width,
    height: response?.height ?? local?.height,
    pixelWidth: response?.pixelWidth ?? local?.pixelWidth,
    pixelHeight: response?.pixelHeight ?? local?.pixelHeight,
    scale: response?.scale ?? local?.scale ?? image.scale,
    contentBounds: response?.contentBounds ?? local?.contentBounds,
    cropBounds: response?.cropBounds ?? local?.cropBounds,
    padding: response?.padding ?? local?.padding,
    contentCropRatio: response?.contentCropRatio ?? local?.contentCropRatio,
    elapsedMs: response?.elapsedMs,
    renderer: response?.renderer ?? local?.renderer,
  }
}

type MermaidImage = {
  pngBase64?: string
  diagnostics: MermaidDiagnostic[]
  response?: RemoteMermaidRenderResponse
  local?: LocalMermaidRender
  scale: number
}

async function renderMermaidImage(input: RenderMermaidPngInput): Promise<MermaidImage> {
  const timeoutMs = input.timeoutMs ?? 120_000
  const endpoint = input.remoteEndpoint?.trim() || process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]?.trim()
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
    } catch (error) {
      const remote = classifyRenderError(error)
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
  return { pngBase64, diagnostics, response, local, scale }
}

export async function renderSourceBackedMermaidBatch(
  input: SourceBackedMermaidBatchInput,
): Promise<RenderedSourceBackedMermaidBatch> {
  const file = resolveWorkspacePath(input.manifestPath)
  const raw = await limitedText(file, 512 * 1024, "batch manifest")
  const parsed = JSON.parse(raw) as unknown
  const manifest = sourceBackedBatchManifest(parsed)
  const base = await secureBatchDirectory(manifest.basePath ?? ".", "batch basePath")
  const resultPath = await secureBatchOutput(base, resolveBatchResultPath(file, base, manifest.resultPath))
  const reserved = new Set([
    file,
    ...manifest.items.flatMap((item) => [
      resolveBatchPath(base, item.sourcePath, "batch sourcePath"),
      resolveBatchPath(base, item.semanticEvidencePath, "batch semanticEvidencePath"),
    ]),
  ])
  if (reserved.has(resultPath))
    throw new Error("batch resultPath must not overwrite the manifest, Mermaid source, or semantic evidence")

  const before = new Set(SemanticGuard.pending(input.semanticSessionId))
  if (before.size) {
    const repair = SemanticGuard.pendingDetails(input.semanticSessionId)[0]
    const expected = new Set(repair?.suggestedChildren.map((child) => child.suggestedDiagramId) ?? [])
    const actual = new Set(manifest.items.map((item) => item.diagramId))
    const missing = [...expected].filter((id) => !actual.has(id))
    const extra = [...actual].filter((id) => !expected.has(id))
    if (missing.length || extra.length) {
      throw new Error(
        [
          `Split-required parent ${repair?.diagramId ?? "(unknown)"} is pending. The next batch must be repair-only and contain exactly these suggested Diagram IDs: ${[...expected].join(", ")}.`,
          ...(missing.length ? [`Missing repair IDs: ${missing.join(", ")}.`] : []),
          ...(extra.length ? [`Unrelated or stale IDs: ${extra.join(", ")}.`] : []),
          "This preflight rejection does not consume semantic validation or render attempts.",
        ].join(" "),
      )
    }
  }
  const results: SourceBackedMermaidBatchItemResult[] = []
  const pending: MermaidSemanticFingerprint[] = []
  for (const [index, item] of manifest.items.entries()) {
    const result = await (async (): Promise<SourceBackedMermaidBatchItemResult> => {
      const sourceFile = await secureBatchFile(base, item.sourcePath, `Mermaid source for ${item.diagramId}`)
      const evidenceFile = await secureBatchFile(
        base,
        item.semanticEvidencePath,
        `semantic evidence for ${item.diagramId}`,
      )
      const source = await limitedText(sourceFile, 256 * 1024, `Mermaid source for ${item.diagramId}`)
      const parsedEvidence = JSON.parse(
        await limitedText(evidenceFile, 2 * 1024 * 1024, `semantic evidence for ${item.diagramId}`),
      ) as unknown
      if (!parsedEvidence || typeof parsedEvidence !== "object" || Array.isArray(parsedEvidence)) {
        throw new Error(`semantic evidence for ${item.diagramId} must be a JSON object`)
      }
      const evidence = parsedEvidence as { diagramId?: unknown; sourceHash?: unknown }
      if (evidence.diagramId !== item.diagramId) {
        return {
          index,
          diagramId: item.diagramId,
          sourcePath: portableWorkspacePath(sourceFile),
          semanticEvidencePath: portableWorkspacePath(evidenceFile),
          rendered: false,
          semanticStatus: "invalid",
          documentReady: false,
          issues: [
            {
              code: "semantic-batch-diagram-id-mismatch",
              severity: "error",
              message: `Batch item ${item.diagramId} references a claim manifest for ${String(evidence.diagramId ?? "(missing)")}.`,
            },
          ],
          warnings: [],
        }
      }
      const normalized = await normalizeBatchEvidence(evidence, base, source)
      if (normalized) {
        await fs.writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
      }
      const evidenceHash = createHash("sha256")
        .update(await fs.readFile(evidenceFile))
        .digest("hex")
      const validation = SemanticGuard.validate(input.semanticSessionId, portableWorkspacePath(evidenceFile))
      if (validation) {
        return {
          index,
          diagramId: item.diagramId,
          sourcePath: portableWorkspacePath(sourceFile),
          semanticEvidencePath: portableWorkspacePath(evidenceFile),
          rendered: false,
          semanticStatus: "invalid",
          documentReady: false,
          issues: [validation],
          warnings: [validation.message],
        }
      }
      const rendered = await renderMermaidDiagram({
        source,
        title: item.title ?? item.diagramId,
        taskSlug: item.taskSlug ?? manifest.taskSlug,
        sourceFile: item.sourceFile ?? path.basename(sourceFile),
        pngFile: item.pngFile ?? `${path.basename(sourceFile, path.extname(sourceFile))}.png`,
        remoteEndpoint: input.remoteEndpoint,
        theme: input.theme,
        background: input.background,
        scale: item.scale ?? input.scale,
        timeoutMs: input.timeoutMs,
        semanticMode: "source-backed",
        semanticEvidencePath: portableWorkspacePath(evidenceFile),
        semanticSessionId: input.semanticSessionId,
        allowSourceHashPlaceholder: true,
      })
      const semantic = rendered.semanticStatus === "valid" || rendered.semanticStatus === "valid-with-unknowns"
      const ready = Boolean(rendered.rendered && semantic && rendered.documentReady !== false && rendered.pngPath)
      if (ready) {
        SemanticGuard.allow(
          input.semanticSessionId,
          rendered.sourceHash,
          rendered.pngPath!,
          rendered.semanticFingerprint,
          source,
        )
      }
      if (rendered.rendered && semantic && !ready && rendered.semanticFingerprint) {
        pending.push(rendered.semanticFingerprint)
      }
      return {
        index,
        diagramId: item.diagramId,
        sourcePath: portableWorkspacePath(sourceFile),
        semanticEvidencePath: portableWorkspacePath(evidenceFile),
        rendered: rendered.rendered,
        semanticStatus: rendered.semanticStatus,
        sourceHash: rendered.sourceHash,
        semanticEvidenceHash: evidenceHash,
        pngPath: rendered.pngPath,
        diagnosticsPath: rendered.diagnosticsPath,
        semanticDiagnosticsPath: rendered.semanticDiagnosticsPath,
        wordFitStatus: rendered.wordFitStatus,
        wordFitReasons: rendered.wordFitReasons,
        documentReady: ready,
        claimCount: rendered.claimCount,
        validatedClaimCount: rendered.validatedClaimCount,
        issues: rendered.semanticIssues,
        warnings: rendered.warnings,
      }
    })().catch((err): SourceBackedMermaidBatchItemResult => {
      const message = err instanceof Error ? err.message : String(err)
      return {
        index,
        diagramId: item.diagramId,
        sourcePath: item.sourcePath,
        semanticEvidencePath: item.semanticEvidencePath,
        rendered: false,
        semanticStatus: "invalid",
        documentReady: false,
        issues: [
          {
            code: "semantic-batch-item-failed",
            severity: "error",
            message,
          },
        ],
        warnings: [message],
      }
    })
    results.push(result)
  }
  for (const fingerprint of pending) SemanticGuard.hold(input.semanticSessionId, fingerprint)

  const renderedCount = results.filter((item) => item.rendered).length
  const readyCount = results.filter((item) => item.documentReady).length
  const invalidCount = results.filter((item) => item.semanticStatus === "invalid").length
  const splitRequiredCount = results.filter((item) => item.wordFitStatus === "split-required").length
  const pendingSplitDiagramIds = SemanticGuard.pending(input.semanticSessionId)
  const pendingSplitSet = new Set(pendingSplitDiagramIds)
  const resolvedSplitDiagramIds = [...before].filter((id) => !pendingSplitSet.has(id))
  const pendingSplitDetails = SemanticGuard.pendingDetails(input.semanticSessionId)
  const value: RenderedSourceBackedMermaidBatch = {
    generatedAt: Date.now(),
    manifestPath: portableWorkspacePath(file),
    basePath: manifest.basePath ? portableWorkspacePath(base) : undefined,
    resultPath: portableWorkspacePath(resultPath),
    requestedCount: manifest.items.length,
    processedCount: results.length,
    renderedCount,
    readyCount,
    invalidCount,
    splitRequiredCount,
    complete: readyCount === manifest.items.length && pendingSplitDiagramIds.length === 0,
    resolvedSplitDiagramIds,
    pendingSplitDiagramIds,
    pendingSplitDetails,
    items: results,
  }
  await archiveBatchResult(resultPath)
  await fs.writeFile(resultPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  return value
}

export function mermaidWordFit(input: {
  width?: number
  height?: number
  status: MermaidSemanticStatus
  fingerprint?: MermaidWordFitFingerprint
  issues?: readonly MermaidRenderIssue[]
}) {
  if (input.status === "not-requested" || input.status === "invalid") return {}
  if (!input.width || !input.height) {
    return {
      wordFitStatus: "split-required" as const,
      wordFitReasons: ["Renderer did not return cropped CSS dimensions."],
      documentReady: false,
    }
  }
  const scale = Math.min(1, WORD_WIDTH / input.width, WORD_HEIGHT / input.height)
  const nodes = input.fingerprint?.nodeCount ?? input.fingerprint?.nodeIds.length ?? 0
  const edges = input.fingerprint?.edgeCount ?? input.fingerprint?.edges.length ?? 0
  const count = nodes + edges
  const density = count ? count / ((input.width * input.height) / 100_000) : 0
  const aspect = Math.max(input.width / input.height, input.height / input.width)
  const longLabels = input.fingerprint?.longLabelCount ?? 0
  const longEdges = input.fingerprint?.longEdgeLabelCount ?? 0
  const branching = input.fingerprint?.branchingNodeCount ?? 0
  const maxOutgoing = input.fingerprint?.maxOutgoingEdges ?? 0
  const collisionIssues = (input.issues ?? []).filter(
    (item) =>
      item.severity === "error" &&
      (item.code === "mermaid-render-label-collision" || item.code === "mermaid-render-collision-check-unavailable"),
  )
  const denseLongLabels = longLabels >= 10 && edges >= 8
  const denseBranching = branching >= 3 && longEdges >= 6 && edges >= nodes + 2
  const concentratedBranching = maxOutgoing >= 4 && longEdges >= 4
  const reasons = [
    ...(scale < WORD_MIN_SCALE
      ? [
          `Word-fit scale ${scale.toFixed(3)} is below ${WORD_MIN_SCALE}; split into a readable overview and focused figures.`,
        ]
      : []),
    ...(density > WORD_MAX_DENSITY
      ? [
          `Semantic density ${density.toFixed(1)} claims per 100k CSS px is above ${WORD_MAX_DENSITY}; split the layout.`,
        ]
      : []),
    ...(aspect > WORD_MAX_ASPECT
      ? [`Aspect ratio ${aspect.toFixed(2)} is above ${WORD_MAX_ASPECT}; regroup or split disconnected flow families.`]
      : []),
    ...(denseLongLabels || denseBranching || concentratedBranching
      ? [
          `Visual complexity (${nodes} nodes, ${edges} edges, ${longLabels} long labels, ${branching} branching nodes, max out-degree ${maxOutgoing}) is too dense for one Word figure; split it into focused figures without removing labels.`,
        ]
      : []),
    ...collisionIssues.map(
      (item) =>
        `${item.code}: ${item.message ?? "Rendered Mermaid labels or nodes overlap; split or regroup the figure."}`,
    ),
  ]
  return {
    wordFitScale: scale,
    wordFitDensity: density,
    wordFitAspectRatio: aspect,
    wordFitStatus: reasons.length ? ("split-required" as const) : ("readable" as const),
    wordFitReasons: reasons,
    documentReady: reasons.length === 0,
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
    figureTitle: input.figureTitle,
    altText: input.altText,
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

export function inspectMermaidSvgCollisions(source: string): MermaidRenderIssue[] {
  const errors: string[] = []
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") errors.push(message)
    },
  })
  const document = (() => {
    try {
      return parser.parseFromString(source, "image/svg+xml")
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  })()
  const root = document?.documentElement
  if (!root || root.localName !== "svg" || errors.length) {
    return [
      {
        severity: "error",
        code: "mermaid-render-collision-check-unavailable",
        message: `Rendered Mermaid SVG could not be inspected for label collisions${errors.length ? `: ${errors.join("; ")}` : "."}`,
      },
    ]
  }

  const boxes = Array.from(document.getElementsByTagName("foreignObject")).flatMap((element, index) => {
    const width = svgNumber(element.getAttribute("width"))
    const height = svgNumber(element.getAttribute("height"))
    if (width <= 0 || height <= 0) return []
    const edge = closestSvgClass(element, "edgeLabel")
    const node = closestSvgClass(element, "node")
    if (!edge && !node) return []
    const kind = edge ? ("edge-label" as const) : ("node-label" as const)
    const owner = edge ? closestSvgAttribute(element, "data-id") : node
    const id = owner?.getAttribute("data-id") || owner?.getAttribute("id") || `${kind}-${index}`
    const labelBounds = transformedSvgBounds(element, {
      x: svgNumber(element.getAttribute("x")),
      y: svgNumber(element.getAttribute("y")),
      width,
      height,
    })
    const nodeBounds = kind === "node-label" && node ? svgNodeBounds(node) : undefined
    const bounds = nodeBounds ?? labelBounds
    const padding = kind === "node-label" && !nodeBounds ? 8 : 0
    return [
      {
        id,
        kind,
        x: bounds.x - padding,
        y: bounds.y - padding,
        width: bounds.width + padding * 2,
        height: bounds.height + padding * 2,
      } satisfies SvgLabelBounds,
    ]
  })
  const collisions: Array<{ left: SvgLabelBounds; right: SvgLabelBounds; ratio: number }> = []
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex++) {
    const left = boxes[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex++) {
      const right = boxes[rightIndex]!
      const overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
      const overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
      if (overlapWidth < 4 || overlapHeight < 4) continue
      const overlap = overlapWidth * overlapHeight
      const ratio = overlap / Math.min(left.width * left.height, right.width * right.height)
      if (ratio < 0.05) continue
      collisions.push({ left, right, ratio })
    }
  }
  if (!collisions.length) return []
  const examples = collisions
    .slice(0, 8)
    .map(
      ({ left, right, ratio }) =>
        `${left.kind} ${left.id} overlaps ${right.kind} ${right.id} by ${(ratio * 100).toFixed(1)}%`,
    )
  return [
    {
      severity: "error",
      code: "mermaid-render-label-collision",
      message: `Rendered Mermaid SVG contains ${collisions.length} significant label/node collision(s): ${examples.join("; ")}.`,
    },
  ]
}

function svgNodeBounds(node: Element) {
  const boxes: PixelBounds[] = []
  for (const rect of Array.from(node.getElementsByTagName("rect"))) {
    const width = svgNumber(rect.getAttribute("width"))
    const height = svgNumber(rect.getAttribute("height"))
    if (width > 0 && height > 0)
      boxes.push(
        transformedSvgBounds(rect, {
          x: svgNumber(rect.getAttribute("x")),
          y: svgNumber(rect.getAttribute("y")),
          width,
          height,
        }),
      )
  }
  for (const circle of Array.from(node.getElementsByTagName("circle"))) {
    const radius = svgNumber(circle.getAttribute("r"))
    if (radius > 0)
      boxes.push(
        transformedSvgBounds(circle, {
          x: svgNumber(circle.getAttribute("cx")) - radius,
          y: svgNumber(circle.getAttribute("cy")) - radius,
          width: radius * 2,
          height: radius * 2,
        }),
      )
  }
  for (const ellipse of Array.from(node.getElementsByTagName("ellipse"))) {
    const radiusX = svgNumber(ellipse.getAttribute("rx"))
    const radiusY = svgNumber(ellipse.getAttribute("ry"))
    if (radiusX > 0 && radiusY > 0)
      boxes.push(
        transformedSvgBounds(ellipse, {
          x: svgNumber(ellipse.getAttribute("cx")) - radiusX,
          y: svgNumber(ellipse.getAttribute("cy")) - radiusY,
          width: radiusX * 2,
          height: radiusY * 2,
        }),
      )
  }
  for (const polygon of Array.from(node.getElementsByTagName("polygon"))) {
    const points = [...(polygon.getAttribute("points") ?? "").matchAll(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/g)].map(
      (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
    )
    if (!points.length) continue
    const x = Math.min(...points.map((point) => point.x))
    const y = Math.min(...points.map((point) => point.y))
    boxes.push(
      transformedSvgBounds(polygon, {
        x,
        y,
        width: Math.max(...points.map((point) => point.x)) - x,
        height: Math.max(...points.map((point) => point.y)) - y,
      }),
    )
  }
  if (!boxes.length) return
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return { x, y, width: right - x, height: bottom - y }
}

function closestSvgClass(element: Element, name: string) {
  let current: Element | undefined = element
  while (current) {
    const classes = current.getAttribute("class")?.split(/\s+/) ?? []
    if (classes.includes(name)) return current
    current = svgParent(current)
  }
}

function closestSvgAttribute(element: Element, name: string) {
  let current: Element | undefined = element
  while (current) {
    if (current.hasAttribute(name)) return current
    current = svgParent(current)
  }
}

function svgParent(element: Element) {
  const parent = element.parentNode
  return parent?.nodeType === 1 ? (parent as Element) : undefined
}

function transformedSvgBounds(element: Element, bounds: PixelBounds): PixelBounds {
  const chain: Element[] = []
  let current: Element | undefined = element
  while (current) {
    chain.push(current)
    current = svgParent(current)
  }
  const matrix = chain.toReversed().reduce((value, item) => multiplySvgMatrix(value, svgTransform(item)), svgIdentity())
  const corners = [
    svgPoint(matrix, bounds.x, bounds.y),
    svgPoint(matrix, bounds.x + bounds.width, bounds.y),
    svgPoint(matrix, bounds.x, bounds.y + bounds.height),
    svgPoint(matrix, bounds.x + bounds.width, bounds.y + bounds.height),
  ]
  const x = Math.min(...corners.map((point) => point.x))
  const y = Math.min(...corners.map((point) => point.y))
  const right = Math.max(...corners.map((point) => point.x))
  const bottom = Math.max(...corners.map((point) => point.y))
  return { x, y, width: right - x, height: bottom - y }
}

function svgTransform(element: Element): SvgMatrix {
  const source = element.getAttribute("transform") ?? ""
  const matches = source.matchAll(/(matrix|translate|scale)\s*\(([^)]*)\)/g)
  return [...matches].reduce((value, match) => {
    const numbers = match[2]!.split(/[\s,]+/).filter(Boolean).map(Number)
    const next = (() => {
      if (match[1] === "matrix" && numbers.length >= 6)
        return { a: numbers[0]!, b: numbers[1]!, c: numbers[2]!, d: numbers[3]!, e: numbers[4]!, f: numbers[5]! }
      if (match[1] === "translate")
        return { a: 1, b: 0, c: 0, d: 1, e: numbers[0] ?? 0, f: numbers[1] ?? 0 }
      if (match[1] === "scale")
        return { a: numbers[0] ?? 1, b: 0, c: 0, d: numbers[1] ?? numbers[0] ?? 1, e: 0, f: 0 }
      return svgIdentity()
    })()
    return multiplySvgMatrix(value, next)
  }, svgIdentity())
}

function svgIdentity(): SvgMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
}

function multiplySvgMatrix(left: SvgMatrix, right: SvgMatrix): SvgMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

function svgPoint(matrix: SvgMatrix, x: number, y: number) {
  return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }
}

function svgNumber(value: string | null) {
  const number = Number.parseFloat(value ?? "0")
  return Number.isFinite(number) ? number : 0
}

async function renderWithMmdc(
  source: string,
  background: string,
  scale: number,
  timeoutMs: number,
): Promise<LocalMermaidRender> {
  const requested = process.env["CHIPMATE_MERMAID_MMDC"]?.trim() || "mmdc"
  const command = path.isAbsolute(requested) ? requested : (Bun.which(requested) ?? requested)
  const tmp = path.join(
    Instance.directory,
    ProductProfile.label(),
    "tmp",
    `mermaid-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const input = path.join(tmp, "diagram.mmd")
  const svg = path.join(tmp, "diagram.svg")
  const output = path.join(tmp, "diagram.png")
  await fs.mkdir(tmp, { recursive: true })
  await fs.writeFile(input, source, "utf8")
  try {
    const startedAt = Date.now()
    await execFileWithTimeout(command, ["-i", input, "-o", svg, "-b", background, "-s", String(scale)], timeoutMs)
    const svgSource = await fs.readFile(svg, "utf8")
    const visualIssues = inspectMermaidSvgCollisions(svgSource)
    const visualDiagnostics = visualIssues.map(
      (issue): MermaidDiagnostic => ({
        code:
          issue.code === "mermaid-render-label-collision"
            ? "mermaid-render-label-collision"
            : "mermaid-render-collision-check-unavailable",
        severity: "warning",
        message: issue.message ?? "Mermaid SVG visual collision inspection failed.",
      }),
    )
    const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt))
    await execFileWithTimeout(command, ["-i", input, "-o", output, "-b", background, "-s", String(scale)], remaining)
    const png = await fs.readFile(output)
    if (!isPng(png))
      return {
        diagnostics: [{ code: "png-invalid", severity: "error", message: "mmdc output is not a valid PNG." }],
        issues: [],
      }
    const result = await cropLocalPng(png, background, scale)
    return {
      ...result,
      diagnostics: [...visualDiagnostics, ...result.diagnostics],
      issues: [...visualIssues, ...result.issues],
      renderer: { ...result.renderer, visualInspection: "svg-label-bounds" },
    }
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
    const child = execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, env: userEnv(process.env) },
      (err, _stdout, stderr) => {
        if (err) {
          reject(Object.assign(err, { stderr }))
          return
        }
        resolve()
      },
    )
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
        "Mermaid renderer executable was not found. Configure CHIPMATE_MERMAID_RENDER_ENDPOINT or install mmdc externally.",
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
  let quoted = false
  for (const char of source) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) continue
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

function sourceBackedBatchManifest(input: unknown): {
  version: 1
  basePath?: string
  taskSlug?: string
  resultPath?: string
  items: SourceBackedMermaidBatchItem[]
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("source-backed Mermaid batch manifest must be a JSON object")
  }
  const value = input as {
    version?: unknown
    basePath?: unknown
    taskSlug?: unknown
    resultPath?: unknown
    items?: unknown
  }
  if (value.version !== 1) throw new Error("source-backed Mermaid batch manifest version must be 1")
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 20) {
    throw new Error("source-backed Mermaid batch manifest items must contain 1 to 20 diagrams")
  }
  if (value.basePath !== undefined && (typeof value.basePath !== "string" || !value.basePath.trim())) {
    throw new Error("source-backed Mermaid batch basePath must be a non-empty string")
  }
  if (value.taskSlug !== undefined && typeof value.taskSlug !== "string") {
    throw new Error("source-backed Mermaid batch taskSlug must be a string")
  }
  if (value.resultPath !== undefined && typeof value.resultPath !== "string") {
    throw new Error("source-backed Mermaid batch resultPath must be a string")
  }
  const items = value.items.map((entry, index) => sourceBackedBatchItem(entry, index))
  const ids = new Set(items.map((item) => item.diagramId))
  if (ids.size !== items.length) throw new Error("source-backed Mermaid batch diagramId values must be unique")
  return {
    version: 1,
    basePath: typeof value.basePath === "string" ? value.basePath.trim() : undefined,
    taskSlug: value.taskSlug?.trim() || undefined,
    resultPath: value.resultPath?.trim() || undefined,
    items,
  }
}

function sourceBackedBatchItem(input: unknown, index: number): SourceBackedMermaidBatchItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`source-backed Mermaid batch item ${index} must be a JSON object`)
  }
  const value = input as Record<string, unknown>
  const required = (key: "diagramId" | "sourcePath" | "semanticEvidencePath") => {
    const field = value[key]
    if (typeof field !== "string" || !field.trim()) {
      throw new Error(`source-backed Mermaid batch item ${index} ${key} is required`)
    }
    return field.trim()
  }
  const optional = (key: "title" | "taskSlug" | "sourceFile" | "pngFile") => {
    const field = value[key]
    if (field === undefined) return
    if (typeof field !== "string") throw new Error(`source-backed Mermaid batch item ${index} ${key} must be a string`)
    return field.trim() || undefined
  }
  const diagramId = required("diagramId")
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(diagramId)) {
    throw new Error(`source-backed Mermaid batch item ${index} diagramId contains unsupported characters`)
  }
  if (value.scale !== undefined && (typeof value.scale !== "number" || !Number.isFinite(value.scale))) {
    throw new Error(`source-backed Mermaid batch item ${index} scale must be a finite number`)
  }
  return {
    diagramId,
    sourcePath: required("sourcePath"),
    semanticEvidencePath: required("semanticEvidencePath"),
    title: optional("title"),
    taskSlug: optional("taskSlug"),
    sourceFile: optional("sourceFile"),
    pngFile: optional("pngFile"),
    scale: value.scale as number | undefined,
  }
}

async function limitedText(file: string, limit: number, label: string) {
  const stat = await fs.stat(file)
  if (!stat.isFile()) throw new Error(`${label} must be a file`)
  if (stat.size > limit) throw new Error(`${label} exceeds the ${limit}-byte limit`)
  return fs.readFile(file, "utf8")
}

function resolveBatchResultPath(manifest: string, base: string, input?: string) {
  if (!input) {
    const ext = path.extname(manifest)
    return path.join(path.dirname(manifest), `${path.basename(manifest, ext)}.results.json`)
  }
  return resolveBatchPath(base, input, "batch resultPath")
}

function resolveBatchPath(base: string, input: string, label: string) {
  if (!input.trim()) throw new Error(`${label} is required`)
  const file = path.resolve(base, input)
  assertBatchInside(base, file, label)
  return file
}

async function secureBatchDirectory(input: string, label: string) {
  const file = resolveWorkspacePath(input)
  const [root, real] = await Promise.all([fs.realpath(Instance.directory), fs.realpath(file)])
  assertInside(root, real, label)
  const stat = await fs.stat(real)
  if (!stat.isDirectory()) throw new Error(`${label} must be a workspace directory`)
  return real
}

async function secureBatchFile(base: string, input: string, label: string) {
  const file = resolveBatchPath(base, input, label)
  const real = await fs.realpath(file)
  assertBatchInside(base, real, label)
  return real
}

async function secureBatchOutput(base: string, file: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const parent = await fs.realpath(path.dirname(file))
  assertBatchInside(base, parent, "batch resultPath")
  const output = path.join(parent, path.basename(file))
  const stat = await fs.lstat(output).then(
    (value) => value,
    () => undefined,
  )
  if (stat?.isSymbolicLink()) throw new Error("batch resultPath must not be a symbolic link")
  return output
}

async function archiveBatchResult(file: string) {
  const raw = await fs.readFile(file, "utf8").catch(() => "")
  if (!raw) return
  const dir = path.join(path.dirname(file), ".history")
  const name = path.basename(file).replace(/(?:\.results)?\.json$/, "")
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12)
  const target = path.join(dir, `${name}.${hash}.results.json`)
  if (await exists(target)) return
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(target, raw, "utf8")
}

async function normalizeBatchEvidence(input: Record<string, unknown>, base: string, source: string) {
  let changed = false
  const rewrite = async (value: string) => {
    if (!value.trim()) return value
    const workspace = resolveWorkspacePath(value)
    if (await exists(workspace)) {
      const next = portableWorkspacePath(workspace) || "."
      changed ||= next !== value
      return next
    }
    const rooted = resolveBatchPath(base, value, "semantic evidence path")
    if (await exists(rooted)) {
      const next = portableWorkspacePath(rooted) || "."
      changed ||= next !== value
      return next
    }
    return value
  }
  const visit = async (value: unknown): Promise<void> => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const item of value) await visit(item)
      return
    }
    const record = value as Record<string, unknown>
    for (const [key, item] of Object.entries(record)) {
      if ((key === "path" || key === "scopePath" || key === "designUnitCensusPath") && typeof item === "string") {
        record[key] = await rewrite(item)
        continue
      }
      await visit(item)
    }
  }
  await visit(input)
  const containers = mermaidContainers(source)
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  for (const item of nodes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const node = item as Record<string, unknown>
    if (typeof node.id !== "string" || node.container !== undefined) continue
    const container = containers.get(node.id)
    if (!container) continue
    node.container = container
    changed = true
  }
  const groups = Array.isArray(input.nodeGroups) ? input.nodeGroups : []
  for (const group of groups) {
    if (!group || typeof group !== "object" || Array.isArray(group)) continue
    const items = (group as Record<string, unknown>).items
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (!Array.isArray(item) || typeof item[0] !== "string" || item[2] !== undefined) continue
      const container = containers.get(item[0])
      if (!container) continue
      item[2] = container
      changed = true
    }
  }
  return changed
}

async function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

function portableWorkspacePath(input: string) {
  return normalizePortable(path.relative(Instance.directory, input))
}

function assertInside(base: string, target: string, label: string): void {
  const relative = path.relative(base, target)
  if (relative === "") return
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must be inside workspace`)
}

function assertBatchInside(base: string, target: string, label: string): void {
  const relative = path.relative(base, target)
  if (relative === "") return
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside batch basePath`)
  }
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
