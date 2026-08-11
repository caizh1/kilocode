import { createHash } from "node:crypto"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { extractDocument } from "../indexing/documents/extractors"
import { extractBehaviorEvidence, extractRootComponentBehaviorEvidence } from "./behavior"
import { extractCodeStructureEvidence } from "./code-structure"
import { extractLifecycleEvidence } from "./lifecycle"
import { extractStructureEvidence } from "./structure"
import type {
  DiscoveredDesignDocModule,
  ProductDesignSection,
  ProductExtractionResult,
  ProductReferenceInput,
  RawProductEvidence,
} from "./types"
import { DesignDocDiscoveryError } from "./types"

export interface ExtractProductEvidenceInput {
  module: DiscoveredDesignDocModule
  section: ProductDesignSection
  workspace: string
  references?: ProductReferenceInput[]
}

/**
 * 为产品级详细设计章节提取专用证据。章节选择完全由 runtime 决定；模型只在
 * 当前章节的有界证据内组织设计说明，不能把文件清单当作正文结构。
 */
export async function extractProductEvidence(input: ExtractProductEvidenceInput): Promise<ProductExtractionResult> {
  const { module, section } = input
  const [structure, code, behavior, lifecycle, references] = await Promise.all([
    extractStructureEvidence(module),
    extractCodeStructureEvidence(module),
    module.unitKind === "root" ? extractRootComponentBehaviorEvidence(module) : extractBehaviorEvidence(module),
    extractLifecycleEvidence(module),
    extractReferenceEvidence(input.workspace, input.references ?? []),
  ])
  const source: RawProductEvidence[] = deduplicate([
    ...structure.evidence,
    ...code.evidence,
    ...behavior.evidence,
    ...lifecycle.evidence,
    ...references,
  ])
  const requirements = source.filter((item) => item.kind === "requirement")
  const evidence =
    section === "requirements"
      ? requirements.length
        ? source.filter(
            (item) =>
              item.kind === "requirement" ||
              item.kind === "code-symbol" ||
              item.kind === "flow-node" ||
              item.kind === "call-message",
          )
        : []
      : source.flatMap((item) => sectionEvidence(section, item))
  const unknowns = [...new Set([...structure.unknowns, ...code.unknowns, ...behavior.unknowns, ...lifecycle.unknowns])]
  if (section === "requirements" && !evidence.some((item) => item.kind === "requirement")) {
    unknowns.push("requirements-missing:未提供上游需求证据；本章只能列出源码可证实的实现责任，不能生成 AR 编号")
  }
  if (!evidence.some((item) => item.confidence === "explicit")) {
    unknowns.push(`product-section-absence:${section}:当前输入中没有足够的显式证据`)
  }
  return {
    moduleID: module.id,
    sourceSnapshotHash: module.sourceSnapshotHash,
    section,
    evidence,
    unknowns,
  }
}

function sectionEvidence(section: ProductDesignSection, item: RawProductEvidence): RawProductEvidence[] {
  const text = searchable(item)
  if (section === "requirements") return []
  if (section === "module-overview") {
    if (["dependency", "call-message", "architecture-reference", "module-boundary"].includes(item.kind)) return [item]
    if (item.kind === "flow-node" && item.attributes.nodeKind === "entry") return [item]
    return []
  }
  if (section === "overall-structure") {
    return ["source-file", "dependency", "architecture-reference", "module-boundary"].includes(item.kind)
      ? [item]
      : []
  }
  if (section === "data-entities") {
    if (item.kind === "data-entity" && String(item.attributes.ref).startsWith("root-component-data:")) return []
    if (["data-entity", "state-definition", "state-field"].includes(item.kind)) return [item]
    if (item.kind === "code-symbol" && !callable(item)) return [item]
    return []
  }
  if (section === "algorithms") {
    return ["flow-node", "flow-edge", "call-message", "guard", "timeout"].includes(item.kind) ? [item] : []
  }
  if (section === "provided-interfaces") {
    if (item.kind === "interface-reference") return [item]
    if (item.kind !== "code-symbol" || !callable(item)) return []
    return publicDeclaration(item) ? [item] : []
  }
  if (section === "required-interfaces") {
    if (item.kind === "interface-reference" || item.kind === "dependency") return [item]
    if (item.kind === "call-message" && String(item.attributes.callKind) === "external") return [item]
    return []
  }
  if (section === "internal-interfaces") {
    if (item.kind === "call-message" && String(item.attributes.callKind) !== "external") return [item]
    if (item.kind === "code-symbol" && callable(item) && !publicDeclaration(item)) return [item]
    return []
  }
  if (section === "key-flows") {
    return ["flow-node", "flow-edge", "call-message", "state-transition", "error-node", "error-edge"].includes(
      item.kind,
    )
      ? [item]
      : []
  }
  if (section === "resource-performance") {
    if (!resourcePattern.test(text)) return []
    const resourceEvidence =
      ["data-entity", "state-definition", "state-field", "config", "guard", "timeout"].includes(item.kind) ||
      (item.kind === "code-symbol" && !callable(item)) ||
      (item.kind === "flow-node" && item.attributes.nodeKind === "loop")
    if (!resourceEvidence) return []
    return [{ ...item, kind: "resource", fact: `资源或性能约束：${item.fact}` }]
  }
  if (section === "dfx") {
    if (!diagnosticPattern.test(text)) return []
    return [{ ...item, kind: "diagnostic", fact: `诊断与定位机制：${item.fact}` }]
  }
  if (section === "sfmea") {
    if (!["error-node", "error-edge", "error-path", "timeout", "guard"].includes(item.kind)) return []
    return [{ ...item, kind: "failure-mode", fact: `潜在失效与现有处理：${item.fact}` }]
  }
  if (section === "verification") {
    if (item.source.sourceKind !== "test" && item.kind !== "test-reference") return []
    return [item.kind === "test-reference" ? item : { ...item, kind: "test-reference" }]
  }
  return []
}

async function extractReferenceEvidence(workspace: string, inputs: ProductReferenceInput[]): Promise<RawProductEvidence[]> {
  const root = await realpath(path.resolve(workspace))
  const values: RawProductEvidence[] = []
  for (const input of inputs) {
    const candidate = path.resolve(root, input.path)
    const actual = await realpath(candidate).catch(() => undefined)
    const stat = actual ? await lstat(actual).catch(() => undefined) : undefined
    if (!actual || !stat?.isFile()) {
      throw new DesignDocDiscoveryError("INVALID_TARGET", `参考文档不存在或不是普通文件：${input.path}`)
    }
    assertContained(root, actual)
    const sections = await extractDocument(actual, 4 * 1024 * 1024)
    const relative = portable(path.relative(root, actual))
    for (const section of sections) {
      const chunks = documentChunks(section.text)
      for (const chunk of chunks) {
        const kind = referenceKind(input.kind)
        values.push({
          kind,
          fact: referenceFact(input.kind, chunk.text),
          source: {
            path: relative,
            contentHash: sha256(section.text),
            startLine: section.page ?? section.startLine + chunk.start,
            endLine: section.page ?? section.startLine + chunk.end,
            sourceKind: "document",
          },
          attributes: {
            referenceKind: input.kind,
            ...(section.page ? { page: section.page } : {}),
            ...(requirementID(chunk.text) ? { requirementID: requirementID(chunk.text)! } : {}),
          },
          confidence: "explicit",
          snippet: chunk.text,
        })
      }
    }
  }
  return values
}

function documentChunks(value: string) {
  const lines = value.split(/\r?\n/)
  const chunks: Array<{ text: string; start: number; end: number }> = []
  for (let start = 0; start < lines.length; start += 12) {
    const selected = lines.slice(start, start + 12).join("\n").trim()
    if (!selected) continue
    chunks.push({ text: selected.slice(0, 4_000), start, end: Math.min(lines.length - 1, start + 11) })
  }
  return chunks
}

function referenceKind(kind: ProductReferenceInput["kind"]): RawProductEvidence["kind"] {
  if (kind === "requirement") return "requirement"
  if (kind === "architecture") return "architecture-reference"
  if (kind === "interface") return "interface-reference"
  return "test-reference"
}

function referenceFact(kind: ProductReferenceInput["kind"], text: string) {
  const label = { requirement: "需求", architecture: "概设", interface: "接口文档", test: "测试文档" }[kind]
  const first = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? label
  return `${label}说明：${first.slice(0, 240)}`
}

function requirementID(value: string) {
  return value.match(/\b(?:AR|REQ|SR|FR)[-_ ]?\d+(?:[-_.]\d+)*\b/i)?.[0]
}

function callable(item: RawProductEvidence) {
  return item.attributes.symbolKind === "function" || item.attributes.symbolKind === "method"
}

function publicDeclaration(item: RawProductEvidence) {
  return /\.(?:h|hh|hpp|hxx)$/i.test(item.source.path) || /\bexport\b/.test(item.snippet)
}

function searchable(item: RawProductEvidence) {
  return `${item.fact}\n${item.snippet}\n${JSON.stringify(item.attributes)}`
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_./:#-]+/g, " ")
}

function deduplicate(values: RawProductEvidence[]) {
  const seen = new Set<string>()
  return values.filter((item) => {
    const key = `${item.kind}\0${item.source.path}\0${item.source.startLine}\0${item.fact}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function assertContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return
  }
  throw new DesignDocDiscoveryError("PATH_ESCAPE", "参考文档必须位于当前工作区内")
}

function portable(value: string) {
  return value.split(path.sep).join("/")
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

const resourcePattern =
  /\b(buffer|cache|queue|fifo|pool|memory|heap|stack|dma|timeout|limit|max|min|size|length|count|concurrency|parallel|latency|throughput|performance|ddr|sram|flash)\b/i
const diagnosticPattern =
  /\b(log|debug|trace|assert|printf|print|metric|telemetry|diagnostic|dump|inspect|monitor|health|error code|counter)\b/i
