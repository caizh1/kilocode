import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { declareArtifact } from "@/kilocode/documents/artifacts"
import { insertWordPngImage } from "@/kilocode/documents/word"
import { Instance } from "@/project/instance"

export type MermaidDiagnosticCode =
  | "chrome-not-found"
  | "chrome-startup-failed"
  | "mermaid-render-failed"
  | "mermaid-render-timeout"
  | "png-invalid"
  | "artifact-write-failed"

export type MermaidDiagnostic = {
  code: MermaidDiagnosticCode
  severity: "warning" | "error"
  message: string
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
  timeoutMs?: number
}

export type RenderedMermaidDiagram = SavedMermaidArtifact & {
  rendered: boolean
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
  pngBase64?: string
  warnings?: string[]
}

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
    diagnostics.push({ code: "mermaid-render-failed", severity: "error", message: "Mermaid source contains unsafe script-like content." })
  }
  const firstLine = source.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ""
  const starter = DIAGRAM_STARTERS.find((item) => firstLine === item || firstLine.startsWith(`${item} `) || firstLine.startsWith(`${item}\t`))
  if (!starter) {
    diagnostics.push({ code: "mermaid-render-failed", severity: "error", message: `Unsupported or missing Mermaid diagram starter: ${firstLine || "(empty)"}` })
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
      qualityStatus: diagnostics.some((item) => item.severity === "error") ? "failed" : diagnostics.length ? "warning" : "ok",
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
      diagnostics: [...diagnostics, { code: "artifact-write-failed", severity: "error", message: err instanceof Error ? err.message : String(err) }],
      warnings: [...warnings, `artifact-write-failed: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}

export async function renderMermaidDiagram(input: RenderMermaidDiagramInput): Promise<RenderedMermaidDiagram> {
  const validation = validateMermaidDiagram({ source: input.source })
  if (!validation.valid) {
    const saved = await saveMermaidArtifact({ ...input, diagnostics: validation.diagnostics })
    return { ...saved, rendered: false }
  }
  const timeoutMs = input.timeoutMs ?? 120_000
  const endpoint = input.remoteEndpoint?.trim() || process.env["KILO_MERMAID_RENDER_ENDPOINT"]?.trim()
  const diagnostics: MermaidDiagnostic[] = []
  let pngBase64: string | undefined
  if (endpoint) {
    try {
      const response = await callRemoteRenderer(endpoint, input, timeoutMs)
      pngBase64 = response.pngBase64
      diagnostics.push(...(response.warnings ?? []).map((message) => ({ code: "mermaid-render-failed" as const, severity: "warning" as const, message })))
    } catch (err) {
      diagnostics.push(classifyRenderError(err))
    }
  } else {
    const rendered = await renderWithMmdc(input.source, input.background, timeoutMs)
    pngBase64 = rendered.pngBase64
    diagnostics.push(...rendered.diagnostics)
  }
  const saved = await saveMermaidArtifact({ ...input, pngBase64, diagnostics })
  return { ...saved, rendered: Boolean(saved.pngPath && !saved.diagnostics.some((item) => item.severity === "error")) }
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
    const saved = await saveMermaidArtifact({ source: input.source, pngPath, pngBase64, taskSlug: input.taskSlug ? `${input.taskSlug}-mermaid` : undefined, title: input.title ? `${input.title} Mermaid` : undefined })
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

async function callRemoteRenderer(endpoint: string, input: RenderMermaidDiagramInput, timeoutMs: number): Promise<RemoteMermaidRenderResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: input.source, theme: input.theme, background: input.background }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`renderer returned HTTP ${response.status}`)
    return await response.json() as RemoteMermaidRenderResponse
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("mermaid-render-timeout")
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function renderWithMmdc(source: string, background: string | undefined, timeoutMs: number): Promise<{ pngBase64?: string; diagnostics: MermaidDiagnostic[] }> {
  const command = process.env["KILO_MERMAID_MMDC"]?.trim() || "mmdc"
  const tmp = path.join(Instance.directory, ".kilo", "tmp", `mermaid-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const input = path.join(tmp, "diagram.mmd")
  const output = path.join(tmp, "diagram.png")
  await fs.mkdir(tmp, { recursive: true })
  await fs.writeFile(input, source, "utf8")
  try {
    await execFileWithTimeout(command, ["-i", input, "-o", output, "-b", background ?? "transparent"], timeoutMs)
    const png = await fs.readFile(output)
    if (!isPng(png)) return { diagnostics: [{ code: "png-invalid", severity: "error", message: "mmdc output is not a valid PNG." }] }
    return { pngBase64: Buffer.from(png).toString("base64"), diagnostics: [] }
  } catch (err) {
    return { diagnostics: [classifyRenderError(err)] }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

function execFileWithTimeout(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
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
  if (message === "mermaid-render-timeout" || /timed out|timeout/i.test(message)) return { code: "mermaid-render-timeout", severity: "error", message: "Mermaid rendering timed out." }
  if (code === "ENOENT") return { code: "chrome-not-found", severity: "error", message: "Mermaid renderer executable was not found. Configure KILO_MERMAID_RENDER_ENDPOINT or install mmdc externally." }
  if (/chrome|chromium|browser/i.test(`${message}\n${stderr}`)) return { code: "chrome-startup-failed", severity: "error", message: `${message}${stderr ? `: ${stderr}` : ""}` }
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
    if ((char === ")" || char === "]" || char === "}") && stack.pop() !== char) return { valid: false, message: `Unbalanced Mermaid bracket near "${char}".` }
  }
  return stack.length ? { valid: false, message: "Unbalanced Mermaid brackets." } : { valid: true, message: "" }
}

function safeMmdName(input: string): string {
  const base = input
    .replace(/\.mmd$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "diagram"
  return `${base}.mmd`
}

function safePngName(input: string): string {
  const base = normalizePortable(input)
    .replace(/^\/+/, "")
    .replace(/\.png$/i, "")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[\\:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, ""))
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
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
}

function normalizePortable(input: string): string {
  return input.split(path.sep).join("/")
}
