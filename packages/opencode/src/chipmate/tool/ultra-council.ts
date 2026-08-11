// chipmate_change - new file
import { Agent } from "@/agent/agent"
import { ULTRA_BASELINE } from "@/chipmate/agent"
import { UltraCouncil } from "@/chipmate/agent/ultra-council"
import { Instance } from "@/chipmate/instance"
import { Parameters as TaskParameters } from "@/tool/task"
import * as Tool from "@/tool/tool"
import { Cause, Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "path"

type Task = Tool.Def<typeof TaskParameters>
type ExploreMeta = {
  rejected: boolean
  started?: number
  valid?: number
  sessions?: string[]
  ultraCouncil?: UltraCouncil.Snapshot
}
type BaselineMeta = {
  rejected: boolean
  session?: string
  baselineHash?: string
  packetHash?: string
  ultraCouncil?: UltraCouncil.Snapshot
}
type ArbitrationMeta = {
  rejected: boolean
  errors?: string[]
  ultraCouncil?: UltraCouncil.Snapshot
}
type AdjudicationMeta = {
  rejected: boolean
  valid?: boolean
  session?: string
  ultraCouncil?: UltraCouncil.Snapshot
}
type RevisionMeta = AdjudicationMeta

const Lens = Schema.Literals(["flow", "falsify", "evidence", "adjudicate", "recheck"])
const Kind = Schema.Literals(["analysis", "review", "implementation"])
const Obligation = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  text: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(2_000)),
})
const Investigation = Schema.Struct({
  lens: Lens,
  question: Schema.String.check(Schema.isMinLength(10), Schema.isMaxLength(4_000)),
})
const ExploreParams = Schema.Struct({
  phase: Schema.Literals(["initial", "followup"]),
  requestKind: Schema.optional(Kind),
  obligations: Schema.optional(Schema.Array(Obligation).check(Schema.isMinLength(1), Schema.isMaxLength(20))),
  investigations: Schema.Array(Investigation).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
})
const BaselineParams = Schema.Struct({
  requestKind: Kind,
  obligations: Schema.Array(Obligation).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
})
const Ref = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  hash: Schema.String.check(Schema.isMinLength(64), Schema.isMaxLength(64)),
})
const Binding = Schema.Struct({
  obligation: Obligation.fields.id,
  claims: Schema.Array(Ref.fields.id).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
})
const Edit = Schema.Struct({
  kind: Schema.Literals(["replace", "delete", "insert_before", "insert_after"]),
  anchor: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(20_000))),
  obligations: Schema.Array(Obligation.fields.id).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  claims: Schema.Array(Ref).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  reason: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(2_000)),
})
const AdjudicationParams = Schema.Struct({
  baselineHash: Ref.fields.hash.annotate({
    description: "Exact SHA-256 of the frozen Code baseline.",
  }),
  edits: Schema.Array(Edit).check(Schema.isMaxLength(20)).annotate({
    description:
      "Evidence-backed exact edits against the frozen Code answer. Submit an empty list to preserve Code byte-for-byte.",
  }),
  bindings: Schema.Array(Binding).check(Schema.isMinLength(1), Schema.isMaxLength(20)).annotate({
    description:
      "Bind each frozen question obligation covered by the exact candidate to the runtime claim ids that support it.",
  }),
  claims: Schema.optional(Schema.Array(Ref).check(Schema.isMinLength(1), Schema.isMaxLength(50))).annotate({
    description:
      "Optional integrity echo. The runtime always injects the complete authoritative claim manifest into the adjudicator. If supplied, this list must match it exactly.",
  }),
})

const Evidence = Schema.Struct({
  kind: Schema.Literals(["workspace", "document", "user", "url", "observation", "derived"]),
  role: Schema.Literals(["entry", "guard", "call", "state", "outcome", "fact", "observation", "counterexample"]),
  logic: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(2_000)),
  path: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
  line: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  symbol: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  source: Schema.optional(Schema.String.check(Schema.isMaxLength(4_000))),
  excerpt: Schema.optional(Schema.String.check(Schema.isMaxLength(4_000))),
})
const ReportClaim = Schema.Struct({
  obligations: Schema.Array(Obligation.fields.id).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  claim: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
  status: Schema.Literals(["verified", "inferred", "unverified"]),
  scope: Schema.Literals(["local", "execution", "system", "external"]),
  chain: Schema.Array(Evidence).check(Schema.isMaxLength(20)),
  protectionsChecked: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
  counterEvidence: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
  uncertainties: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
  excluded: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
})
const ReportBody = Schema.Struct({
  claims: Schema.Array(ReportClaim).check(Schema.isMinLength(1), Schema.isMaxLength(5)),
})
const Decision = Schema.Struct({
  id: Ref.fields.id,
  hash: Ref.fields.hash,
  status: Schema.Literals(["approved", "rejected", "unverified"]),
  evidence: Schema.Array(Evidence).check(Schema.isMaxLength(20)),
  corrections: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
  uncertainties: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
})
const EditDecision = Schema.Struct({
  id: Ref.fields.id,
  hash: Ref.fields.hash,
  status: Schema.Literals(["approved", "rejected", "unverified"]),
  corrections: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
  uncertainties: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
})
const Coverage = Schema.Struct({
  id: Obligation.fields.id,
  status: Schema.Literals(["covered", "missing", "conflicted"]),
  claims: Schema.Array(Ref.fields.id).check(Schema.isMaxLength(20)),
  evidence: Schema.Array(Evidence).check(Schema.isMaxLength(20)),
  corrections: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
  uncertainties: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(10)),
})
const Candidate = Schema.Struct({
  hash: Ref.fields.hash,
  status: Schema.Literals(["approved", "revision"]),
  corrections: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(20)),
})
const AdjudicationBody = Schema.Struct({
  requestKind: Kind,
  candidate: Candidate,
  obligations: Schema.Array(Coverage).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  missing: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(20)),
  claims: Schema.Array(Decision).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  edits: Schema.Array(EditDecision).check(Schema.isMaxLength(20)),
  excluded: Schema.Array(Schema.String.check(Schema.isMaxLength(2_000))).check(Schema.isMaxLength(20)),
})
const Claim = Schema.Struct({
  id: Ref.fields.id,
  hash: Ref.fields.hash,
  claim: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
  status: Schema.Literals(["verified", "disputed", "unsupported"]),
  evidence: Schema.Array(Evidence).check(Schema.isMaxLength(30)),
})
const Anchor = Schema.Struct({
  anchor: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
  covered: Schema.Boolean,
  evidence: Schema.optional(Schema.String.check(Schema.isMaxLength(4_000))),
})
const ArbitrationParams = Schema.Struct({
  decision: Schema.Literals(["verified", "limited", "followup"]),
  claims: Schema.optional(Schema.Array(Claim).check(Schema.isMinLength(1), Schema.isMaxLength(50))).annotate({
    description:
      "Optional diagnostic echo. Omit this field: runtime constructs the authoritative evidence matrix from the claim manifest and adjudicator decisions.",
  }),
  contradictions: Schema.Array(Schema.String).check(Schema.isMaxLength(20)).annotate({
    description:
      "Conflicts found during arbitration, including conflicts resolved by source. Any unresolved conflict must also have a disputed or unsupported claim and decision=followup.",
  }),
  missingEvidence: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  anchors: Schema.Array(Anchor).check(Schema.isMaxLength(100)).annotate({
    description:
      "Diagnostic anchor coverage summary. Runtime coverage is derived only from verified claim evidence, not from this self-report.",
  }),
  followups: Schema.Array(Schema.String).check(Schema.isMaxLength(2)),
})
const ArbitrationValue = Schema.Struct({
  value: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(200_000)).annotate({
    description:
      "Compatibility wrapper for providers that serialize the complete arbitration object as one JSON string.",
  }),
})
const ArbitrationInput = Schema.Struct({
  decision: Schema.optional(Schema.Literals(["verified", "limited", "followup"])),
  claims: Schema.optional(Schema.Array(Claim).check(Schema.isMinLength(1), Schema.isMaxLength(50))),
  contradictions: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(20))),
  missingEvidence: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(20))),
  anchors: Schema.optional(Schema.Array(Anchor).check(Schema.isMaxLength(100))),
  followups: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(2))),
  value: Schema.optional(ArbitrationValue.fields.value),
})

type Parsed<T> = { data: T } | { error: string }

function payload(output: string, marker: string): Parsed<unknown> {
  const offset = output.indexOf(marker)
  if (offset < 0) return { error: `The result omitted required marker: ${marker}` }
  const body = output.slice(offset + marker.length)
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end < start) return { error: `The ${marker} payload did not contain a JSON object.` }
  try {
    return { data: JSON.parse(body.slice(start, end + 1)) as unknown }
  } catch (err) {
    return { error: `The ${marker} JSON was invalid: ${String(err)}` }
  }
}

function structured(output: string, marker: string): Parsed<unknown> {
  return output.includes(marker)
    ? payload(output, marker)
    : (() => {
        const match = output.match(/\{\s*"claims"\s*:/)
        const start = match?.index ?? -1
        const end = output.lastIndexOf("}")
        if (start < 0 || end < start) {
          return { error: `The result omitted required marker and claims object: ${marker}` } satisfies Parsed<unknown>
        }
        try {
          return { data: JSON.parse(output.slice(start, end + 1)) } satisfies Parsed<unknown>
        } catch (err) {
          return { error: `The fallback claims JSON was invalid: ${String(err)}` } satisfies Parsed<unknown>
        }
      })()
}

function steps(raw: unknown, text: string) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((value) => {
      if (!value || typeof value !== "object") return undefined
      const step = value as Record<string, unknown>
      const roles = new Set(["entry", "guard", "call", "state", "outcome", "fact", "observation", "counterexample"])
      const kinds = new Set(["workspace", "document", "user", "url", "observation", "derived"])
      const role =
        typeof step.role === "string" && roles.has(step.role)
          ? step.role
          : step.role === "dispatch" || step.role === "invoke"
            ? "call"
            : step.role === "branch" || step.role === "condition"
              ? "guard"
              : step.role === "transition"
                ? "state"
                : step.role === "completion" || step.role === "result"
                  ? "outcome"
                  : "fact"
      const kind =
        typeof step.kind === "string" && kinds.has(step.kind)
          ? step.kind
          : typeof step.path === "string"
            ? "workspace"
            : "derived"
      const line =
        typeof step.line === "string" && /^\d+$/.test(step.line)
          ? Number.parseInt(step.line, 10)
          : typeof step.line === "number"
            ? step.line
            : undefined
      return {
        ...step,
        kind,
        role,
        logic:
          typeof step.logic === "string" && step.logic.trim()
            ? step.logic
            : `Evidence cited for: ${text.slice(0, 300)}`,
        line: line && line > 0 ? line : undefined,
      }
    })
    .filter((value) => value !== undefined)
}

function report(output: string): Parsed<Schema.Schema.Type<typeof ReportBody>> {
  const parsed = structured(output, "ULTRA_COUNCIL_REPORT")
  if ("error" in parsed) return { error: parsed.error }
  if (!parsed.data || typeof parsed.data !== "object" || !("claims" in parsed.data)) {
    return { error: "The ULTRA_COUNCIL_REPORT JSON omitted claims." }
  }
  const list = (parsed.data as { claims?: unknown }).claims
  if (!Array.isArray(list)) return { error: "The ULTRA_COUNCIL_REPORT claims value was not an array." }
  const data = {
    claims: list.map((value) => {
      const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
      const text = typeof item.claim === "string" ? item.claim : ""
      return {
        ...item,
        obligations: Array.isArray(item.obligations) ? item.obligations : [],
        claim: text,
        status: item.status ?? "unverified",
        scope: item.scope ?? "local",
        chain: steps(item.chain, text),
        protectionsChecked: Array.isArray(item.protectionsChecked) ? item.protectionsChecked : [],
        counterEvidence: Array.isArray(item.counterEvidence) ? item.counterEvidence : [],
        uncertainties: Array.isArray(item.uncertainties) ? item.uncertainties : [],
        excluded: Array.isArray(item.excluded) ? item.excluded : [],
      }
    }),
  }
  try {
    return { data: Schema.decodeUnknownSync(ReportBody)(data) }
  } catch (err) {
    return { error: `The ULTRA_COUNCIL_REPORT JSON was invalid: ${String(err)}` }
  }
}

function adjudication(
  output: string,
  expected: ReadonlyMap<string, string>,
  expectedEdits: ReadonlyMap<string, string>,
): Parsed<Schema.Schema.Type<typeof AdjudicationBody>> {
  const parsed = structured(output, "ULTRA_COUNCIL_ADJUDICATION")
  if ("error" in parsed) return { error: parsed.error }
  if (!parsed.data || typeof parsed.data !== "object" || !("claims" in parsed.data)) {
    return { error: "The ULTRA_COUNCIL_ADJUDICATION JSON omitted claims." }
  }
  const body = parsed.data as Record<string, unknown>
  if (!Array.isArray(body.claims)) {
    return { error: "The ULTRA_COUNCIL_ADJUDICATION claims value was not an array." }
  }
  const data = {
    requestKind: body.requestKind,
    candidate:
      body.candidate && typeof body.candidate === "object"
        ? {
            ...(body.candidate as Record<string, unknown>),
            corrections: Array.isArray((body.candidate as Record<string, unknown>).corrections)
              ? (body.candidate as Record<string, unknown>).corrections
              : [],
          }
        : {},
    obligations: Array.isArray(body.obligations)
      ? body.obligations.map((value) => {
          const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
          return {
            ...item,
            claims: Array.isArray(item.claims) ? item.claims : [],
            evidence: steps(item.evidence, typeof item.id === "string" ? item.id : ""),
            corrections: Array.isArray(item.corrections) ? item.corrections : [],
            uncertainties: Array.isArray(item.uncertainties) ? item.uncertainties : [],
          }
        })
      : [],
    missing: Array.isArray(body.missing) ? body.missing : [],
    claims: body.claims.map((value) => {
      const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
      const id = typeof item.id === "string" ? item.id : ""
      const raw = typeof item.hash === "string" ? item.hash : ""
      const hash = expected.get(id)
      const repaired = hash && raw.length >= 16 && raw.length < 64 && hash.startsWith(raw) ? hash : raw
      return {
        ...item,
        id,
        hash: repaired,
        status: ["approved", "rejected", "unverified"].includes(String(item.status)) ? item.status : "unverified",
        evidence: steps(item.evidence, id),
        corrections: Array.isArray(item.corrections) ? item.corrections : [],
        uncertainties: Array.isArray(item.uncertainties) ? item.uncertainties : [],
      }
    }),
    edits: (Array.isArray(body.edits) ? body.edits : []).map((value) => {
      const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
      const id = typeof item.id === "string" ? item.id : ""
      const raw = typeof item.hash === "string" ? item.hash : ""
      const expected = expectedEdits.get(id)
      const repaired = expected && raw.length >= 16 && raw.length < 64 && expected.startsWith(raw) ? expected : raw
      return {
        ...item,
        id,
        hash: repaired,
        status: ["approved", "rejected", "unverified"].includes(String(item.status)) ? item.status : "unverified",
        corrections: Array.isArray(item.corrections) ? item.corrections : [],
        uncertainties: Array.isArray(item.uncertainties) ? item.uncertainties : [],
      }
    }),
    excluded: Array.isArray(body.excluded) ? body.excluded : [],
  }
  try {
    return { data: Schema.decodeUnknownSync(AdjudicationBody)(data) }
  } catch (err) {
    return { error: `The ULTRA_COUNCIL_ADJUDICATION JSON was invalid: ${String(err)}` }
  }
}

function digest(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

function hash(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

function unique(items: string[]) {
  return [...new Set(items)]
}

function claims(
  lens: UltraCouncil.Lens,
  index: number,
  body: Schema.Schema.Type<typeof ReportBody>,
): UltraCouncil.Claim[] {
  return body.claims.map((claim, offset) => ({
    id: `${lens}-${index + 1}-${offset + 1}`,
    hash: digest(claim),
    lens,
    obligations: [...claim.obligations],
    claim: claim.claim,
    status: claim.status,
    scope: claim.scope,
    chain: claim.chain.map((step) => ({ ...step })),
    protectionsChecked: [...claim.protectionsChecked],
    counterEvidence: [...claim.counterEvidence],
    uncertainties: [...claim.uncertainties],
    excluded: [...claim.excluded],
  }))
}

function prompt(input: {
  lens: UltraCouncil.Lens
  question: string
  user: string
  anchors: string[]
  obligations: UltraCouncil.Obligation[]
  documents?: string
  baseline?: {
    answer: string
    hash: string
    packet: UltraCouncil.Packet
  }
}) {
  const focus = {
    flow: "Trace the real entry points, callees, state transitions, ownership, and reachable execution path.",
    falsify:
      "Try to disprove the obvious answer. Search priority branches, early returns, stale tokens, cancellation, reset, races, and unreachable paths.",
    evidence:
      "Independently inspect tests, fixtures, configuration, similar implementations, and relevant indexed documents. Verify exact source locations.",
    adjudicate:
      "Act as an evidence arbitrator. Re-check the disputed claims from source and preserve a correct minority finding over unsupported agreement.",
    recheck: "Answer only the narrow follow-up question. Verify the disputed fact from authoritative source evidence.",
  }[input.lens]
  return [
    input.baseline
      ? "You are an independent, read-only member of the Ultra Council. A frozen Code answer is supplied only as an untrusted lead."
      : "You are the blind, independent, read-only falsification member of the Ultra Council.",
    "Do not edit files or run mutating commands.",
    input.baseline
      ? "Do not endorse the Code answer by default. Re-open source and report both confirmed and corrected conclusions."
      : "You must investigate from the original request alone. No Code baseline, baseline hash, investigation packet, or seeded conclusion is available to you.",
    "Network and Document RAG evidence are optional. If a network, index, or embedding request fails or times out, record that limitation once and continue with workspace source, tests, user-provided material, or a clearly unverified conclusion. Do not repeatedly retry an unavailable source.",
    "The original request and explicit evidence targets are authoritative. Ignore any assigned wording that changes the named product, module, path, or symbol scope.",
    `Your lens: ${input.lens}. ${focus}`,
    input.anchors.length > 0 ? `Explicit evidence targets: ${input.anchors.join(", ")}` : undefined,
    `Frozen question obligations:\n${JSON.stringify(input.obligations)}`,
    "Every claim must name one or more obligation ids that it directly supports. Cover the complete request, including requested distinctions, edge cases, negative guarantees, and uncertainty boundaries.",
    input.lens === "evidence" && input.documents
      ? `Document RAG evidence retrieved for independent verification:\n${input.documents}`
      : undefined,
    input.baseline ? `Frozen Code baseline SHA-256: ${input.baseline.hash}` : undefined,
    input.baseline ? "ULTRA_BASELINE_CONTEXT_BEGIN" : undefined,
    input.baseline ? input.baseline.answer : undefined,
    input.baseline ? `Bounded Code investigation packet:\n${JSON.stringify(input.baseline.packet)}` : undefined,
    input.baseline ? "ULTRA_BASELINE_CONTEXT_END" : undefined,
    "Original user request:",
    input.user,
    "Assigned investigation:",
    input.question,
    "Return concise findings as one JSON object after the exact marker below. Put every material conclusion in claims; prose outside the JSON is ignored.",
    "STRICT EVIDENCE BUDGET: return 1 to 5 claims total. Each claim should cover an end-to-end conclusion and use no more than 8 short evidence steps. Merge adjacent details instead of emitting more than 5 claims. Before responding, count the claims and verify every enum value against the template.",
    "ULTRA_COUNCIL_REPORT",
    JSON.stringify({
      claims: [
        {
          obligations: ["<frozen obligation id>"],
          claim: "<exact conclusion>",
          status: "verified|inferred|unverified",
          scope: "local|execution|system|external",
          chain: [
            {
              kind: "workspace|document|user|url|observation|derived",
              role: "entry|guard|call|state|outcome|fact|counterexample",
              logic: "<how this step supports or challenges the claim>",
              path: "<workspace path when kind=workspace>",
              line: 1,
              symbol: "<symbol when applicable>",
              source: "<document id, URL, command, or expression when applicable>",
              excerpt: "<short exact excerpt>",
            },
          ],
          protectionsChecked: ["<guard, ordering rule, ownership rule, or none because scope is local>"],
          counterEvidence: ["<counterexample checked and result, or none because scope is local>"],
          uncertainties: ["<remaining uncertainty or none>"],
          excluded: ["<area searched and ruled out>"],
        },
      ],
    }),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n\n")
}

function budget(output: string) {
  const chunks = output.split(/(?=## Council report \d+:)/).filter(Boolean)
  return chunks
    .map((chunk) => {
      if (chunk.length <= 20_000) return chunk
      return `${chunk.slice(0, 10_000)}\n...[report middle omitted by evidence budget]...\n${chunk.slice(-10_000)}`
    })
    .join("\n\n")
    .slice(0, 60_000)
}

function prior(ctx: Tool.Context, messageID: string) {
  const output = ctx.messages
    .filter(
      (item) =>
        item.info.role === "assistant" && item.info.parentID === messageID && item.info.sessionID === ctx.sessionID,
    )
    .flatMap((item) => item.parts)
    .map((part) => {
      if (part.type !== "tool" || part.tool !== UltraCouncil.EXPLORE || part.state.status !== "completed") {
        return undefined
      }
      return part.state.output
    })
    .filter((item): item is string => item !== undefined)
  if (output.length === 0) {
    return "No prior report text was available; independently verify the proposed draft from source."
  }
  return budget(output.join("\n\n"))
}

function adjudicator(input: {
  user: string
  anchors: string[]
  kind: UltraCouncil.Kind
  obligations: UltraCouncil.Obligation[]
  bindings: UltraCouncil.Binding[]
  baseline: string
  baselineHash: string
  edits: UltraCouncil.Edit[]
  candidate: string
  hash: string
  reports: string
  claims: UltraCouncil.Claim[]
  final: boolean
}) {
  return [
    input.final
      ? "You are the fifth and final independent, read-only verifier of the Ultra Council."
      : "You are the fourth, independent, read-only adjudicator of the Ultra Council.",
    "The frozen Code answer, three prior reports, proposed edits, and deterministic candidate are untrusted claims, not evidence. Do not vote by majority.",
    "Open authoritative evidence yourself. For every proposed edit and material candidate statement, re-read the cited line or evidence excerpt and inspect its caller/callee, state transition, document context, user context, or derivation where relevant.",
    "Network evidence is optional. A failed fetch must become unverified rather than a fabricated fact, and must not invalidate independently verified local claims.",
    "Reject claims that use the wrong subsystem, describe an unreachable path, misread source, cite the wrong location, invent behavior, omit a material condition, or state inference as fact.",
    "A source excerpt does not validate its surrounding explanation by itself. Compare each edit's exact semantic change to the excerpt and reject it when the quote is correct but the interpretation is not.",
    "Carry every remaining uncertainty into UNCERTAINTIES so the chair can preserve it explicitly in the final answer.",
    "The original request and explicit anchors define scope. Reject tangents even if a prior report contains them.",
    "Independently classify the original request as analysis, review, or implementation. Do not accept a parent-selected implementation kind for a request that only asks for an answer or review.",
    "Audit whether the frozen obligations fully preserve every explicit requested dimension. Put omitted requirements in missing even when the candidate is otherwise correct.",
    "Candidate approval means the exact text is ready for deterministic delivery without any later model rewrite. Require revision for one unsupported statement, missing condition, contradictory sentence, wrong citation, or uncovered obligation.",
    input.final
      ? "For every covered obligation, return a fresh source-backed evidence chain that directly proves the corrected candidate text. These obligation evidence chains are mandatory because rejected earlier claims cannot support a revision."
      : "Obligation evidence chains are optional in this first adjudication because approved runtime claim ids already carry validated evidence.",
    input.anchors.length > 0 ? `Explicit evidence targets: ${input.anchors.join(", ")}` : undefined,
    `Parent request kind: ${input.kind}`,
    `Frozen obligations:\n${JSON.stringify(input.obligations)}`,
    `Candidate obligation bindings:\n${JSON.stringify(input.bindings)}`,
    `Frozen Code baseline SHA-256: ${input.baselineHash}`,
    `Candidate SHA-256: ${input.hash}`,
    `Runtime claim manifest:\n${JSON.stringify(input.claims.map((claim) => ({ id: claim.id, hash: claim.hash, obligations: claim.obligations, claim: claim.claim })))}`,
    `Runtime edit manifest:\n${JSON.stringify(input.edits)}`,
    "Original user request:",
    input.user,
    "Frozen Code answer:",
    "<code-baseline>",
    input.baseline,
    "</code-baseline>",
    "Runtime-built candidate after applying every proposed edit:",
    "<proposed-candidate>",
    input.candidate,
    "</proposed-candidate>",
    "Prior independent reports, supplied only as leads:",
    "<untrusted-reports>",
    input.reports,
    "</untrusted-reports>",
    "Return one JSON object after the exact marker. Cover every frozen obligation and every runtime claim id/hash exactly once; prose outside the JSON is ignored.",
    "ULTRA_COUNCIL_ADJUDICATION",
    JSON.stringify({
      requestKind: "analysis|review|implementation",
      candidate: {
        hash: "<exact Candidate SHA-256>",
        status: "approved|revision",
        corrections: ["<exact candidate correction or none>"],
      },
      obligations: [
        {
          id: "<frozen obligation id>",
          status: "covered|missing|conflicted",
          claims: ["<approved runtime claim id supporting this obligation>"],
          evidence: [
            {
              kind: "workspace|document|user|url|observation|derived",
              role: "entry|guard|call|state|outcome|fact|counterexample",
              logic: "<how this evidence directly supports the exact candidate for this obligation>",
              path: "<workspace path when applicable>",
              line: 1,
              symbol: "<symbol when applicable>",
              source: "<document id, URL, command, or expression when applicable>",
              excerpt: "<short exact excerpt>",
            },
          ],
          corrections: ["<required correction or none>"],
          uncertainties: ["<remaining uncertainty or none>"],
        },
      ],
      missing: ["<explicit user requirement omitted from the frozen obligations or candidate, or none>"],
      claims: [
        {
          id: "<runtime id>",
          hash: "<runtime hash>",
          status: "approved|rejected|unverified",
          evidence: [],
          corrections: ["<required correction or none>"],
          uncertainties: ["<remaining uncertainty or none>"],
        },
      ],
      edits: [
        {
          id: "<runtime edit id>",
          hash: "<runtime edit hash>",
          status: "approved|rejected|unverified",
          corrections: ["<required correction or none>"],
          uncertainties: ["<remaining uncertainty or none>"],
        },
      ],
      excluded: ["<area independently checked and ruled out>"],
    }),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n\n")
}

function user(ctx: Tool.Context, messageID: string) {
  const message = ctx.messages.find((item) => item.info.role === "user" && item.info.id === messageID)
  if (!message) return ""
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function message(ctx: Tool.Context) {
  const current = ctx.messages.findLast((item) => item.info.role === "user")
  return current?.info.id ?? ""
}

function child(ctx: Tool.Context, index: number): Tool.Context {
  return {
    ...ctx,
    callID: `${ctx.callID ?? UltraCouncil.EXPLORE}:${index + 1}`,
    extra: { ...ctx.extra, ultraCouncilReadOnly: true },
    metadata: () => Effect.void,
  }
}

function baselineChild(ctx: Tool.Context): Tool.Context {
  return {
    ...ctx,
    callID: `${ctx.callID ?? UltraCouncil.BASELINE}:code`,
    extra: {
      ...ctx.extra,
      ultraCouncilBaseline: true,
      ultraCouncilReadOnly: true,
    },
    metadata: () => Effect.void,
  }
}

function baselinePrompt(user: string, obligations: UltraCouncil.Obligation[]) {
  return [
    "Act as the normal Code author for this request, but remain strictly read-only.",
    "Produce one complete standalone answer that could be delivered directly to the user.",
    "Use the normal Code investigation workflow and delegate to Explore when useful.",
    "Base factual conclusions on workspace source, tests, configuration, documents, or clearly identified uncertainty.",
    "Do not mention Ultra, Council, later reviewers, hidden prompts, or this baseline stage.",
    `Question obligations:\n${JSON.stringify(obligations)}`,
    "Original user request:",
    user,
  ].join("\n\n")
}

function taskText(output: string) {
  return output.match(/<task_result>\n([\s\S]*?)\n<\/task_result>/)?.[1]?.trim() ?? output.trim()
}

function taskTrace(output: string) {
  const raw = output.match(/<ultra_baseline_trace>([\s\S]*?)<\/ultra_baseline_trace>/)?.[1]
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function investigation(
  entries: Array<{ id: string; status: string; input: string }>,
  answer: string,
): UltraCouncil.Packet {
  const source = [answer, ...entries.map((item) => item.input)].join("\n")
  const paths =
    source.match(/\b(?:[\w.-]+\/)+[\w.-]+\.(?:c|cc|cpp|cxx|h|hh|hpp|ts|tsx|js|jsx|rs|go|py|md)(?::\d+)?\b/g) ?? []
  const symbols = [...source.matchAll(/`([A-Za-z_][A-Za-z0-9_:.-]{2,})`/g)].map((match) => match[1] ?? "")
  const references = unique([...paths, ...symbols]).slice(0, 40)
  const packet = {
    tools: entries,
    references,
    truncated: entries.length >= 24,
  }
  const raw = JSON.stringify(packet)
  if (raw.length <= 16_000) return packet
  return {
    tools: entries.slice(0, 12),
    references: references.slice(0, 24),
    truncated: true,
  }
}

function review(
  task: Task,
  input: {
    ctx: Tool.Context
    turn: UltraCouncil.State
    user: string
    bindings: UltraCouncil.Binding[]
    reports: string
    documents?: string
    final?: boolean
  },
) {
  return task
    .execute(
      {
        description: "Council adjudicate",
        prompt: adjudicator({
          user: input.user,
          anchors: input.turn.anchors,
          kind: input.turn.kind ?? "analysis",
          obligations: input.turn.obligations,
          bindings: input.bindings,
          baseline: input.turn.baseline ?? "",
          baselineHash: input.turn.baselineHash ?? "",
          edits: input.turn.edits,
          candidate: input.turn.candidate ?? input.turn.baseline ?? "",
          hash: input.turn.proposalHash ?? "",
          reports: input.reports,
          claims: input.turn.claims,
          final: input.final === true,
        }),
        subagent_type: "explore",
        background: false,
      },
      child(input.ctx, input.turn.started - 1),
    )
    .pipe(
      Effect.flatMap((value) =>
        Effect.gen(function* () {
          const expected = new Map(input.turn.claims.map((claim) => [claim.id, claim.hash]))
          const expectedEdits = new Map(input.turn.edits.map((edit) => [edit.id, edit.hash]))
          const parsed = adjudication(value.output, expected, expectedEdits)
          if ("error" in parsed) {
            return {
              output: value.output,
              reason: parsed.error,
              decisions: [] as UltraCouncil.Decision[],
              edits: [] as UltraCouncil.EditDecision[],
              review: undefined,
              session:
                "sessionId" in value.metadata && typeof value.metadata.sessionId === "string"
                  ? value.metadata.sessionId
                  : undefined,
            }
          }
          const source = new Map(input.turn.claims.map((claim) => [claim.id, claim]))
          const actual = new Map(parsed.data.claims.map((claim) => [claim.id, claim.hash]))
          const missing = [...expected].filter(([id, hash]) => actual.get(id) !== hash).map(([id]) => id)
          const extra = [...actual].filter(([id, hash]) => expected.get(id) !== hash).map(([id]) => id)
          const actualEdits = new Map(parsed.data.edits.map((edit) => [edit.id, edit.hash]))
          const missingEdits = [...expectedEdits].filter(([id, hash]) => actualEdits.get(id) !== hash).map(([id]) => id)
          const extraEdits = [...actualEdits].filter(([id, hash]) => expectedEdits.get(id) !== hash).map(([id]) => id)
          const decisions = yield* Effect.forEach(
            parsed.data.claims,
            (claim) =>
              Effect.gen(function* () {
                if (claim.status !== "approved") return claim
                const errors = yield* validateSteps(claim.evidence, {
                  user: input.user,
                  documents: input.documents,
                })
                if (claim.evidence.length > 0 && errors.length === 0) return claim
                const fallback = source.get(claim.id)
                if (fallback && fallback.status !== "unverified" && fallback.chain.length > 0) {
                  return {
                    ...claim,
                    evidence: fallback.chain.map((step) => ({ ...step })),
                    corrections: [
                      ...claim.corrections,
                      "Runtime replaced malformed adjudicator evidence with the report's already validated source chain.",
                    ].slice(0, 10),
                  }
                }
                return {
                  ...claim,
                  status: "unverified" as const,
                  evidence: [],
                  uncertainties: [
                    ...claim.uncertainties,
                    ...(errors.length > 0
                      ? errors
                      : [`Approved claim lacks independently checked evidence: ${claim.id}`]),
                  ].slice(0, 10),
                }
              }),
            { concurrency: 8 },
          )
          const errors = [
            ...(missing.length > 0 ? [`Adjudication omitted or changed claims: ${missing.join(", ")}`] : []),
            ...(extra.length > 0 ? [`Adjudication added unknown claims: ${extra.join(", ")}`] : []),
            ...(missingEdits.length > 0 ? [`Adjudication omitted or changed edits: ${missingEdits.join(", ")}`] : []),
            ...(extraEdits.length > 0 ? [`Adjudication added unknown edits: ${extraEdits.join(", ")}`] : []),
          ]
          const expectedObligations = new Set(input.turn.obligations.map((item) => item.id))
          const actualObligations = new Set(parsed.data.obligations.map((item) => item.id))
          const omittedObligations = [...expectedObligations].filter((id) => !actualObligations.has(id))
          const addedObligations = [...actualObligations].filter((id) => !expectedObligations.has(id))
          if (omittedObligations.length > 0) {
            errors.push(`Adjudication omitted obligations: ${omittedObligations.join(", ")}`)
          }
          if (addedObligations.length > 0) {
            errors.push(`Adjudication added unknown obligations: ${addedObligations.join(", ")}`)
          }
          const ids = new Set(input.turn.claims.map((claim) => claim.id))
          const badCoverage = parsed.data.obligations.flatMap((item) =>
            item.claims.filter((id) => !ids.has(id)).map((id) => `${item.id}:${id}`),
          )
          if (badCoverage.length > 0) {
            errors.push(`Adjudication obligation coverage references unknown claims: ${badCoverage.join(", ")}`)
          }
          const coverage = yield* Effect.forEach(
            parsed.data.obligations,
            (item) =>
              Effect.gen(function* () {
                const checked = yield* Effect.forEach(
                  item.evidence,
                  (step) =>
                    validateSteps([step], {
                      user: input.user,
                      documents: input.documents,
                    }).pipe(Effect.map((issues) => ({ step, issues }))),
                  { concurrency: 8 },
                )
                const evidence = checked.filter((entry) => entry.issues.length === 0).map((entry) => entry.step)
                const issues = checked.flatMap((entry) => entry.issues)
                if (!input.final || evidence.length > 0) {
                  return {
                    ...item,
                    evidence,
                    uncertainties: [...item.uncertainties, ...issues].slice(0, 10),
                  }
                }
                return {
                  ...item,
                  status: "missing" as const,
                  evidence,
                  corrections: [
                    ...item.corrections,
                    "The final verifier did not provide a runtime-valid evidence chain for this obligation.",
                  ].slice(0, 10),
                  uncertainties: [...item.uncertainties, ...issues].slice(0, 10),
                }
              }),
            { concurrency: 8 },
          )
          return {
            output: value.output,
            reason: errors[0],
            decisions: decisions.map((claim) => ({
              ...claim,
              evidence: claim.evidence.map((step) => ({ ...step })),
              corrections: [...claim.corrections],
              uncertainties: [...claim.uncertainties],
            })),
            edits: parsed.data.edits.map((edit) => ({
              id: edit.id,
              hash: edit.hash,
              status: edit.status,
              corrections: [...edit.corrections],
              uncertainties: [...edit.uncertainties],
            })),
            review: {
              kind: parsed.data.requestKind,
              candidateHash: parsed.data.candidate.hash,
              status: parsed.data.candidate.status,
              obligations: coverage.map((item) => ({
                id: item.id,
                status: item.status,
                claims: [...item.claims],
                evidence: item.evidence.map((step) => ({ ...step })),
                corrections: [...item.corrections],
                uncertainties: [...item.uncertainties],
              })),
              missing: [...parsed.data.missing],
              corrections: [...parsed.data.candidate.corrections],
            } satisfies UltraCouncil.Review,
            session:
              "sessionId" in value.metadata && typeof value.metadata.sessionId === "string"
                ? value.metadata.sessionId
                : undefined,
          }
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.succeed({
          output: "",
          reason: Cause.pretty(cause),
          decisions: [] as UltraCouncil.Decision[],
          edits: [] as UltraCouncil.EditDecision[],
          review: undefined,
          session: undefined,
        }),
      ),
    )
}

type Step = Schema.Schema.Type<typeof Evidence>

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function validateSteps(entries: readonly Step[], input: { user: string; documents?: string }) {
  return Effect.gen(function* () {
    const root = yield* Effect.promise(() => realpath(Instance.directory))
    const errors = yield* Effect.forEach(
      entries,
      (item) =>
        Effect.gen(function* () {
          if (item.kind === "user") {
            if (!item.excerpt || !compact(input.user).includes(compact(item.excerpt))) {
              return `User evidence excerpt was not found in the current request: ${item.logic}`
            }
            return undefined
          }
          if (item.kind === "document") {
            if (!item.source || !item.excerpt)
              return `Document evidence needs a source and exact excerpt: ${item.logic}`
            if (!input.documents || !compact(input.documents).includes(compact(item.excerpt))) {
              return `Document evidence excerpt was not found in the retrieved evidence pack: ${item.source}`
            }
            return undefined
          }
          if (item.kind === "url") {
            if (!item.source || !item.excerpt) return `URL evidence needs a source and exact excerpt: ${item.logic}`
            try {
              const url = new URL(item.source)
              if (url.protocol === "http:" || url.protocol === "https:") return undefined
            } catch {
              return `URL evidence must use an absolute HTTP(S) URL: ${item.source}`
            }
            return `URL evidence must use an absolute HTTP(S) URL: ${item.source}`
          }
          if (item.kind === "observation" || item.kind === "derived") {
            if (!item.source || !item.excerpt) {
              return `${item.kind} evidence needs a command/expression source and result excerpt: ${item.logic}`
            }
            return undefined
          }
          if (!item.path) return `Workspace evidence must identify a path: ${item.logic}`
          if (!item.line && !item.symbol) {
            return `Workspace evidence must include a line or symbol: ${item.path}`
          }
          const file = path.resolve(Instance.directory, item.path)
          if (!(yield* Effect.promise(() => Bun.file(file).exists())))
            return `Evidence path does not exist: ${item.path}`
          const actual = yield* Effect.promise(() => realpath(file))
          const resolved = path.relative(root, actual)
          if (resolved.startsWith("..") || path.isAbsolute(resolved)) {
            return `Evidence symlink escapes the workspace: ${item.path}`
          }
          const source = yield* Effect.promise(() => Bun.file(actual).text())
          const lines = source.split(/\r?\n/)
          if (item.line && item.line > lines.length) {
            return `Evidence line is outside ${item.path}: ${item.line}`
          }
          if (item.symbol && !source.includes(item.symbol)) {
            return `Evidence symbol was not found in ${item.path}: ${item.symbol}`
          }
          const points = item.line
            ? [item.line - 1]
            : lines.flatMap((line, index) => (item.symbol && line.includes(item.symbol) ? [index] : []))
          if (item.line && item.symbol) {
            const window = lines.slice(Math.max(0, item.line - 9), item.line + 8).join("\n")
            if (!window.includes(item.symbol)) {
              return `Evidence symbol was not found near ${item.path}:${item.line}: ${item.symbol}`
            }
          }
          const attached = (() => {
            if (item.excerpt?.trim()) return item.excerpt
            const point =
              points.find((index) => {
                const line = lines[index]?.trim()
                return Boolean(line && (!item.symbol || line.includes(item.symbol)))
              }) ??
              (item.symbol
                ? lines.findIndex(
                    (line, index) =>
                      line.includes(item.symbol!) && (!item.line || Math.abs(index - (item.line - 1)) <= 8),
                  )
                : -1)
            const excerpt = point >= 0 ? lines[point]?.trim() : undefined
            return excerpt
          })()
          if (!attached) {
            return `Workspace evidence must include an exact source excerpt: ${item.path}:${item.line ?? item.symbol}`
          }
          const excerpt = compact(attached)
          const found = points.some((point) => {
            const window = lines.slice(Math.max(0, point - 8), point + 9).join("\n")
            return compact(window).includes(excerpt)
          })
          if (excerpt.length < 4 || !found) {
            return `Evidence excerpt was not found near ${item.path}:${item.line ?? item.symbol}; copy one short contiguous source excerpt verbatim without ellipses, comments, or paraphrase`
          }
          return undefined
        }),
      { concurrency: 8 },
    )
    return errors.filter((item): item is string => item !== undefined)
  })
}

function validateReport(
  items: readonly Schema.Schema.Type<typeof ReportClaim>[],
  input: { user: string; obligations: UltraCouncil.Obligation[]; documents?: string },
) {
  return Effect.gen(function* () {
    const obligations = new Set(input.obligations.map((item) => item.id))
    const checked = yield* Effect.forEach(
      items,
      (claim) =>
        Effect.gen(function* () {
          const checked = yield* Effect.forEach(
            claim.chain,
            (step) => validateSteps([step], input).pipe(Effect.map((errors) => ({ step, errors }))),
            { concurrency: 8 },
          )
          const chain = checked.filter((item) => item.errors.length === 0).map((item) => item.step)
          const dropped = checked.flatMap((item) => item.errors)
          const errors = [...dropped]
          const unknown = claim.obligations.filter((id) => !obligations.has(id))
          if (unknown.length > 0) errors.push(`Claim references unknown obligations: ${unknown.join(", ")}`)
          if (claim.status !== "unverified" && chain.length === 0) {
            errors.push(`Evidence-bearing claim has no evidence chain: ${claim.claim}`)
          }
          const structural: string[] = []
          if (claim.status === "verified" && (claim.scope === "execution" || claim.scope === "system")) {
            const roles = new Set(chain.map((step) => step.role))
            if (chain.length < 2 || roles.size < 2) {
              structural.push(
                `Verified ${claim.scope} claim must include at least two distinct source-backed logic steps: ${claim.claim}`,
              )
            }
            if (claim.protectionsChecked.length === 0) {
              structural.push(`Verified ${claim.scope} claim must record protections checked: ${claim.claim}`)
            }
            if (claim.counterEvidence.length === 0) {
              structural.push(`Verified ${claim.scope} claim must record counterevidence checked: ${claim.claim}`)
            }
          }
          errors.push(...structural)
          if (errors.length === 0) return { claim, errors }
          if (claim.status !== "unverified" && chain.length > 0 && unknown.length === 0 && structural.length === 0) {
            return {
              claim: {
                ...claim,
                status: "inferred" as const,
                chain,
                uncertainties: [
                  ...claim.uncertainties,
                  "One or more proposed evidence steps failed runtime validation; the surviving source chain requires independent adjudication.",
                  ...dropped,
                ].slice(0, 10),
              },
              errors,
            }
          }
          return {
            claim: {
              ...claim,
              status: "unverified" as const,
              chain,
              uncertainties: [...claim.uncertainties, ...errors].slice(0, 10),
            },
            errors,
          }
        }),
      { concurrency: 8 },
    )
    return {
      claims: checked.map((item) => item.claim),
      errors: checked.flatMap((item) => item.errors),
    }
  })
}

function validateEvidence(
  input: Schema.Schema.Type<typeof ArbitrationParams>,
  ctx: { user: string; documents?: string },
) {
  return validateSteps(
    (input.claims ?? []).flatMap((claim) => claim.evidence),
    ctx,
  )
}

function covered(state: UltraCouncil.State, input: Schema.Schema.Type<typeof ArbitrationParams>) {
  const claims = (input.claims ?? []).filter((item) => item.status === "verified").flatMap((item) => item.evidence)
  const normalize = (value: string) => {
    const location = value
      .replaceAll("\\", "/")
      .replace(/^\.\//, "")
      .replace(/:\d+(?:-\d+)?$/, "")
    if (!path.isAbsolute(location)) return location
    return path.relative(Instance.directory, location).replaceAll("\\", "/")
  }
  return state.anchors.filter((anchor) => {
    const target = normalize(anchor)
    const direct = claims.some((item) => {
      const file = item.path ? normalize(item.path) : undefined
      return (
        file === target ||
        file?.startsWith(`${target}/`) ||
        item.symbol === anchor ||
        item.source === anchor ||
        item.source?.includes(anchor)
      )
    })
    return direct
  })
}

export function UltraCouncilTools(task: Task, document?: Tool.Def) {
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    const baseline = yield* Tool.define(
      UltraCouncil.BASELINE,
      Effect.succeed({
        description:
          "Freeze the mandatory read-only Code author answer before Ultra exploration. This baseline can be retried only for infrastructure or empty-output failure, never for answer quality.",
        parameters: BaselineParams,
        execute: (
          params: Schema.Schema.Type<typeof BaselineParams>,
          ctx: Tool.Context,
        ): Effect.Effect<Tool.ExecuteResult<BaselineMeta>> =>
          Effect.gen(function* () {
            const agent = yield* agents.get(ctx.agent)
            if (!agent || !UltraCouncil.active(agent)) {
              return {
                title: "Ultra Code baseline unavailable",
                metadata: { rejected: true },
                output: "This tool is available only to the native ChipMate Ultra agent.",
              }
            }
            const turn = UltraCouncil.load({
              sessionID: ctx.sessionID,
              messageID: message(ctx),
              messages: ctx.messages,
            })
            const configured = UltraCouncil.configure(turn, params.requestKind, [...params.obligations])
            if (configured) {
              return {
                title: "Ultra Code baseline rejected",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: configured,
              }
            }
            const denied = UltraCouncil.reserveBaseline(turn)
            if (denied) {
              return {
                title: "Ultra Code baseline rejected",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: denied,
              }
            }
            yield* ctx.metadata({
              title: "Ultra Code baseline",
              metadata: {
                rejected: false,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
            })
            const original = user(ctx, turn.messageID)
            const run = yield* task
              .execute(
                {
                  description: "Ultra Code baseline",
                  prompt: baselinePrompt(original, turn.obligations),
                  subagent_type: ULTRA_BASELINE,
                  background: false,
                },
                baselineChild(ctx),
              )
              .pipe(
                Effect.map((value) => ({ value })),
                Effect.catchCause((cause) => Effect.succeed({ error: Cause.pretty(cause) })),
              )
            if ("error" in run) {
              UltraCouncil.failBaseline(turn, `The read-only Code baseline failed: ${run.error}`)
              return {
                title: "Ultra Code baseline failed",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: UltraCouncil.reminder(turn),
              }
            }
            const answer = taskText(run.value.output)
            const id = typeof run.value.metadata.sessionId === "string" ? run.value.metadata.sessionId : undefined
            const parsed = taskTrace(run.value.output)
            const trace = Array.isArray(parsed)
              ? parsed
                  .filter(
                    (item): item is { id: string; status: string; input: string } =>
                      Boolean(item) &&
                      typeof item === "object" &&
                      typeof item.id === "string" &&
                      typeof item.status === "string" &&
                      typeof item.input === "string",
                  )
                  .slice(0, 24)
              : []
            const packet = investigation(trace, answer)
            const valid = UltraCouncil.recordBaseline(turn, {
              answer,
              packet,
              sessionID: id,
            })
            if (!valid) {
              return {
                title: "Ultra Code baseline empty",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: UltraCouncil.reminder(turn),
              }
            }
            return {
              title: "Ultra Code baseline frozen",
              metadata: {
                rejected: false,
                session: id,
                baselineHash: turn.baselineHash,
                packetHash: turn.packetHash,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
              output: [
                "ULTRA_CODE_BASELINE",
                JSON.stringify({
                  answer: turn.baseline,
                  packet: turn.packet,
                }),
              ].join("\n"),
            }
          }),
      }),
    )
    const explore = yield* Tool.define(
      UltraCouncil.EXPLORE,
      Effect.succeed({
        description:
          "Run the mandatory Ultra Council investigations. The initial wave must contain flow, falsify, and evidence exactly once; each follow-up wave contains exactly one targeted investigation. After three valid reports, draft the exact proposed answer and submit it separately to the independent adjudicator.",
        parameters: ExploreParams,
        execute: (
          params: Schema.Schema.Type<typeof ExploreParams>,
          ctx: Tool.Context,
        ): Effect.Effect<Tool.ExecuteResult<ExploreMeta>> =>
          Effect.gen(function* () {
            const agent = yield* agents.get(ctx.agent)
            if (!agent || !UltraCouncil.active(agent)) {
              return {
                title: "Ultra Council unavailable",
                metadata: { rejected: true },
                output: "This tool is available only to the native ChipMate Ultra agent.",
              }
            }
            const turn = UltraCouncil.load({
              sessionID: ctx.sessionID,
              messageID: message(ctx),
              messages: ctx.messages,
            })
            if (params.phase === "initial") {
              const kind = params.requestKind ?? turn.kind
              const obligations = params.obligations ? [...params.obligations] : turn.obligations
              if (kind !== turn.kind || JSON.stringify(obligations) !== JSON.stringify(turn.obligations)) {
                return {
                  title: "Ultra Council request rejected",
                  metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                  output:
                    "The initial Council wave cannot change the request kind or obligations frozen by Code baseline.",
                }
              }
            }
            const before = turn.started
            const denied = UltraCouncil.reserve(
              turn,
              params.phase,
              params.investigations.map((item) => item.lens),
            )
            if (denied) {
              return {
                title: "Ultra Council request rejected",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: denied,
              }
            }
            yield* ctx.metadata({
              title: `Ultra Council ${params.phase} wave`,
              metadata: {
                rejected: false,
                started: params.investigations.length,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
            })
            const original = user(ctx, turn.messageID)
            const documents =
              document && params.phase === "initial" && params.investigations.some((item) => item.lens === "evidence")
                ? yield* document
                    .execute(
                      {
                        query: original,
                        maxResults: 8,
                        maxPackChars: 12_000,
                      },
                      child(ctx, params.investigations.length),
                    )
                    .pipe(
                      Effect.map((result) => result.output),
                      Effect.timeoutOrElse({
                        duration: "15 seconds",
                        orElse: () =>
                          Effect.succeed(
                            "Document search was unavailable: the bounded 15-second Council evidence lookup timed out. Continue with local evidence and do not retry it in this wave.",
                          ),
                      }),
                      Effect.catchCause((cause) =>
                        Effect.succeed(`Document search was unavailable: ${Cause.pretty(cause)}`),
                      ),
                    )
                : turn.documents
            turn.documents = documents
            const reports = yield* Effect.forEach(
              params.investigations,
              (item, index) =>
                task
                  .execute(
                    {
                      description: `Council ${item.lens}`,
                      prompt: prompt({
                        lens: item.lens,
                        question: item.question,
                        user: original,
                        anchors: turn.anchors,
                        obligations: turn.obligations,
                        documents,
                        baseline:
                          item.lens === "falsify" || !turn.baseline || !turn.baselineHash || !turn.packet
                            ? undefined
                            : {
                                answer: turn.baseline,
                                hash: turn.baselineHash,
                                packet: turn.packet,
                              },
                      }),
                      subagent_type: "explore",
                      background: false,
                    },
                    child(ctx, index),
                  )
                  .pipe(
                    Effect.flatMap((result) =>
                      Effect.gen(function* () {
                        const parsed = report(result.output)
                        if ("error" in parsed) {
                          return {
                            lens: item.lens,
                            question: item.question,
                            valid: false,
                            reason: parsed.error,
                            sessionID:
                              typeof result.metadata.sessionId === "string" ? result.metadata.sessionId : undefined,
                            output: result.output,
                            claims: [],
                          } satisfies UltraCouncil.Report
                        }
                        const checked = yield* validateReport(parsed.data.claims, {
                          user: original,
                          obligations: turn.obligations,
                          documents,
                        })
                        const body = { claims: checked.claims }
                        const valid = checked.claims.some(
                          (claim) => claim.status !== "unverified" && claim.chain.length > 0,
                        )
                        const reason =
                          checked.errors.length > 0
                            ? checked.errors.slice(0, 6).join(" | ")
                            : "The report returned no source-backed claim after validation."
                        return {
                          lens: item.lens,
                          question: item.question,
                          valid,
                          reason: !valid
                            ? reason
                            : checked.errors.length > 0
                              ? `${checked.errors.length} evidence issue(s) were removed; surviving source-backed claims were preserved as inferred for independent adjudication.`
                              : undefined,
                          sessionID:
                            typeof result.metadata.sessionId === "string" ? result.metadata.sessionId : undefined,
                          output: result.output,
                          claims: valid ? claims(item.lens, before + index, body) : [],
                        } satisfies UltraCouncil.Report
                      }),
                    ),
                    Effect.catchCause((cause) =>
                      Effect.succeed({
                        lens: item.lens,
                        question: item.question,
                        valid: false,
                        reason: Cause.pretty(cause),
                        sessionID: undefined,
                        output: "",
                        claims: [],
                      } satisfies UltraCouncil.Report),
                    ),
                  ),
              { concurrency: "unbounded" },
            )
            UltraCouncil.record(turn, reports)
            const sessions = reports.map((item) => item.sessionID).filter((item): item is string => item !== undefined)
            return {
              title: `Ultra Council ${params.phase} wave`,
              metadata: {
                rejected: false,
                started: turn.started - before,
                valid: reports.filter((item) => item.valid).length,
                sessions,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
              output: reports
                .map((item, index) =>
                  [
                    `## Council report ${index + 1}: ${item.lens} (${item.valid ? "valid" : "invalid"})`,
                    item.reason ? `Validation: ${item.reason}` : undefined,
                    item.output,
                    item.valid
                      ? `RUNTIME_CLAIM_MANIFEST: ${JSON.stringify(item.claims.map((claim) => ({ id: claim.id, hash: claim.hash, obligations: claim.obligations, claim: claim.claim })))}`
                      : undefined,
                  ]
                    .filter((line): line is string => line !== undefined)
                    .join("\n"),
                )
                .join("\n\n"),
            }
          }),
      }),
    )

    const adjudicate = yield* Tool.define(
      UltraCouncil.ADJUDICATE,
      Effect.succeed({
        description:
          "Submit exact evidence-backed edits against the frozen Code answer. The fourth independent Explore adjudicator re-opens source and approves or rejects each edit before runtime applies it.",
        parameters: AdjudicationParams,
        execute: (
          params: Schema.Schema.Type<typeof AdjudicationParams>,
          ctx: Tool.Context,
        ): Effect.Effect<Tool.ExecuteResult<AdjudicationMeta>> =>
          Effect.gen(function* () {
            const agent = yield* agents.get(ctx.agent)
            if (!agent || !UltraCouncil.active(agent)) {
              return {
                title: "Ultra adjudication unavailable",
                metadata: { rejected: true },
                output: "This tool is available only to the native ChipMate Ultra agent.",
              }
            }
            const turn = UltraCouncil.load({
              sessionID: ctx.sessionID,
              messageID: message(ctx),
              messages: ctx.messages,
            })
            const expected = new Map(turn.claims.map((claim) => [claim.id, claim.hash]))
            const actual = new Map((params.claims ?? []).map((claim) => [claim.id, claim.hash]))
            const omitted = params.claims
              ? [...expected].filter(([id, hash]) => actual.get(id) !== hash).map(([id]) => id)
              : []
            const added = params.claims
              ? [...actual].filter(([id, hash]) => expected.get(id) !== hash).map(([id]) => id)
              : []
            if (omitted.length > 0 || added.length > 0) {
              return {
                title: "Ultra adjudication manifest rejected",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: [
                  omitted.length > 0 ? `Include the unchanged runtime claims: ${omitted.join(", ")}` : undefined,
                  added.length > 0 ? `Remove unknown or changed claims: ${added.join(", ")}` : undefined,
                ]
                  .filter((line): line is string => line !== undefined)
                  .join("\n"),
              }
            }
            const bindings = params.bindings.map((item) => ({
              obligation: item.obligation,
              claims: [...item.claims],
            }))
            const edits = params.edits.map((edit) => ({
              kind: edit.kind,
              anchor: edit.anchor,
              text: edit.text,
              obligations: [...edit.obligations],
              claims: edit.claims.map((claim) => ({ id: claim.id, hash: claim.hash })),
              reason: edit.reason,
            }))
            const denied = UltraCouncil.reserveAdjudication(turn, params.baselineHash, edits, bindings)
            if (denied) {
              return {
                title: "Ultra adjudication rejected",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: denied,
              }
            }
            yield* ctx.metadata({
              title: "Ultra Council independent adjudication",
              metadata: {
                rejected: false,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
            })
            const original = user(ctx, turn.messageID)
            const result = yield* review(task, {
              ctx,
              turn,
              user: original,
              bindings,
              reports: prior(ctx, turn.messageID),
              documents: turn.documents,
            })
            UltraCouncil.recordAdjudication(turn, {
              valid: result.reason === undefined,
              decisions: result.decisions,
              edits: result.edits,
              review: result.review,
            })
            return {
              title: result.reason ? "Ultra Council adjudication invalid" : "Ultra Council adjudication complete",
              metadata: {
                rejected: result.reason !== undefined,
                valid: result.reason === undefined,
                session: result.session,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
              output: result.reason ? `Independent adjudication failed validation: ${result.reason}` : result.output,
            }
          }),
      }),
    )

    const revise = yield* Tool.define(
      UltraCouncil.REVISE,
      Effect.succeed({
        description:
          "Submit one corrected complete edit set against the same frozen Code answer. The fifth independent verifier reviews the runtime-built exact candidate; failure falls back to previously approved edits.",
        parameters: AdjudicationParams,
        execute: (
          params: Schema.Schema.Type<typeof AdjudicationParams>,
          ctx: Tool.Context,
        ): Effect.Effect<Tool.ExecuteResult<RevisionMeta>> =>
          Effect.gen(function* () {
            const agent = yield* agents.get(ctx.agent)
            if (!agent || !UltraCouncil.active(agent)) {
              return {
                title: "Ultra revision unavailable",
                metadata: { rejected: true },
                output: "This tool is available only to the native ChipMate Ultra agent.",
              }
            }
            const turn = UltraCouncil.load({
              sessionID: ctx.sessionID,
              messageID: message(ctx),
              messages: ctx.messages,
            })
            const expected = new Map(turn.claims.map((claim) => [claim.id, claim.hash]))
            const actual = new Map((params.claims ?? []).map((claim) => [claim.id, claim.hash]))
            const changed = params.claims
              ? [
                  ...[...expected].filter(([id, value]) => actual.get(id) !== value).map(([id]) => id),
                  ...[...actual].filter(([id, value]) => expected.get(id) !== value).map(([id]) => id),
                ]
              : []
            if (changed.length > 0) {
              return {
                title: "Ultra revision manifest rejected",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: `The revision changed or omitted runtime claims: ${unique(changed).join(", ")}`,
              }
            }
            const bindings = params.bindings.map((item) => ({
              obligation: item.obligation,
              claims: [...item.claims],
            }))
            const edits = params.edits.map((edit) => ({
              kind: edit.kind,
              anchor: edit.anchor,
              text: edit.text,
              obligations: [...edit.obligations],
              claims: edit.claims.map((claim) => ({ id: claim.id, hash: claim.hash })),
              reason: edit.reason,
            }))
            const denied = UltraCouncil.reserveRevision(turn, params.baselineHash, edits, bindings)
            if (denied) {
              return {
                title: "Ultra revision rejected",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: denied,
              }
            }
            yield* ctx.metadata({
              title: "Ultra Council final verification",
              metadata: {
                rejected: false,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
            })
            const original = user(ctx, turn.messageID)
            const result = yield* review(task, {
              ctx,
              turn,
              user: original,
              bindings,
              reports: prior(ctx, turn.messageID),
              documents: turn.documents,
              final: true,
            })
            UltraCouncil.recordRevision(turn, {
              valid: result.reason === undefined,
              decisions: result.decisions,
              edits: result.edits,
              review: result.review,
            })
            return {
              title: turn.phase === "sealed" ? "Ultra Council answer sealed" : "Ultra Council revision limited",
              metadata: {
                rejected: turn.phase !== "sealed",
                valid: result.reason === undefined,
                session: result.session,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
              output: result.reason
                ? `Independent final verification failed validation: ${result.reason}`
                : UltraCouncil.reminder(turn),
            }
          }),
      }),
    )

    const arbitrate = yield* Tool.define(
      UltraCouncil.ARBITRATE,
      Effect.succeed({
        description:
          "Submit the Ultra chair's adjudicated evidence matrix. Preserve every runtime claim id and hash. Workspace excerpt fields must be short contiguous verbatim excerpts without ellipses or paraphrase. Use decision=limited when authoritative evidence is unavailable; do not invent or vote by majority.",
        parameters: ArbitrationInput,
        execute: (
          params: Schema.Schema.Type<typeof ArbitrationInput>,
          ctx: Tool.Context,
        ): Effect.Effect<Tool.ExecuteResult<ArbitrationMeta>> =>
          Effect.gen(function* () {
            const agent = yield* agents.get(ctx.agent)
            if (!agent || !UltraCouncil.active(agent)) {
              return {
                title: "Ultra arbitration unavailable",
                metadata: { rejected: true },
                output: "This tool is available only to the native ChipMate Ultra agent.",
              }
            }
            const turn = UltraCouncil.load({
              sessionID: ctx.sessionID,
              messageID: message(ctx),
              messages: ctx.messages,
            })
            const limited = UltraCouncil.reserveArbitration(turn)
            if (limited) {
              return {
                title: "Ultra arbitration attempt limit reached",
                metadata: { rejected: true, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: UltraCouncil.reminder(turn),
              }
            }
            const parsed = yield* Effect.try({
              try: () => Schema.decodeUnknownSync(ArbitrationParams)(params.value ? JSON.parse(params.value) : params),
              catch: (err) => String(err),
            }).pipe(
              Effect.map((data) => ({ data })),
              Effect.catch((error) => Effect.succeed({ error })),
            )
            if ("error" in parsed) {
              return {
                title: "Ultra arbitration input rejected",
                metadata: { rejected: true, errors: [parsed.error], ultraCouncil: UltraCouncil.snapshot(turn) },
                output: `The wrapped arbitration JSON was invalid: ${parsed.error}`,
              }
            }
            const decisions = new Map(turn.decisions.map((decision) => [decision.id, decision]))
            const claims = turn.claims.map((claim) => {
              const decision = decisions.get(claim.id)
              return {
                id: claim.id,
                hash: claim.hash,
                claim: claim.claim,
                status:
                  decision?.status === "approved"
                    ? ("verified" as const)
                    : decision?.status === "rejected"
                      ? ("disputed" as const)
                      : ("unsupported" as const),
                evidence: decision?.evidence.map((step) => ({ ...step })) ?? [],
              }
            })
            const gaps = claims
              .filter((claim) => claim.status !== "verified")
              .map((claim) => `${claim.status} claim: ${claim.claim}`)
            const data = {
              ...parsed.data,
              decision: gaps.length > 0 ? ("limited" as const) : parsed.data.decision,
              claims,
              missingEvidence: [...new Set([...parsed.data.missingEvidence, ...gaps])].slice(0, 20),
            }
            const original = user(ctx, turn.messageID)
            const errors = yield* validateEvidence(data, { user: original, documents: turn.documents })
            const expected = new Map(turn.claims.map((claim) => [claim.id, claim]))
            const actual = new Map(data.claims.map((claim) => [claim.id, claim]))
            for (const [id, claim] of expected) {
              const item = actual.get(id)
              if (!item || item.hash !== claim.hash || item.claim !== claim.claim) {
                errors.push(`Arbitration omitted or changed runtime claim: ${id}`)
                continue
              }
              const decision = decisions.get(id)
              if (!decision || decision.hash !== claim.hash) {
                errors.push(`Arbitration claim lacks the matching adjudicator decision: ${id}`)
                continue
              }
              if (item.status === "verified" && decision.status !== "approved") {
                errors.push(`Only adjudicator-approved claims may be verified: ${id}`)
              }
              if (decision.status === "approved" && item.status !== "verified") {
                errors.push(`Approved claim was silently downgraded or omitted from the answer: ${id}`)
              }
              if (decision.status === "rejected" && item.status !== "disputed") {
                errors.push(`Rejected claim must remain disputed in arbitration: ${id}`)
              }
              if (decision.status === "unverified" && item.status !== "unsupported") {
                errors.push(`Unverified claim must remain unsupported in arbitration: ${id}`)
              }
            }
            for (const id of actual.keys()) {
              if (!expected.has(id)) errors.push(`Arbitration added a claim that was never investigated: ${id}`)
            }
            if (data.decision === "limited" && data.missingEvidence.length === 0) {
              errors.push("A limited decision must state the unavailable or missing evidence.")
            }
            if (errors.length > 0) {
              return {
                title: "Ultra arbitration evidence rejected",
                metadata: { rejected: true, errors, ultraCouncil: UltraCouncil.snapshot(turn) },
                output: `Correct these evidence errors before arbitration:\n${errors.map((item) => `- ${item}`).join("\n")}`,
              }
            }
            const coverage = covered(turn, data)
            const unresolved = data.claims
              .filter((item) => item.status !== "verified")
              .map((item) => `${item.status} claim: ${item.claim}`)
            const denied = UltraCouncil.submit(turn, {
              decision: data.decision,
              claims: data.claims.filter((item) => item.status === "verified").length,
              contradictions: [...data.contradictions],
              missing: [...data.missingEvidence],
              unresolved,
              followups: [...data.followups],
              covered: coverage,
            })
            return {
              title: denied ? "Ultra arbitration rejected" : `Ultra arbitration ${turn.phase}`,
              metadata: {
                rejected: denied !== undefined,
                ultraCouncil: UltraCouncil.snapshot(turn),
              },
              output: denied ?? UltraCouncil.reminder(turn),
            }
          }),
      }),
    )

    return { baseline, explore, adjudicate, revise, arbitrate }
  })
}
