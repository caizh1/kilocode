import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

const root = path.resolve(import.meta.dir, "../..")
const schema = z.object({
  max: z.number(),
  searches: z.number(),
  calls: z.array(z.object({ lens: z.string(), type: z.string(), background: z.boolean(), final: z.boolean() })),
  initial: z.object({ started: z.number(), valid: z.number(), phase: z.string(), sessions: z.number() }),
  review: z.object({ started: z.number(), phase: z.string(), rejected: z.boolean() }),
  final: z.object({ phase: z.string(), started: z.number(), text: z.string().optional() }),
})

const script = `
import { Effect } from "effect"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Agent } from "./src/agent/agent.ts"
import { UltraCouncil } from "./src/kilocode/agent/ultra-council.ts"
import { UltraCouncilTools } from "./src/kilocode/tool/ultra-council.ts"
import { MessageID, PartID, SessionID } from "./src/session/schema.ts"
import { Parameters } from "./src/tool/task.ts"
import { Tool } from "./src/tool/tool.ts"
import { Truncate } from "./src/tool/truncate.ts"
import { disposeAllInstances, disposeTestRuntime, provideInstance, testInstanceStoreLayer, tmpdir } from "./test/fixture/fixture.ts"

await using dir = await tmpdir({
  init: async (root) => {
    await mkdir(path.join(root, "src"), { recursive: true })
    await Bun.write(path.join(root, "src/target.c"), "void target_symbol(void) {}\\n")
  },
})
const sessionID = SessionID.make("ses_ultra_tool")
const userID = MessageID.make("msg_ultra_tool_user")
const calls = []
let active = 0
let max = 0
let searches = 0
const task = {
  id: "task",
  description: "stub task",
  parameters: Parameters,
  execute(params) {
    return Effect.gen(function* () {
      active++
      max = Math.max(max, active)
      const final = params.prompt.includes("fifth and final")
      calls.push({
        lens: params.description.replace("Council ", ""),
        type: params.subagent_type,
        background: params.background === true,
        final,
      })
      yield* Effect.sleep("40 millis")
      active--
      if (params.description === "Council adjudicate") {
        const marker = "Runtime claim manifest:\\n"
        const start = params.prompt.indexOf(marker) + marker.length
        const end = params.prompt.indexOf("\\n\\n", start)
        const manifest = JSON.parse(params.prompt.slice(start, end))
        const obligationMarker = "Frozen obligations:\\n"
        const obligationStart = params.prompt.indexOf(obligationMarker) + obligationMarker.length
        const obligationEnd = params.prompt.indexOf("\\n\\n", obligationStart)
        const obligations = JSON.parse(params.prompt.slice(obligationStart, obligationEnd))
        const hash = params.prompt.match(/Candidate SHA-256: ([a-f0-9]{64})/)?.[1]
        const revise = process.env.REVISION === "1" && !final
        return {
          title: "adjudication",
          metadata: { sessionId: "ses_child_" + calls.length },
          output: [
            "ULTRA_COUNCIL_ADJUDICATION",
            JSON.stringify({
              requestKind: process.env.KIND_MISMATCH === "1" ? "implementation" : "analysis",
              candidate: {
                hash: process.env.BAD_CANDIDATE_HASH === "1" ? "0".repeat(64) : hash,
                status: revise ? "revision" : "approved",
                corrections: revise ? ["Add the omitted ownership condition."] : [],
              },
              obligations: obligations.map((item) => ({
                id: item.id,
                status: revise ? "missing" : "covered",
                claims: revise ? [] : [manifest[0].id],
                evidence: revise ? [] : [{
                  kind: "workspace",
                  role: "fact",
                  logic: "The exact definition independently supports this obligation.",
                  path: "src/target.c",
                  line: 1,
                  symbol: "target_symbol",
                  excerpt: "void target_symbol(void) {}",
                }],
                corrections: revise ? ["Cover the ownership condition."] : [],
                uncertainties: [],
              })),
              missing: revise ? ["The candidate omitted one requested condition."] : [],
              claims: manifest.map((claim) => ({
                id: claim.id,
                hash: claim.hash,
                status: process.env.FINAL_REJECT_CLAIMS === "1" && final ? "rejected" : "approved",
                evidence: [{
                  kind: "workspace",
                  role: "fact",
                  logic: "The exact definition independently proves the local claim.",
                  path: "src/target.c",
                  line: 1,
                  symbol: "target_symbol",
                  excerpt: "void target_symbol(void) {}",
                }],
                corrections: [],
                uncertainties: [],
              })),
              excluded: ["unrelated files"],
            }),
          ].join("\\n"),
        }
      }
      const body = {
        claims: [{
          obligations: ["O1"],
          claim: "target_symbol is defined in the requested source file",
          status: "verified",
          scope: "local",
          chain: [{
            kind: "workspace",
            role: "fact",
            logic: "The exact definition proves symbol presence.",
            path: "src/target.c",
            line: 1,
            symbol: "target_symbol",
            excerpt: "void target_symbol(void) {}",
          }],
          protectionsChecked: [],
          counterEvidence: [],
          uncertainties: [],
          excluded: ["unrelated modules"],
        }],
      }
      if (process.env.BAD_CHAIN === "1") body.claims[0].chain[0].excerpt = "fabricated source"
      if (process.env.MISSING_EXCERPT === "1") delete body.claims[0].chain[0].excerpt
      if (process.env.PARTIAL_BAD_CHAIN === "1") {
        body.claims[0].chain.push({
          kind: "workspace",
          role: "call",
          logic: "A malformed optional step must not erase the validated definition.",
          path: "src/target.c",
          line: 1,
          symbol: "target_symbol",
          excerpt: "fabricated source",
        })
      }
      return {
        title: "stub",
        metadata: { sessionId: "ses_child_" + calls.length },
        output: ["ULTRA_COUNCIL_REPORT", JSON.stringify(body)].join("\\n"),
      }
    })
  },
}
const document = {
  id: "document_search",
  description: "stub document search",
  parameters: Parameters,
  execute() {
    searches++
    if (process.env.DOC_FAIL === "1") return Effect.die(new Error("offline"))
    return Effect.succeed({ title: "documents", metadata: {}, output: "document-source: indexed design evidence" })
  },
}
const messages = [{
  info: {
    id: userID,
    role: "user",
    sessionID,
    agent: "ultra",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
  },
  parts: [{
    id: PartID.make("prt_ultra_tool_user"),
    messageID: userID,
    sessionID,
    type: "text",
    text: "Inspect \`target_symbol\` in src/target.c and explain its ownership boundary.",
  }],
}]
const ctx = {
  sessionID,
  messageID: MessageID.make("msg_ultra_tool_assistant"),
  agent: "ultra",
  abort: new AbortController().signal,
  callID: "call_council",
  extra: { userMessageID: userID },
  messages,
  metadata: () => Effect.void,
  ask: () => Effect.void,
}
const output = await Effect.runPromise(
  provideInstance(dir.path)(
    Effect.gen(function* () {
      const infos = yield* UltraCouncilTools(task, document)
      const explore = yield* Tool.init(infos.explore)
      const adjudicate = yield* Tool.init(infos.adjudicate)
      const revise = yield* Tool.init(infos.revise)
      const initial = yield* explore.execute({
        phase: "initial",
        requestKind: "analysis",
        obligations: [{ id: "O1", text: "Explain the definition and ownership boundary." }],
        investigations: [
          { lens: "flow", question: "Trace the reachable entry and execution path." },
          { lens: "falsify", question: "Try to disprove the proposed reachable path." },
          { lens: "evidence", question: "Verify the exact source evidence and tests." },
        ],
      }, ctx)
      const refs = initial.metadata.ultraCouncil.claims.map((claim) => ({ id: claim.id, hash: claim.hash }))
      if (process.env.TAMPER_MANIFEST === "1" && refs[0]) refs[0].hash = "0".repeat(64)
      if (refs.length === 0) {
        return {
          max,
          searches,
          calls,
          initial: {
            started: initial.metadata.started,
            valid: initial.metadata.valid,
            phase: initial.metadata.ultraCouncil?.phase,
            sessions: initial.metadata.sessions?.length,
          },
          review: {
            started: initial.metadata.ultraCouncil?.started,
            phase: initial.metadata.ultraCouncil?.phase,
            rejected: true,
          },
          final: {
            phase: initial.metadata.ultraCouncil?.phase,
            started: initial.metadata.ultraCouncil?.started,
          },
        }
      }
      const first = [
        "EXACT_DRAFT_SENTINEL",
        "The final proposed answer states that target_symbol is defined at src/target.c:1.",
        "The answer explains the ownership boundary using only runtime-validated evidence.",
        "This exact draft is intentionally longer than two hundred characters so the independent adjudicator receives the complete proposed synthesis rather than a generic request.",
      ].join(" ")
      const reviewed = yield* adjudicate.execute({
        draft: first,
        bindings: [{ obligation: "O1", claims: refs.length > 0 ? [refs[0].id] : ["missing"] }],
        claims: refs,
      }, ctx)
      const turn = reviewed.metadata.ultraCouncil
      let final = reviewed
      if (turn?.phase === "revising") {
        const revised = first + " The corrected candidate explicitly preserves the requested ownership condition."
        final = yield* revise.execute({
          draft: revised,
          bindings: [{ obligation: "O1", claims: [refs[0].id] }],
          claims: refs,
        }, ctx)
      }
      const state = UltraCouncil.load({ sessionID, messageID: userID, messages })
      return {
        max,
        searches,
        calls,
        initial: {
          started: initial.metadata.started,
          valid: initial.metadata.valid,
          phase: initial.metadata.ultraCouncil?.phase,
          sessions: initial.metadata.sessions?.length,
        },
        review: {
          started: reviewed.metadata.ultraCouncil?.started,
          phase: reviewed.metadata.ultraCouncil?.phase,
          rejected: reviewed.metadata.rejected,
        },
        final: {
          phase: final.metadata.ultraCouncil?.phase,
          started: final.metadata.ultraCouncil?.started,
          text: UltraCouncil.delivery(state)?.text,
        },
      }
    }),
  ).pipe(
    Effect.provide(Agent.defaultLayer),
    Effect.provide(Truncate.defaultLayer),
    Effect.provide(testInstanceStoreLayer),
  ),
)
await disposeAllInstances()
await disposeTestRuntime()
process.stdout.write(JSON.stringify(output), () => process.exit(0))
`

describe("Ultra Council tools", () => {
  async function run(env: Record<string, string> = {}) {
    const storage = path.join(os.tmpdir(), `chipmate-ultra-tool-test-${Math.random().toString(36).slice(2)}`)
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: root,
      env: {
        ...process.env,
        KILO_PRODUCT_PROFILE: "chipmate-v2",
        KILO_STORAGE_ROOT: storage,
        KILO_VSCODE_GLOBAL_STORAGE: storage,
        KILO_CONFIG_CONTENT: "{}",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]).finally(() => fs.rm(storage, { recursive: true, force: true }))

    expect(code, stderr).toBe(0)
    const start = stdout.lastIndexOf('{"max":')
    return schema.parse(JSON.parse(stdout.slice(start)))
  }

  test("runs three blind Explore sessions concurrently and seals the exact Task 4 candidate", async () => {
    const output = await run()
    expect(output.max).toBe(3)
    expect(output.searches).toBe(1)
    expect(output.calls).toEqual([
      { lens: "flow", type: "explore", background: false, final: false },
      { lens: "falsify", type: "explore", background: false, final: false },
      { lens: "evidence", type: "explore", background: false, final: false },
      { lens: "adjudicate", type: "explore", background: false, final: false },
    ])
    expect(output.initial).toEqual({ started: 3, valid: 3, phase: "arbitrating", sessions: 3 })
    expect(output.review).toEqual({ started: 4, phase: "sealed", rejected: false })
    expect(output.final.phase).toBe("sealed")
    expect(output.final.text).toContain("EXACT_DRAFT_SENTINEL")
  })

  test("uses Task 5 only when Task 4 requires a complete revision", async () => {
    const output = await run({ REVISION: "1" })
    expect(output.calls).toHaveLength(5)
    expect(output.calls.at(-1)).toMatchObject({ lens: "adjudicate", final: true })
    expect(output.review).toEqual({ started: 4, phase: "revising", rejected: false })
    expect(output.final).toMatchObject({ phase: "sealed", started: 5 })
    expect(output.final.text).toContain("corrected candidate")
  })

  test("seals a corrected Task 5 candidate from fresh obligation evidence", async () => {
    const output = await run({ REVISION: "1", FINAL_REJECT_CLAIMS: "1" })
    expect(output.calls).toHaveLength(5)
    expect(output.final).toMatchObject({ phase: "sealed", started: 5 })
    expect(output.final.text).toContain("corrected candidate")
  })

  test("keeps local Council evidence usable when Document RAG is offline", async () => {
    const output = await run({ DOC_FAIL: "1" })
    expect(output.searches).toBe(1)
    expect(output.final.phase).toBe("sealed")
  })

  test("rejects a changed runtime claim manifest before spending Task 4", async () => {
    const output = await run({ TAMPER_MANIFEST: "1" })
    expect(output.calls).toHaveLength(3)
    expect(output.review).toMatchObject({ started: 3, rejected: true })
    expect(output.final.phase).toBe("arbitrating")
  })

  test("does not seal a request-kind mismatch even after the fifth verifier", async () => {
    const output = await run({ KIND_MISMATCH: "1" })
    expect(output.calls).toHaveLength(5)
    expect(output.final).toMatchObject({ phase: "limited", started: 5 })
    expect(output.final.text).toBeUndefined()
  })

  test("does not count fabricated source chains as valid Council reports", async () => {
    const output = await run({ BAD_CHAIN: "1" })
    expect(output.initial.valid).toBe(0)
    expect(output.initial.phase).toBe("degraded")
    expect(output.calls).toHaveLength(3)
  })

  test("preserves a surviving source chain as inferred for independent adjudication", async () => {
    const output = await run({ PARTIAL_BAD_CHAIN: "1" })
    expect(output.initial.valid).toBe(3)
    expect(output.calls).toHaveLength(4)
    expect(output.final.phase).toBe("sealed")
  })

  test("attaches an exact workspace line when a valid location omits its excerpt", async () => {
    const output = await run({ MISSING_EXCERPT: "1" })
    expect(output.initial.valid).toBe(3)
    expect(output.calls).toHaveLength(4)
    expect(output.final.phase).toBe("sealed")
  })
})
