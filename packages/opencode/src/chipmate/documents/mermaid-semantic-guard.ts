import { createHash } from "node:crypto"
import type { MermaidSemanticFingerprint } from "@/chipmate/documents/mermaid-semantics"

const ttl = 24 * 60 * 60 * 1000
const limit = 1024
const paths = 512
const sessions = new Map<
  string,
  {
    seen: number
    rendered: Map<string, Set<string>>
    sources: Map<string, string>
    coverage: Map<string, MermaidSemanticFingerprint>
    drafts: Map<string, MermaidSemanticFingerprint>
    pending: Map<
      string,
      {
        fingerprint: MermaidSemanticFingerprint
        nodes: Set<string>
        edges: Set<string>
      }
    >
    validations: Map<string, number>
    renders: Map<string, number>
  }
>()

export type Issue = {
  code:
    | "mermaid-semantic-downgrade-blocked"
    | "mermaid-semantic-insert-blocked"
    | "mermaid-semantic-coverage-regression-blocked"
    | "mermaid-semantic-repair-regression-blocked"
    | "mermaid-semantic-word-fit-pending"
    | "mermaid-semantic-validation-budget-exhausted"
    | "mermaid-semantic-render-budget-exhausted"
  severity: "error"
  message: string
}

export type PendingSplit = {
  diagramId: string
  missingNodes: Array<{ id: string; symbol?: string; designUnitId?: string }>
  missingEdges: MermaidSemanticFingerprint["edges"]
}

export function mark(session: string) {
  prune()
  const found = sessions.get(session)
  sessions.set(session, {
    seen: Date.now(),
    rendered: found?.rendered ?? new Map(),
    sources: found?.sources ?? new Map(),
    coverage: found?.coverage ?? new Map(),
    drafts: found?.drafts ?? new Map(),
    pending: found?.pending ?? new Map(),
    validations: found?.validations ?? new Map(),
    renders: found?.renders ?? new Map(),
  })
}

export function validate(session: string, file: string): Issue | undefined {
  return attempt(session, file, "validations", 10, {
    code: "mermaid-semantic-validation-budget-exhausted",
    severity: "error",
    message:
      "This Diagram claim file already consumed ten source-backed semantic validations in the current session. Stop editing or validating it, preserve the last valid artifacts, and checkpoint the figure as attempted_failed instead of retrying or renaming the claim file.",
  })
}

export function render(session: string, file: string): Issue | undefined {
  return attempt(session, file, "renders", 4, {
    code: "mermaid-semantic-render-budget-exhausted",
    severity: "error",
    message:
      "This Diagram claim file already consumed four source-backed render calls in the current session. Stop rendering it and checkpoint the figure as attempted_failed; do not rename the claim file or downgrade semanticMode to evade the budget.",
  })
}

export function allow(
  session: string,
  hash: string,
  png: string,
  fingerprint?: MermaidSemanticFingerprint,
  source?: string,
) {
  mark(session)
  const state = sessions.get(session)!
  const found = state.rendered.get(hash) ?? new Set<string>()
  found.add(png)
  state.rendered.set(hash, found)
  if (source) state.sources.set(hash, source)
  if (fingerprint) state.coverage.set(fingerprint.diagramId, fingerprint)
  if (fingerprint) settle(state, fingerprint)
  while ([...state.rendered.values()].reduce((count, items) => count + items.size, 0) > paths) {
    const first = state.rendered.keys().next().value
    if (!first) return
    state.rendered.delete(first)
    state.sources.delete(first)
  }
}

export function source(session: string, png: string): string | undefined {
  prune()
  const state = sessions.get(session)
  if (!state) return
  state.seen = Date.now()
  for (const [hash, items] of state.rendered) {
    if (!items.has(png)) continue
    return state.sources.get(hash)
  }
}

export function remember(session: string, fingerprint?: MermaidSemanticFingerprint) {
  if (!fingerprint) return
  mark(session)
  sessions.get(session)!.coverage.set(fingerprint.diagramId, fingerprint)
}

export function hold(session: string, fingerprint?: MermaidSemanticFingerprint) {
  if (!fingerprint) return
  remember(session, fingerprint)
  const state = sessions.get(session)!
  if (fingerprint.splitFromDiagramId && state.pending.has(fingerprint.splitFromDiagramId)) return
  state.pending.set(fingerprint.diagramId, {
    fingerprint,
    nodes: new Set(),
    edges: new Set(),
  })
}

export function advance(session: string, fingerprint?: MermaidSemanticFingerprint): Issue | undefined {
  if (!fingerprint) return
  mark(session)
  const state = sessions.get(session)!
  if (fingerprint.splitFromDiagramId) {
    const parent = state.pending.get(fingerprint.splitFromDiagramId)?.fingerprint
    if (parent) {
      const nodes = new Map(entries(parent).map((node) => [node.id, node]))
      const conflicts: string[] = []
      for (const node of entries(fingerprint)) {
        const expected = nodes.get(node.id)
        if (!expected) continue
        if (node.symbol && expected.symbol && node.symbol !== expected.symbol) {
          conflicts.push(`node ${node.id} symbol ${node.symbol} != ${expected.symbol}`)
        }
        if (node.designUnitId && expected.designUnitId && node.designUnitId !== expected.designUnitId) {
          conflicts.push(`node ${node.id} DesignUnit ${node.designUnitId} != ${expected.designUnitId}`)
        }
      }
      for (const link of fingerprint.edges) {
        const matches = parent.edges.filter((item) => visible(item) === visible(link))
        if (!matches.length) continue
        for (const field of ["fromSymbol", "toSymbol"] as const) {
          const value = link[field]
          if (!value) continue
          const known = matches.map((item) => item[field]).filter((item): item is string => Boolean(item))
          if (known.length && !known.includes(value)) {
            conflicts.push(`${link.from}->${link.to} ${field} ${value} != ${known.join("/")}`)
          }
        }
      }
      if (conflicts.length) {
        return {
          code: "mermaid-semantic-coverage-regression-blocked",
          severity: "error",
          message:
            `Readable split child ${fingerprint.diagramId} contradicts its validated parent bindings (${conflicts.slice(0, 10).join("; ")}). ` +
            "Omitting duplicate binding metadata is allowed, but remapping a visible node or edge to another source symbol or DesignUnit is not.",
        }
      }
    }
  }
  const draft = state.drafts.get(fingerprint.diagramId)
  if (!draft) state.drafts.set(fingerprint.diagramId, fingerprint)
  if (draft) {
    const nodes = new Set(fingerprint.sourceNodeIds ?? [])
    const missingNodes = (draft.sourceNodeIds ?? []).filter((id) => !nodes.has(id))
    const missingEdges = missing(draft.sourceEdges ?? [], fingerprint.sourceEdges ?? [])
    if (missingNodes.length || missingEdges.length) {
      const details = [
        ...(missingNodes.length ? [`nodes: ${missingNodes.slice(0, 10).join(", ")}`] : []),
        ...(missingEdges.length
          ? [
              `edges: ${missingEdges
                .slice(0, 10)
                .map((item) => `${item.from}->${item.to}`)
                .join(", ")}`,
            ]
          : []),
      ].join("; ")
      return {
        code: "mermaid-semantic-repair-regression-blocked",
        severity: "error",
        message:
          `Diagram ID ${fingerprint.diagramId} removes visible semantics from its first semantically valid source-backed validation (${details}). ` +
          "Repair missing claims with compact nodeGroups/edgeGroups and keep the detailed MMD. Do not pass validation by collapsing branches, errors, handoffs, states, or lifecycle steps; checkpoint and restart the figure if the original semantics were disproven.",
      }
    }
    state.drafts.set(fingerprint.diagramId, merge(draft, fingerprint))
  }
  if (!state.pending.size) return
  if (state.pending.has(fingerprint.diagramId)) return
  if (fingerprint.splitFromDiagramId && state.pending.has(fingerprint.splitFromDiagramId)) return
  const ids = [...state.pending.keys()].slice(0, 10)
  return {
    code: "mermaid-semantic-word-fit-pending",
    severity: "error",
    message:
      `Source-backed diagrams ${ids.join(", ")} are still split-required. Do not advance to another view. ` +
      "Re-layout the same Diagram ID without deleting semantic coverage, or create readable replacement claim manifests whose splitFromDiagramId names the oldest pending Diagram ID and whose combined node/edge IDs cover that parent. Split-required intermediate probes do not become new parents. Only documentReady=true children count.",
  }
}

export function pending(session: string) {
  prune()
  return [...(sessions.get(session)?.pending.keys() ?? [])]
}

export function restore(session: string, split: PendingSplit) {
  mark(session)
  const state = sessions.get(session)!
  if (state.pending.has(split.diagramId)) return
  state.pending.set(split.diagramId, {
    fingerprint: {
      diagramId: split.diagramId,
      nodeIds: split.missingNodes.map((node) => node.id),
      nodes: split.missingNodes.map((node) => ({ ...node })),
      edges: split.missingEdges.map((edge) => ({ ...edge })),
    },
    nodes: new Set(),
    edges: new Set(),
  })
}

export function pendingDetails(session: string) {
  prune()
  const state = sessions.get(session)
  if (!state) return []
  return [...state.pending.entries()].map(([diagramId, entry]) => {
    const nodes = entries(entry.fingerprint).filter((node) => !entry.nodes.has(node.id))
    const edges = entry.fingerprint.edges.filter((link) => !entry.edges.has(visible(link))).map((link) => ({ ...link }))
    return {
      diagramId,
      missingNodes: nodes,
      missingEdges: edges,
      suggestedChildren: suggestions(diagramId, entry.fingerprint, nodes, edges),
    }
  })
}

export function coverage(session: string, fingerprint?: MermaidSemanticFingerprint): Issue | undefined {
  if (!fingerprint) return
  mark(session)
  const previous = sessions.get(session)!.coverage.get(fingerprint.diagramId)
  if (!previous) return
  const nodes = new Set(bindings(fingerprint))
  const edges = new Set(fingerprint.edges.map(edge))
  const missingNodes = bindings(previous).filter((id) => !nodes.has(id))
  const missingEdges = previous.edges.filter((item) => !edges.has(edge(item)))
  if (!missingNodes.length && !missingEdges.length) return
  const details = [
    ...(missingNodes.length ? [`nodes: ${missingNodes.slice(0, 10).map(display).join(", ")}`] : []),
    ...(missingEdges.length
      ? [
          `edges: ${missingEdges
            .slice(0, 10)
            .map((item) => `${item.from}->${item.to} (${item.relation})`)
            .join(", ")}`,
        ]
      : []),
  ].join("; ")
  return {
    code: "mermaid-semantic-coverage-regression-blocked",
    severity: "error",
    message:
      `Diagram ID ${fingerprint.diagramId} already has a successful source-backed render. Its replacement removes validated semantic coverage (${details}). ` +
      "Keep the same node/edge coverage and re-layout it, or preserve the rendered diagram as a focused figure and create a new unique Diagram ID for a readable overview. Do not simplify by deleting validated semantics.",
  }
}

export function check(session: string, mode?: "source-backed"): Issue | undefined {
  if (mode) {
    mark(session)
    return
  }
  prune()
  if (!sessions.has(session)) return
  return {
    code: "mermaid-semantic-downgrade-blocked",
    severity: "error",
    message:
      "Source-backed Mermaid validation is active in this session. Rendering without semanticMode and semanticEvidencePath is blocked. Repair the version 1 top-level claim manifest, then retry source-backed validation and rendering; do not downgrade to ordinary Mermaid.",
  }
}

export function insert(session: string, hash: string, png?: string, base64?: boolean): Issue | undefined {
  prune()
  const state = sessions.get(session)
  if (!state) return
  state.seen = Date.now()
  if (!base64 && png && state.rendered.get(hash)?.has(png)) return
  return {
    code: "mermaid-semantic-insert-blocked",
    severity: "error",
    message:
      "Source-backed Mermaid validation is active in this session. Insert only the exact PNG path returned by a successful source-backed render of the same Mermaid source; internal re-rendering, base64 replacement, and unvalidated PNG paths are blocked.",
  }
}

function prune() {
  const now = Date.now()
  for (const [session, state] of sessions) {
    if (now - state.seen > ttl) sessions.delete(session)
  }
  while (sessions.size > limit) {
    const session = sessions.keys().next().value
    if (!session) return
    sessions.delete(session)
  }
}

function edge(input: MermaidSemanticFingerprint["edges"][number]) {
  return [input.from, input.to, input.relation, input.fromSymbol ?? "", input.toSymbol ?? "", input.event ?? ""].join(
    "\u0000",
  )
}

function visible(input: MermaidSemanticFingerprint["edges"][number]) {
  return [input.from, input.to, input.relation, input.event ?? ""].join("\u0000")
}

function sourceEdge(input: NonNullable<MermaidSemanticFingerprint["sourceEdges"]>[number]) {
  return [input.from, input.to].join("\u0000")
}

function missing(
  previous: NonNullable<MermaidSemanticFingerprint["sourceEdges"]>,
  current: NonNullable<MermaidSemanticFingerprint["sourceEdges"]>,
) {
  const counts = new Map<string, number>()
  for (const item of current) {
    const key = sourceEdge(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return previous.filter((item) => {
    const key = sourceEdge(item)
    const count = counts.get(key) ?? 0
    if (!count) return true
    counts.set(key, count - 1)
    return false
  })
}

function merge(previous: MermaidSemanticFingerprint, current: MermaidSemanticFingerprint): MermaidSemanticFingerprint {
  const nodes = new Set([...(previous.sourceNodeIds ?? []), ...(current.sourceNodeIds ?? [])])
  const edges = [...(previous.sourceEdges ?? [])]
  const counts = new Map<string, number>()
  for (const item of edges) counts.set(sourceEdge(item), (counts.get(sourceEdge(item)) ?? 0) + 1)
  const seen = new Map<string, number>()
  for (const item of current.sourceEdges ?? []) {
    const key = sourceEdge(item)
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (count <= (counts.get(key) ?? 0)) continue
    edges.push(item)
  }
  return { ...current, sourceNodeIds: [...nodes].sort(), sourceEdges: edges }
}

function bindings(input: MermaidSemanticFingerprint) {
  return input.nodes?.length
    ? input.nodes.map((item) => [item.id, item.symbol ?? "", item.designUnitId ?? ""].join("\u0000"))
    : input.nodeIds.map((id) => [id, "", ""].join("\u0000"))
}

function entries(input: MermaidSemanticFingerprint): Array<{ id: string; symbol?: string; designUnitId?: string }> {
  return input.nodes?.length
    ? input.nodes.map((item) => ({
        id: item.id,
        ...(item.symbol ? { symbol: item.symbol } : {}),
        ...(item.designUnitId ? { designUnitId: item.designUnitId } : {}),
      }))
    : input.nodeIds.map((id) => ({ id }))
}

function suggestions(
  parent: string,
  fingerprint: MermaidSemanticFingerprint,
  missingNodes: Array<{ id: string; symbol?: string; designUnitId?: string }>,
  missingEdges: MermaidSemanticFingerprint["edges"],
) {
  const all = entries(fingerprint)
  const index = new Map(all.map((node) => [node.id, node]))
  const maxNodes = 12
  const maxEdges = 16
  const groups: Array<{
    nodes: Map<string, (typeof all)[number]>
    edges: MermaidSemanticFingerprint["edges"]
  }> = []
  const flush = (nodes: Map<string, (typeof all)[number]>, edges: MermaidSemanticFingerprint["edges"]) => {
    if (!nodes.size && !edges.length) return
    groups.push({ nodes, edges })
  }
  const nodes = new Map<string, (typeof all)[number]>()
  const edges: MermaidSemanticFingerprint["edges"] = []
  for (const link of missingEdges) {
    const ids = [...new Set([link.from, link.to])]
    const size = new Set([...nodes.keys(), ...ids]).size
    if (edges.length && (size > maxNodes || edges.length >= maxEdges)) {
      flush(new Map(nodes), [...edges])
      nodes.clear()
      edges.length = 0
    }
    for (const id of ids) nodes.set(id, index.get(id) ?? { id })
    edges.push({ ...link })
  }
  flush(new Map(nodes), [...edges])

  const assigned = new Set(groups.flatMap((group) => [...group.nodes.keys()]))
  for (const node of missingNodes) {
    if (assigned.has(node.id)) continue
    const group = groups.find((item) => item.nodes.size < maxNodes)
    if (group) {
      group.nodes.set(node.id, node)
      assigned.add(node.id)
      continue
    }
    groups.push({ nodes: new Map([[node.id, node]]), edges: [] })
    assigned.add(node.id)
  }

  return groups.map((group) => {
    const nodes = [...group.nodes.values()]
    const edges = group.edges.map((link) => ({ ...link }))
    const hash = createHash("sha256").update(JSON.stringify({ nodes, edges })).digest("hex").slice(0, 8)
    return {
      suggestedDiagramId: `${parent}-FOCUS-${hash}`,
      splitFromDiagramId: parent,
      nodes,
      edges,
    }
  })
}

function display(input: string) {
  return input.split("\u0000").filter(Boolean).join(":")
}

function settle(
  state: {
    pending: Map<
      string,
      {
        fingerprint: MermaidSemanticFingerprint
        nodes: Set<string>
        edges: Set<string>
      }
    >
  },
  fingerprint: MermaidSemanticFingerprint,
) {
  const queue = [fingerprint]
  while (queue.length) {
    const item = queue.shift()!
    const ids = [
      ...(state.pending.has(item.diagramId) ? [item.diagramId] : []),
      ...(item.splitFromDiagramId && state.pending.has(item.splitFromDiagramId) ? [item.splitFromDiagramId] : []),
    ]
    for (const id of ids) {
      const entry = state.pending.get(id)
      if (!entry) continue
      for (const node of item.nodeIds) entry.nodes.add(node)
      for (const link of item.edges) entry.edges.add(visible(link))
      const complete =
        entry.fingerprint.nodeIds.every((node) => entry.nodes.has(node)) &&
        entry.fingerprint.edges.every((link) => entry.edges.has(visible(link)))
      if (!complete) continue
      state.pending.delete(id)
      queue.push(entry.fingerprint)
    }
  }
}

function attempt(session: string, file: string, key: "validations" | "renders", max: number, issue: Issue) {
  mark(session)
  const state = sessions.get(session)!
  const count = state[key].get(file) ?? 0
  if (count >= max) return issue
  state[key].set(file, count + 1)
  while (state[key].size > paths) {
    const first = state[key].keys().next().value
    if (!first) return
    state[key].delete(first)
  }
}
