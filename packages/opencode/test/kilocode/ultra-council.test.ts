import { beforeEach, describe, expect, test } from "bun:test"
import { UltraCouncil } from "../../src/kilocode/agent/ultra-council"
import { KiloTask } from "../../src/kilocode/tool/task"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

const sessionID = SessionID.make("ses_ultra_council")
const messageID = MessageID.make("msg_ultra_user")
const obligations = [
  { id: "O1", text: "Trace the reachable execution path." },
  { id: "O2", text: "Explain the completion and ownership boundary." },
]

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

function review(state: UltraCouncil.State, status: "approved" | "revision" = "approved"): UltraCouncil.Review {
  return {
    kind: state.kind ?? "analysis",
    candidateHash: state.candidateHash ?? "",
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
  test("wires exact delivery and terminal gating only through the Ultra Council branch", async () => {
    const source = await Bun.file(new URL("../../src/session/prompt.ts", import.meta.url)).text()
    const task = await Bun.file(new URL("../../src/tool/task.ts", import.meta.url)).text()

    expect(source).toContain("UltraCouncil.delivery(council)")
    expect(source).toContain("sessions.removePart")
    expect(source).toContain("text: UltraCouncil.result(council)")
    expect(source).toMatch(/UltraCouncil\.gate\([\s\S]*?handle\.message\.finish,[\s\S]*?\)/)
    expect(task.match(/KiloTask\.permissions\(rules, ctx\.extra\?\.ultraCouncilReadOnly === true\)/g)).toHaveLength(2)
  })

  test("freezes a complete request contract before exactly three blind investigations", () => {
    const state = UltraCouncil.load({ sessionID, messageID, messages: messages() })

    expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify", "evidence"])).toContain("Freeze")
    expect(UltraCouncil.configure(state, "analysis", obligations)).toBeUndefined()
    expect(UltraCouncil.configure(state, "analysis", obligations)).toBeUndefined()
    expect(UltraCouncil.configure(state, "review", obligations)).toContain("already frozen")
    expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify"])).toContain("exactly 3")
    expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify", "evidence"])).toBeUndefined()
    UltraCouncil.record(state, [report("flow"), report("falsify"), report("evidence")])

    expect(state).toMatchObject({
      phase: "arbitrating",
      kind: "analysis",
      obligations,
      started: 3,
      valid: 3,
    })
  })

  test("seals the exact approved analysis candidate without chair prose regeneration", () => {
    const state = start()
    const draft = "A".repeat(220)

    expect(UltraCouncil.reserveAdjudication(state, draft, binding())).toBeUndefined()
    const result = review(state)
    UltraCouncil.recordAdjudication(state, { valid: true, decisions: decisions(), review: result })

    expect(state).toMatchObject({ phase: "sealed", started: 4, adjudicated: true })
    expect(UltraCouncil.delivery(state)).toMatchObject({ text: draft, hash: state.candidateHash })
    expect(UltraCouncil.required(state)).toBeFalse()
  })

  test("uses the fifth task to verify one complete revision and seals only the approved text", () => {
    const state = start("review")
    const first = "B".repeat(220)

    expect(UltraCouncil.reserveAdjudication(state, first, binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, {
      valid: true,
      decisions: decisions(),
      review: review(state, "revision"),
    })
    expect(state).toMatchObject({ phase: "revising", started: 4 })

    const final = "C".repeat(240)
    expect(UltraCouncil.reserveRevision(state, final, binding())).toBeUndefined()
    UltraCouncil.recordRevision(state, { valid: true, decisions: decisions(), review: review(state) })

    expect(state).toMatchObject({ phase: "sealed", started: 5 })
    expect(UltraCouncil.delivery(state)?.text).toBe(final)
  })

  test("rejects a parent request-kind bypass and falls back after the task budget is exhausted", () => {
    const state = start("analysis")
    const draft = "D".repeat(220)
    expect(UltraCouncil.reserveAdjudication(state, draft, binding())).toBeUndefined()
    const result = { ...review(state), kind: "implementation" as const }

    UltraCouncil.recordAdjudication(state, { valid: true, decisions: decisions(), review: result })
    expect(state.phase).toBe("revising")
    expect(UltraCouncil.reserveRevision(state, "E".repeat(220), binding())).toBeUndefined()
    UltraCouncil.recordRevision(state, { valid: true, decisions: decisions(), review: result })

    expect(state.phase).toBe("limited")
    expect(UltraCouncil.fallback(state)).toContain("ULTRA_COUNCIL_EVIDENCE_LIMITED")
  })

  test("degrades early when the remaining task budget cannot reach three valid reports plus adjudication", () => {
    const state = UltraCouncil.load({ sessionID, messageID, messages: messages("Check a failure.") })
    expect(UltraCouncil.configure(state, "analysis", obligations)).toBeUndefined()
    expect(UltraCouncil.reserve(state, "initial", ["flow", "falsify", "evidence"])).toBeUndefined()
    UltraCouncil.record(state, [report("flow"), report("falsify", false), report("evidence", false)])

    expect(state).toMatchObject({ phase: "degraded", started: 3, valid: 1 })
    expect(state.reason).toContain("cannot reach three valid reports")
    expect(UltraCouncil.result(state)).toContain("No unadjudicated technical answer was emitted")
  })

  test("returns the best investigated candidate when only final arbitration validation fails", () => {
    const state = start("analysis")
    const candidate = "G".repeat(220)

    expect(UltraCouncil.reserveAdjudication(state, candidate, binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, { valid: false })
    expect(UltraCouncil.reserveAdjudication(state, candidate, binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, { valid: false })

    expect(state).toMatchObject({ phase: "degraded", started: 5, valid: 3 })
    expect(UltraCouncil.result(state)).toStartWith(candidate)
    expect(UltraCouncil.result(state)).toContain("最终仲裁未完全通过")
  })

  test("preserves the existing verified mutation unlock for implementation turns", () => {
    const state = start("implementation")
    const draft = "F".repeat(220)
    expect(UltraCouncil.reserveAdjudication(state, draft, binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, { valid: true, decisions: decisions(), review: review(state) })
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
    const draft = "G".repeat(220)
    expect(UltraCouncil.reserveAdjudication(state, draft, binding())).toBeUndefined()
    UltraCouncil.recordAdjudication(state, { valid: true, decisions: decisions(), review: review(state) })
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
            id: PartID.make("prt_ultra_sealed"),
            messageID: MessageID.make("msg_ultra_sealed"),
            sessionID,
            type: "tool",
            callID: "call_ultra_sealed",
            tool: UltraCouncil.ADJUDICATE,
            state: {
              status: "completed",
              input: { draft, bindings: binding() },
              output: "sealed",
              title: "sealed",
              metadata: { ultraCouncil: saved },
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ] as unknown as SessionV1.WithParts[]

    UltraCouncil.reset()
    const restored = UltraCouncil.load({ sessionID, messageID, messages: history })
    expect(UltraCouncil.delivery(restored)?.text).toBe(draft)
  })

  test("exposes only the phase-specific Ultra tools and never the ordinary task tool", () => {
    const state = UltraCouncil.load({ sessionID, messageID, messages: messages("Explain it.") })
    const tools = {
      read: 1,
      edit: 2,
      task: 3,
      StructuredOutput: 6,
      [UltraCouncil.EXPLORE]: 4,
      [UltraCouncil.ADJUDICATE]: 7,
      [UltraCouncil.REVISE]: 8,
      [UltraCouncil.ARBITRATE]: 5,
    }
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
    const normal = KiloTask.permissions([])
    const council = KiloTask.permissions([], true)

    expect(normal.some((item) => item.permission === "edit" || item.permission === "bash")).toBeFalse()
    expect(council).toContainEqual({ permission: "edit", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "bash", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "suggest", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "plan_enter", pattern: "*", action: "deny" })
    expect(council).toContainEqual({ permission: "plan_exit", pattern: "*", action: "deny" })
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
