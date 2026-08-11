import {
  mermaidWordFit,
  renderMermaidPng,
  validateMermaidDiagram,
  type MermaidWordFitFingerprint,
} from "@/kilocode/documents/mermaid"
import { DesignDocStore } from "./store"
import type {
  CodeStructureIR,
  BusinessFlowIR,
  DataFlowIR,
  ErrorFlowIR,
  ExecutionFlowIR,
  LifecycleIR,
  OverviewIR,
  SequenceIR,
  StructureIR,
} from "./domain"
import { AnyCurrentLifecycleState } from "./domain"

const chineseWordSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" })

export interface RenderedDiagramPart {
  source: string
  render: { path: string; sha256: string; mediaType: string }
  diagnostics: Array<{ code: string; severity: string; message: string }>
  wordFit: ReturnType<typeof mermaidWordFit>
}

export function renderedDiagramParts(input: RenderedDiagramPart & { parts?: RenderedDiagramPart[] }) {
  return input.parts?.length ? input.parts : [input]
}

export interface RenderLifecycleInput {
  workspace: string
  jobID: string
  ir: LifecycleIR
  timeoutMs?: number
  outputPath?: string
}

export async function renderLifecycle(input: RenderLifecycleInput) {
  const timeoutMs = input.timeoutMs ?? 120_000
  const primary = await renderCandidate(
    lifecycleMermaid(input.ir),
    "stateDiagram-v2",
    lifecycleFitFingerprint(input.ir),
    timeoutMs,
  )
  if (primary.wordFit.wordFitStatus === "readable") {
    const part = await storeLifecyclePart(input, primary, 0, 1)
    return { ...part, parts: [part] }
  }

  const maximum = Math.min(4, input.ir.transitions.length)
  let lastReasons = primary.wordFit.wordFitReasons ?? []
  for (let transitionsPerFacet = maximum; transitionsPerFacet >= 1; transitionsPerFacet--) {
    const plans = lifecycleFacetPlans(input.ir, transitionsPerFacet)
    const candidates: RenderCandidate[] = []
    let readable = true
    for (const [index, plan] of plans.entries()) {
      const fingerprint = lifecycleFacetFitFingerprint(input.ir, plan)
      const variants: RenderCandidate[] = []
      for (const direction of ["TD", "LR"] as const) {
        const candidate = await renderCandidate(
          lifecycleFacetMermaid(input.ir, plan, direction, index, plans.length),
          "flowchart",
          fingerprint,
          timeoutMs,
        )
        variants.push(candidate)
        if (candidate.wordFit.wordFitStatus === "readable") break
      }
      const selected = selectFlowchartCandidate(variants)
      if (!selected) throw new Error("生命周期分面图渲染失败")
      candidates.push(selected)
      if (selected.wordFit.wordFitStatus !== "readable") {
        readable = false
        lastReasons = selected.wordFit.wordFitReasons ?? lastReasons
        break
      }
    }
    if (!readable) continue
    const parts = await Promise.all(
      candidates.map((candidate, index) => storeLifecyclePart(input, candidate, index, candidates.length)),
    )
    return {
      ...parts[0]!,
      parts,
      diagnostics: parts.flatMap((part) => part.diagnostics),
      wordFit: aggregateWordFit(parts.map((part) => part.wordFit)),
    }
  }
  throw new Error(`DIAGRAM_SPLIT_REQUIRED：${lastReasons.join("；") || "生命周期图无法拆成适合 Word 阅读的确定性分面"}`)
}

interface RenderCandidate {
  source: string
  result: Awaited<ReturnType<typeof renderMermaidPng>> & { png: Uint8Array }
  wordFit: ReturnType<typeof wordFit>
}

async function renderCandidate(
  source: string,
  diagramType: "stateDiagram-v2" | "flowchart",
  fingerprint: MermaidWordFitFingerprint,
  timeoutMs: number,
): Promise<RenderCandidate> {
  const syntax = validateMermaidDiagram({ source, diagramType })
  if (!syntax.valid) throw new Error(syntax.diagnostics.map((item) => item.message).join("；"))
  const result = await renderMermaidPng({ source, timeoutMs })
  if (!result.rendered || !result.png) {
    throw new Error(result.diagnostics.map((item) => item.message).join("；") || "Mermaid 图渲染失败")
  }
  return { source, result: { ...result, png: result.png }, wordFit: wordFit(result, fingerprint) }
}

async function storeLifecyclePart(
  input: RenderLifecycleInput,
  candidate: RenderCandidate,
  index: number,
  count: number,
) {
  const output = input.outputPath ?? "render/lifecycle.png"
  const outputPath = count === 1 ? output : numberedPath(output, index + 1)
  const render = await DesignDocStore.writeBytes(
    input.workspace,
    input.jobID,
    outputPath,
    candidate.result.png,
    "image/png",
  )
  return {
    source: candidate.source,
    render,
    diagnostics: candidate.result.diagnostics,
    wordFit: candidate.wordFit,
  }
}

function numberedPath(value: string, part: number) {
  const match = value.match(/^(.*?)(\.[^.\/]+)$/u)
  return match ? `${match[1]}-part-${part}${match[2]}` : `${value}-part-${part}`
}

function aggregateWordFit(parts: Array<ReturnType<typeof wordFit>>): ReturnType<typeof wordFit> {
  const readable = parts.every((part) => part.wordFitStatus === "readable")
  return {
    wordFitStatus: readable ? "readable" : "split-required",
    wordFitReasons: parts.flatMap((part) => part.wordFitReasons ?? []),
    wordFitScale: Math.min(...parts.map((part) => part.wordFitScale ?? 0)),
    wordFitAspectRatio: Math.max(...parts.map((part) => part.wordFitAspectRatio ?? 0)),
    wordFitDensity: Math.max(...parts.map((part) => part.wordFitDensity ?? 0)),
    documentReady: readable,
  }
}

export interface RenderStructureInput {
  workspace: string
  jobID: string
  ir: StructureIR
  timeoutMs?: number
  outputPath?: string
}

export async function renderStructure(input: RenderStructureInput) {
  return renderFlowchart(
    input,
    "structure",
    directionalSources("LR", (direction) => structureMermaid(input.ir, direction)),
    diagramFitFingerprint(
      input.ir.nodes.map((node) => node.id),
      input.ir.edges,
      input.ir.nodes.map((node) => node.sourceRef),
      [],
      "flowchart",
    ),
    (maximumEdges) =>
      graphFacetInputs(input.ir.nodes, input.ir.edges, maximumEdges, (nodes, edges) => {
        const ir = { ...input.ir, nodes, edges }
        return {
          sources: directionalSources("LR", (direction) => structureMermaid(ir, direction)),
          fingerprint: diagramFitFingerprint(
            nodes.map((node) => node.id),
            edges,
            nodes.map((node) => node.sourceRef),
            [],
            "flowchart",
          ),
        }
      }),
  )
}

export interface RenderCodeStructureInput {
  workspace: string
  jobID: string
  ir: CodeStructureIR
  timeoutMs?: number
  outputPath?: string
}

export async function renderCodeStructure(input: RenderCodeStructureInput) {
  return renderFlowchart(
    input,
    "code-structure",
    directionalSources("TD", (direction) => codeStructureMermaid(input.ir, direction)),
    diagramFitFingerprint(
      input.ir.nodes.map((node) => node.id),
      input.ir.edges,
      input.ir.nodes.map((node) => (node.kind === "source-file" ? node.sourceRef : node.label)),
      [],
      "flowchart",
    ),
    (maximumEdges) =>
      graphFacetInputs(input.ir.nodes, input.ir.edges, maximumEdges, (nodes, edges) => {
        const ir = { ...input.ir, nodes, edges }
        return {
          sources: directionalSources("TD", (direction) => codeStructureMermaid(ir, direction)),
          fingerprint: diagramFitFingerprint(
            nodes.map((node) => node.id),
            edges,
            nodes.map((node) => (node.kind === "source-file" ? node.sourceRef : node.label)),
            [],
            "flowchart",
          ),
        }
      }),
  )
}

export async function renderExecutionFlow(input: {
  workspace: string
  jobID: string
  ir: ExecutionFlowIR
  timeoutMs?: number
  outputPath?: string
}) {
  return renderFlowchart(
    input,
    "execution-flow",
    flowchartLayoutSources((direction, layout) => executionFlowMermaid(input.ir, direction, layout)),
    diagramFitFingerprint(
      input.ir.nodes.map((node) => node.id),
      input.ir.edges,
      input.ir.nodes.map((node) => node.label),
      input.ir.edges.map((edge) => executionEdgeLabel(edge.kind, edge.label)),
      "flowchart",
    ),
    (maximumEdges) =>
      graphFacetInputs(input.ir.nodes, input.ir.edges, maximumEdges, (nodes, edges) => {
        const ir = { ...input.ir, nodes, edges }
        return {
          sources: flowchartLayoutSources((direction, layout) => executionFlowMermaid(ir, direction, layout)),
          fingerprint: diagramFitFingerprint(
            nodes.map((node) => node.id),
            edges,
            nodes.map((node) => node.label),
            edges.map((edge) => executionEdgeLabel(edge.kind, edge.label)),
            "flowchart",
          ),
        }
      }),
  )
}

export async function renderBusinessFlow(input: {
  workspace: string
  jobID: string
  ir: BusinessFlowIR
  timeoutMs?: number
  outputPath?: string
}) {
  return renderFlowchart(
    input,
    "business-flow",
    flowchartLayoutSources((direction, layout) => businessFlowMermaid(input.ir, direction, layout)),
    diagramFitFingerprint(
      input.ir.activities.map((activity) => activity.id),
      input.ir.flows,
      input.ir.activities.map((activity) => activity.businessMeaning || activity.label),
      input.ir.flows.map((flow) => flow.label),
      "flowchart",
    ),
    (maximumEdges) =>
      graphFacetInputs(input.ir.activities, input.ir.flows, maximumEdges, (activities, flows) => {
        const ir = { ...input.ir, activities, flows }
        return {
          sources: flowchartLayoutSources((direction, layout) => businessFlowMermaid(ir, direction, layout)),
          fingerprint: diagramFitFingerprint(
            activities.map((activity) => activity.id),
            flows,
            activities.map((activity) => activity.businessMeaning || activity.label),
            flows.map((flow) => flow.label),
            "flowchart",
          ),
        }
      }),
  )
}

export async function renderSequence(input: {
  workspace: string
  jobID: string
  ir: SequenceIR
  timeoutMs?: number
  outputPath?: string
}) {
  const source = sequenceMermaid(input.ir)
  const syntax = validateMermaidDiagram({ source, diagramType: "sequenceDiagram" })
  if (!syntax.valid) throw new Error(syntax.diagnostics.map((item) => item.message).join("；"))
  const result = await renderMermaidPng({ source, timeoutMs: input.timeoutMs ?? 120_000 })
  if (!result.rendered || !result.png) {
    throw new Error(result.diagnostics.map((item) => item.message).join("；") || "Mermaid 图渲染失败")
  }
  const render = await DesignDocStore.writeBytes(
    input.workspace,
    input.jobID,
    input.outputPath ?? "render/sequence.png",
    result.png,
    "image/png",
  )
  return {
    source,
    render,
    diagnostics: result.diagnostics,
    wordFit: wordFit(
      result,
      diagramFitFingerprint(
        input.ir.participants.map((participant) => participant.id),
        input.ir.messages,
        input.ir.participants.map((participant) => participant.label),
        input.ir.messages.map((message) => message.label),
        "sequenceDiagram",
      ),
    ),
  }
}

export async function renderDataFlow(input: {
  workspace: string
  jobID: string
  ir: DataFlowIR
  timeoutMs?: number
  outputPath?: string
}) {
  return renderFlowchart(
    input,
    "data-flow",
    flowchartLayoutSources((direction, layout) => dataFlowMermaid(input.ir, direction, layout)),
    diagramFitFingerprint(
      input.ir.entities.map((entity) => entity.id),
      input.ir.flows,
      input.ir.entities.map((entity) => entity.label),
      input.ir.flows.map((flow) => flow.label),
      "flowchart",
    ),
    (maximumEdges) =>
      graphFacetInputs(input.ir.entities, input.ir.flows, maximumEdges, (entities, flows) => {
        const ir = { ...input.ir, entities, flows }
        return {
          sources: flowchartLayoutSources((direction, layout) => dataFlowMermaid(ir, direction, layout)),
          fingerprint: diagramFitFingerprint(
            entities.map((entity) => entity.id),
            flows,
            entities.map((entity) => entity.label),
            flows.map((flow) => flow.label),
            "flowchart",
          ),
        }
      }),
  )
}

export async function renderErrorFlow(input: {
  workspace: string
  jobID: string
  ir: ErrorFlowIR
  timeoutMs?: number
  outputPath?: string
}) {
  return renderFlowchart(
    input,
    "error-flow",
    flowchartLayoutSources((direction, layout) => errorFlowMermaid(input.ir, direction, layout)),
    diagramFitFingerprint(
      input.ir.nodes.map((node) => node.id),
      input.ir.edges,
      input.ir.nodes.map((node) => node.label),
      input.ir.edges.map((edge) => edge.label),
      "flowchart",
    ),
    (maximumEdges) =>
      graphFacetInputs(input.ir.nodes, input.ir.edges, maximumEdges, (nodes, edges) => {
        const ir = { ...input.ir, nodes, edges }
        return {
          sources: flowchartLayoutSources((direction, layout) => errorFlowMermaid(ir, direction, layout)),
          fingerprint: diagramFitFingerprint(
            nodes.map((node) => node.id),
            edges,
            nodes.map((node) => node.label),
            edges.map((edge) => edge.label),
            "flowchart",
          ),
        }
      }),
  )
}

export async function renderOverview(input: {
  workspace: string
  jobID: string
  ir: OverviewIR
  timeoutMs?: number
  outputPath?: string
}) {
  return renderFlowchart(
    input,
    "overview",
    directionalSources("LR", (direction) => overviewMermaid(input.ir, direction)),
    diagramFitFingerprint(
      input.ir.items.map((item) => item.id),
      input.ir.relations ?? [],
      input.ir.items.map((item) => item.label),
      (input.ir.relations ?? []).map((relation) => relation.label),
      "flowchart",
    ),
    (maximumEdges) =>
      graphFacetInputs(input.ir.items, input.ir.relations ?? [], maximumEdges, (items, relations) => {
        const ir = { ...input.ir, items, relations }
        return {
          sources: directionalSources("LR", (direction) => overviewMermaid(ir, direction)),
          fingerprint: diagramFitFingerprint(
            items.map((item) => item.id),
            relations,
            items.map((item) => item.label),
            relations.map((relation) => relation.label),
            "flowchart",
          ),
        }
      }),
  )
}

interface FlowchartFacetInput {
  sources: string[]
  fingerprint: MermaidWordFitFingerprint
}

export interface GraphFacetPlan {
  nodeIDs: string[]
  edgeIDs: string[]
}

/**
 * 按已验证关系确定性切分图：每条边只出现一次，关系端点可作为分面上下文重复，
 * 孤立节点也至少出现一次。该过程不让模型删减或重写任何图元素。
 */
export function graphFacetPlans(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ id: string; from: string; to: string }>,
  maximumEdges: number,
): GraphFacetPlan[] {
  const edgeLimit = Math.max(1, maximumEdges)
  const nodeLimit = Math.max(4, edgeLimit * 2 + 1)
  const plans: GraphFacetPlan[] = []
  for (let index = 0; index < edges.length; index += edgeLimit) {
    const part = edges.slice(index, index + edgeLimit)
    plans.push({
      edgeIDs: part.map((edge) => edge.id),
      nodeIDs: [...new Set(part.flatMap((edge) => [edge.from, edge.to]))],
    })
  }
  const covered = new Set(plans.flatMap((plan) => plan.nodeIDs))
  const isolated = nodes.filter((node) => !covered.has(node.id))
  for (let index = 0; index < isolated.length; index += nodeLimit) {
    plans.push({ nodeIDs: isolated.slice(index, index + nodeLimit).map((node) => node.id), edgeIDs: [] })
  }
  return plans.length ? plans : [{ nodeIDs: nodes.map((node) => node.id), edgeIDs: [] }]
}

function graphFacetInputs<Node extends { id: string }, Edge extends { id: string; from: string; to: string }>(
  nodes: Node[],
  edges: Edge[],
  maximumEdges: number,
  build: (nodes: Node[], edges: Edge[]) => FlowchartFacetInput,
) {
  return graphFacetPlans(nodes, edges, maximumEdges).map((plan) => {
    const nodeIDs = new Set(plan.nodeIDs)
    const edgeIDs = new Set(plan.edgeIDs)
    return build(
      nodes.filter((node) => nodeIDs.has(node.id)),
      edges.filter((edge) => edgeIDs.has(edge.id)),
    )
  })
}

async function renderFlowchart(
  input: { workspace: string; jobID: string; timeoutMs?: number; outputPath?: string },
  name: string,
  sources: string[],
  fingerprint: MermaidWordFitFingerprint,
  facets?: (maximumEdges: number) => FlowchartFacetInput[],
) {
  const timeoutMs = input.timeoutMs ?? 120_000
  const primary = await selectRenderedFlowchart(sources, fingerprint, timeoutMs)
  if (primary.wordFit.wordFitStatus === "readable") {
    const part = await storeFlowchartPart(input, name, primary, 0, 1)
    return { ...part, parts: [part] }
  }
  if (!facets) {
    throw new Error(`DIAGRAM_SPLIT_REQUIRED：${primary.wordFit.wordFitReasons?.join("；") || "图无法拆成可读分面"}`)
  }

  let lastReasons = primary.wordFit.wordFitReasons ?? []
  const maximum = Math.min(6, Math.max(1, fingerprint.edgeCount ?? 1))
  for (let maximumEdges = maximum; maximumEdges >= 1; maximumEdges--) {
    const inputs = facets(maximumEdges)
    if (inputs.length <= 1) continue
    const candidates: RenderCandidate[] = []
    let readable = true
    for (const facet of inputs) {
      const selected = await selectRenderedFlowchart(facet.sources, facet.fingerprint, timeoutMs)
      candidates.push(selected)
      if (selected.wordFit.wordFitStatus !== "readable") {
        readable = false
        lastReasons = selected.wordFit.wordFitReasons ?? lastReasons
        break
      }
    }
    if (!readable) continue
    const parts = await Promise.all(
      candidates.map((candidate, index) => storeFlowchartPart(input, name, candidate, index, candidates.length)),
    )
    return {
      ...parts[0]!,
      parts,
      diagnostics: parts.flatMap((part) => part.diagnostics),
      wordFit: aggregateWordFit(parts.map((part) => part.wordFit)),
    }
  }
  throw new Error(`DIAGRAM_SPLIT_REQUIRED：${lastReasons.join("；") || "图无法拆成适合 Word 阅读的确定性分面"}`)
}

async function selectRenderedFlowchart(
  sources: string[],
  fingerprint: MermaidWordFitFingerprint,
  timeoutMs: number,
): Promise<RenderCandidate> {
  const candidates: RenderCandidate[] = []
  const errors: string[] = []
  for (const source of sources) {
    try {
      const candidate = await renderCandidate(source, "flowchart", fingerprint, timeoutMs)
      candidates.push(candidate)
      if (candidate.wordFit.wordFitStatus === "readable") break
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  const selected = selectFlowchartCandidate(candidates)
  if (!selected) throw new Error(errors.join("；") || "Mermaid 图渲染失败")
  return selected
}

async function storeFlowchartPart(
  input: { workspace: string; jobID: string; outputPath?: string },
  name: string,
  candidate: RenderCandidate,
  index: number,
  count: number,
) {
  const output = input.outputPath ?? `render/${name}.png`
  const render = await DesignDocStore.writeBytes(
    input.workspace,
    input.jobID,
    count === 1 ? output : numberedPath(output, index + 1),
    candidate.result.png,
    "image/png",
  )
  return {
    source: candidate.source,
    render,
    diagnostics: candidate.result.diagnostics,
    wordFit: candidate.wordFit,
  }
}

function directionalSources(preferred: "TD" | "LR", source: (direction: "TD" | "LR") => string) {
  const alternate = preferred === "TD" ? "LR" : "TD"
  return [source(preferred), source(alternate)]
}

interface FlowchartCandidate {
  wordFit: {
    wordFitStatus?: "readable" | "split-required"
    wordFitReasons?: string[]
    wordFitScale?: number
    wordFitAspectRatio?: number
    wordFitDensity?: number
  }
}

export function selectFlowchartCandidate<Candidate extends FlowchartCandidate>(
  candidates: Candidate[],
): Candidate | undefined {
  return candidates.toSorted((left, right) => flowchartCandidateScore(right) - flowchartCandidateScore(left))[0]
}

function flowchartCandidateScore(candidate: FlowchartCandidate) {
  const fit = candidate.wordFit
  const readable = fit.wordFitStatus === "readable" ? 1_000_000 : 0
  const reasons = (fit.wordFitReasons?.length ?? 10) * -10_000
  const scale = (fit.wordFitScale ?? 0) * 1_000
  const aspect = (fit.wordFitAspectRatio ?? 100) * -10
  const density = (fit.wordFitDensity ?? 100) * -1
  return readable + reasons + scale + aspect + density
}

function wordFit(
  result: { width?: number; height?: number; issues?: Array<{ severity?: string; code?: string; message?: string }> },
  fingerprint: MermaidWordFitFingerprint,
) {
  return mermaidWordFit({
    width: result.width,
    height: result.height,
    status: "valid",
    fingerprint,
    issues: result.issues,
  })
}

export function lifecycleFitFingerprint(ir: LifecycleIR) {
  const transitions = ir.transitions.map((transition) => ({ from: transition.from, to: transition.to }))
  const labels = ir.transitions.map((transition) =>
    [transition.trigger, transition.guard ? `[${transition.guard}]` : undefined, transition.action]
      .filter((item): item is string => Boolean(item))
      .join(" / "),
  )
  return diagramFitFingerprint(
    ir.states.map((state) => state.id),
    transitions,
    ir.states.map((state) => state.sourceValue),
    labels,
    "stateDiagram-v2",
  )
}

function diagramFitFingerprint(
  nodeIds: readonly string[],
  edges: ReadonlyArray<{ from: string; to: string }>,
  nodeLabels: readonly string[],
  edgeLabels: readonly string[],
  diagramType: string,
): MermaidWordFitFingerprint {
  const outgoing = new Map<string, number>()
  for (const edge of edges) outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1)
  const normalizedNodes = nodeLabels.map(labelCharacters)
  const normalizedEdges = edgeLabels.map(labelCharacters)
  const longNodeLabelCount = normalizedNodes.filter((count) => count > 48).length
  const longEdgeLabelCount = normalizedEdges.filter((count) => count > 48).length
  return {
    nodeIds,
    edges,
    nodeCount: nodeIds.length,
    edgeCount: edges.length,
    labelCharacterCount: [...normalizedNodes, ...normalizedEdges].reduce((total, count) => total + count, 0),
    longLabelCount: longNodeLabelCount + longEdgeLabelCount,
    longNodeLabelCount,
    longEdgeLabelCount,
    branchingNodeCount: [...outgoing.values()].filter((count) => count > 1).length,
    maxOutgoingEdges: Math.max(0, ...outgoing.values()),
    diagramType,
  }
}

function labelCharacters(value: string) {
  return [
    ...value
      .replace(/<br\s*\/?>/gi, "")
      .replace(/[\r\n]+/g, " ")
      .trim(),
  ].length
}

export function lifecycleMermaid(ir: LifecycleIR) {
  const aliases = new Map(ir.states.map((state, index) => [state.id, `S${index}`]))
  const lines = ["stateDiagram-v2"]
  for (const state of ir.states) {
    lines.push(`  state "${wrappedLabel(state.sourceValue, 24)}" as ${aliases.get(state.id)}`)
  }
  if (ir.transitions.some((transition) => transition.from === AnyCurrentLifecycleState)) {
    lines.push('  state "外部事件（不限定当前状态）" as ANY')
  }
  lines.push(`  [*] --> ${aliases.get(ir.initialStateID)}`)
  for (const transition of ir.transitions) {
    const text = [transition.trigger, transition.guard ? `[${transition.guard}]` : undefined, transition.action]
      .filter((item): item is string => Boolean(item))
      .join(" / ")
    const from = transition.from === AnyCurrentLifecycleState ? "ANY" : aliases.get(transition.from)
    lines.push(`  ${from} --> ${aliases.get(transition.to)}${text ? `: ${wrappedLabel(text, 32)}` : ""}`)
  }
  for (const terminal of ir.terminalStateIDs) lines.push(`  ${aliases.get(terminal)} --> [*]`)
  return `${lines.join("\n")}\n`
}

export interface LifecycleFacetPlan {
  transitions: LifecycleIR["transitions"]
  stateIDs: string[]
}

export function lifecycleFacetPlans(ir: LifecycleIR, maximumTransitions: number): LifecycleFacetPlan[] {
  const maximum = Math.max(1, Math.floor(maximumTransitions))
  const order = [...ir.states.map((state) => state.id), AnyCurrentLifecycleState]
  const transitionOrder = new Map(ir.transitions.map((transition, index) => [transition.id, index]))
  const sources = new Map<string, LifecycleIR["transitions"]>()
  for (const transition of ir.transitions) {
    const values = sources.get(transition.from) ?? []
    values.push(transition)
    sources.set(transition.from, values)
  }
  const groups = [...sources]
    .toSorted(
      ([left], [right]) => sourcePosition(order, left) - sourcePosition(order, right) || left.localeCompare(right),
    )
    .flatMap(([, transitions]) =>
      Array.from({ length: Math.ceil(transitions.length / maximum) }, (_, index) =>
        transitions.slice(index * maximum, index * maximum + maximum),
      ),
    )
    .toSorted(
      (left, right) =>
        right.length - left.length ||
        (transitionOrder.get(left[0]?.id ?? "") ?? Number.MAX_SAFE_INTEGER) -
          (transitionOrder.get(right[0]?.id ?? "") ?? Number.MAX_SAFE_INTEGER),
    )
  const facets: Array<LifecycleIR["transitions"]> = []
  for (const group of groups) {
    const current = facets.find((facet) => facet.length + group.length <= maximum)
    if (current) current.push(...group)
    else facets.push([...group])
  }
  if (!facets.length) facets.push([])
  for (const facet of facets) {
    facet.sort(
      (left, right) =>
        (transitionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (transitionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }
  facets.sort(
    (left, right) =>
      (transitionOrder.get(left[0]?.id ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (transitionOrder.get(right[0]?.id ?? "") ?? Number.MAX_SAFE_INTEGER),
  )
  const covered = new Set(facets.flatMap((transitions) => transitions.flatMap((item) => [item.from, item.to])))
  const isolated = ir.states.map((state) => state.id).filter((id) => !covered.has(id))
  return facets.map((transitions, index) => ({
    transitions,
    stateIDs: [
      ...new Set([
        ...transitions.flatMap((transition) =>
          transition.from === AnyCurrentLifecycleState ? [transition.to] : [transition.from, transition.to],
        ),
        ...(index === 0 ? isolated : []),
      ]),
    ],
  }))
}

function sourcePosition(order: string[], value: string) {
  const index = order.indexOf(value)
  return index < 0 ? order.length : index
}

export function lifecycleFacetMermaid(
  ir: LifecycleIR,
  plan: LifecycleFacetPlan,
  direction: "TD" | "LR" = "TD",
  facetIndex = 0,
  facetCount = 1,
) {
  const states = ir.states.filter((state) => plan.stateIDs.includes(state.id))
  const aliases = new Map(states.map((state, index) => [state.id, `FS${index}`]))
  const lines = [`flowchart ${direction}`]
  for (const state of states) lines.push(`  ${aliases.get(state.id)}["${wrappedLabel(state.sourceValue, 24)}"]`)
  const hasAny = plan.transitions.some((transition) => transition.from === AnyCurrentLifecycleState)
  if (hasAny) lines.push('  FANY["任意当前状态"]')
  if (aliases.has(ir.initialStateID)) {
    lines.push('  FSTART(["开始"])')
    lines.push(`  FSTART --> ${aliases.get(ir.initialStateID)}`)
  }
  const visibleTerminal = ir.terminalStateIDs.filter((id) => aliases.has(id))
  if (visibleTerminal.length) lines.push('  FEND(["结束"])')
  for (const [index, transition] of plan.transitions.entries()) {
    const alias = `FT${index}`
    const from = transition.from === AnyCurrentLifecycleState ? "FANY" : aliases.get(transition.from)
    const to = aliases.get(transition.to)
    if (!from || !to) throw new Error(`生命周期分面缺少迁移端点：${transition.id}`)
    lines.push(`  ${alias}["${wrappedLabel(lifecycleTransitionText(transition), 26)}"]`)
    lines.push(`  ${from} --> ${alias} --> ${to}`)
  }
  for (const terminal of visibleTerminal) lines.push(`  ${aliases.get(terminal)} --> FEND`)
  lines.push("  classDef state fill:#eef6ff,stroke:#2f6fa3,color:#102a43")
  lines.push("  classDef transition fill:#f7f4ff,stroke:#7457a6,color:#2e2142,stroke-dasharray: 4 2")
  lines.push("  classDef marker fill:#e8f8ef,stroke:#287a50,color:#123d29,stroke-width:2px")
  if (aliases.size) lines.push(`  class ${[...aliases.values()].join(",")} state`)
  if (plan.transitions.length)
    lines.push(`  class ${plan.transitions.map((_, index) => `FT${index}`).join(",")} transition`)
  const markers = [
    hasAny ? "FANY" : undefined,
    aliases.has(ir.initialStateID) ? "FSTART" : undefined,
    visibleTerminal.length ? "FEND" : undefined,
  ].filter((item): item is string => Boolean(item))
  if (markers.length) lines.push(`  class ${markers.join(",")} marker`)
  if (facetCount > 1) lines.push(`  %% 生命周期迁移分面 ${facetIndex + 1}/${facetCount}`)
  return `${lines.join("\n")}\n`
}

export function lifecycleFacetFitFingerprint(ir: LifecycleIR, plan: LifecycleFacetPlan) {
  const stateLabels = ir.states.filter((state) => plan.stateIDs.includes(state.id)).map((state) => state.sourceValue)
  const transitionLabels = plan.transitions.map(lifecycleTransitionText)
  const hasAny = plan.transitions.some((transition) => transition.from === AnyCurrentLifecycleState)
  const hasInitial = plan.stateIDs.includes(ir.initialStateID)
  const terminals = ir.terminalStateIDs.filter((id) => plan.stateIDs.includes(id))
  const nodeIDs = [
    ...plan.stateIDs,
    ...plan.transitions.map((transition) => transition.id),
    ...(hasAny ? ["__ANY_MARKER__"] : []),
    ...(hasInitial ? ["__START_MARKER__"] : []),
    ...(terminals.length ? ["__END_MARKER__"] : []),
  ]
  const edges = [
    ...plan.transitions.flatMap((transition) => [
      {
        from: transition.from === AnyCurrentLifecycleState ? "__ANY_MARKER__" : transition.from,
        to: transition.id,
      },
      { from: transition.id, to: transition.to },
    ]),
    ...(hasInitial ? [{ from: "__START_MARKER__", to: ir.initialStateID }] : []),
    ...terminals.map((terminal) => ({ from: terminal, to: "__END_MARKER__" })),
  ]
  const fingerprint = diagramFitFingerprint(
    nodeIDs,
    edges,
    [
      ...stateLabels,
      ...transitionLabels,
      ...(hasAny ? ["任意当前状态"] : []),
      ...(hasInitial ? ["开始"] : []),
      ...(terminals.length ? ["结束"] : []),
    ],
    [],
    "flowchart",
  )
  // 迁移文字虽在 fallback 中由关系节点承载，语义上仍是状态迁移标签。
  // 保留其长边计数，防止仅通过更换 Mermaid diagramType 绕过原复杂度门禁。
  return {
    ...fingerprint,
    longEdgeLabelCount: transitionLabels.map(labelCharacters).filter((count) => count > 48).length,
  }
}

function lifecycleTransitionText(transition: LifecycleIR["transitions"][number]) {
  return [
    `触发：${transition.trigger}`,
    ...(transition.guard ? [`条件：${transition.guard}`] : []),
    ...(transition.action ? [`动作：${transition.action}`] : []),
  ].join("；")
}

export function structureMermaid(ir: StructureIR, direction: "TD" | "LR" = "LR") {
  const aliases = new Map(ir.nodes.map((node, index) => [node.id, `N${index}`]))
  const lines = [`flowchart ${direction}`]
  for (const node of ir.nodes) {
    lines.push(`  ${aliases.get(node.id)}["${wrappedLabel(node.sourceRef, 28)}"]`)
  }
  for (const edge of ir.edges) lines.push(`  ${aliases.get(edge.from)} --> ${aliases.get(edge.to)}`)
  const internal = ir.nodes.filter((node) => node.kind === "source-file").map((node) => aliases.get(node.id))
  const external = ir.nodes.filter((node) => node.kind === "external-dependency").map((node) => aliases.get(node.id))
  lines.push("  classDef source fill:#e8f3ff,stroke:#2667a9,color:#102a43")
  lines.push("  classDef external fill:#fff5db,stroke:#a66a00,color:#4a3000")
  if (internal.length) lines.push(`  class ${internal.join(",")} source`)
  if (external.length) lines.push(`  class ${external.join(",")} external`)
  return `${lines.join("\n")}\n`
}

export function codeStructureMermaid(ir: CodeStructureIR, direction: "TD" | "LR" = "TD") {
  const aliases = new Map(ir.nodes.map((node, index) => [node.id, `C${index}`]))
  const lines = [`flowchart ${direction}`]
  for (const node of ir.nodes) {
    const text =
      node.kind === "source-file"
        ? wrappedLabel(node.sourceRef, 28)
        : `${wrappedLabel(node.label, 28)}<br/>${wrappedLabel(`«${node.kind}»`, 28)}`
    lines.push(`  ${aliases.get(node.id)}["${text}"]`)
  }
  for (const edge of ir.edges) lines.push(`  ${aliases.get(edge.from)} --> ${aliases.get(edge.to)}`)
  const files = ir.nodes.filter((node) => node.kind === "source-file").map((node) => aliases.get(node.id))
  const types = ir.nodes
    .filter((node) => ["class", "interface", "type", "enum", "struct", "union", "namespace"].includes(node.kind))
    .map((node) => aliases.get(node.id))
  const callables = ir.nodes
    .filter((node) => node.kind === "function" || node.kind === "method")
    .map((node) => aliases.get(node.id))
  lines.push("  classDef file fill:#e8f3ff,stroke:#2667a9,color:#102a43")
  lines.push("  classDef type fill:#eee8ff,stroke:#6646a3,color:#2b1d46")
  lines.push("  classDef callable fill:#e8f8ef,stroke:#287a50,color:#123d29")
  if (files.length) lines.push(`  class ${files.join(",")} file`)
  if (types.length) lines.push(`  class ${types.join(",")} type`)
  if (callables.length) lines.push(`  class ${callables.join(",")} callable`)
  return `${lines.join("\n")}\n`
}

export function executionFlowMermaid(ir: ExecutionFlowIR, direction: "TD" | "LR" = "TD", layout?: FlowchartLayout) {
  const aliases = new Map(ir.nodes.map((node, index) => [node.id, `F${index}`]))
  const ordered = orderGraphNodes(ir.nodes, ir.edges, (node) => node.id)
  const lines = flowchartNodes(
    direction,
    ordered,
    ir.edges.length,
    "流程分区",
    (node) => {
      const alias = aliases.get(node.id)
      const text = wrappedLabel(node.label, 24)
      return node.kind === "decision" ? `${alias}{"${text}"}` : `${alias}["${text}"]`
    },
    ir.nodes.some((node) => node.kind === "decision") ? "TB" : "LR",
    layout,
  )
  const channels = appendRelationEdges(
    lines,
    ir.edges.map((edge) => ({ ...edge, label: executionEdgeLabel(edge.kind, edge.label) })),
    aliases,
    "FREL",
    "逐条代码路径",
  )
  appendSemanticClasses(lines, aliases, ir.nodes)
  appendRelationChannelClass(lines, channels)
  return `${lines.join("\n")}\n`
}

export function businessFlowMermaid(ir: BusinessFlowIR, direction: "TD" | "LR" = "TD", layout?: FlowchartLayout) {
  const aliases = new Map(ir.activities.map((activity, index) => [activity.id, `B${index}`]))
  const ordered = orderGraphNodes(ir.activities, ir.flows, (activity) => activity.id)
  const lines = flowchartNodes(
    direction,
    ordered,
    ir.flows.length,
    "业务阶段",
    (activity) => {
      const alias = aliases.get(activity.id)
      const text = wrappedLabel(activity.businessMeaning || activity.label, 24)
      return activity.kind === "decision" ? `${alias}{"${text}"}` : `${alias}["${text}"]`
    },
    ir.activities.some((activity) => activity.kind === "decision") ? "TB" : "LR",
    layout,
  )
  const channels = appendRelationEdges(lines, ir.flows, aliases, "BREL", "逐条业务步骤")
  appendSemanticClasses(lines, aliases, ir.activities)
  appendRelationChannelClass(lines, channels)
  return `${lines.join("\n")}\n`
}

export function sequenceMermaid(ir: SequenceIR) {
  const aliases = new Map(ir.participants.map((participant, index) => [participant.id, `P${index}`]))
  const lines = ["sequenceDiagram"]
  for (const participant of ir.participants) {
    lines.push(`  participant ${aliases.get(participant.id)} as ${wrappedLabel(participant.label, 24)}`)
  }
  for (const message of ir.messages) {
    const arrow = message.kind === "return" ? "-->>" : "->>"
    lines.push(`  ${aliases.get(message.from)}${arrow}${aliases.get(message.to)}: ${wrappedLabel(message.label, 32)}`)
  }
  return `${lines.join("\n")}\n`
}

export function dataFlowMermaid(ir: DataFlowIR, direction: "TD" | "LR" = "TD", layout?: FlowchartLayout) {
  const aliases = new Map(ir.entities.map((entity, index) => [entity.id, `D${index}`]))
  const ordered = orderGraphNodes(ir.entities, ir.flows, (entity) => entity.id)
  const lines = flowchartNodes(
    direction,
    ordered,
    ir.flows.length,
    "数据阶段",
    (entity) => `${aliases.get(entity.id)}["${wrappedLabel(entity.label, 18)}"]`,
    "LR",
    layout,
  )
  const channels = appendRelationEdges(lines, ir.flows, aliases, "DREL", "逐条数据读写与传递")
  const stores = ir.entities.filter((item) => item.kind === "store").map((item) => aliases.get(item.id))
  const external = ir.entities.filter((item) => item.kind === "external").map((item) => aliases.get(item.id))
  const inputs = ir.entities.filter((item) => item.kind === "input").map((item) => aliases.get(item.id))
  const outputs = ir.entities.filter((item) => item.kind === "output").map((item) => aliases.get(item.id))
  lines.push("  classDef data fill:#eef6ff,stroke:#2f6fa3,color:#102a43")
  lines.push("  classDef store fill:#fff3d6,stroke:#9a6500,color:#3f2a00")
  lines.push("  classDef external fill:#f3eaff,stroke:#7047a3,color:#2c1747")
  lines.push("  classDef input fill:#e8f8ef,stroke:#287a50,color:#123d29")
  lines.push("  classDef output fill:#e8f7fa,stroke:#23768a,color:#123943")
  const ordinary = ir.entities
    .filter((item) => !["store", "external", "input", "output"].includes(item.kind))
    .map((item) => aliases.get(item.id))
  if (ordinary.length) lines.push(`  class ${ordinary.join(",")} data`)
  if (stores.length) lines.push(`  class ${stores.join(",")} store`)
  if (external.length) lines.push(`  class ${external.join(",")} external`)
  if (inputs.length) lines.push(`  class ${inputs.join(",")} input`)
  if (outputs.length) lines.push(`  class ${outputs.join(",")} output`)
  appendRelationChannelClass(lines, channels)
  return `${lines.join("\n")}\n`
}

export function errorFlowMermaid(ir: ErrorFlowIR, direction: "TD" | "LR" = "TD", layout?: FlowchartLayout) {
  const aliases = new Map(ir.nodes.map((node, index) => [node.id, `E${index}`]))
  const ordered = orderGraphNodes(ir.nodes, ir.edges, (node) => node.id)
  const lines = flowchartNodes(
    direction,
    ordered,
    ir.edges.length,
    "异常阶段",
    (node) => `${aliases.get(node.id)}["${wrappedLabel(node.label, 20)}"]`,
    "TB",
    layout,
  )
  const channels = appendRelationEdges(lines, ir.edges, aliases, "EREL", "逐条异常处理路径")
  const terminal = ir.nodes.filter((item) => item.kind === "terminal").map((item) => aliases.get(item.id))
  const handlers = ir.nodes
    .filter((item) => item.kind === "handler" || item.kind === "retry" || item.kind === "fallback")
    .map((item) => aliases.get(item.id))
  const raises = ir.nodes.filter((item) => item.kind === "raise").map((item) => aliases.get(item.id))
  lines.push("  classDef normal fill:#eef6ff,stroke:#2f6fa3,color:#102a43")
  lines.push("  classDef danger fill:#ffe8e8,stroke:#b83b3b,color:#541717")
  lines.push("  classDef recovery fill:#fff3d6,stroke:#9a6500,color:#3f2a00")
  lines.push("  classDef terminal fill:#f0e8f8,stroke:#6d4695,color:#2d1b42")
  if (raises.length) lines.push(`  class ${raises.join(",")} danger`)
  if (handlers.length) lines.push(`  class ${handlers.join(",")} recovery`)
  if (terminal.length) lines.push(`  class ${terminal.join(",")} terminal`)
  appendRelationChannelClass(lines, channels)
  return `${lines.join("\n")}\n`
}

export function overviewMermaid(ir: OverviewIR, direction: "TD" | "LR" = "LR") {
  if (ir.items.length > 12) return complexOverviewMermaid(ir, direction)
  const lines = [`flowchart ${direction}`, `  M["${wrappedLabel(ir.title, 24)}"]`]
  const itemAliases: string[] = []
  const aliases = new Map<string, string>()
  const kinds: Array<OverviewIR["items"][number]["kind"]> = ["file", "symbol", "entry", "dependency", "configuration"]
  for (const [index, kind] of kinds.entries()) {
    const items = ir.items.filter((item) => item.kind === kind)
    if (!items.length) continue
    const hub = `H${index}`
    const kindLabel = {
      file: "源码文件",
      symbol: "核心符号",
      entry: "执行入口",
      dependency: "外部依赖",
      configuration: "关键配置",
    }[kind]
    lines.push(`  ${hub}["${kindLabel}（${items.length}）"]`)
    lines.push(`  M -->${edgeLabelText(`包含${kindLabel}`)} ${hub}`)
    for (const [itemIndex, item] of items.entries()) {
      const alias = `O${index}_${itemIndex}`
      itemAliases.push(alias)
      aliases.set(item.id, alias)
      lines.push(`  ${alias}["${wrappedLabel(item.label, 20)}"]`)
      lines.push(`  ${hub} --> ${alias}`)
    }
  }
  for (const relation of ir.relations ?? []) {
    const from = aliases.get(relation.from)
    const to = aliases.get(relation.to)
    if (from && to) lines.push(`  ${from} -->${edgeLabelText(relation.label)} ${to}`)
  }
  lines.push("  classDef module fill:#dcecff,stroke:#245f99,color:#102a43,stroke-width:2px")
  lines.push("  classDef group fill:#eef6ff,stroke:#4b7da5,color:#17324d")
  lines.push("  classDef item fill:#ffffff,stroke:#7b94aa,color:#263746")
  lines.push("  class M module")
  const hubs = kinds
    .map((_, index) => `H${index}`)
    .filter((alias) => lines.some((line) => line.startsWith(`  ${alias}[`)))
  if (hubs.length) lines.push(`  class ${hubs.join(",")} group`)
  if (itemAliases.length) lines.push(`  class ${itemAliases.join(",")} item`)
  return `${lines.join("\n")}\n`
}

function complexOverviewMermaid(ir: OverviewIR, direction: "TD" | "LR") {
  const lines = [`flowchart ${direction === "LR" ? "TD" : "LR"}`, `  M["${wrappedLabel(ir.title, 24)}"]`]
  const aliases = new Map<string, string>()
  const kinds: Array<OverviewIR["items"][number]["kind"]> = ["file", "symbol", "entry", "dependency", "configuration"]
  const names = {
    file: "源码文件",
    symbol: "核心符号",
    entry: "执行入口",
    dependency: "依赖目标",
    configuration: "关键配置",
  }
  const panels = kinds.flatMap((kind) => {
    const items = ir.items.filter((item) => item.kind === kind)
    return Array.from({ length: Math.ceil(items.length / 5) }, (_, index) => ({
      kind,
      items: items.slice(index * 5, index * 5 + 5),
      index,
      total: Math.ceil(items.length / 5),
    }))
  })
  for (let row = 0; row < panels.length; row += 3) {
    lines.push(`  subgraph ARCH_ROW_${row / 3 + 1}["架构分区 ${row / 3 + 1}"]`)
    lines.push("    direction LR")
    for (const [offset, panel] of panels.slice(row, row + 3).entries()) {
      const panelIndex = row + offset
      const hub = `AH${panelIndex}`
      const suffix = panel.total > 1 ? ` ${panel.index + 1}/${panel.total}` : ""
      lines.push(`    subgraph ARCH_PANEL_${panelIndex}["${names[panel.kind]}${suffix}"]`)
      lines.push("      direction TB")
      lines.push(`      ${hub}["${names[panel.kind]}（${panel.items.length}）"]`)
      for (const [itemIndex, item] of panel.items.entries()) {
        const alias = `AO${panelIndex}_${itemIndex}`
        aliases.set(item.id, alias)
        lines.push(`      ${alias}["${wrappedLabel(item.label, 20)}"]`)
        lines.push(`      ${hub} --> ${alias}`)
      }
      lines.push("    end")
      lines.push(`    M -->${edgeLabelText(`包含${names[panel.kind]}`)} ${hub}`)
    }
    lines.push("  end")
  }
  for (const relation of ir.relations ?? []) {
    const from = aliases.get(relation.from)
    const to = aliases.get(relation.to)
    if (from && to) lines.push(`  ${from} -->${edgeLabelText(relation.label)} ${to}`)
  }
  lines.push("  classDef module fill:#dcecff,stroke:#245f99,color:#102a43,stroke-width:2px")
  lines.push("  classDef hub fill:#eef6ff,stroke:#4b7da5,color:#17324d")
  lines.push("  classDef item fill:#ffffff,stroke:#7b94aa,color:#263746")
  lines.push("  class M module")
  const hubs = panels.map((_, index) => `AH${index}`)
  if (hubs.length) lines.push(`  class ${hubs.join(",")} hub`)
  const items = [...aliases.values()]
  if (items.length) lines.push(`  class ${items.join(",")} item`)
  return `${lines.join("\n")}\n`
}

function appendSemanticClasses<T extends { id: string; kind: string }>(
  lines: string[],
  aliases: Map<string, string>,
  nodes: readonly T[],
) {
  const triggers = nodes
    .filter((item) => item.kind === "entry" || item.kind === "trigger")
    .map((item) => aliases.get(item.id))
  const decisions = nodes.filter((item) => item.kind === "decision").map((item) => aliases.get(item.id))
  const outcomes = nodes
    .filter((item) => item.kind === "exit" || item.kind === "outcome")
    .map((item) => aliases.get(item.id))
  const errors = nodes.filter((item) => item.kind === "error").map((item) => aliases.get(item.id))
  const actions = nodes
    .filter((item) => !["entry", "trigger", "decision", "exit", "outcome", "error"].includes(item.kind))
    .map((item) => aliases.get(item.id))
  lines.push("  classDef trigger fill:#e8f8ef,stroke:#287a50,color:#123d29,stroke-width:2px")
  lines.push("  classDef action fill:#eef6ff,stroke:#2f6fa3,color:#102a43")
  lines.push("  classDef decision fill:#fff3d6,stroke:#9a6500,color:#3f2a00")
  lines.push("  classDef outcome fill:#e8f7fa,stroke:#23768a,color:#123943,stroke-width:2px")
  lines.push("  classDef error fill:#ffe8e8,stroke:#b83b3b,color:#541717,stroke-width:2px")
  if (triggers.length) lines.push(`  class ${triggers.join(",")} trigger`)
  if (actions.length) lines.push(`  class ${actions.join(",")} action`)
  if (decisions.length) lines.push(`  class ${decisions.join(",")} decision`)
  if (outcomes.length) lines.push(`  class ${outcomes.join(",")} outcome`)
  if (errors.length) lines.push(`  class ${errors.join(",")} error`)
}

function appendRelationEdges(
  lines: string[],
  relations: readonly { from: string; to: string; label: string }[],
  aliases: ReadonlyMap<string, string>,
  prefix: string,
  channelLabel: string,
) {
  const channels: string[] = []
  const groups = Map.groupBy(relations, (relation) => `${relation.from}\u0000${relation.to}`)
  let groupIndex = 0
  for (const group of groups.values()) {
    const from = aliases.get(group[0]?.from ?? "")
    const to = aliases.get(group[0]?.to ?? "")
    if (!from || !to) continue
    if (group.length === 1) {
      lines.push(`  ${from} -->${edgeLabelText(group[0].label)} ${to}`)
      continue
    }

    const details = group.map((relation) => relationDetailLabel(relation.label))
    const totals = new Map<string, number>()
    const positions = new Map<string, number>()
    for (const detail of details) totals.set(detail, (totals.get(detail) ?? 0) + 1)
    const relationAliases = details.map((detail, index) => {
      const alias = `${prefix}${groupIndex}_${index}`
      const position = (positions.get(detail) ?? 0) + 1
      positions.set(detail, position)
      const suffix = (totals.get(detail) ?? 0) > 1 ? `（第 ${position}/${totals.get(detail)} 次）` : ""
      return { alias, text: `${detail}${suffix}` }
    })
    lines.push(`  subgraph ${prefix}_DETAIL_${groupIndex}["${channelLabel}（${relationAliases.length} 条）"]`)
    lines.push("    direction TB")
    const rows = Array.from({ length: Math.ceil(relationAliases.length / 2) }, (_, index) =>
      relationAliases.slice(index * 2, index * 2 + 2),
    )
    for (const [rowIndex, row] of rows.entries()) {
      const rowAlias = `${prefix}_ROW_${groupIndex}_${rowIndex}`
      lines.push(`    subgraph ${rowAlias}[" "]`)
      lines.push("      direction LR")
      for (const item of row) lines.push(`      ${item.alias}["${wrappedLabel(item.text, 24)}"]`)
      if (row.length === 2) lines.push(`      ${row[0]!.alias} ~~~ ${row[1]!.alias}`)
      lines.push("    end")
      lines.push(`    style ${rowAlias} fill:none,stroke:none`)
    }
    for (let index = 1; index < rows.length; index++) {
      lines.push(`    ${rows[index - 1]![0]!.alias} ~~~ ${rows[index]![0]!.alias}`)
    }
    lines.push("  end")
    for (const item of relationAliases) {
      lines.push(`  ${from} --> ${item.alias}`)
      lines.push(`  ${item.alias} --> ${to}`)
      channels.push(item.alias)
    }
    groupIndex++
  }
  return channels
}

function relationDetailLabel(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim()
}

function appendRelationChannelClass(lines: string[], channels: string[]) {
  if (!channels.length) return
  lines.push("  classDef relation fill:#f7f4ff,stroke:#7457a6,color:#2e2142,stroke-dasharray: 4 2")
  lines.push(`  class ${channels.join(",")} relation`)
}

function flowchartNodes<T>(
  direction: "TD" | "LR",
  nodes: readonly T[],
  relationCount: number,
  panelLabel: string,
  declaration: (node: T) => string,
  panelDirection: "TB" | "LR" = "TB",
  layout?: FlowchartLayout,
) {
  const panelled = relationCount > 4 && nodes.length > 6
  if (!panelled) return [`flowchart ${direction}`, ...nodes.map((node) => `  ${declaration(node)}`)]
  const inner = layout?.panelDirection ?? panelDirection
  const panelSize = layout?.panelSize ?? (direction === "TD" ? 4 : 3)
  const panels = Array.from({ length: Math.ceil(nodes.length / panelSize) }, (_, index) =>
    nodes.slice(index * panelSize, index * panelSize + panelSize),
  )
  const panelsPerRow = layout?.panelsPerRow ?? (inner === "LR" ? 1 : direction === "TD" ? 3 : 1)
  const lines = ["flowchart TD"]
  for (let row = 0; row < panels.length; row += panelsPerRow) {
    if (panelsPerRow === 1) {
      const panel = row + 1
      lines.push(`  subgraph PANEL_${panel}["${panelLabel} ${panel}"]`)
      lines.push(`    direction ${inner}`)
      for (const node of panels[row] ?? []) lines.push(`    ${declaration(node)}`)
      lines.push("  end")
      continue
    }
    lines.push(`  subgraph FLOW_ROW_${row / panelsPerRow + 1}["${panelLabel}组 ${row / panelsPerRow + 1}"]`)
    lines.push("    direction LR")
    for (const [offset, panelNodes] of panels.slice(row, row + panelsPerRow).entries()) {
      const panel = row + offset + 1
      lines.push(`    subgraph PANEL_${panel}["${panelLabel} ${panel}"]`)
      lines.push(`      direction ${inner}`)
      for (const node of panelNodes) lines.push(`      ${declaration(node)}`)
      lines.push("    end")
    }
    lines.push("  end")
  }
  return lines
}

interface FlowchartLayout {
  panelSize: number
  panelsPerRow: number
  panelDirection: "TB" | "LR"
}

function flowchartLayoutSources(source: (direction: "TD" | "LR", layout?: FlowchartLayout) => string) {
  const candidates = [
    source("TD"),
    source("LR"),
    source("TD", { panelSize: 3, panelsPerRow: 3, panelDirection: "TB" }),
    source("TD", { panelSize: 4, panelsPerRow: 2, panelDirection: "TB" }),
    source("TD", { panelSize: 4, panelsPerRow: 1, panelDirection: "LR" }),
    source("TD", { panelSize: 3, panelsPerRow: 2, panelDirection: "LR" }),
    source("TD", { panelSize: 5, panelsPerRow: 2, panelDirection: "TB" }),
  ]
  return [...new Set(candidates)]
}

function orderGraphNodes<T>(
  nodes: readonly T[],
  relations: readonly { from: string; to: string }[],
  id: (node: T) => string,
) {
  const positions = new Map(nodes.map((node, index) => [id(node), index]))
  const incoming = new Map(nodes.map((node) => [id(node), 0]))
  const outgoing = new Map(nodes.map((node) => [id(node), [] as string[]]))
  for (const relation of relations) {
    if (!incoming.has(relation.from) || !incoming.has(relation.to)) continue
    incoming.set(relation.to, (incoming.get(relation.to) ?? 0) + 1)
    outgoing.get(relation.from)?.push(relation.to)
  }
  const ready = [...incoming]
    .filter(([, count]) => count === 0)
    .map(([key]) => key)
    .toSorted((left, right) => (positions.get(left) ?? 0) - (positions.get(right) ?? 0))
  const ordered: string[] = []
  while (ready.length) {
    const current = ready.shift()!
    ordered.push(current)
    for (const target of outgoing.get(current) ?? []) {
      const count = (incoming.get(target) ?? 0) - 1
      incoming.set(target, count)
      if (count === 0) ready.push(target)
    }
    ready.sort((left, right) => (positions.get(left) ?? 0) - (positions.get(right) ?? 0))
  }
  const seen = new Set(ordered)
  const byID = new Map(nodes.map((node) => [id(node), node]))
  return [...ordered, ...nodes.map(id).filter((key) => !seen.has(key))].flatMap((key) => {
    const node = byID.get(key)
    return node ? [node] : []
  })
}

function edgeLabelText(value: string) {
  return `|"${wrappedLabel(value, 30).replaceAll("|", "&#124;")}"|`
}

function executionEdgeLabel(kind: ExecutionFlowIR["edges"][number]["kind"], value: string) {
  const detail = value.replace(/[\r\n]+/g, " ").trim()
  if (kind === "branch-true") return detail && detail !== "条件成立" ? `条件成立：${detail}` : "条件成立"
  if (kind === "branch-false") return detail && detail !== "条件不成立" ? `条件不成立：${detail}` : "条件不成立"
  return value
}

function wrappedLabel(value: string, lineCharacters: number) {
  const normalized = value.replace(/[\r\n]+/g, " ").trim()
  const rawTokens =
    normalized.match(
      /\s+|0[xX][\dA-Fa-f]+|[A-Za-z_$][A-Za-z\d_$]*(?:[.:][A-Za-z_$][A-Za-z\d_$]*)*|\d+(?:\.\d+)?|&&|\|\||==|!=|<=|>=|->|=>|::|[\p{Script=Han}]+|./gu,
    ) ?? []
  const tokens = rawTokens.flatMap((token) =>
    /^[\p{Script=Han}]+$/u.test(token)
      ? [...chineseWordSegmenter.segment(token)].map((segment) => protectChineseWord(segment.segment))
      : [token],
  )
  const output: string[] = []
  let currentLength = 0
  for (const token of tokens) {
    const length = [...token].length
    const trailingPunctuation = /^[,.;:!?，。；：！？)\]】}]+$/u.test(token)
    if (currentLength > 0 && currentLength + length > lineCharacters && !/^\s+$/u.test(token) && !trailingPunctuation) {
      output.push("<br/>")
      currentLength = 0
    }
    output.push(token.replaceAll('"', "&quot;"))
    currentLength += length
  }
  return output.join("")
}

function protectChineseWord(value: string) {
  return [...value].join("\u2060")
}
