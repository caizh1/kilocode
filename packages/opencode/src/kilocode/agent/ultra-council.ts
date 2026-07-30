// kilocode_change - new file
import { ProductProfile } from "@/kilocode/product-profile"
import type { Agent } from "@/agent/agent"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

export namespace UltraCouncil {
  export const BASELINE = "ultra_code_baseline"
  export const EXPLORE = "ultra_council_explore"
  export const ADJUDICATE = "ultra_council_adjudicate"
  export const REVISE = "ultra_council_revise"
  export const ARBITRATE = "ultra_submit_arbitration"
  const arbitrationLimit = 12
  const prematureLimit = 6

  export type Phase =
    | "baselining"
    | "collecting"
    | "arbitrating"
    | "followup"
    | "revising"
    | "sealed"
    | "verified"
    | "limited"
    | "degraded"
  export type Kind = "analysis" | "review" | "implementation"
  export type Lens = "flow" | "falsify" | "evidence" | "adjudicate" | "recheck"
  export type ClaimStatus = "verified" | "inferred" | "unverified"
  export type ClaimScope = "local" | "execution" | "system" | "external"
  export type EvidenceKind = "workspace" | "document" | "user" | "url" | "observation" | "derived"
  export type EvidenceRole =
    | "entry"
    | "guard"
    | "call"
    | "state"
    | "outcome"
    | "fact"
    | "observation"
    | "counterexample"
  export type Evidence = {
    kind: EvidenceKind
    role: EvidenceRole
    logic: string
    path?: string
    line?: number
    symbol?: string
    source?: string
    excerpt?: string
  }
  export type Obligation = {
    id: string
    text: string
  }
  export type Binding = {
    obligation: string
    claims: string[]
  }
  export type EditKind = "replace" | "delete" | "insert_before" | "insert_after"
  export type Edit = {
    id: string
    hash: string
    kind: EditKind
    anchor: string
    text?: string
    obligations: string[]
    claims: string[]
    reason: string
  }
  export type EditDecision = {
    id: string
    hash: string
    status: "approved" | "rejected" | "unverified"
    corrections: string[]
    uncertainties: string[]
  }
  export type EditInput = {
    kind: EditKind
    anchor: string
    text?: string
    obligations: string[]
    claims: Array<{ id: string; hash: string }>
    reason: string
  }
  export type Packet = {
    tools: Array<{
      id: string
      status: string
      input: string
    }>
    references: string[]
    truncated: boolean
  }
  export type Claim = {
    id: string
    hash: string
    lens: Lens
    obligations: string[]
    claim: string
    status: ClaimStatus
    scope: ClaimScope
    chain: Evidence[]
    protectionsChecked: string[]
    counterEvidence: string[]
    uncertainties: string[]
    excluded: string[]
  }
  export type Decision = {
    id: string
    hash: string
    status: "approved" | "rejected" | "unverified"
    evidence: Evidence[]
    corrections: string[]
    uncertainties: string[]
  }
  export type Coverage = {
    id: string
    status: "covered" | "missing" | "conflicted"
    claims: string[]
    evidence: Evidence[]
    corrections: string[]
    uncertainties: string[]
  }
  export type Review = {
    kind: Kind
    candidateHash: string
    status: "approved" | "revision"
    obligations: Coverage[]
    missing: string[]
    corrections: string[]
  }
  export type Report = {
    lens: Lens
    question: string
    valid: boolean
    reason?: string
    sessionID?: string
    output: string
    claims: Claim[]
  }
  export type State = {
    sessionID: string
    messageID: string
    phase: Phase
    baselineAttempts: number
    baselineSessionID?: string
    baseline?: string
    baselineHash?: string
    packet?: Packet
    packetHash?: string
    started: number
    valid: number
    rounds: number
    premature: number
    adjudicated: boolean
    arbitrations: number
    anchors: string[]
    kind?: Kind
    obligations: Obligation[]
    claims: Claim[]
    decisions: Decision[]
    edits: Edit[]
    editDecisions: EditDecision[]
    appliedEdits: Edit[]
    bindings: Binding[]
    review?: Review
    candidate?: string
    candidateHash?: string
    proposalHash?: string
    fallback?: string
    sealedHash?: string
    documents?: string
    reason?: string
  }

  export type Snapshot = Pick<
    State,
    | "messageID"
    | "phase"
    | "baselineAttempts"
    | "baselineSessionID"
    | "baselineHash"
    | "packetHash"
    | "started"
    | "valid"
    | "rounds"
    | "adjudicated"
    | "arbitrations"
    | "anchors"
    | "kind"
    | "obligations"
    | "claims"
    | "decisions"
    | "edits"
    | "editDecisions"
    | "appliedEdits"
    | "bindings"
    | "review"
    | "candidateHash"
    | "proposalHash"
    | "sealedHash"
    | "documents"
    | "reason"
  > & { version: 5 }

  const states = new Map<string, State>()
  const readonly = new Set([
    ARBITRATE,
    ADJUDICATE,
    REVISE,
    "read",
    "grep",
    "glob",
    "list",
    "skill",
    "webfetch",
    "websearch",
    "codebase_search",
    "codebase_analysis",
    "semantic_search",
    "document_search",
    "StructuredOutput",
  ])

  function key(sessionID: string, messageID: string) {
    return `${sessionID}\u0000${messageID}`
  }

  function digest(input: string) {
    return new Bun.CryptoHasher("sha256").update(input).digest("hex")
  }

  function text(message: SessionV1.WithParts | undefined) {
    if (!message) return ""
    return message.parts
      .filter((part): part is SessionV1.TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n")
  }

  function unique(items: string[]) {
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
  }

  function anchors(input: string) {
    const paths = input.match(/\b(?:[\w.-]+\/)+[\w.-]+\.(?:c|cc|cpp|cxx|h|hh|hpp|ts|tsx|js|jsx|rs|go|py|md)\b/g) ?? []
    const calls = [...input.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\s*\(\s*\)/g)].map((match) => match[1] ?? "")
    const fenced = [...input.matchAll(/`([A-Za-z_][A-Za-z0-9_]{2,})`/g)].map((match) => match[1] ?? "")
    const marker = input.match(/(?:Evidence targets|证据锚点)\s*:\s*([\s\S]*?)(?:\n\n|$)/i)?.[1] ?? ""
    const listed = marker
      .split(/\r?\n/)
      .map((item) => item.replace(/^\s*[-*]\s*/, ""))
      .filter(Boolean)
    return unique([...paths, ...calls, ...fenced, ...listed])
  }

  function isSnapshot(input: unknown): input is Snapshot {
    if (!input || typeof input !== "object") return false
    const data = input as Record<string, unknown>
    return (
      data.version === 5 &&
      typeof data.messageID === "string" &&
      [
        "baselining",
        "collecting",
        "arbitrating",
        "followup",
        "revising",
        "sealed",
        "verified",
        "limited",
        "degraded",
      ].includes(String(data.phase)) &&
      typeof data.baselineAttempts === "number" &&
      typeof data.started === "number" &&
      typeof data.valid === "number" &&
      typeof data.rounds === "number" &&
      typeof data.adjudicated === "boolean" &&
      typeof data.arbitrations === "number" &&
      Array.isArray(data.anchors) &&
      Array.isArray(data.obligations) &&
      Array.isArray(data.claims) &&
      Array.isArray(data.decisions) &&
      Array.isArray(data.edits) &&
      Array.isArray(data.editDecisions) &&
      Array.isArray(data.bindings)
    )
  }

  function legacy(input: unknown) {
    if (!input || typeof input !== "object") return false
    return [3, 4].includes(Number((input as Record<string, unknown>).version))
  }

  function baseline(part: SessionV1.ToolPart) {
    if (part.tool !== BASELINE || !("output" in part.state) || typeof part.state.output !== "string") return undefined
    const marker = "ULTRA_CODE_BASELINE\n"
    const offset = part.state.output.indexOf(marker)
    if (offset < 0) return undefined
    try {
      const data = JSON.parse(part.state.output.slice(offset + marker.length)) as {
        answer?: unknown
        packet?: unknown
      }
      if (typeof data.answer !== "string" || !data.answer.trim()) return undefined
      if (!data.packet || typeof data.packet !== "object") return undefined
      return {
        answer: data.answer,
        packet: data.packet as Packet,
      }
    } catch {
      return undefined
    }
  }

  function restore(input: {
    sessionID: string
    messageID: string
    messages: SessionV1.WithParts[]
    anchors: string[]
  }): State {
    const parts = input.messages
      .filter(
        (message) =>
          message.info.role === "assistant" &&
          message.info.parentID === input.messageID &&
          message.info.sessionID === input.sessionID,
      )
      .flatMap((message) => message.parts)
      .filter(
        (part): part is SessionV1.ToolPart =>
          part.type === "tool" && [BASELINE, EXPLORE, ADJUDICATE, REVISE, ARBITRATE].includes(part.tool),
      )
    const saved = parts
      .map((part) => ("metadata" in part.state ? part.state.metadata?.ultraCouncil : undefined))
      .filter(isSnapshot)
      .at(-1)
    const old = parts
      .map((part) => ("metadata" in part.state ? part.state.metadata?.ultraCouncil : undefined))
      .some(legacy)
    if (!saved && old) {
      return {
        sessionID: input.sessionID,
        messageID: input.messageID,
        phase: "degraded",
        baselineAttempts: 2,
        started: 5,
        valid: 0,
        rounds: 0,
        premature: 0,
        adjudicated: false,
        arbitrations: 0,
        anchors: input.anchors,
        obligations: [],
        claims: [],
        decisions: [],
        edits: [],
        editDecisions: [],
        appliedEdits: [],
        bindings: [],
        reason: "A legacy Ultra Council snapshot cannot prove the exact final candidate after upgrade.",
      }
    }
    const source = parts
      .map(baseline)
      .filter((item): item is NonNullable<ReturnType<typeof baseline>> => item !== undefined)
      .findLast(
        (item) =>
          (!saved?.baselineHash || digest(item.answer) === saved.baselineHash) &&
          (!saved?.packetHash || digest(JSON.stringify(item.packet)) === saved.packetHash),
      )
    const approved = new Set(
      (saved?.editDecisions ?? []).filter((item) => item.status === "approved").map((item) => item.id),
    )
    const supported = new Set(
      (saved?.decisions ?? []).filter((item) => item.status === "approved").map((item) => item.id),
    )
    const legacyApplied =
      saved?.edits.filter((item) => approved.has(item.id) && item.claims.every((claim) => supported.has(claim))) ?? []
    const terminal = Boolean(
      saved &&
        (["sealed", "limited", "degraded"].includes(saved.phase) ||
          (saved.phase === "arbitrating" && saved.adjudicated)),
    )
    const applied = saved?.appliedEdits ?? legacyApplied
    const proposal = terminal ? applied : (saved?.edits ?? [])
    const reconstructed = source && saved ? apply(source.answer, proposal) : undefined
    const candidate =
      reconstructed && (!saved?.candidateHash || digest(reconstructed) === saved.candidateHash)
        ? reconstructed
        : source?.answer
    const unverifiable =
      Boolean(saved && terminal && !saved.appliedEdits && saved.edits.length > 0 && saved.editDecisions.length === 0) ||
      Boolean(
        saved && terminal && saved.candidateHash && (!reconstructed || digest(reconstructed) !== saved.candidateHash),
      )
    const broken =
      Boolean(saved?.baselineHash && !source) ||
      Boolean(saved?.phase === "sealed" && (!candidate || saved.sealedHash !== digest(candidate))) ||
      unverifiable
    const phase = broken ? "degraded" : (saved?.phase ?? "baselining")
    return {
      sessionID: input.sessionID,
      messageID: input.messageID,
      phase,
      baselineAttempts: saved?.baselineAttempts ?? 0,
      baselineSessionID: saved?.baselineSessionID,
      baseline: source?.answer,
      baselineHash: saved?.baselineHash,
      packet: source?.packet,
      packetHash: saved?.packetHash,
      started: saved?.started ?? 0,
      valid: saved?.valid ?? 0,
      rounds: saved?.rounds ?? 0,
      premature: 0,
      adjudicated: saved?.adjudicated ?? false,
      arbitrations: saved?.arbitrations ?? 0,
      anchors: unique([...(saved?.anchors ?? []), ...input.anchors]),
      kind: saved?.kind,
      obligations: saved?.obligations ?? [],
      claims: saved?.claims ?? [],
      decisions: saved?.decisions ?? [],
      edits: saved?.edits ?? [],
      editDecisions: saved?.editDecisions ?? [],
      appliedEdits: applied,
      bindings: saved?.bindings ?? [],
      review: saved?.review,
      candidate,
      candidateHash: saved?.candidateHash,
      proposalHash: saved?.proposalHash,
      sealedHash: saved?.sealedHash,
      documents: saved?.documents,
      reason: broken
        ? "The Ultra Code baseline or exact approved candidate could not be reconstructed from persisted tool evidence."
        : saved?.reason,
    }
  }

  export function active(agent: Pick<Agent.Info, "native" | "options">) {
    return ProductProfile.chipmate && agent.native === true && agent.options?.id === "ultra"
  }

  export function load(input: { sessionID: string; messageID: string; messages: SessionV1.WithParts[] }): State {
    const id = key(input.sessionID, input.messageID)
    const cached = states.get(id)
    if (cached) return cached
    const user = input.messages.find((message) => message.info.role === "user" && message.info.id === input.messageID)
    const state = restore({
      ...input,
      anchors: anchors(text(user)),
    })
    states.set(id, state)
    if (states.size > 512) {
      const oldest = states.keys().next().value
      if (oldest) states.delete(oldest)
    }
    return state
  }

  export function snapshot(state: State): Snapshot {
    return {
      version: 5,
      messageID: state.messageID,
      phase: state.phase,
      baselineAttempts: state.baselineAttempts,
      baselineSessionID: state.baselineSessionID,
      baselineHash: state.baselineHash,
      packetHash: state.packetHash,
      started: state.started,
      valid: state.valid,
      rounds: state.rounds,
      adjudicated: state.adjudicated,
      arbitrations: state.arbitrations,
      anchors: state.anchors,
      kind: state.kind,
      obligations: state.obligations,
      claims: state.claims,
      decisions: state.decisions,
      edits: state.edits,
      editDecisions: state.editDecisions,
      appliedEdits: state.appliedEdits,
      bindings: state.bindings,
      review: state.review,
      candidateHash: state.candidateHash,
      proposalHash: state.proposalHash,
      sealedHash: state.sealedHash,
      documents: state.documents,
      reason: state.reason,
    }
  }

  export function configure(state: State, kind: Kind, obligations: Obligation[]) {
    if (state.phase !== "baselining" || state.started > 0 || state.baseline) {
      return "The Council request contract is already frozen."
    }
    const ids = obligations.map((item) => item.id.trim())
    if (obligations.length < 1 || obligations.length > 20) return "The Council requires 1 to 20 question obligations."
    if (ids.some((id) => !id)) return "Every Council obligation needs a non-empty id."
    if (new Set(ids).size !== ids.length) return "Council obligation ids must be unique."
    if (obligations.some((item) => item.text.trim().length < 3)) {
      return "Every Council obligation needs a concrete question requirement."
    }
    const next = obligations.map((item) => ({ id: item.id.trim(), text: item.text.trim() }))
    if (state.kind || state.obligations.length > 0) {
      if (state.kind === kind && JSON.stringify(state.obligations) === JSON.stringify(next)) return undefined
      return "The Council request contract is already frozen."
    }
    state.kind = kind
    state.obligations = next
    return undefined
  }

  export function reserveBaseline(state: State) {
    if (state.phase !== "baselining") return "The Ultra Code baseline is not currently required."
    if (!state.kind || state.obligations.length === 0)
      return "Freeze request kind and obligations before Code baseline."
    if (state.baseline) return "The Ultra Code baseline is already frozen."
    if (state.baselineAttempts >= 2) {
      state.phase = "degraded"
      state.reason = "The Ultra Code baseline failed twice and cannot be retried for answer quality."
      return state.reason
    }
    state.baselineAttempts++
    state.premature = 0
    state.reason = "The Ultra Code baseline was interrupted before its complete answer could be frozen."
    return undefined
  }

  export function recordBaseline(state: State, input: { answer: string; packet: Packet; sessionID?: string }) {
    const answer = input.answer.trim()
    if (!answer) {
      if (state.baselineAttempts >= 2) state.phase = "degraded"
      state.reason = "The Ultra Code baseline returned an empty answer."
      return false
    }
    state.baseline = answer
    state.baselineHash = digest(answer)
    state.packet = input.packet
    state.packetHash = digest(JSON.stringify(input.packet))
    state.baselineSessionID = input.sessionID
    state.phase = "collecting"
    state.reason = undefined
    return true
  }

  export function failBaseline(state: State, reason: string) {
    state.reason = reason
    if (state.baselineAttempts < 2) return
    state.phase = "degraded"
  }

  function occurrences(text: string, anchor: string) {
    const found: number[] = []
    for (let offset = text.indexOf(anchor); offset >= 0; offset = text.indexOf(anchor, offset + anchor.length)) {
      found.push(offset)
    }
    return found
  }

  function spans(baseline: string, edits: Edit[]) {
    return edits.map((edit) => {
      const offset = baseline.indexOf(edit.anchor)
      if (edit.kind === "insert_before") return { edit, start: offset, end: offset }
      if (edit.kind === "insert_after") {
        const point = offset + edit.anchor.length
        return { edit, start: point, end: point }
      }
      return { edit, start: offset, end: offset + edit.anchor.length }
    })
  }

  function apply(baseline: string, edits: Edit[]) {
    return spans(baseline, edits)
      .sort((a, b) => b.start - a.start)
      .reduce((text, item) => {
        if (item.edit.kind === "delete") return text.slice(0, item.start) + text.slice(item.end)
        if (item.edit.kind === "replace") {
          return text.slice(0, item.start) + (item.edit.text ?? "") + text.slice(item.end)
        }
        return text.slice(0, item.start) + (item.edit.text ?? "") + text.slice(item.start)
      }, baseline)
  }

  export function propose(state: State, baselineHash: string, input: EditInput[]) {
    if (!state.baseline || !state.baselineHash || !state.packetHash) {
      return { error: "The frozen Ultra Code baseline is unavailable." } as const
    }
    if (baselineHash !== state.baselineHash) return { error: "The Ultra Code baseline hash is stale." } as const
    if (input.length > 20) return { error: "A Council proposal cannot contain more than 20 edits." } as const
    const obligations = new Set(state.obligations.map((item) => item.id))
    const claims = new Map(state.claims.map((item) => [item.id, item.hash]))
    const edits: Edit[] = []
    for (const [index, item] of input.entries()) {
      if (!item.anchor) return { error: `Edit ${index + 1} needs a non-empty exact anchor.` } as const
      if (occurrences(state.baseline, item.anchor).length !== 1) {
        return { error: `Edit ${index + 1} anchor must occur exactly once in the frozen Code answer.` } as const
      }
      if (item.kind !== "delete" && !item.text?.trim()) {
        return { error: `Edit ${index + 1} needs non-empty replacement or insertion text.` } as const
      }
      if (item.obligations.length === 0 || item.obligations.some((id) => !obligations.has(id))) {
        return { error: `Edit ${index + 1} references an unknown or empty obligation set.` } as const
      }
      if (
        item.claims.length === 0 ||
        item.claims.some((claim) => !claims.has(claim.id) || claims.get(claim.id) !== claim.hash)
      ) {
        return { error: `Edit ${index + 1} references an unknown or changed claim hash.` } as const
      }
      const body = {
        kind: item.kind,
        anchor: item.anchor,
        text: item.text,
        obligations: unique(item.obligations),
        claims: unique(item.claims.map((claim) => claim.id)),
        reason: item.reason.trim(),
      }
      edits.push({
        id: `edit-${index + 1}`,
        hash: digest(JSON.stringify(body)),
        ...body,
      })
    }
    const targets = new Map<string, string>()
    for (const edit of edits) {
      const previous = targets.get(edit.anchor)
      if (previous) return { error: `Edits ${previous} and ${edit.id} overlap.` } as const
      targets.set(edit.anchor, edit.id)
    }
    const ranges = spans(state.baseline, edits).sort((a, b) => a.start - b.start || a.end - b.end)
    for (let index = 1; index < ranges.length; index++) {
      const prev = ranges[index - 1]
      const next = ranges[index]
      if (next.start < prev.end || (next.start === prev.start && next.end === prev.end)) {
        return { error: `Edits ${prev.edit.id} and ${next.edit.id} overlap.` } as const
      }
    }
    return {
      edits,
      candidate: apply(state.baseline, edits),
    } as const
  }

  export function reserve(state: State, phase: "initial" | "followup", lenses: Lens[]) {
    if (phase === "initial") {
      if (state.phase !== "collecting") return "The initial Council wave has already started."
      if (!state.kind || state.obligations.length === 0)
        return "Freeze request kind and obligations before exploration."
      if (!state.baseline || !state.baselineHash || !state.packet || !state.packetHash) {
        return "Freeze the complete Ultra Code baseline before exploration."
      }
      if (lenses.length !== 3) return "The initial Council wave must contain exactly 3 investigations."
      const required = ["flow", "falsify", "evidence"]
      if (!required.every((lens) => lenses.includes(lens as Lens))) {
        return "The initial Council wave must contain flow, falsify, and evidence exactly once."
      }
    }
    if (phase === "followup") {
      if (state.phase !== "followup") return "A follow-up Council wave is not currently required."
      if (lenses.length !== 1) return "A follow-up Council wave must contain exactly 1 investigation."
    }
    if (state.started + lenses.length > 5) return "This turn cannot start more than 5 Council investigations."
    state.premature = 0
    state.started += lenses.length
    state.rounds++
    state.phase = state.started >= 5 ? "degraded" : "followup"
    if (state.phase === "degraded") {
      state.reason = "The final Council wave was interrupted before its results could be recorded."
    }
    return undefined
  }

  export function record(state: State, reports: Report[]) {
    const valid = reports.filter(
      (report) =>
        report.valid && report.claims.some((claim) => claim.status !== "unverified" && claim.chain.length > 0),
    )
    state.valid += valid.length
    const ids = new Set(state.claims.map((claim) => claim.id))
    for (const claim of valid.flatMap((report) => report.claims)) {
      if (ids.has(claim.id)) continue
      ids.add(claim.id)
      state.claims.push(claim)
    }
    if (state.valid >= 3) {
      if (state.started >= 5 && !state.adjudicated) {
        state.phase = "degraded"
        state.reason = "Three valid investigations returned, but no task budget remained for independent adjudication."
        return
      }
      state.phase = "arbitrating"
      state.reason = undefined
      return
    }
    const remaining = 5 - state.started
    const needed = 3 - state.valid + 1
    if (remaining < needed) {
      state.phase = "degraded"
      state.reason = `Only ${state.valid} valid reports returned; the remaining ${remaining} task slots cannot reach three valid reports and preserve independent adjudication.`
      return
    }
    state.phase = "followup"
  }

  function refs(state: State, bindings: Binding[]) {
    const obligations = new Set(state.obligations.map((item) => item.id))
    const claims = new Set(state.claims.map((item) => item.id))
    const errors = bindings.flatMap((binding) => [
      ...(obligations.has(binding.obligation) ? [] : [`Unknown obligation binding: ${binding.obligation}`]),
      ...binding.claims.filter((id) => !claims.has(id)).map((id) => `Unknown claim binding: ${id}`),
    ])
    return unique(errors)
  }

  export function reserveAdjudication(state: State, baselineHash: string, input: EditInput[], bindings: Binding[]) {
    if (state.phase !== "arbitrating") return "Council reports are not ready for independent adjudication."
    if (state.adjudicated) return "Independent Council adjudication has already completed."
    if (state.started >= 5) {
      state.phase = "degraded"
      state.reason = "No Council task budget remained for independent adjudication."
      return state.reason
    }
    const errors = refs(state, bindings)
    if (errors.length > 0) return errors.join("; ")
    const proposal = propose(state, baselineHash, input)
    if ("error" in proposal) return proposal.error
    state.premature = 0
    state.started++
    state.rounds++
    state.edits = proposal.edits
    state.editDecisions = []
    state.candidate = proposal.candidate
    state.candidateHash = digest(proposal.candidate)
    state.proposalHash = state.candidateHash
    state.fallback = state.baseline
    state.bindings = bindings.map((item) => ({ obligation: item.obligation, claims: unique(item.claims) }))
    state.reason = "The independent adjudicator was interrupted before its result could be recorded."
    return undefined
  }

  function clean(state: State, review: Review, decisions: Decision[], edits: EditDecision[], revised = false) {
    if (!state.kind || review.kind !== state.kind) return false
    if (!state.proposalHash || review.candidateHash !== state.proposalHash) return false
    if (review.status !== "approved" || review.missing.length > 0 || review.corrections.length > 0) return false
    const approvedEdits = new Set(edits.filter((item) => item.status === "approved").map((item) => item.id))
    const approvedClaims = new Set(decisions.filter((item) => item.status === "approved").map((item) => item.id))
    if (
      state.edits.some((item) => !approvedEdits.has(item.id) || item.claims.some((claim) => !approvedClaims.has(claim)))
    ) {
      return false
    }
    const coverage = new Map(review.obligations.map((item) => [item.id, item]))
    const approved = approvedClaims
    const bound = new Map(state.bindings.map((item) => [item.obligation, item.claims]))
    return state.obligations.every((item) => {
      const result = coverage.get(item.id)
      const claims = bound.get(item.id) ?? []
      const evidence = result?.evidence ?? []
      return (
        result?.status === "covered" &&
        result.corrections.length === 0 &&
        (revised
          ? evidence.length > 0
          : claims.length > 0 &&
            claims.every((id) => approved.has(id)) &&
            result.claims.every((id) => approved.has(id)))
      )
    })
  }

  export function recordAdjudication(
    state: State,
    result: { valid: boolean; decisions?: Decision[]; edits?: EditDecision[]; review?: Review },
  ) {
    if (!result.valid || !result.review) {
      if (state.started >= 5) {
        state.phase = "degraded"
        state.reason = "The independent adjudicator did not return a valid source-backed review."
        return
      }
      state.phase = "arbitrating"
      state.reason = "The independent adjudicator result was invalid and must be retried."
      return
    }
    const decisions = result.decisions ?? []
    const edits = result.edits ?? []
    state.valid++
    state.adjudicated = true
    state.decisions = decisions
    state.editDecisions = edits
    state.review = result.review
    const approved = new Set(edits.filter((item) => item.status === "approved").map((item) => item.id))
    const supported = new Set(decisions.filter((item) => item.status === "approved").map((item) => item.id))
    state.appliedEdits = state.edits.filter(
      (item) => approved.has(item.id) && item.claims.every((claim) => supported.has(claim)),
    )
    state.candidate = apply(state.baseline ?? "", state.appliedEdits)
    state.candidateHash = digest(state.candidate)
    state.fallback = state.candidate
    if (clean(state, result.review, decisions, edits)) {
      if (state.kind === "implementation") {
        state.phase = "arbitrating"
        state.reason = undefined
        return
      }
      state.phase = "sealed"
      state.sealedHash = state.candidateHash
      state.reason = undefined
      return
    }
    const reason = unique([
      ...result.review.missing,
      ...result.review.corrections,
      ...result.review.obligations.flatMap((item) =>
        item.status === "covered" ? item.corrections : [`${item.id}: ${item.status}`, ...item.corrections],
      ),
    ]).join("; ")
    if (state.kind !== "implementation" && state.started < 5) {
      state.phase = "revising"
      state.reason = reason || "The exact candidate requires an independently verified revision."
      return
    }
    state.phase = state.kind === "implementation" ? "arbitrating" : "limited"
    state.reason = reason || "The exact candidate was not fully supported by the adjudicated evidence."
  }

  export function reserveRevision(state: State, baselineHash: string, input: EditInput[], bindings: Binding[]) {
    if (state.phase !== "revising") return "The Council is not waiting for a revised candidate."
    if (state.started >= 5) {
      state.phase = "limited"
      state.reason = "No Council task budget remained for independent final verification."
      return state.reason
    }
    const errors = refs(state, bindings)
    if (errors.length > 0) return errors.join("; ")
    const proposal = propose(state, baselineHash, input)
    if ("error" in proposal) return proposal.error
    state.premature = 0
    state.started++
    state.rounds++
    state.fallback = state.candidate ?? state.baseline
    state.edits = proposal.edits
    state.editDecisions = []
    state.candidate = proposal.candidate
    state.candidateHash = digest(proposal.candidate)
    state.proposalHash = state.candidateHash
    state.bindings = bindings.map((item) => ({ obligation: item.obligation, claims: unique(item.claims) }))
    state.reason = "The final verifier was interrupted before its result could be recorded."
    return undefined
  }

  export function recordRevision(
    state: State,
    result: { valid: boolean; decisions?: Decision[]; edits?: EditDecision[]; review?: Review },
  ) {
    const decisions = result.decisions ?? state.decisions
    const edits = result.edits ?? []
    const approved = new Set(edits.filter((item) => item.status === "approved").map((item) => item.id))
    const supported = new Set(decisions.filter((item) => item.status === "approved").map((item) => item.id))
    const applied = state.edits.filter(
      (item) => approved.has(item.id) && item.claims.every((claim) => supported.has(claim)),
    )
    const candidate = apply(state.baseline ?? "", applied)
    if (result.valid && result.review && clean(state, result.review, decisions, edits, true)) {
      state.valid++
      state.decisions = decisions
      state.editDecisions = edits
      state.review = result.review
      state.appliedEdits = applied
      state.candidate = candidate
      state.candidateHash = digest(candidate)
      state.phase = "sealed"
      state.sealedHash = state.candidateHash
      state.reason = undefined
      return
    }
    state.candidate = apply(state.baseline ?? "", state.appliedEdits)
    state.candidateHash = state.candidate ? digest(state.candidate) : undefined
    state.phase = "limited"
    state.reason =
      result.review?.corrections.join("; ") ||
      result.review?.missing.join("; ") ||
      "The independently reviewed revision could not be fully verified."
  }

  export function submit(
    state: State,
    input: {
      decision: "verified" | "limited" | "followup"
      claims: number
      contradictions: string[]
      missing: string[]
      unresolved: string[]
      followups: string[]
      covered: string[]
    },
  ) {
    if (state.phase !== "arbitrating") return "Council results are not ready for arbitration."
    if (!state.adjudicated) return "Independent Council adjudication must complete before arbitration."
    if (state.kind !== "implementation")
      return "Read-only analysis and review answers are delivered from the sealed candidate."
    const uncovered = state.anchors.filter((anchor) => !input.covered.includes(anchor))
    const clean =
      input.decision === "verified" &&
      input.claims > 0 &&
      input.missing.length === 0 &&
      input.unresolved.length === 0 &&
      uncovered.length === 0
    if (clean) {
      state.phase = "verified"
      state.reason = undefined
      return undefined
    }
    if (input.decision === "limited") {
      state.phase = "limited"
      state.reason =
        [...input.missing, ...input.unresolved, ...uncovered.map((anchor) => `Unverified anchor: ${anchor}`)]
          .filter(Boolean)
          .join("; ") || "Evidence remained limited."
      return undefined
    }
    if (state.started < 5) {
      state.phase = "followup"
      state.reason = [
        ...input.contradictions,
        ...input.unresolved,
        ...input.missing,
        ...uncovered.map((anchor) => `Uncovered anchor: ${anchor}`),
      ].join("; ")
      return undefined
    }
    state.reason = [
      "Council arbitration could not verify the implementation decision.",
      ...input.contradictions,
      ...input.unresolved,
      ...input.missing,
      ...uncovered.map((anchor) => `Uncovered anchor: ${anchor}`),
    ]
      .filter(Boolean)
      .join(" ")
    if (state.arbitrations < arbitrationLimit) {
      return `Correct and resubmit the existing evidence matrix without starting another task: ${state.reason}`
    }
    state.phase = "degraded"
    return undefined
  }

  export function reserveArbitration(state: State) {
    if (state.phase !== "arbitrating") return "Council results are not ready for arbitration."
    if (!state.adjudicated) return "Independent Council adjudication must complete before arbitration."
    if (state.kind !== "implementation") return "Only implementation turns use chair arbitration."
    state.premature = 0
    state.arbitrations++
    if (state.arbitrations <= arbitrationLimit) return undefined
    state.phase = "degraded"
    state.reason = `The Council chair exceeded ${arbitrationLimit} bounded evidence-matrix submissions.`
    return state.reason
  }

  export function filter<T>(state: State, tools: Record<string, T>) {
    if (state.phase === "baselining") {
      return Object.fromEntries(Object.entries(tools).filter(([id]) => id === BASELINE))
    }
    if (state.phase === "collecting" || state.phase === "followup") {
      return Object.fromEntries(Object.entries(tools).filter(([id]) => id === EXPLORE))
    }
    if (state.phase === "revising") {
      return Object.fromEntries(Object.entries(tools).filter(([id]) => id === REVISE))
    }
    if (state.phase === "arbitrating") {
      if (!state.adjudicated) {
        return Object.fromEntries(Object.entries(tools).filter(([id]) => id === ADJUDICATE))
      }
      if (state.premature > 0 || (state.started >= 5 && state.arbitrations > 0)) {
        return Object.fromEntries(Object.entries(tools).filter(([id]) => id === ARBITRATE))
      }
      return Object.fromEntries(
        Object.entries(tools).filter(
          ([id]) => readonly.has(id) && id !== ADJUDICATE && id !== REVISE && id !== "StructuredOutput",
        ),
      )
    }
    if (state.phase === "degraded" || state.phase === "limited" || state.phase === "sealed") {
      return Object.fromEntries(
        Object.entries(tools).filter(([id]) => readonly.has(id) && ![ADJUDICATE, REVISE, ARBITRATE].includes(id)),
      )
    }
    return Object.fromEntries(
      Object.entries(tools).filter(([id]) => ![BASELINE, EXPLORE, ADJUDICATE, REVISE, ARBITRATE, "task"].includes(id)),
    )
  }

  export function required(state: State) {
    return ["baselining", "collecting", "arbitrating", "followup", "revising"].includes(state.phase)
  }

  export function reminder(state: State) {
    const base = [
      "Ultra Council runtime contract:",
      `- phase=${state.phase}; kind=${state.kind ?? "unset"}; started=${state.started}; valid=${state.valid}; remaining=${5 - state.started}.`,
      `- frozen obligations=${JSON.stringify(state.obligations)}.`,
      `- required anchor keys=${JSON.stringify(state.anchors)}. Cover these exact keys with verified path, symbol, or source evidence.`,
    ]
    if (state.phase === "baselining") {
      return [
        ...base,
        `- First call ${BASELINE} with requestKind and a complete 1-20 item obligation list.`,
        "- The runtime will freeze a complete read-only Code answer and its bounded investigation packet before any Council exploration.",
        "- Do not answer, explore, or draft corrections before the Code baseline is frozen.",
      ].join("\n")
    }
    if (state.phase === "collecting") {
      return [
        ...base,
        `- Call ${EXPLORE} once with exactly three investigations: flow, falsify, evidence.`,
        "- Flow and evidence receive the untrusted frozen Code answer and bounded investigation packet; falsify remains fully blind to both.",
        "- Each obligation must preserve one explicit user requirement; do not merge away requested edge cases, distinctions, or output dimensions.",
      ].join("\n")
    }
    if (state.phase === "followup") {
      return [
        ...base,
        `- Call ${EXPLORE} with exactly one narrowly targeted follow-up investigation.`,
        "- Preserve enough task budget to reach three valid reports and run the mandatory independent adjudicator.",
      ].join("\n")
    }
    if (state.phase === "arbitrating") {
      if (!state.adjudicated) {
        return [
          ...base,
          `- Propose only exact evidence-backed edits against baseline SHA-256 ${state.baselineHash}, bind every obligation to investigated claim ids, then call ${ADJUDICATE}.`,
          "- The fourth independent adjudicator audits each edit, the deterministic candidate, every obligation, and every bound claim.",
          "- Do not rewrite the complete answer. With no approved edits, the frozen Code answer is delivered byte-for-byte.",
        ].join("\n")
      }
      return [
        ...base,
        `- This is an implementation turn. Verify the adjudicated evidence matrix, then call ${ARBITRATE} before mutating files.`,
        "- Do not vote by majority. A source-backed counterexample outranks agreement.",
        `- Do not answer yet. Your next response must call ${ARBITRATE}.`,
      ].join("\n")
    }
    if (state.phase === "revising") {
      return [
        ...base,
        `- Submit one complete corrected edit set against the same frozen Code baseline through ${REVISE}.`,
        `- Required corrections: ${state.reason ?? "address every adjudicator finding"}.`,
        "- The fifth independent verifier reviews the runtime-built exact candidate. It cannot rewrite the answer for you.",
      ].join("\n")
    }
    if (state.phase === "degraded") {
      return [
        ...base,
        `- The Council contract was not satisfied: ${state.reason ?? "evidence remained unresolved"}.`,
        "- The runtime will emit a read-only failure disclosure. Do not edit files.",
      ].join("\n")
    }
    if (state.phase === "limited") {
      return [
        ...base,
        `- The exact answer could not be fully verified: ${state.reason ?? "evidence remained limited"}.`,
        "- The runtime will render only adjudicator-approved claims and unresolved obligations.",
      ].join("\n")
    }
    if (state.phase === "sealed") {
      return [...base, "- The exact independently approved candidate is sealed for deterministic delivery."].join("\n")
    }
    return [
      ...base,
      "- Council verification passed for an implementation turn. Complete the requested edits and tests using adjudicated evidence.",
    ].join("\n")
  }

  function source(step: Evidence) {
    if (step.path) return `${step.path}${step.line ? `:${step.line}` : step.symbol ? ` (${step.symbol})` : ""}`
    return step.source
  }

  export function fallback(state: State) {
    const claims = new Map(state.claims.map((item) => [item.id, item]))
    const approved = state.decisions
      .filter((item) => item.status === "approved")
      .map((item) => {
        const claim = claims.get(item.id)
        if (!claim) return undefined
        const refs = unique(item.evidence.map(source).filter((item): item is string => item !== undefined))
        return `- ${claim.claim}${refs.length > 0 ? ` — ${refs.join(", ")}` : ""}`
      })
      .filter((item): item is string => item !== undefined)
    const unresolved = state.obligations
      .filter((item) => state.review?.obligations.find((entry) => entry.id === item.id)?.status !== "covered")
      .map((item) => `- ${item.text}`)
    return [
      "ULTRA_COUNCIL_EVIDENCE_LIMITED",
      "以下内容由运行时从独立仲裁已批准的结论确定性生成；未获批准的技术结论已省略。",
      "",
      "已验证结论：",
      ...(approved.length > 0 ? approved : ["- 无可安全输出的已批准结论。"]),
      "",
      "未解决问题义务：",
      ...(unresolved.length > 0 ? unresolved : [`- ${state.reason ?? "候选答案未通过完整复核。"}`]),
    ].join("\n")
  }

  export function disclosure(state: State) {
    return [
      "ULTRA_COUNCIL_RUNTIME_DISCLOSURE",
      "The Ultra Council contract was not satisfied for this turn.",
      `Valid reports: ${state.valid}; investigations started: ${state.started}.`,
      `Reason: ${state.reason ?? "Evidence remained unresolved."}`,
      "No unadjudicated technical answer was emitted.",
    ].join("\n")
  }

  export function result(state: State) {
    const candidate = state.baseline ? apply(state.baseline, state.appliedEdits) : undefined
    if (candidate) {
      return [
        candidate,
        "",
        "---",
        `证据状态：以上保留冻结 Code 基准及已获独立仲裁批准的修正；未批准修改已被运行时丢弃（${state.reason ?? "仍有未解决证据项"}）。`,
      ].join("\n")
    }
    return state.phase === "degraded" ? disclosure(state) : fallback(state)
  }

  export function delivery(state: State) {
    const candidate = state.baseline ? apply(state.baseline, state.appliedEdits) : undefined
    if (
      state.phase !== "sealed" ||
      !candidate ||
      state.candidate !== candidate ||
      state.sealedHash !== digest(candidate)
    ) {
      return undefined
    }
    return {
      text: candidate,
      hash: state.sealedHash,
      partID: `prt_ultra_${digest(`${state.sessionID}\u0000${state.messageID}\u0000${state.sealedHash}`).slice(0, 32)}`,
    }
  }

  export function outputID(state: State, kind: "limited" | "degraded") {
    return `prt_ultra_${kind}_${digest(`${state.sessionID}\u0000${state.messageID}\u0000${kind}`).slice(0, 24)}`
  }

  export function stopping(outcome: "break" | "continue", finish?: string) {
    return outcome === "break" || Boolean(finish && !["tool-calls", "unknown"].includes(finish))
  }

  export function gate(state: State, outcome: "break" | "continue", failed: boolean, finish?: string) {
    if (!stopping(outcome, finish)) return outcome
    if (failed || !required(state)) return "break" as const
    state.premature++
    const limit = state.phase === "arbitrating" && state.adjudicated ? arbitrationLimit : prematureLimit
    if (state.premature < limit) return "continue" as const
    state.phase = "degraded"
    state.reason = `The provider ended the turn ${limit} consecutive times without executing the mandatory Council tool.`
    return "continue" as const
  }

  export function reset() {
    states.clear()
  }
}
