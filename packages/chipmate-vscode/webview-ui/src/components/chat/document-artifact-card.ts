import type { ToolPart } from "../../types/messages"

export type DocumentArtifactLinkKind = "primary" | "pdf" | "page-png" | "diagnostics" | "folder" | "source" | "json"

export type DocumentArtifactLink = {
  kind: DocumentArtifactLinkKind
  label: string
  path: string
  webviewUri?: string
}

export type DocumentArtifactCardModel = {
  tool: string
  title: string
  artifactDir?: string
  quality?: "ok" | "warning" | "failed" | "unknown"
  warnings: string[]
  links: DocumentArtifactLink[]
}

const DOCUMENT_ARTIFACT_TOOLS = new Set([
  "create_word_document",
  "apply_word_document_edits",
  "apply_word_template_styles",
  "materialize_word_fields",
  "merge_word_documents",
  "diff_word_documents",
  "render_word_document",
  "word_to_images",
  "save_mermaid_artifact",
  "render_mermaid_diagram",
  "render_plantuml_diagram",
  "insert_mermaid_into_word",
])

const WARNING_RE = /\bwarning\b/i
const FAILED_RE = /\bfailed|error\b/i

export function documentArtifactCardFromToolPart(part: ToolPart): DocumentArtifactCardModel | undefined {
  if (!DOCUMENT_ARTIFACT_TOOLS.has(part.tool)) return undefined
  if (part.state.status !== "completed") return undefined
  const state = part.state
  const output = parseObject(state.output)
  const metadata = isObject(state.metadata) ? state.metadata : {}
  const read = (key: string) => value(metadata[key]) ?? value(output[key])
  const artifactDir = read("artifactDir")
  const warnings = [...new Set(stringArray(metadata.warnings).concat(stringArray(output.warnings)))]
  const links = uniqueLinks([
    link("primary", "Open artifact", read("path") ?? read("wordPath")),
    link("pdf", "Open PDF", read("pdfPath")),
    ...stringArray(output.pagePngPaths).map((item, index) => ({
      kind: "page-png" as const,
      label:
        part.tool === "word_to_images"
          ? `查看第 ${Array.isArray(output.pageNumbers) ? output.pageNumbers[index] : index + 1} 页`
          : `Open page PNG ${index + 1}`,
      path: item,
      webviewUri: stringArray(output.pagePngWebviewUris)[index],
    })),
    link("diagnostics", "Open diagnostics", read("diagnosticsPath")),
    link("json", "Open JSON", read("jsonPath")),
    link(
      "source",
      part.tool === "word_to_images"
        ? "查看原 Word"
        : part.tool === "render_plantuml_diagram"
          ? "Open PlantUML source"
          : "Open Mermaid source",
      read("sourcePath"),
    ),
    link(
      "page-png",
      part.tool === "render_plantuml_diagram" ? "Open PlantUML PNG" : "Open Mermaid PNG",
      read("pngPath") ?? read("mermaidPngPath"),
    ),
    link("folder", "Open artifact folder", artifactDir),
  ])
  if (!artifactDir && links.length === 0) return undefined
  return {
    tool: part.tool,
    title: titleFor(part.tool, state.title),
    artifactDir,
    quality: qualityFrom(metadata.quality ?? output.quality, warnings, part.tool, metadata, output),
    warnings,
    links,
  }
}

function titleFor(tool: string, fallback?: string): string {
  if (fallback?.trim()) return fallback
  if (tool.includes("plantuml")) return "PlantUML artifact"
  if (tool.includes("mermaid")) return "Mermaid artifact"
  if (tool === "diff_word_documents") return "Word diff artifact"
  if (tool === "render_word_document") return "Word render artifact"
  if (tool === "word_to_images") return "Word 页面图片"
  return "Word document artifact"
}

function link(
  kind: DocumentArtifactLinkKind,
  label: string,
  path: string | undefined,
): DocumentArtifactLink | undefined {
  if (!path?.trim()) return undefined
  return { kind, label, path }
}

function uniqueLinks(input: Array<DocumentArtifactLink | undefined>): DocumentArtifactLink[] {
  const seen = new Set<string>()
  const result: DocumentArtifactLink[] = []
  for (const item of input) {
    if (!item) continue
    const key = `${item.kind}:${item.path}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function parseObject(input: string | undefined): Record<string, unknown> {
  if (!input?.trim()) return {}
  try {
    const parsed = JSON.parse(input)
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isObject(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

function value(input: unknown): string | undefined {
  return typeof input === "string" && input.trim() ? input : undefined
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function qualityFrom(
  input: unknown,
  warnings: string[],
  tool: string,
  metadata: Record<string, unknown>,
  output: Record<string, unknown>,
): DocumentArtifactCardModel["quality"] {
  if (input === "ok" || input === "warning" || input === "failed" || input === "unknown") return input
  if (tool === "render_mermaid_diagram" || tool === "render_plantuml_diagram") {
    const rendered = flag(metadata.rendered) ?? flag(output.rendered)
    const issues = objects(metadata.issues).concat(objects(output.issues), objects(output.diagnostics))
    if (rendered === false || issues.some((item) => item.severity === "error")) return "failed"
    if (rendered === true) {
      if (warnings.length || issues.some((item) => item.severity === "warning")) return "warning"
      return "ok"
    }
  }
  if (warnings.some((item) => FAILED_RE.test(item))) return "failed"
  if (warnings.some((item) => WARNING_RE.test(item))) return "warning"
  return warnings.length ? "warning" : "unknown"
}

function flag(input: unknown): boolean | undefined {
  return typeof input === "boolean" ? input : undefined
}

function objects(input: unknown): Array<Record<string, unknown>> {
  return Array.isArray(input) ? input.filter(isObject) : []
}
