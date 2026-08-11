import type {
  DesignDocTopic,
  DiscoveredDesignDocModule,
  TopicExtractionResult,
  TopicExtractionResult as Result,
} from "./types"
import { extractBehaviorEvidence, extractRootComponentBehaviorEvidence } from "./behavior"
import { extractCodeStructureEvidence } from "./code-structure"
import { extractLifecycleEvidence } from "./lifecycle"
import { extractStructureEvidence } from "./structure"

type RawEvidence = Result["evidence"][number]
export interface TopicEvidenceCandidate {
  kind: RawEvidence["kind"]
  fact: string
  snippet: string
  attributes: Record<string, string | number | boolean | null>
}

export async function extractTopicEvidence(
  module: DiscoveredDesignDocModule,
  topic: DesignDocTopic,
): Promise<TopicExtractionResult> {
  const [structure, code, behavior, lifecycle] = await Promise.all([
    extractStructureEvidence(module),
    extractCodeStructureEvidence(module),
    module.unitKind === "root" ? extractRootComponentBehaviorEvidence(module) : extractBehaviorEvidence(module),
    extractLifecycleEvidence(module),
  ])
  const extracted: RawEvidence[] = [
    ...structure.evidence,
    ...code.evidence,
    ...behavior.evidence,
    ...lifecycle.evidence,
  ]
  const unique = deduplicate(extracted)
  const relevant = topic === "data-persistence" ? dataPersistenceEvidence(unique) : unique.filter((item) => topicEvidenceApplies(topic, item))
  const unknowns = [...structure.unknowns, ...code.unknowns, ...behavior.unknowns, ...lifecycle.unknowns]
  if (!relevant.some((item) => item.confidence === "explicit" && item.source.sourceKind !== "test")) {
    unknowns.push(`topic-absence:${topic}:完整源码快照中未发现可直接证明该主题专用机制的生产源码证据`)
  }
  return {
    moduleID: module.id,
    sourceSnapshotHash: module.sourceSnapshotHash,
    topic,
    evidence: relevant,
    unknowns: [...new Set(unknowns)],
  }
}

export function topicEvidenceApplies(topic: DesignDocTopic, item: TopicEvidenceCandidate) {
  // 正文主题只收集该抽象层能够直接说明的源码事实；逐条 action、顺序边和局部变量
  // 由 code-flow/data-lifecycle 等专用图全量承载。这里不是代表性采样，而是确定性的
  // 证据职责分离：同类事实全部保留，不把每个 AST 原子在正文和图中重复生成两遍。
  if (topic === "responsibilities") {
    return item.kind === "code-symbol"
      ? callableSymbol(item)
      : item.kind === "flow-node" && item.attributes.nodeKind === "entry"
  }
  if (topic === "inputs-outputs") {
    if (item.kind === "code-symbol") return callableSymbol(item)
    if (item.kind === "data-entity")
      return ["input", "output", "store", "external"].includes(String(item.attributes.entityKind))
    if (item.kind === "data-flow") return inputOutputFlow(item)
    return item.kind === "call-message" && item.attributes.callKind === "external"
  }
  if (topic === "business-process") return processEvidence(item, false)
  if (topic === "algorithms") return processEvidence(item, true)
  if (topic === "core-models") {
    if (item.kind === "code-symbol") return !callableSymbol(item)
    return ["state-definition", "state-field"].includes(item.kind)
  }
  if (topic === "concurrency") return concurrencyEvidence(item)
  if (topic === "data-persistence") return dataBoundaryEvidence(item)
  if (topic === "configuration-startup") return configurationEvidence(item)
  if (topic === "observability-debugging") return observabilityEvidence(item)
  const kinds = topicKinds[topic]
  if (kinds.has(item.kind)) return true
  if (item.kind === "source-file") return false
  const text = evidenceText(item)
  return topicPatterns[topic]?.test(text) ?? false
}

function callableSymbol(item: TopicEvidenceCandidate) {
  return item.attributes.symbolKind === "function" || item.attributes.symbolKind === "method"
}

function processEvidence(item: TopicEvidenceCandidate, includeSymbols: boolean) {
  if (includeSymbols && item.kind === "code-symbol") return callableSymbol(item)
  if (item.kind === "call-message") return true
  if (item.kind === "flow-node")
    return ["entry", "decision", "exit", "error"].includes(String(item.attributes.nodeKind))
  if (item.kind !== "flow-edge") return false
  if (String(item.attributes.ref ?? "").startsWith("root-flow:")) return true
  return ["branch-true", "branch-false", "loop", "return", "error"].includes(String(item.attributes.edgeKind))
}

function concurrencyEvidence(item: TopicEvidenceCandidate) {
  if (!topicPatterns.concurrency!.test(evidenceText(item))) return false
  if (
    ["code-symbol", "call-message", "guard", "timeout", "state-transition", "event-handler", "configuration"].includes(
      item.kind,
    )
  )
    return true
  return item.kind === "flow-node" && ["entry", "decision"].includes(String(item.attributes.nodeKind))
}

function inputOutputFlow(item: TopicEvidenceCandidate) {
  if (item.attributes.flowKind === "return") return true
  const from = String(item.attributes.fromRef ?? "")
  const to = String(item.attributes.toRef ?? "")
  return /(?:external:|::data:return$|::data:(?:input|output)\b)/iu.test(`${from}\n${to}`)
}

function dataBoundaryEvidence(item: TopicEvidenceCandidate) {
  if (item.kind === "data-entity") {
    if (["input", "output", "store", "external"].includes(String(item.attributes.entityKind))) return true
    return dataBoundaryPattern.test(evidenceText(item))
  }
  if (item.kind !== "data-flow") return false
  // “数据流转与保存边界”首先是数据流主题；是否真正持久化由正文明确说明，
  // 不能因缺少 file/flash 等关键词就把普通内存数据流误判为不适用。
  return true
}

function dataPersistenceEvidence(evidence: RawEvidence[]) {
  const flows = evidence.filter((item) => item.kind === "data-flow")
  const referenced = new Set(
    flows.flatMap((item) =>
      [item.attributes.fromRef, item.attributes.toRef].filter((value): value is string => typeof value === "string"),
    ),
  )
  return evidence.filter((item) => {
    if (item.kind === "data-flow") return true
    if (item.kind !== "data-entity") return false
    if (referenced.has(String(item.attributes.ref ?? ""))) return true
    return dataBoundaryEvidence(item)
  })
}

function configurationEvidence(item: TopicEvidenceCandidate) {
  if (item.kind === "configuration") return true
  if (!["dependency", "code-symbol", "call-message", "flow-node"].includes(item.kind)) return false
  if (item.kind === "flow-node" && !["entry", "decision"].includes(String(item.attributes.nodeKind))) return false
  return topicPatterns["configuration-startup"]!.test(evidenceText(item))
}

function observabilityEvidence(item: TopicEvidenceCandidate) {
  if (!["code-symbol", "call-message", "flow-node", "error-node", "error-edge", "configuration"].includes(item.kind))
    return false
  if (item.kind === "flow-node" && !["entry", "action", "error"].includes(String(item.attributes.nodeKind)))
    return false
  return observabilityPattern.test(evidenceText(item))
}

function evidenceText(item: TopicEvidenceCandidate) {
  return `${item.fact}\n${item.snippet}\n${JSON.stringify(item.attributes)}`
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_./:#-]+/g, " ")
}

function deduplicate(evidence: RawEvidence[]) {
  const seen = new Set<string>()
  return evidence.filter((item) => {
    const key = [item.kind, item.source.path, item.source.startLine, item.source.endLine, item.fact].join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const topicKinds: Record<DesignDocTopic, ReadonlySet<RawEvidence["kind"]>> = {
  positioning: new Set(["source-file", "dependency", "call-message"]),
  responsibilities: new Set(),
  boundaries: new Set(["source-file", "dependency", "call-message", "configuration"]),
  "inputs-outputs": new Set(),
  "business-process": new Set(),
  "core-models": new Set(),
  algorithms: new Set(),
  concurrency: new Set(),
  "state-lifecycle": new Set([
    "state-definition",
    "state-field",
    "initial-state",
    "state-transition",
    "event-handler",
    "guard",
    "timeout",
    "terminal-state",
  ]),
  "error-recovery": new Set(["error-node", "error-edge", "error-path", "timeout", "guard"]),
  "data-persistence": new Set(),
  "configuration-startup": new Set(["configuration"]),
  "observability-debugging": new Set(),
  "constraints-risks": new Set(["guard", "timeout", "error-node", "error-edge", "error-path", "configuration"]),
}

const topicPatterns: Partial<Record<DesignDocTopic, RegExp>> = {
  concurrency: /\b(lock|mutex|semaphore|spin|atomic|barrier|queue|interrupt|irq|thread|task|dma|critical)\b/i,
  "configuration-startup": /\b(config|configure|init|initialize|startup|boot|build|make|environment)\b/i,
}

const dataBoundaryPattern = /\b(file|cache|database|db|flash|nand|persist|storage|dma|pcie|fifo|register|reg)\b/i
const observabilityPattern =
  /\b(log|debug|trace|assert|printf|print|metric|telemetry|diagnostic|dump|inspect|monitor)\b/i
