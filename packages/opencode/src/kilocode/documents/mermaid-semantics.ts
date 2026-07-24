import { createHash } from "node:crypto"
import fs from "fs/promises"
import path from "path"
import type { QueryEvidenceResult } from "@kilocode/kilo-indexing/engine"
import { Instance } from "@/kilocode/instance"

export type MermaidSemanticStatus = "not-requested" | "valid" | "valid-with-unknowns" | "invalid"

export type MermaidSemanticIssue = {
  code: string
  severity: "warning" | "error"
  message: string
  claimId?: string
  path?: string
  startLine?: number
  endLine?: number
}

export type MermaidSemanticResult = {
  semanticStatus: MermaidSemanticStatus
  sourceHash: string
  claimCount: number
  validatedClaimCount: number
  issues: MermaidSemanticIssue[]
  diagnosticsPath?: string
  semanticFingerprint?: MermaidSemanticFingerprint
}

export type MermaidSemanticFingerprint = {
  diagramId: string
  splitFromDiagramId?: string
  nodeIds: string[]
  sourceNodeIds?: string[]
  sourceEdges?: Array<{
    from: string
    to: string
  }>
  nodes?: Array<{
    id: string
    symbol?: string
    designUnitId?: string
  }>
  edges: Array<{
    from: string
    to: string
    relation: EdgeClaim["relation"]
    fromSymbol?: string
    toSymbol?: string
    event?: string
  }>
}

type Evidence = {
  path: string
  startLine: number
  endLine: number
  symbols?: string[]
  fileHash?: string
}

type NodeClaim = {
  id: string
  symbol?: string
  container?: string
  designUnitId?: string
  status?: "confirmed" | "active" | "unknown"
  evidence?: Evidence[]
  evidenceIds?: string[]
}

type EdgeClaim = {
  id: string
  from: string
  to: string
  relation:
    | "direct-call"
    | "callback"
    | "ownership"
    | "dependency"
    | "data-flow"
    | "state-transition"
    | "unknown"
  fromSymbol?: string
  toSymbol?: string
  event?: string
  status?: "confirmed" | "active" | "unknown"
  evidence?: Evidence[]
  evidenceIds?: string[]
}

type NodeGroup = {
  items: Array<[id: string, symbol?: string, container?: string, designUnitId?: string]>
  status?: NodeClaim["status"]
  evidence?: Evidence[]
  evidenceIds?: string[]
}

type EdgeGroup = {
  id: string
  pairs: Array<[from: string, to: string, fromSymbol?: string, toSymbol?: string, event?: string]>
  relation: EdgeClaim["relation"]
  status?: EdgeClaim["status"]
  evidence?: Evidence[]
  evidenceIds?: string[]
}

type Manifest = {
  version: 1
  diagramId: string
  splitFromDiagramId?: string
  diagramType: string
  scopePath: string
  sourceHash: string
  language?: string
  designUnitId?: string
  designUnitCensusPath?: string
  evidenceCatalog?: Record<string, Evidence>
  nodes: NodeClaim[]
  edges: EdgeClaim[]
  nodeGroups?: NodeGroup[]
  edgeGroups?: EdgeGroup[]
}

type ImplementationUnit = {
  path: string
  disposition: "target" | "confirmed-submodule" | "excluded"
  designUnitId?: string
  exclusion?: {
    reason:
      | "generated"
      | "test-fixture"
      | "inactive-platform-variant"
      | "outside-target-build"
      | "exact-alias-duplicate"
    ownerDesignUnitId?: string
    evidence: Evidence[]
  }
}

type Census = {
  version: 1
  targetDesignUnitId: string
  targetSourceRoot?: string
  designUnits: Array<{
    id: string
    name: string
    kind: "target" | "confirmed-submodule"
    parentId?: string
  }>
  implementationUnits?: ImplementationUnit[]
}

type Parsed = {
  nodes: Set<string>
  edges: Array<{ from: string; to: string; text: string }>
  containers: Map<string, string>
}

export function mermaidContainers(source: string) {
  return parse(source).containers
}

export type MermaidSemanticQuery = (
  query: string,
  options: { directoryPrefix?: string; retrievalMode: "graph-only"; maxEvidenceItems: number; maxPackChars: number },
) => Promise<QueryEvidenceResult>

const UNKNOWN = "待确认"
const MAX_ISSUES = 200
const RELATIONS = new Set<EdgeClaim["relation"]>([
  "direct-call",
  "callback",
  "ownership",
  "dependency",
  "data-flow",
  "state-transition",
  "unknown",
])
const STRONG_RELATIONS = new Set<EdgeClaim["relation"]>([
  "direct-call",
  "callback",
  "ownership",
  "data-flow",
  "state-transition",
])
const STATUSES = new Set(["confirmed", "active", "unknown"])
const C_EXTENSIONS = new Set([".c", ".h", ".cc", ".hh", ".cpp", ".hpp", ".cxx", ".hxx", ".inc", ".inl"])
const C_IMPLEMENTATIONS = new Set([".c", ".cc", ".cpp", ".cxx"])
const EXCLUSIONS = new Set(["generated", "test-fixture", "inactive-platform-variant", "outside-target-build", "exact-alias-duplicate"])
const SKIP = new Set([".git", ".chipmate-v2", "node_modules"])

export async function validateSourceBackedMermaid(input: {
  source: string
  semanticEvidencePath: string
  query?: MermaidSemanticQuery
  allowSourceHashPlaceholder?: boolean
}): Promise<MermaidSemanticResult> {
  const sourceHash = hash(input.source)
  const issues: MermaidSemanticIssue[] = []
  const manifest = await read(input.semanticEvidencePath, issues)
  if (!manifest) return await finish(input.semanticEvidencePath, "invalid", sourceHash, 0, 0, issues)

  const placeholder = manifest.sourceHash === "$MMD_SHA256"
  if (placeholder && !input.allowSourceHashPlaceholder) {
    push(issues, {
      code: "semantic-source-hash-placeholder-not-allowed",
      severity: "error",
      message:
        "The $MMD_SHA256 placeholder is accepted only by a source-backed batch manifest, where the tool binds it to the exact saved Mermaid source. Supply the exact hash for standalone validation or rendering.",
    })
  }
  if (!placeholder && manifest.sourceHash !== sourceHash) {
    push(issues, {
      code: "semantic-source-hash-mismatch",
      severity: "error",
      message: `diagram-claims.json sourceHash ${manifest.sourceHash} does not match ${sourceHash}. Use the hash returned for the exact final Mermaid source being validated; do not use a probe, shortened copy, or different saved MMD.`,
    })
  }
  if (!manifest.diagramId.trim() || !manifest.diagramType.trim()) {
    push(issues, {
      code: "semantic-manifest-invalid",
      severity: "error",
      message: "diagramId and diagramType are required.",
    })
  }

  const parsed = parse(input.source)
  const state = stateMachine(manifest.diagramType, input.source)
  const nodes = unique(manifest.nodes.map((item) => item.id), "node", issues)
  const edges = unique(manifest.edges.map((item) => item.id), "edge", issues)
  await coverage(manifest, issues)
  const unclaimedNodes = [...parsed.nodes].filter((id) => id !== "[*]" && !nodes.has(id))
  if (unclaimedNodes.length) {
    push(issues, {
      code: "semantic-nodes-unclaimed-summary",
      severity: "error",
      message:
        `Add claims for all ${unclaimedNodes.length} visible nodes (${unclaimedNodes.slice(0, 100).join(", ")}). ` +
        "Use compact nodeGroups for nodes sharing evidence; do not delete, merge, or rename visible semantics to reduce the list.",
    })
  }
  for (const id of unclaimedNodes) {
    push(issues, {
      code: "semantic-node-unclaimed",
      severity: "error",
      message: `Mermaid node ${id} has no source-backed claim. Add it directly or through nodeGroups; do not remove it from the MMD.`,
    })
  }
  for (const claim of manifest.nodes) {
    if (!parsed.nodes.has(claim.id)) {
      push(issues, {
        code: "semantic-node-missing",
        severity: "error",
        claimId: claim.id,
        message: `Claimed node ${claim.id} is not present in Mermaid source.`,
      })
    }
    const container = parsed.containers.get(claim.id)
    if (container && !claim.container) {
      push(issues, {
        code: "semantic-container-unclaimed",
        severity: "error",
        claimId: claim.id,
        message: `Node ${claim.id} is rendered inside ${container}, but its claim does not record that container.`,
      })
    }
    if (claim.container && container !== claim.container) {
      push(issues, {
        code: "semantic-container-mismatch",
        severity: "error",
        claimId: claim.id,
        message: `Node ${claim.id} is rendered inside ${container ?? "the top level"}, not ${claim.container}. container is the Mermaid subgraph ID, not a source file or C/C++ owner.`,
      })
    }
  }

  const remaining = [...parsed.edges]
  for (const claim of manifest.edges) {
    if (
      state &&
      claim.from !== "[*]" &&
      claim.to !== "[*]" &&
      claim.relation !== "state-transition" &&
      claim.relation !== "unknown"
    ) {
      push(issues, {
        code: "semantic-state-transition-downgrade",
        severity: "error",
        claimId: claim.id,
        message:
          `State diagram edge ${claim.from} -> ${claim.to} must use state-transition with guard/action evidence, ` +
          `or relation unknown with a visible ${UNKNOWN} label. ${claim.relation} cannot satisfy state-machine coverage.`,
      })
    }
    const index = remaining.findIndex((item) => item.from === claim.from && item.to === claim.to)
    if (index >= 0) remaining.splice(index, 1)
    else {
      push(issues, {
        code: "semantic-edge-missing",
        severity: "error",
        claimId: claim.id,
        message: `Claimed edge ${claim.from} -> ${claim.to} is not present in Mermaid source.`,
      })
    }
  }
  const unclaimedEdges = remaining.filter((edge) => edge.from !== "[*]" && edge.to !== "[*]")
  if (unclaimedEdges.length) {
    push(issues, {
      code: "semantic-edges-unclaimed-summary",
      severity: "error",
      message:
        `Add claims for all ${unclaimedEdges.length} visible edges (${unclaimedEdges.slice(0, 100).map((edge) => `${edge.from}->${edge.to}`).join(", ")}). ` +
        "Use compact edgeGroups for edges sharing evidence and relation; do not collapse branches or remove error, retry, handoff, transition, or terminal paths.",
    })
  }
  for (const edge of unclaimedEdges) {
    push(issues, {
      code: "semantic-edge-unclaimed",
      severity: "error",
      message: `Mermaid edge ${edge.from} -> ${edge.to} has no source-backed claim. Add it directly or through edgeGroups; do not remove it from the MMD.`,
    })
  }

  const scope = await resolveScope(manifest.scopePath, issues)
  const paths = [
    ...Object.values(manifest.evidenceCatalog ?? {}),
    ...[...manifest.nodes, ...manifest.edges].flatMap((item) => item.evidence ?? []),
  ].map((item) => item.path)
  const declared = manifest.language?.trim().toLowerCase()
  const strong =
    declared === "c" ||
    declared === "cpp" ||
    declared === "c++" ||
    paths.some((item) => C_EXTENSIONS.has(path.extname(item).toLowerCase()))
  if (strong && declared && declared !== "c" && declared !== "cpp" && declared !== "c++") {
    push(issues, {
      code: "semantic-language-mismatch",
      severity: "error",
      message: `Claims reference C/C++ evidence but declare language ${manifest.language}. language means source-code language, not document or label language; use c/cpp/c++ or omit it. C/C++ strong validation cannot be disabled by manifest metadata.`,
    })
  }
  const query = strong ? input.query ?? (await load(issues)) : undefined
  const cache = new Map<string, Promise<QueryEvidenceResult>>()
  let validated = 0
  for (const claim of manifest.nodes) {
    const refs = resolve(claim, manifest, issues)
    const evidence = await checkEvidence(claim.id, refs, claim.symbol ? [claim.symbol] : [], issues)
    if (claim.status === "unknown") {
      unknownIssue(claim.id, input.source, issues, { node: claim.id })
      continue
    }
    if (claim.symbol && !evidence) continue
    validated += 1
  }
  for (const claim of manifest.edges) {
    const refs = resolve(claim, manifest, issues)
    const endpoints = edgeSymbols(claim, manifest)
    const symbols = STRONG_RELATIONS.has(claim.relation)
      ? [endpoints.from, endpoints.to].filter((item): item is string => Boolean(item))
      : []
    const evidence = await checkEvidence(claim.id, refs, symbols, issues)
    if (claim.relation === "unknown" || claim.status === "unknown") {
      unknownIssue(claim.id, input.source, issues, { from: claim.from, to: claim.to })
      continue
    }
    if (!evidence) continue
    if (strong && claim.relation === "direct-call" && endpoints.from && endpoints.to) {
      const source = await direct(refs, endpoints.from, endpoints.to, issues, claim.id)
      if (source.forward) {
        validated += 1
        continue
      }
      if (source.reverse) {
        push(issues, {
          code: "semantic-call-direction-reversed",
          severity: "error",
          claimId: claim.id,
          message: `Source evidence supports ${endpoints.to} -> ${endpoints.from}, not ${endpoints.from} -> ${endpoints.to}.`,
        })
        continue
      }
      const exact = query
        ? await calls(query, cache, scope, endpoints.from, endpoints.to, refs, issues, claim.id)
        : undefined
      if (!exact) continue
      if (exact.forward) validated += 1
      else if (exact.reverse) {
        push(issues, {
          code: "semantic-call-direction-reversed",
          severity: "error",
          claimId: claim.id,
          message: `CodeGraph supports ${endpoints.to} -> ${endpoints.from}, not ${endpoints.from} -> ${endpoints.to}.`,
        })
      } else {
        unresolved(claim, input.source, `Direct call ${endpoints.from} -> ${endpoints.to} is not proven. direct-call requires exact caller and callee functions; use ownership or dependency for an evidenced architecture link.`, issues)
      }
      continue
    }
    if (strong && claim.relation === "state-transition" && endpoints.from && endpoints.to) {
      if (await transition(refs, endpoints.from, endpoints.to, issues, claim.id)) {
        validated += 1
        continue
      }
      const data = query
        ? await graph(query, cache, scope, `state transition ${endpoints.from} ${endpoints.to} ${claim.event ?? ""}`, issues, claim.id)
        : undefined
      if (!data) continue
      const match = data.stateTransitions.some(
        (item) =>
          item.fromState === endpoints.from &&
          item.toState === endpoints.to &&
          (!claim.event || item.eventName === claim.event) &&
          refs.some((evidence) => overlaps(evidence, item.filePath, item.startLine, item.endLine)),
      )
      if (match) validated += 1
      else {
        const fallback = state
          ? `Mark the edge ${UNKNOWN} or remove it.`
          : `When the prior state is implicit, use dependency for the evidenced mechanism or mark the edge ${UNKNOWN}.`
        unresolved(
          claim,
          input.source,
          `State transition ${endpoints.from} -> ${endpoints.to} is not proven by one narrow C/C++ guard/action range, an evidenced guard -> helper call -> target-state assignment chain, or CodeGraph. Cite the exact ranges. ${fallback}`,
          issues,
        )
      }
      continue
    }
    if (claim.relation === "callback" && endpoints.from && endpoints.to) {
      const text = await evidenceText(refs, issues, claim.id)
      const from = escape(endpoints.from)
      const to = escape(endpoints.to)
      const register = new RegExp(`\\b${from}\\b[\\s\\S]{0,600}?\\b(?:register|set|install|attach)[A-Za-z0-9_]*\\s*\\([^)]*\\b${to}\\b`)
      const assign = new RegExp(`\\b${from}\\b[^;\\n]{0,200}?(?:callback|handler|notify|complete|ops)[A-Za-z0-9_.>-]*\\s*=\\s*&?\\b${to}\\b`, "i")
      if (register.test(text) || assign.test(text)) validated += 1
      else unresolved(claim, input.source, `Callback ${endpoints.from} -> ${endpoints.to} lacks registration or assignment evidence.`, issues)
      continue
    }
    if (claim.relation === "ownership" && endpoints.from && endpoints.to) {
      const text = await evidenceText(refs, issues, claim.id)
      const owner = escape(endpoints.from)
      const member = escape(endpoints.to)
      const field = new RegExp(`(?:struct|class|typedef\\s+struct)[^\\n{]*\\b${owner}\\b[^\\{]*\\{[^}]*?\\b${member}\\b`)
      const init = new RegExp(`\\b${owner}\\b[^;\\n]{0,200}?\\.${member}\\s*=`)
      if (field.test(text) || init.test(text)) validated += 1
      else unresolved(claim, input.source, `Ownership ${endpoints.from} -> ${endpoints.to} is not proven by a field or initializer.`, issues)
      continue
    }
    if (strong && claim.relation === "data-flow" && endpoints.from && endpoints.to) {
      const text = await evidenceText(refs, issues, claim.id)
      const from = escape(endpoints.from)
      const to = escape(endpoints.to)
      const assignment = new RegExp(`\\b${to}\\b[^\\n=]*=\\s*[^;\\n]*\\b${from}\\b`)
      const copy = new RegExp(`\\b(?:memcpy|memmove|copy[^\\s(]*|write[^\\s(]*|send[^\\s(]*|enqueue[^\\s(]*)\\s*\\(\\s*[^,]*\\b${to}\\b\\s*,[^\\n]*\\b${from}\\b`)
      const annotated = new RegExp(`\\b${from}\\b\\s*(?:->|to)\\s*\\b${to}\\b`, "i")
      if (assignment.test(text) || copy.test(text) || annotated.test(text)) validated += 1
      else unresolved(claim, input.source, `Data flow ${endpoints.from} -> ${endpoints.to} is not proven in that direction.`, issues)
      continue
    }
    validated += 1
  }

  const errors = issues.some((item) => item.severity === "error")
  const warnings = issues.some((item) => item.severity === "warning")
  const fingerprint: MermaidSemanticFingerprint = {
    diagramId: manifest.diagramId,
    splitFromDiagramId: manifest.splitFromDiagramId,
    nodeIds: [...new Set(manifest.nodes.map((item) => item.id))].sort(),
    sourceNodeIds: [...parsed.nodes].filter((item) => item !== "[*]").sort(),
    sourceEdges: parsed.edges
      .filter((item) => item.from !== "[*]" && item.to !== "[*]")
      .map((item) => ({ from: item.from, to: item.to }))
      .sort((left, right) => `${left.from}\u0000${left.to}`.localeCompare(`${right.from}\u0000${right.to}`)),
    nodes: manifest.nodes
      .map((item) => ({
        id: item.id,
        symbol: item.symbol,
        designUnitId: item.designUnitId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: manifest.edges
      .map((item) => ({
        from: item.from,
        to: item.to,
        relation: item.relation,
        fromSymbol: edgeSymbols(item, manifest).from,
        toSymbol: edgeSymbols(item, manifest).to,
        event: item.event,
      }))
      .sort((left, right) =>
        `${left.from}\u0000${left.to}\u0000${left.relation}\u0000${left.fromSymbol ?? ""}\u0000${left.toSymbol ?? ""}\u0000${left.event ?? ""}`.localeCompare(
          `${right.from}\u0000${right.to}\u0000${right.relation}\u0000${right.fromSymbol ?? ""}\u0000${right.toSymbol ?? ""}\u0000${right.event ?? ""}`,
        ),
      ),
  }
  return await finish(
    input.semanticEvidencePath,
    errors ? "invalid" : warnings ? "valid-with-unknowns" : "valid",
    sourceHash,
    manifest.nodes.length + manifest.edges.length,
    validated,
    issues,
    fingerprint,
  )
}

function parse(source: string): Parsed {
  const nodes = new Set<string>()
  const edges: Parsed["edges"] = []
  const containers = new Map<string, string>()
  const stack: string[] = []
  const fsm = /^\s*stateDiagram(?:-v2)?\b/m.test(source)
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("%%") || /^(flowchart|graph|stateDiagram)/.test(line)) continue
    const sub = line.match(/^subgraph\s+([A-Za-z_][\w-]*)/)
    if (sub) {
      stack.push(sub[1]!)
      continue
    }
    if (line === "end") {
      stack.pop()
      continue
    }
    const state = line.match(/^state\s+(?:"[^"]*"\s+as\s+)?([A-Za-z_][\w-]*)/)
    if (state) add(state[1]!, stack, nodes, containers)
    if (!fsm) {
      const defs = visible(line).matchAll(/(?:^|[\s;&])([A-Za-z_][\w-]*)\s*(?:\[|\(|\{|(?<!-)>)/g)
      for (const match of defs) add(match[1]!, stack, nodes, containers)
    }
    const arrow = line.match(/-->|---|-\.\->|==>/)
    if (!arrow || arrow.index === undefined) continue
    const from = line.slice(0, arrow.index).match(/^([A-Za-z_][\w-]*|\[\*\])/)
    const tail = line.slice(arrow.index + arrow[0].length).trimStart().replace(/^\|[^|]*\|\s*/, "")
    const to = tail.match(/^([A-Za-z_][\w-]*|\[\*\])/)
    if (!from || !to) continue
    add(from[1]!, stack, nodes, containers)
    add(to[1]!, stack, nodes, containers)
    edges.push({ from: from[1]!, to: to[1]!, text: line })
  }
  return { nodes, edges, containers }
}

function add(id: string, stack: string[], nodes: Set<string>, containers: Map<string, string>) {
  nodes.add(id)
  const container = stack.at(-1)
  if (container) containers.set(id, container)
}

async function read(input: string, issues: MermaidSemanticIssue[]): Promise<Manifest | undefined> {
  try {
    const file = await secure(input, "semanticEvidencePath")
    const value = JSON.parse(await fs.readFile(file, "utf8")) as Manifest
    const problems = shape(value)
    if (problems.length) {
      throw new Error(
        `${problems.slice(0, 20).join("; ")}; expected one version 1 object with top-level version, diagramId, splitFromDiagramId?, diagramType, scopePath, sourceHash, language?, designUnitId?, designUnitCensusPath?, evidenceCatalog?, nodes[], edges[], nodeGroups?, and edgeGroups?. Architecture diagrams require designUnitId plus a workspace design-unit-census.json; every direct confirmed child in that census must map to exactly one visible node through node.designUnitId. C/C++ architecture census also requires targetSourceRoot and implementationUnits[] so every implementation file is mapped to target/confirmed-submodule or a narrowly evidenced generated/test/inactive/non-build/exact-alias exclusion. language is the source-code language (c/cpp/c++), sourceHash must describe the exact final Mermaid source, splitFromDiagramId identifies the pending split-required parent covered by a readable child, and node container is its Mermaid subgraph ID rather than a source file. evidenceCatalog maps reusable evidence IDs to {path,startLine,endLine,symbols?,fileHash?}. Node items use id, symbol?, container?, designUnitId?, status?, evidenceIds?, evidence?. Edge items use id, from, to, relation, fromSymbol?, toSymbol?, event?, status?, evidenceIds?, evidence?; compact nodeGroups use items [[id,symbol?,container?,designUnitId?],...] and compact edgeGroups use id plus pairs [[from,to,fromSymbol?,toSymbol?,event?],...] with shared relation/status/evidence. relation must be one of ${[...RELATIONS].join(", ")}. symbol/fromSymbol/toSymbol are exact source identifiers, not labels or file stems; omit symbol for a conceptual node. Do not wrap claims in diagrams[] or replace node/edge fields with description/source/target shortcuts`,
      )
    }
    return expand(value)
  } catch (err) {
    push(issues, {
      code: "semantic-evidence-unreadable",
      severity: "error",
      path: input,
      message: `Cannot read diagram claims: ${err instanceof Error ? err.message : String(err)}`,
    })
    return undefined
  }
}

async function coverage(manifest: Manifest, issues: MermaidSemanticIssue[]) {
  if (!architecture(manifest.diagramType)) return
  if (!manifest.designUnitId?.trim() || !manifest.designUnitCensusPath?.trim()) return
  const strict = csource(manifest) || await contains(manifest.scopePath)
  const census = await readCensus(manifest.designUnitCensusPath, issues, strict)
  if (!census) return
  if (strict) await implementations(census, manifest.scopePath, issues)
  const units = new Map(census.designUnits.map((item) => [item.id, item]))
  const current = units.get(manifest.designUnitId)
  if (!current) {
    push(issues, {
      code: "semantic-design-unit-unknown",
      severity: "error",
      message: `Architecture diagram designUnitId ${manifest.designUnitId} is absent from ${manifest.designUnitCensusPath}.`,
    })
    return
  }
  const mapped = new Map<string, string[]>()
  for (const node of manifest.nodes) {
    if (!node.designUnitId) continue
    const ids = mapped.get(node.designUnitId) ?? []
    ids.push(node.id)
    mapped.set(node.designUnitId, ids)
    if (units.has(node.designUnitId)) continue
    push(issues, {
      code: "semantic-design-unit-node-unknown",
      severity: "error",
      claimId: node.id,
      message: `Node ${node.id} maps unknown designUnitId ${node.designUnitId}. Use an exact frozen census ID or omit designUnitId for a support/context node.`,
    })
  }
  const required = census.designUnits.filter(
    (item) => item.kind === "confirmed-submodule" && item.parentId === current.id,
  )
  for (const unit of required) {
    const nodes = mapped.get(unit.id) ?? []
    if (nodes.length === 1) continue
    push(issues, {
      code: nodes.length ? "semantic-design-unit-node-duplicate" : "semantic-design-unit-node-missing",
      severity: "error",
      message: nodes.length
        ? `Confirmed child ${unit.id} (${unit.name}) maps to ${nodes.length} visible nodes (${nodes.join(", ")}); it must appear exactly once in its owning architecture overview.`
        : `Confirmed child ${unit.id} (${unit.name}) is missing from the owning architecture overview. Add one visible node and a node claim whose designUnitId is ${unit.id}; do not remove it from the frozen census.`,
    })
  }
}

async function readCensus(input: string, issues: MermaidSemanticIssue[], strict: boolean): Promise<Census | undefined> {
  try {
    const file = await secure(input, "designUnitCensusPath")
    const value = JSON.parse(await fs.readFile(file, "utf8")) as Census
    const problems: string[] = []
    if (!value || typeof value !== "object") problems.push("census must be one object")
    if (value?.version !== 1) problems.push("version must be 1")
    if (typeof value?.targetDesignUnitId !== "string" || !value.targetDesignUnitId.trim()) {
      problems.push("targetDesignUnitId must be a non-empty string")
    }
    if (strict && (typeof value?.targetSourceRoot !== "string" || !value.targetSourceRoot.trim())) {
      problems.push("targetSourceRoot must be a non-empty workspace path for C/C++ architecture validation")
    }
    if (value?.targetSourceRoot !== undefined && typeof value.targetSourceRoot !== "string") {
      problems.push("targetSourceRoot must be a string when present")
    }
    if (!Array.isArray(value?.designUnits)) problems.push("designUnits must be an array")
    if (Array.isArray(value?.designUnits)) {
      const ids = new Set<string>()
      for (const [index, unit] of value.designUnits.entries()) {
        if (!unit || typeof unit !== "object") {
          problems.push(`designUnits[${index}] must be an object`)
          continue
        }
        if (typeof unit.id !== "string" || !unit.id.trim()) problems.push(`designUnits[${index}].id must be non-empty`)
        if (typeof unit.name !== "string" || !unit.name.trim()) problems.push(`designUnits[${index}].name must be non-empty`)
        if (unit.kind !== "target" && unit.kind !== "confirmed-submodule") problems.push(`designUnits[${index}].kind is invalid`)
        if (unit.parentId !== undefined && (typeof unit.parentId !== "string" || !unit.parentId.trim())) problems.push(`designUnits[${index}].parentId must be non-empty when present`)
        if (ids.has(unit.id)) problems.push(`duplicate designUnitId ${unit.id}`)
        ids.add(unit.id)
      }
      const target = value.designUnits.filter((item) => item.id === value.targetDesignUnitId && item.kind === "target")
      if (target.length !== 1) problems.push("targetDesignUnitId must identify exactly one target design unit")
      if (value.designUnits.filter((item) => item.kind === "target").length !== 1) {
        problems.push("designUnits must contain exactly one target design unit")
      }
      for (const unit of value.designUnits) {
        if (unit.kind !== "confirmed-submodule") continue
        if (!unit.parentId || !ids.has(unit.parentId)) problems.push(`confirmed submodule ${unit.id} must reference an existing parentId`)
      }
    }
    if (strict && !Array.isArray(value?.implementationUnits)) {
      problems.push("implementationUnits must be an array for C/C++ architecture validation")
    }
    if (value?.implementationUnits !== undefined && !Array.isArray(value.implementationUnits)) {
      problems.push("implementationUnits must be an array when present")
    }
    if (Array.isArray(value?.implementationUnits)) {
      const paths = new Set<string>()
      const ids = new Set(value.designUnits?.map((item) => item.id) ?? [])
      for (const [index, unit] of value.implementationUnits.entries()) {
        const root = `implementationUnits[${index}]`
        if (!unit || typeof unit !== "object") {
          problems.push(`${root} must be an object`)
          continue
        }
        if (typeof unit.path !== "string" || !unit.path.trim()) problems.push(`${root}.path must be non-empty`)
        if (paths.has(unit.path)) problems.push(`duplicate implementation path ${unit.path}`)
        paths.add(unit.path)
        if (unit.disposition !== "target" && unit.disposition !== "confirmed-submodule" && unit.disposition !== "excluded") {
          problems.push(`${root}.disposition is invalid`)
          continue
        }
        if (unit.disposition === "target" && unit.designUnitId !== value.targetDesignUnitId) {
          problems.push(`${root} target disposition must map to targetDesignUnitId`)
        }
        if (unit.disposition === "confirmed-submodule") {
          const design = value.designUnits?.find((item) => item.id === unit.designUnitId)
          if (!design || design.kind !== "confirmed-submodule" || design.parentId !== value.targetDesignUnitId) {
            problems.push(`${root} confirmed-submodule disposition must map to a direct confirmed child of targetDesignUnitId`)
          }
        }
        if (unit.disposition !== "excluded" && (!unit.designUnitId || !ids.has(unit.designUnitId))) {
          problems.push(`${root}.designUnitId must identify an existing design unit`)
        }
        if (unit.disposition !== "excluded" && unit.exclusion !== undefined) {
          problems.push(`${root}.exclusion is only valid for excluded implementation units`)
        }
        if (unit.disposition !== "excluded") continue
        if (unit.designUnitId !== undefined) problems.push(`${root}.designUnitId must be omitted for excluded implementation units`)
        if (!unit.exclusion || typeof unit.exclusion !== "object") {
          problems.push(`${root}.exclusion is required`)
          continue
        }
        if (!EXCLUSIONS.has(unit.exclusion.reason)) problems.push(`${root}.exclusion.reason is invalid`)
        if (!Array.isArray(unit.exclusion.evidence) || !unit.exclusion.evidence.length) {
          problems.push(`${root}.exclusion.evidence must be a non-empty array`)
        } else {
          problems.push(...evidence(unit.exclusion.evidence, `${root}.exclusion`))
        }
        if (unit.exclusion.reason === "exact-alias-duplicate") {
          const owner = value.designUnits?.find((item) => item.id === unit.exclusion?.ownerDesignUnitId)
          if (!owner || owner.kind !== "confirmed-submodule") {
            problems.push(`${root} exact-alias-duplicate must name a confirmed ownerDesignUnitId`)
          }
        } else if (unit.exclusion.ownerDesignUnitId !== undefined) {
          problems.push(`${root}.exclusion.ownerDesignUnitId is only valid for exact-alias-duplicate`)
        }
      }
    }
    if (problems.length) throw new Error(problems.slice(0, 20).join("; "))
    return value
  } catch (err) {
    push(issues, {
      code: "semantic-census-unreadable",
      severity: "error",
      path: input,
      message: `Cannot read design-unit census: ${err instanceof Error ? err.message : String(err)}`,
    })
    return undefined
  }
}

async function implementations(census: Census, scopePath: string, issues: MermaidSemanticIssue[]) {
  if (!census.targetSourceRoot || !census.implementationUnits) return
  try {
    const [scope, root] = await Promise.all([
      secure(scopePath || ".", "scopePath"),
      secure(census.targetSourceRoot, "targetSourceRoot"),
    ])
    const stat = await fs.stat(root)
    const dir = stat.isDirectory()
    if (!dir && (!stat.isFile() || !C_IMPLEMENTATIONS.has(path.extname(root).toLowerCase()))) {
      throw new Error("targetSourceRoot must identify a directory or one exact C/C++ implementation file")
    }
    nested(root, scope, "targetSourceRoot")
    const found = dir ? await walk(root) : new Set([root])
    const listed = new Map<string, ImplementationUnit>()
    for (const unit of census.implementationUnits) {
      const file = await secure(unit.path, "implementation unit path")
      if (dir) nested(file, root, "implementation unit path")
      if (!dir && file !== root) throw new Error(`implementation unit ${unit.path} must equal the exact targetSourceRoot file`)
      if (!C_IMPLEMENTATIONS.has(path.extname(file).toLowerCase())) {
        throw new Error(`implementation unit ${unit.path} is not a C/C++ implementation file`)
      }
      const key = portable(path.relative(Instance.directory, file))
      if (listed.has(key)) throw new Error(`duplicate implementation path ${unit.path}`)
      listed.set(key, unit)
      if (unit.disposition !== "excluded") continue
      await checkEvidence(`implementation:${key}`, unit.exclusion?.evidence ?? [], [], issues)
    }
    for (const file of found) {
      const key = portable(path.relative(Instance.directory, file))
      if (listed.has(key)) continue
      push(issues, {
        code: "semantic-implementation-unit-unmapped",
        severity: "error",
        path: key,
        message: `Target implementation unit ${key} is absent from implementationUnits. Map it to the target or one confirmed submodule; stateless, utility-like, small, or single-caller behavior is not an exclusion reason.`,
      })
    }
    for (const key of listed.keys()) {
      if (found.has(path.resolve(Instance.directory, key))) continue
      push(issues, {
        code: "semantic-implementation-unit-outside-census",
        severity: "error",
        path: key,
        message: `implementationUnits lists ${key}, but it is not a C/C++ implementation file discovered under targetSourceRoot.`,
      })
    }
  } catch (err) {
    push(issues, {
      code: "semantic-implementation-census-invalid",
      severity: "error",
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function walk(root: string) {
  const files = new Set<string>()
  const dirs = [root]
  while (dirs.length) {
    const dir = dirs.pop()!
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (SKIP.has(item.name)) continue
      const file = path.join(dir, item.name)
      if (item.isDirectory()) {
        dirs.push(file)
        continue
      }
      if (!item.isFile() || !C_IMPLEMENTATIONS.has(path.extname(item.name).toLowerCase())) continue
      files.add(await fs.realpath(file))
      if (files.size > 10_000) throw new Error("targetSourceRoot contains more than 10000 C/C++ implementation files; narrow it to the target-owned source root")
    }
  }
  return files
}

async function contains(input: string) {
  try {
    const root = await secure(input || ".", "scopePath")
    if (!(await fs.stat(root)).isDirectory()) return false
    const dirs = [root]
    while (dirs.length) {
      const dir = dirs.pop()!
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        if (SKIP.has(item.name)) continue
        if (item.isDirectory()) {
          dirs.push(path.join(dir, item.name))
          continue
        }
        if (item.isFile() && C_IMPLEMENTATIONS.has(path.extname(item.name).toLowerCase())) return true
      }
    }
    return false
  } catch {
    return false
  }
}

async function checkEvidence(id: string, evidence: Evidence[], symbols: string[], issues: MermaidSemanticIssue[]) {
  if (!evidence.length) {
    push(issues, { code: "semantic-evidence-missing", severity: "error", claimId: id, message: `Claim ${id} has no source evidence.` })
    return false
  }
  let valid = true
  const seen = new Set<string>()
  const candidates = new Map<string, string[]>()
  for (const item of evidence) {
    try {
      const file = await secure(item.path, "evidence path")
      const text = await fs.readFile(file, "utf8")
      const lines = text.split(/\r?\n/)
      if (!Number.isInteger(item.startLine) || !Number.isInteger(item.endLine) || item.startLine < 1 || item.endLine < item.startLine || item.endLine > lines.length) {
        throw new Error(`invalid line range ${item.startLine}-${item.endLine}; file has ${lines.length} lines`)
      }
      if (item.fileHash && item.fileHash !== hash(text)) throw new Error("file hash is stale")
      const slice = lines.slice(item.startLine - 1, item.endLine).join("\n")
      for (const symbol of symbols) {
        const found = lines.flatMap((line, index) => line.includes(symbol) ? [`${item.path}:${index + 1}`] : []).slice(0, 3)
        if (found.length) candidates.set(symbol, [...new Set([...(candidates.get(symbol) ?? []), ...found])].slice(0, 3))
      }
      for (const symbol of item.symbols ?? []) {
        if (slice.includes(symbol)) continue
        throw new Error(`symbol ${symbol} is absent from the claimed range`)
      }
      for (const symbol of symbols) if (slice.includes(symbol)) seen.add(symbol)
    } catch (err) {
      valid = false
      push(issues, {
        code: "semantic-evidence-invalid",
        severity: "error",
        claimId: id,
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine,
        message: `Claim ${id}: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  for (const symbol of symbols) {
    if (seen.has(symbol)) continue
    valid = false
    push(issues, {
      code: "semantic-evidence-invalid",
      severity: "error",
      claimId: id,
      message: `Claim ${id}: exact symbol ${symbol} is absent from all claimed ranges.${candidates.has(symbol) ? ` Candidate lines: ${candidates.get(symbol)!.join(", ")}.` : ""} For a conceptual/module/file node, omit symbol and retain exact evidence symbols; never use a display label or file stem as symbol.`,
    })
  }
  return valid
}

function resolve(claim: NodeClaim | EdgeClaim, manifest: Manifest, issues: MermaidSemanticIssue[]) {
  const values = [...(claim.evidence ?? [])]
  const seen = new Set(values.map((item) => `${item.path}:${item.startLine}:${item.endLine}`))
  for (const id of claim.evidenceIds ?? []) {
    const item = manifest.evidenceCatalog?.[id]
    if (!item) {
      push(issues, {
        code: "semantic-evidence-ref-missing",
        severity: "error",
        claimId: claim.id,
        message: `Claim ${claim.id} references unknown evidence ID ${id}. Define it once in evidenceCatalog or remove the reference.`,
      })
      continue
    }
    const key = `${item.path}:${item.startLine}:${item.endLine}`
    if (seen.has(key)) continue
    seen.add(key)
    values.push(item)
  }
  return values
}

async function calls(
  query: MermaidSemanticQuery,
  cache: Map<string, Promise<QueryEvidenceResult>>,
  scope: string | undefined,
  from: string,
  to: string,
  evidence: Evidence[],
  issues: MermaidSemanticIssue[],
  id: string,
) {
  const forward = await graph(query, cache, scope, `call sites ${from} ${to}`, issues, id)
  const reverse = await graph(query, cache, scope, `call sites ${to} ${from}`, issues, id)
  if (!forward || !reverse) return undefined
  return {
    forward: forward.evidenceRefs.some(
      (item) =>
        item.callerName === from &&
        item.calleeName === to &&
        evidence.some((claim) => overlaps(claim, item.filePath, item.startLine, item.endLine)),
    ),
    reverse: reverse.evidenceRefs.some(
      (item) =>
        item.callerName === to &&
        item.calleeName === from &&
        evidence.some((claim) => overlaps(claim, item.filePath, item.startLine, item.endLine)),
    ),
  }
}

async function graph(
  query: MermaidSemanticQuery,
  cache: Map<string, Promise<QueryEvidenceResult>>,
  scope: string | undefined,
  text: string,
  issues: MermaidSemanticIssue[],
  id: string,
) {
  const key = `${scope ?? ""}\0${text}`
  const found = cache.get(key)
  if (found) return await safe(found, issues, id)
  const value = query(text, { ...(scope ? { directoryPrefix: scope } : {}), retrievalMode: "graph-only", maxEvidenceItems: 20, maxPackChars: 4000 })
  cache.set(key, value)
  return await safe(value, issues, id)
}

async function load(issues: MermaidSemanticIssue[]): Promise<MermaidSemanticQuery | undefined> {
  try {
    const mod = await import("@/kilocode/indexing")
    return (query, options) => mod.KiloIndexing.queryEvidence(query, options)
  } catch (err) {
    push(issues, {
      code: "semantic-codegraph-unavailable",
      severity: "error",
      message: `Cannot load CodeGraph validation: ${err instanceof Error ? err.message : String(err)}`,
    })
    return undefined
  }
}

function unknownIssue(
  id: string,
  source: string,
  issues: MermaidSemanticIssue[],
  target: { node: string } | { from: string; to: string },
) {
  if (visibleUnknown(source, target)) {
    push(issues, { code: "semantic-claim-unconfirmed", severity: "warning", claimId: id, message: `Claim ${id} is visibly marked ${UNKNOWN}.` })
    return
  }
  push(issues, { code: "semantic-unknown-not-visible", severity: "error", claimId: id, message: `Claim ${id} is unproven but the diagram does not visibly say ${UNKNOWN}.` })
}

function unresolved(claim: EdgeClaim, source: string, message: string, issues: MermaidSemanticIssue[]) {
  if (visibleUnknown(source, { from: claim.from, to: claim.to })) {
    push(issues, { code: "semantic-relation-unconfirmed", severity: "warning", claimId: claim.id, message })
    return
  }
  push(issues, { code: "semantic-relation-unproven", severity: "error", claimId: claim.id, message: `${message} Mark it ${UNKNOWN} or remove it.` })
}

function visibleUnknown(source: string, target: { node: string } | { from: string; to: string }) {
  return source.split(/\r?\n/).some((line) => {
    if (!line.includes(UNKNOWN)) return false
    if ("node" in target) return new RegExp(`\\b${escape(target.node)}\\b`).test(line)
    return new RegExp(`^\\s*${escape(target.from)}\\s*(?:-->|---|-.->|==>)[\\s\\S]*?\\b${escape(target.to)}\\b`).test(line)
  })
}

async function evidenceText(evidence: Evidence[], issues: MermaidSemanticIssue[] = [], id = "") {
  const values: string[] = []
  for (const item of evidence) {
    try {
      const text = await fs.readFile(await secure(item.path, "evidence path"), "utf8")
      values.push(text.split(/\r?\n/).slice(item.startLine - 1, item.endLine).join("\n"))
    } catch (err) {
      push(issues, {
        code: "semantic-evidence-invalid",
        severity: "error",
        claimId: id,
        path: item.path,
        message: `Cannot reread relationship evidence: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  return values.join("\n")
}

async function direct(
  evidence: Evidence[],
  from: string,
  to: string,
  issues: MermaidSemanticIssue[],
  id: string,
) {
  let forward = false
  let reverse = false
  for (const item of evidence) {
    if (!C_IMPLEMENTATIONS.has(path.extname(item.path).toLowerCase())) continue
    try {
      const text = await fs.readFile(await secure(item.path, "evidence path"), "utf8")
      const slice = text.split(/\r?\n/).slice(item.startLine - 1, item.endLine).join("\n")
      forward ||= invokes(slice, from, to)
      reverse ||= invokes(slice, to, from)
    } catch (err) {
      push(issues, {
        code: "semantic-evidence-invalid",
        severity: "error",
        claimId: id,
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine,
        message: `Cannot reread direct-call evidence: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  return { forward, reverse }
}

function invokes(input: string, from: string, to: string) {
  const text = scrub(input)
  const pattern = new RegExp(`\\b${escape(from)}\\s*\\(`, "g")
  for (const match of text.matchAll(pattern)) {
    const open = match.index + match[0].lastIndexOf("(")
    const close = pair(text, open, "(", ")")
    if (close < 0) continue
    const body = brace(text, close + 1)
    if (!body) continue
    if (new RegExp(`\\b${escape(to)}\\s*\\(`).test(text.slice(body.start + 1, body.end))) return true
  }
  return false
}

function brace(text: string, start: number) {
  let round = 0
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (char === "(") round += 1
    if (char === ")") round -= 1
    if (char === ";" && round === 0) return
    if (char !== "{" || round !== 0) continue
    const end = pair(text, index, "{", "}")
    if (end < 0) return
    return { start: index, end }
  }
}

function pair(text: string, start: number, open: string, close: string) {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    if (text[index] === open) depth += 1
    if (text[index] !== close) continue
    depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function scrub(input: string) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\r\n]/g, " "))
    .replace(/\/\/[^\r\n]*/g, (value) => " ".repeat(value.length))
    .replace(/"(?:\\.|[^"\\])*"/g, (value) => value.replace(/[^\r\n]/g, " "))
    .replace(/'(?:\\.|[^'\\])*'/g, (value) => value.replace(/[^\r\n]/g, " "))
}

async function transition(
  evidence: Evidence[],
  from: string,
  to: string,
  issues: MermaidSemanticIssue[],
  id: string,
) {
  const slices: Array<{ path: string; text: string }> = []
  const current = escape(from)
  const next = escape(to)
  const guard = new RegExp(
    `(?:\\bcase\\s+${current}\\b|(?:==|!=)\\s*${current}\\b|\\b${current}\\b\\s*(?:==|!=))`,
  )
  const action = new RegExp(
    `(?:=\\s*${next}\\b|\\b(?:set|transition|change|move)[A-Za-z0-9_]*\\s*\\([^;\\n]*\\b${next}\\b)`,
    "i",
  )
  for (const item of evidence) {
    if (!C_IMPLEMENTATIONS.has(path.extname(item.path).toLowerCase())) continue
    try {
      const text = await fs.readFile(await secure(item.path, "evidence path"), "utf8")
      const slice = text.split(/\r?\n/).slice(item.startLine - 1, item.endLine).join("\n")
      if (guard.test(slice) && action.test(slice)) return true
      slices.push({ path: item.path, text: slice })
    } catch (err) {
      push(issues, {
        code: "semantic-evidence-invalid",
        severity: "error",
        claimId: id,
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine,
        message: `Cannot reread state-transition evidence: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  const helpers = slices.flatMap((item) => {
    if (!action.test(item.text)) return []
    const match = item.text.match(
      /^[ \t]*(?:(?:static|inline|extern)\s+)*(?:[A-Za-z_]\w*(?:\s+|\s*\*+\s*))+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/m,
    )
    if (!match?.[1]) return []
    return [{ path: item.path, name: match[1] }]
  })
  for (const item of slices) {
    if (!guard.test(item.text)) continue
    for (const helper of helpers) {
      if (helper.path !== item.path && !evidence.some((ref) => ref.path === helper.path)) continue
      if (new RegExp(`\\b${escape(helper.name)}\\s*\\(`).test(item.text)) return true
    }
  }
  return false
}

function visible(input: string) {
  const chars = [...input]
  let quote = ""
  let escaped = false
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!
    if (!quote) {
      if (char === '"' || char === "'") quote = char
      continue
    }
    if (escaped) {
      chars[index] = " "
      escaped = false
      continue
    }
    if (char === "\\") {
      chars[index] = " "
      escaped = true
      continue
    }
    if (char === quote) {
      quote = ""
      continue
    }
    chars[index] = " "
  }
  return chars.join("")
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function secure(input: string, label: string) {
  if (!input.trim()) throw new Error("semanticEvidencePath is required")
  const file = path.resolve(Instance.directory, input)
  inside(file, label)
  const [root, real] = await Promise.all([fs.realpath(Instance.directory), fs.realpath(file)])
  const rel = path.relative(root, real)
  if (rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))) return real
  throw new Error(`${label} must not escape the workspace through a symlink`)
}

async function resolveScope(input: string, issues: MermaidSemanticIssue[]) {
  try {
    const file = await secure(input || ".", "scopePath")
    const stat = await fs.stat(file)
    if (stat.isDirectory()) return portable(path.relative(Instance.directory, file)) || undefined
    if (stat.isFile() && C_IMPLEMENTATIONS.has(path.extname(file).toLowerCase())) {
      return portable(path.relative(Instance.directory, path.dirname(file))) || undefined
    }
    throw new Error("scopePath must identify a workspace directory or one exact C/C++ implementation file")
  } catch (err) {
    push(issues, { code: "semantic-scope-invalid", severity: "error", message: err instanceof Error ? err.message : String(err) })
    return undefined
  }
}

function shape(value: Manifest) {
  if (!value || typeof value !== "object") return ["manifest must be one object"]
  const problems: string[] = []
  if (value.version !== 1) problems.push("version must be 1")
  if (typeof value.diagramId !== "string") problems.push("diagramId must be a string")
  if (value.splitFromDiagramId !== undefined && (typeof value.splitFromDiagramId !== "string" || !value.splitFromDiagramId.trim())) problems.push("splitFromDiagramId must be a non-empty string when present")
  if (value.splitFromDiagramId === value.diagramId) problems.push("splitFromDiagramId cannot equal diagramId; re-layout the same Diagram ID without this field")
  if (typeof value.diagramType !== "string") problems.push("diagramType must be a string")
  if (typeof value.scopePath !== "string") problems.push("scopePath must be a string")
  if (typeof value.sourceHash !== "string") problems.push("sourceHash must be a string")
  if (value.language !== undefined && typeof value.language !== "string") problems.push("language must be a string when present")
  const architectureType = typeof value.diagramType === "string" && architecture(value.diagramType)
  if (architectureType && (typeof value.designUnitId !== "string" || !value.designUnitId.trim())) problems.push("architecture designUnitId must be a non-empty string")
  if (architectureType && (typeof value.designUnitCensusPath !== "string" || !value.designUnitCensusPath.trim())) problems.push("architecture designUnitCensusPath must be a non-empty string")
  if (value.designUnitId !== undefined && typeof value.designUnitId !== "string") problems.push("designUnitId must be a string when present")
  if (value.designUnitCensusPath !== undefined && typeof value.designUnitCensusPath !== "string") problems.push("designUnitCensusPath must be a string when present")
  if (value.evidenceCatalog !== undefined && (!value.evidenceCatalog || typeof value.evidenceCatalog !== "object" || Array.isArray(value.evidenceCatalog))) {
    problems.push("evidenceCatalog must be an object when present")
  }
  if (value.evidenceCatalog && typeof value.evidenceCatalog === "object" && !Array.isArray(value.evidenceCatalog)) {
    for (const [id, item] of Object.entries(value.evidenceCatalog)) {
      if (!id.trim()) problems.push("evidenceCatalog IDs must be non-empty")
      problems.push(...evidenceItem(item, `evidenceCatalog.${id}`))
    }
  }
  if (!Array.isArray(value.nodes)) problems.push("nodes must be an array")
  if (!Array.isArray(value.edges)) problems.push("edges must be an array")
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return problems
  const symbols = new Map<string, string>()
  for (const item of value.nodes) if (item?.id && item.symbol) symbols.set(item.id, item.symbol)
  for (const group of value.nodeGroups ?? []) {
    for (const item of group?.items ?? []) if (item?.[0] && item[1]) symbols.set(item[0], item[1])
  }
  for (const [index, item] of value.nodes.entries()) {
    const root = `nodes[${index}]`
    if (!item || typeof item !== "object") {
      problems.push(`${root} must be an object`)
      continue
    }
    if (typeof item.id !== "string") problems.push(`${root}.id must be a string`)
    if (item.symbol !== undefined && typeof item.symbol !== "string") problems.push(`${root}.symbol must be a string when present`)
    if (item.container !== undefined && typeof item.container !== "string") problems.push(`${root}.container must be a string when present`)
    if (item.designUnitId !== undefined && typeof item.designUnitId !== "string") problems.push(`${root}.designUnitId must be a string when present`)
    if (!status(item.status)) problems.push(`${root}.status must be confirmed, active, or unknown when present`)
    problems.push(...evidenceIds(item.evidenceIds, root))
    problems.push(...evidence(item.evidence, root))
  }
  for (const [index, item] of value.edges.entries()) {
    const root = `edges[${index}]`
    if (!item || typeof item !== "object") {
      problems.push(`${root} must be an object`)
      continue
    }
    if (typeof item.id !== "string") problems.push(`${root}.id must be a string`)
    if (typeof item.from !== "string") problems.push(`${root}.from must be a string`)
    if (typeof item.to !== "string") problems.push(`${root}.to must be a string`)
    if (item.fromSymbol !== undefined && typeof item.fromSymbol !== "string") problems.push(`${root}.fromSymbol must be a string when present`)
    if (item.toSymbol !== undefined && typeof item.toSymbol !== "string") problems.push(`${root}.toSymbol must be a string when present`)
    if (item.event !== undefined && typeof item.event !== "string") problems.push(`${root}.event must be a string when present`)
    if (!RELATIONS.has(item.relation)) {
      const relation = item && typeof item === "object" && "relation" in item ? JSON.stringify(item.relation) : "missing"
      problems.push(`invalid edge claim at edges[${index}]: relation ${relation}; allowed values are ${[...RELATIONS].join(", ")}`)
    }
    if (!status(item.status)) problems.push(`${root}.status must be confirmed, active, or unknown when present`)
    problems.push(...evidenceIds(item.evidenceIds, root))
    problems.push(...evidence(item.evidence, root))
    if (
      RELATIONS.has(item.relation) &&
      item.relation !== "unknown" &&
      item.relation !== "dependency" &&
      (!edgeSymbols(item, value).from || !edgeSymbols(item, value).to)
    ) problems.push(`${root} relation ${item.relation} requires fromSymbol/toSymbol or endpoint node symbols`)
  }
  if (value.nodeGroups !== undefined && !Array.isArray(value.nodeGroups)) {
    problems.push("nodeGroups must be an array when present")
  }
  for (const [index, group] of (value.nodeGroups ?? []).entries()) {
    const root = `nodeGroups[${index}]`
    if (!group || typeof group !== "object") {
      problems.push(`${root} must be an object`)
      continue
    }
    if (!Array.isArray(group.items) || !group.items.length) {
      problems.push(`${root}.items must be a non-empty array`)
    } else {
      for (const [itemIndex, item] of group.items.entries()) {
        const itemRoot = `${root}.items[${itemIndex}]`
        if (!Array.isArray(item) || item.length < 1 || item.length > 4) {
          problems.push(`${itemRoot} must be [id, symbol?, container?, designUnitId?]`)
          continue
        }
        if (item.some((value) => value !== undefined && typeof value !== "string")) {
          problems.push(`${itemRoot} values must be strings when present`)
        }
      }
    }
    if (!status(group.status)) problems.push(`${root}.status must be confirmed, active, or unknown when present`)
    problems.push(...evidenceIds(group.evidenceIds, root))
    problems.push(...evidence(group.evidence, root))
  }
  if (value.edgeGroups !== undefined && !Array.isArray(value.edgeGroups)) {
    problems.push("edgeGroups must be an array when present")
  }
  for (const [index, group] of (value.edgeGroups ?? []).entries()) {
    const root = `edgeGroups[${index}]`
    if (!group || typeof group !== "object") {
      problems.push(`${root} must be an object`)
      continue
    }
    if (typeof group.id !== "string" || !group.id.trim()) problems.push(`${root}.id must be non-empty`)
    if (!Array.isArray(group.pairs) || !group.pairs.length) {
      problems.push(`${root}.pairs must be a non-empty array`)
    } else {
      for (const [pairIndex, pair] of group.pairs.entries()) {
        const pairRoot = `${root}.pairs[${pairIndex}]`
        if (!Array.isArray(pair) || pair.length < 2 || pair.length > 5) {
          problems.push(`${pairRoot} must be [from, to, fromSymbol?, toSymbol?, event?]`)
          continue
        }
        if (pair.some((value) => value !== undefined && typeof value !== "string")) {
          problems.push(`${pairRoot} values must be strings when present`)
        }
        if (
          RELATIONS.has(group.relation) &&
          group.relation !== "unknown" &&
          group.relation !== "dependency" &&
          (!pair[2] && !symbols.get(pair[0]!))
        ) problems.push(`${pairRoot} relation ${group.relation} requires fromSymbol or a symbol-bearing from node`)
        if (
          RELATIONS.has(group.relation) &&
          group.relation !== "unknown" &&
          group.relation !== "dependency" &&
          (!pair[3] && !symbols.get(pair[1]!))
        ) problems.push(`${pairRoot} relation ${group.relation} requires toSymbol or a symbol-bearing to node`)
      }
    }
    if (!RELATIONS.has(group.relation)) {
      problems.push(`${root}.relation must be one of ${[...RELATIONS].join(", ")}`)
    }
    if (!status(group.status)) problems.push(`${root}.status must be confirmed, active, or unknown when present`)
    problems.push(...evidenceIds(group.evidenceIds, root))
    problems.push(...evidence(group.evidence, root))
  }
  return problems
}

function expand(manifest: Manifest) {
  const nodes = [
    ...manifest.nodes,
    ...(manifest.nodeGroups ?? []).flatMap((group) =>
      group.items.map(([id, symbol, container, designUnitId]) => ({
        id,
        symbol,
        container,
        designUnitId,
        status: group.status,
        evidence: group.evidence,
        evidenceIds: group.evidenceIds,
      })),
    ),
  ]
  const edges = [
    ...manifest.edges,
    ...(manifest.edgeGroups ?? []).flatMap((group) =>
      group.pairs.map(([from, to, fromSymbol, toSymbol, event], index) => ({
        id: `${group.id}:${index + 1}`,
        from,
        to,
        relation: group.relation,
        fromSymbol,
        toSymbol,
        event,
        status: group.status,
        evidence: group.evidence,
        evidenceIds: group.evidenceIds,
      })),
    ),
  ]
  return { ...manifest, nodes, edges }
}

function status(value: NodeClaim["status"] | EdgeClaim["status"]) {
  return value === undefined || STATUSES.has(value)
}

function edgeSymbols(edge: EdgeClaim, manifest: Pick<Manifest, "nodes">) {
  const from = edge.fromSymbol || manifest.nodes.find((item) => item.id === edge.from)?.symbol
  const to = edge.toSymbol || manifest.nodes.find((item) => item.id === edge.to)?.symbol
  return { from, to }
}

function architecture(value: string) {
  const type = value.trim().toLowerCase()
  return type.includes("architecture") || type.includes("架构")
}

function stateMachine(type: string, source: string) {
  const value = type.trim().toLowerCase()
  return value.includes("state") || value.includes("状态机") || /^\s*stateDiagram(?:-v2)?\b/m.test(source)
}

function csource(manifest: Manifest) {
  const language = manifest.language?.trim().toLowerCase()
  if (language === "c" || language === "cpp" || language === "c++") return true
  return [
    ...Object.values(manifest.evidenceCatalog ?? {}),
    ...[...manifest.nodes, ...manifest.edges].flatMap((item) => item.evidence ?? []),
  ].some((item) => C_EXTENSIONS.has(path.extname(item.path).toLowerCase()))
}

function evidence(value: Evidence[] | undefined, root: string) {
  if (value === undefined) return []
  if (!Array.isArray(value)) return [`${root}.evidence must be an array when present`]
  const problems: string[] = []
  for (const [index, item] of value.entries()) {
    problems.push(...evidenceItem(item, `${root}.evidence[${index}]`))
  }
  return problems
}

function evidenceItem(item: Evidence, root: string) {
  if (!item || typeof item !== "object") return [`${root} must be an object`]
  const problems: string[] = []
  if (typeof item.path !== "string") problems.push(`${root}.path must be a string`)
  if (typeof item.startLine !== "number") problems.push(`${root}.startLine must be a number`)
  if (typeof item.endLine !== "number") problems.push(`${root}.endLine must be a number; for one source line, set endLine equal to startLine`)
  if (item.symbols !== undefined && (!Array.isArray(item.symbols) || item.symbols.some((symbol) => typeof symbol !== "string"))) {
    problems.push(`${root}.symbols must contain only strings when present`)
  }
  if (item.fileHash !== undefined && typeof item.fileHash !== "string") problems.push(`${root}.fileHash must be a string when present`)
  return problems
}

function evidenceIds(value: string[] | undefined, root: string) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) {
    return [`${root}.evidenceIds must contain only non-empty strings when present`]
  }
  if (new Set(value).size !== value.length) return [`${root}.evidenceIds must not contain duplicates`]
  return []
}

async function safe(value: Promise<QueryEvidenceResult>, issues: MermaidSemanticIssue[], id: string) {
  try {
    return await value
  } catch (err) {
    push(issues, {
      code: "semantic-codegraph-query-failed",
      severity: "error",
      claimId: id,
      message: `CodeGraph validation failed: ${err instanceof Error ? err.message : String(err)}`,
    })
    return undefined
  }
}

function inside(file: string, label: string) {
  const rel = path.relative(Instance.directory, file)
  if (rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))) return
  throw new Error(`${label} must stay inside the workspace`)
}

function nested(file: string, root: string, label: string) {
  const rel = path.relative(root, file)
  if (rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`))) return
  throw new Error(`${label} must stay inside ${root}`)
}

function unique(values: string[], kind: string, issues: MermaidSemanticIssue[]) {
  const seen = new Set<string>()
  for (const value of values) {
    if (!value || seen.has(value)) push(issues, { code: `semantic-${kind}-claim-duplicate`, severity: "error", claimId: value, message: `${kind} claim IDs must be unique and non-empty.` })
    seen.add(value)
  }
  return seen
}

function push(issues: MermaidSemanticIssue[], issue: MermaidSemanticIssue) {
  if (issues.length < MAX_ISSUES) issues.push(issue)
}

function result(
  semanticStatus: MermaidSemanticStatus,
  sourceHash: string,
  claimCount: number,
  validatedClaimCount: number,
  issues: MermaidSemanticIssue[],
  semanticFingerprint?: MermaidSemanticFingerprint,
): MermaidSemanticResult {
  return { semanticStatus, sourceHash, claimCount, validatedClaimCount, issues, semanticFingerprint }
}

async function finish(
  input: string,
  semanticStatus: MermaidSemanticStatus,
  sourceHash: string,
  claimCount: number,
  validatedClaimCount: number,
  issues: MermaidSemanticIssue[],
  semanticFingerprint?: MermaidSemanticFingerprint,
) {
  const value = result(semanticStatus, sourceHash, claimCount, validatedClaimCount, issues, semanticFingerprint)
  try {
    const file = await secure(input, "semanticEvidencePath")
    const name = `${path.basename(file, path.extname(file))}.semantic-diagnostics.json`
    const output = path.join(path.dirname(file), name)
    await fs.writeFile(output, `${JSON.stringify(value, null, 2)}\n`, "utf8")
    return { ...value, diagnosticsPath: output }
  } catch (err) {
    if (semanticStatus === "invalid") return value
    push(issues, {
      code: "semantic-diagnostics-write-failed",
      severity: "error",
      path: input,
      message: `Cannot persist full semantic diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    })
    return result("invalid", sourceHash, claimCount, validatedClaimCount, issues, semanticFingerprint)
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function portable(value: string) {
  return value.split(path.sep).join("/")
}

function overlaps(evidence: Evidence, file: string, start: number, end: number) {
  const left = portable(path.normalize(evidence.path)).replace(/^\.\//, "")
  const right = portable(path.normalize(file)).replace(/^\.\//, "")
  return left === right && evidence.startLine <= end && evidence.endLine >= start
}
