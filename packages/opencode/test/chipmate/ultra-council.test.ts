import { beforeEach, describe, expect, test } from "bun:test"
import { UltraCouncil } from "../../src/chipmate/agent/ultra-council"
import { ChipMateTask } from "../../src/chipmate/tool/task"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

const sessionID = SessionID.make("ses_ultra_council")
const messageID = MessageID.make("msg_ultra_user")
const obligations = [
  { id: "O1", text: "Trace the reachable execution path." },
  { id: "O2", text: "Explain the completion and ownership boundary." },
]
const baseline = [
  "The Code baseline states target_symbol is defined in src/target.c.",
  "The completion boundary remains with the caller.",
  "The final paragraph is a unique insertion anchor.",
].join("\n")
const packet: UltraCouncil.Packet = {
  tools: [{ id: "read", status: "completed", input: '{"filePath":"src/target.c"}' }],
  references: ["src/target.c", "target_symbol"],
  truncated: false,
}

function messages(text = "Inspect `target_symbol` in src/target.c and prove the reachable path.") {
  return [
    {
      info: {
        id: messageID,
        role: "user",
        sessionID,
        agent: "ultra",
        model: { providerID: "test", modelID: "test" },
        time: { created: 1 },
      },
      parts: [
        {
          id: PartID.make("prt_ultra_user"),
          messageID,
          sessionID,
          type: "text",
          text,
        },
      ],
    },
  ] as unknown as SessionV1.WithParts[]
}

function report(lens: UltraCouncil.Lens, valid = true): UltraCouncil.Report {
  return {
    lens,
    question: `Investigate with ${lens}`,
    valid,
    output: valid ? "ULTRA_COUNCIL_REPORT" : "",
    claims: valid
      ? [
          {
            id: `${lens}-1-1`,
            hash: lens.padEnd(64, "0"),
            lens,
            obligations: ["O1", "O2"],
            claim: `Verified ${lens} finding`,
            status: "verified",
            scope: "local",
            chain: [
              {
                kind: "workspace",
                role: "fact",
                logic: "The source definition proves the local fact.",
                path: "src/target.c",
                line: 1,
                symbol: "target_symbol",
                excerpt: "void target_symbol(void) {}",
              },
            ],
            protectionsChecked: [],
            counterEvidence: [],
            uncertainties: [],
            excluded: [],
          },
        ]
      : [],
  }
}

function start(kind: UltraCouncil.Kind = "analysis") {
  const state = UltraCouncil.load({ sessionID, messageID, messages: messages() })
  expect(UltraCouncil.configure(state, kind, obligations)).toBeUndefined()
  expect(UltraCouncil.reserveBaseline(state)).toBeUndefined()
  expect(UltraCouncil.recordBaseline(state, { answer: baseline, packet, sessionID: "ses_code_baseline" })).toBeTrue()
  expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify", "evidence"])).toBeUndefined()
  UltraCouncil.record(state, [report("flow"), report("falsify"), report("evidence")])
  return state
}

function binding() {
  return obligations.map((item) => ({ obligation: item.id, claims: ["flow-1-1"] }))
}

function decisions(): UltraCouncil.Decision[] {
  return [
    {
      id: "flow-1-1",
      hash: "flow".padEnd(64, "0"),
      status: "approved",
      evidence: report("flow").claims[0]!.chain,
      corrections: [],
      uncertainties: [],
    },
  ]
}

function edits(text = "The completion boundary transfers after target_symbol returns."): UltraCouncil.EditInput[] {
  return [
    {
      kind: "replace",
      anchor: "The completion boundary remains with the caller.",
      text,
      obligations: ["O2"],
      claims: [{ id: "flow-1-1", hash: "flow".padEnd(64, "0") }],
      reason: "The source-backed flow corrects the ownership boundary.",
    },
  ]
}

function editDecisions(state: UltraCouncil.State, status: UltraCouncil.EditDecision["status"] = "approved") {
  return state.edits.map((item) => ({
    id: item.id,
    hash: item.hash,
    status,
    corrections: status === "approved" ? [] : ["The edit needs stronger evidence."],
    uncertainties: status === "approved" ? [] : ["The corrected boundary remains uncertain."],
  }))
}

function review(state: UltraCouncil.State, status: "approved" | "revision" = "approved"): UltraCouncil.Review {
  return {
    kind: state.kind ?? "analysis",
    candidateHash: state.proposalHash ?? "",
    status,
    obligations: obligations.map((item) => ({
      id: item.id,
      status: status === "approved" ? "covered" : "missing",
      claims: status === "approved" ? ["flow-1-1"] : [],
      evidence: status === "approved" ? report("flow").claims[0]!.chain : [],
      corrections: status === "approved" ? [] : [`Complete ${item.id}`],
      uncertainties: [],
    })),
    missing: status === "approved" ? [] : ["The exact candidate omitted a required dimension."],
    corrections: status === "approved" ? [] : ["Revise the exact candidate."],
  }
}

beforeEach(() => {
  UltraCouncil.reset()
})

describe("Ultra Council runtime contract", () => {
  test("wires exact delivery and terminal gating through the native Ultra verification branch", async () => {
    const source = await Bun.file(new URL("../../src/session/prompt.ts", import.meta.url)).text()
    const task = await Bun.file(new URL("../../src/tool/task.ts", import.meta.url)).text()

    expect(source).toContain("UltraVerify.delivery(council)")
    expect(source).toContain("sessions.removePart")
    expect(source).toContain("text: UltraVerify.result(council)")
    expect(source).toMatch(/UltraVerify\.gate\([\s\S]*?handle\.message\.finish,[\s\S]*?\)/)
    expect(task).toContain("ChipMateTask.permissions(rules, ctx.extra?.ultraCouncilReadOnly === true, canTask, cfg.mcp)")
  })

  test("freezes a Code baseline before two inherited and one blind investigation", () => {
    const state = UltraCouncil.load({ sessionID, messageID, messages: messages() })

    expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify", "evidence"])).toContain("already started")
    expect(UltraCouncil.configure(state, "analysis", obligations)).toBeUndefined()
    expect(UltraCouncil.configure(state, "analysis", obligations)).toBeUndefined()
    expect(UltraCouncil.configure(state, "review", obligations)).toContain("already frozen")
    expect(UltraCouncil.reserveBaseline(state)).toBeUndefined()
    expect(UltraCouncil.recordBaseline(state, { answer: baseline, packet, sessionID: "ses_code_baseline" })).toBeTrue()
    expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify"])).toContain("exactly 3")
    expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify", "evidence"])).toBeUndefined()
    UltraCouncil.record(state, [report("flow"), report("falsify"), report("evidence")])

    expect(state).toMatchObject({
      phase: "arbitrating",
      kind: "analysis",
      obligations,
      started: 3,
      valid: 3,
      baseline,
    })
  })

  test("retries the Code baseline only once after infrastructure failure", () => {
    const state = UltraCouncil.load({ sessionID, messageID, messages: messages() })
    expect(UltraCouncil.configure(state, "analysis", obligations)).toBeUndefined()
    expect(UltraCouncil.reserveBaseline(state)).toBeUndefined()
    UltraCouncil.failBaseline(state, "connection reset")
    expect(state).toMatchObject({ phase: "baselining", baselineAttempts: 1 })
    expect(UltraCouncil.reserveBaseline(state)).toBeUndefined()
    UltraCouncil.failBaseline(state, "connection reset again")
    expect(state).toMatchObject({ phase: "degraded", baselineAttempts: 2 })
  })

  test("delivers the frozen Code answer byte-for-byte when no edit is approved", () => {
    const state = start()

    expect(UltraCouncil.reserveAdjudication(state, state.baselineHash!, [], binding())).toBeUndefined()
    const result = review(state)
    UltraCouncil.recordAdjudication(state, { valid: true, decisions: decisions(), edits: [], review: result })

    expect(state).toMatchObject({ phase: "sealed", started: 4, adjudicated: true })
    expect(UltraCouncil.delivery(state)).toMatchObject({ text: baseline, hash: state.baselineHash })
    expect(UltraCouncil.required(state)).toBeFalse()
  })

  test("uses the fifth task to verify a corrected evidence-backed edit set", () => {
    const state = start("review")

    expect(UltraCouncil.reserveAdjudication(state, state.baselineHash!, edits(), binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, {
      valid: true,
      decisions: decisions(),
      edits: editDecisions(state, "rejected"),
      review: review(state, "revision"),
    })
    expect(state).toMatchObject({ phase: "revising", started: 4 })

    const final = "The completion boundary transfers only after target_symbol returns successfully."
    expect(UltraCouncil.reserveRevision(state, state.baselineHash!, edits(final), binding())).toBeUndefined()
    UltraCouncil.recordRevision(state, {
      valid: true,
      decisions: decisions(),
      edits: editDecisions(state),
      review: review(state),
    })

    expect(state).toMatchObject({ phase: "sealed", started: 5 })
    expect(UltraCouncil.delivery(state)?.text).toContain(final)
    expect(UltraCouncil.delivery(state)?.text).not.toContain("remains with the caller")
  })

  test("persists the previously approved edit set when the fifth verifier fails", () => {
    const state = start("analysis")
    const approved = "The completion boundary transfers after target_symbol returns."

    expect(UltraCouncil.reserveAdjudication(state, state.baselineHash!, edits(approved), binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, {
      valid: true,
      decisions: decisions(),
      edits: editDecisions(state),
      review: review(state, "revision"),
    })
    expect(state).toMatchObject({ phase: "revising", appliedEdits: [{ id: "edit-1" }] })

    expect(
      UltraCouncil.reserveRevision(
        state,
        state.baselineHash!,
        edits("The completion boundary transfers after an unverified condition."),
        binding(),
      ),
    ).toBeUndefined()
    UltraCouncil.recordRevision(state, { valid: false })

    expect(state.phase).toBe("limited")
    expect(state.candidate).toContain(approved)
    expect(state.candidate).not.toContain("unverified condition")
    expect(UltraCouncil.snapshot(state).appliedEdits).toEqual(state.appliedEdits)
    expect(UltraCouncil.result(state)).toStartWith(state.candidate!)
  })

  test("rejects a parent request-kind bypass and falls back after the task budget is exhausted", () => {
    const state = start("analysis")
    expect(UltraCouncil.reserveAdjudication(state, state.baselineHash!, edits(), binding())).toBeUndefined()
    const result = { ...review(state), kind: "implementation" as const }

    UltraCouncil.recordAdjudication(state, {
      valid: true,
      decisions: decisions(),
      edits: editDecisions(state),
      review: result,
    })
    expect(state.phase).toBe("revising")
    expect(UltraCouncil.reserveRevision(state, state.baselineHash!, edits(), binding())).toBeUndefined()
    UltraCouncil.recordRevision(state, {
      valid: true,
      decisions: decisions(),
      edits: editDecisions(state),
      review: result,
    })

    expect(state.phase).toBe("limited")
    expect(UltraCouncil.result(state)).toContain("The completion boundary transfers after target_symbol returns.")
  })

  test("degrades early when the remaining task budget cannot reach three valid reports plus adjudication", () => {
    const state = UltraCouncil.load({ sessionID, messageID, messages: messages("Check a failure.") })
    expect(UltraCouncil.configure(state, "analysis", obligations)).toBeUndefined()
    expect(UltraCouncil.reserveBaseline(state)).toBeUndefined()
    expect(UltraCouncil.recordBaseline(state, { answer: baseline, packet })).toBeTrue()
    expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify", "evidence"])).toBeUndefined()
    UltraCouncil.record(state, [report("flow"), report("falsify", false), report("evidence", false)])

    expect(state).toMatchObject({ phase: "degraded", started: 3, valid: 1 })
    expect(state.reason).toContain("cannot reach three valid reports")
    expect(UltraCouncil.result(state)).toStartWith(baseline)
  })

  test("retains only the Code baseline when independent adjudication fails twice", () => {
    const state = start("analysis")

    expect(UltraCouncil.reserveAdjudication(state, state.baselineHash!, edits(), binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, { valid: false })
    expect(UltraCouncil.reserveAdjudication(state, state.baselineHash!, edits(), binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, { valid: false })

    expect(state).toMatchObject({ phase: "degraded", started: 5, valid: 3 })
    expect(UltraCouncil.result(state)).toStartWith(baseline)
    expect(UltraCouncil.result(state)).toContain(
      "The independent adjudicator did not return a valid source-backed review",
    )
  })

  test("preserves the existing verified mutation unlock for implementation turns", () => {
    const state = start("implementation")
    expect(UltraCouncil.reserveAdjudication(state, state.baselineHash!, [], binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, {
      valid: true,
      decisions: decisions(),
      edits: [],
      review: review(state),
    })
    expect(state.phase).toBe("arbitrating")

    expect(UltraCouncil.reserveArbitration(state)).toBeUndefined()
    expect(
      UltraCouncil.submit(state, {
        decision: "verified",
        claims: 1,
        contradictions: [],
        missing: [],
        unresolved: [],
        followups: [],
        covered: ["src/target.c", "target_symbol"],
      }),
    ).toBeUndefined()
    expect(state.phase).toBe("verified")
  })

  test("restores sealed text from persisted tool input without copying it into the snapshot", () => {
    const state = start()
    expect(UltraCouncil.reserveAdjudication(state, state.baselineHash!, [], binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, {
      valid: true,
      decisions: decisions(),
      edits: [],
      review: review(state),
    })
    const saved = UltraCouncil.snapshot(state)
    expect(saved).not.toHaveProperty("candidate")

    const history = [
      ...messages(),
      {
        info: {
          id: MessageID.make("msg_ultra_sealed"),
          parentID: messageID,
          role: "assistant",
          sessionID,
        },
        parts: [
          {
            id: PartID.make("prt_ultra_baseline"),
            messageID: MessageID.make("msg_ultra_sealed"),
            sessionID,
            type: "tool",
            callID: "call_ultra_baseline",
            tool: UltraCouncil.BASELINE,
            state: {
              status: "completed",
              input: { requestKind: "analysis", obligations },
              output: `ULTRA_CODE_BASELINE\n${JSON.stringify({ answer: baseline, packet })}`,
              title: "baseline",
              metadata: { ultraCouncil: saved },
              time: { start: 1, end: 2 },
            },
          },
          {
            id: PartID.make("prt_ultra_sealed"),
            messageID: MessageID.make("msg_ultra_sealed"),
            sessionID,
            type: "tool",
            callID: "call_ultra_sealed",
            tool: UltraCouncil.ADJUDICATE,
            state: {
              status: "completed",
              input: { baselineHash: state.baselineHash, edits: [], bindings: binding() },
              output: "sealed",
              title: "sealed",
              metadata: { ultraCouncil: saved },
              time: { start: 2, end: 3 },
            },
          },
        ],
      },
    ] as unknown as SessionV1.WithParts[]

    UltraCouncil.reset()
    const restored = UltraCouncil.load({ sessionID, messageID, messages: history })
    expect(UltraCouncil.delivery(restored)?.text).toBe(baseline)
  })

  test("degrades an in-progress v4 snapshot whose baseline integrity cannot be proven", () => {
    const history = [
      ...messages(),
      {
        info: {
          id: MessageID.make("msg_ultra_legacy"),
          parentID: messageID,
          role: "assistant",
          sessionID,
        },
        parts: [
          {
            id: PartID.make("prt_ultra_legacy"),
            messageID: MessageID.make("msg_ultra_legacy"),
            sessionID,
            type: "tool",
            callID: "call_ultra_legacy",
            tool: UltraCouncil.EXPLORE,
            state: {
              status: "completed",
              input: {},
              output: "legacy",
              title: "legacy",
              metadata: { ultraCouncil: { version: 4 } },
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ] as unknown as SessionV1.WithParts[]

    const restored = UltraCouncil.load({ sessionID, messageID, messages: history })
    expect(restored.phase).toBe("degraded")
    expect(restored.reason).toContain("legacy Ultra Council snapshot")
  })

  test("exposes only the phase-specific Ultra tools and never the ordinary task tool", () => {
    const state = UltraCouncil.load({ sessionID, messageID, messages: messages("Explain it.") })
    const tools = {
      read: 1,
      edit: 2,
      task: 3,
      StructuredOutput: 6,
      [UltraCouncil.BASELINE]: 9,
      [UltraCouncil.EXPLORE]: 4,
      [UltraCouncil.ADJUDICATE]: 7,
      [UltraCouncil.REVISE]: 8,
      [UltraCouncil.ARBITRATE]: 5,
    }
    expect(UltraCouncil.filter(state, tools)).toEqual({ [UltraCouncil.BASELINE]: 9 })

    state.phase = "collecting"
    expect(UltraCouncil.filter(state, tools)).toEqual({ [UltraCouncil.EXPLORE]: 4 })
    state.phase = "arbitrating"
    expect(UltraCouncil.filter(state, tools)).toEqual({ [UltraCouncil.ADJUDICATE]: 7 })
    state.phase = "revising"
    expect(UltraCouncil.filter(state, tools)).toEqual({ [UltraCouncil.REVISE]: 8 })
    state.phase = "sealed"
    expect(UltraCouncil.filter(state, tools)).toEqual({ read: 1, StructuredOutput: 6 })
    state.phase = "verified"
    expect(UltraCouncil.filter(state, tools)).toEqual({ read: 1, edit: 2, StructuredOutput: 6 })
  })

  test("hardens Council task children against mutation and human-driven tools", () => {
    const normal = ChipMateTask.permissions([])
    const council = ChipMateTask.permissions([], true)
    const nested = ChipMateTask.permissions([], true, true)

    expect(normal.some((item) => item.permission === "edit" || item.permission === "bash")).toBeFalse()
    expect(council).toContainEqual({ permission: "edit", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "bash", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "suggest", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "plan_enter", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "plan_exit", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
    expect(nested).not.toContainEqual({ permission: "task", pattern: "*", action: "deny" })
  })

  test("rejects stale hashes, forged claims, non-unique anchors, and overlapping edits", () => {
    const state = start()
    expect(UltraCouncil.propose(state, "0".repeat(64), edits())).toEqual({
      error: "The Ultra Code baseline hash is stale.",
    })
    expect(
      UltraCouncil.propose(state, state.baselineHash!, [
        {
          ...edits()[0]!,
          claims: [{ id: "flow-1-1", hash: "0".repeat(64) }],
        },
      ]),
    ).toEqual({ error: "Edit 1 references an unknown or changed claim hash." })
    expect(
      UltraCouncil.propose(state, state.baselineHash!, [
        {
          ...edits()[0]!,
          anchor: "The",
        },
      ]),
    ).toEqual({ error: "Edit 1 anchor must occur exactly once in the frozen Code answer." })
    expect(
      UltraCouncil.propose(state, state.baselineHash!, [
        edits()[0]!,
        {
          ...edits()[0]!,
          kind: "insert_before",
          text: "Evidence-backed prefix.",
        },
      ]),
    ).toEqual({ error: "Edits edit-1 and edit-2 overlap." })
  })

  test("blocks premature provider stops without swallowing errors or interruptions", () => {
    const state = UltraCouncil.load({ sessionID, messageID, messages: messages("Explain it.") })

    expect(UltraCouncil.gate(state, "continue", false, "stop")).toBe("continue")
    expect(UltraCouncil.gate(state, "continue", true, "stop")).toBe("break")
    for (const _ of Array.from({ length: 5 })) {
      expect(UltraCouncil.gate(state, "break", false)).toBe("continue")
    }
    expect(state.phase).toBe("degraded")
    expect(UltraCouncil.disclosure(state)).toContain("6 consecutive times")
    expect(UltraCouncil.gate(state, "break", false)).toBe("break")
  })
})
