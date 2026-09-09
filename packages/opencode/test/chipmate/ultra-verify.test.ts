import { beforeEach, describe, expect, test } from "bun:test"
import { UltraVerify } from "../../src/chipmate/agent/ultra-verify"
import { ChipMateTask } from "../../src/chipmate/tool/task"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Permission } from "../../src/permission"

const sessionID = SessionID.make("ses_ultra_verify")
const messageID = MessageID.make("msg_ultra_verify_user")

function messages(output?: string): SessionV1.WithParts[] {
  const user = {
    info: {
      id: messageID,
      sessionID,
      role: "user" as const,
      time: { created: 1 },
      agent: "ultra",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("model") },
    },
    parts: [],
  }
  if (!output) return [user]
  return [
    user,
    {
      info: {
        id: MessageID.make("msg_ultra_verify_assistant"),
        sessionID,
        parentID: messageID,
        role: "assistant" as const,
        mode: "ultra",
        agent: "ultra",
        modelID: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("test"),
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2 },
      },
      parts: [
        {
          id: PartID.make("prt_ultra_verify"),
          messageID: MessageID.make("msg_ultra_verify_assistant"),
          sessionID,
          type: "tool" as const,
          callID: "call_ultra_verify",
          tool: UltraVerify.TOOL,
          state: {
            status: "completed" as const,
            input: { requestKind: "analysis" },
            output,
            title: "Ultra verification complete",
            metadata: {
              ultraVerify: {
                version: 1,
                messageID,
                phase: "complete",
                attempts: 1,
                sessions: ["ses_code", "ses_1", "ses_2", "ses_3", "ses_synth"],
              },
            },
            time: { start: 2, end: 3 },
          },
        },
      ],
    },
  ]
}

beforeEach(() => UltraVerify.reset())

describe("Ultra three-way verification runtime", () => {
  test("hides and denies mutating tools and MCP servers in read-only descendants", () => {
    const disabled = ChipMateTask.disabled()
    expect(disabled.edit).toBe(false)
    expect(disabled.repo_clone).toBe(false)
    expect(disabled.skill_market_install).toBe(false)
    expect(disabled.chipmate_memory_save).toBe(false)
    expect(disabled.render_word_document).toBe(false)
    const rules = ChipMateTask.permissions([], true, false, { internal_docs: { type: "remote", url: "https://test" } })
    expect(Permission.evaluate("edit", "*", rules).action).toBe("deny")
    expect(Permission.evaluate("internal_docs_write", "*", rules).action).toBe("deny")
    expect(Permission.evaluate("read", "*", rules).action).toBe("ask")
  })

  test("exposes only the verification tool until one complete pipeline finishes", () => {
    const state = UltraVerify.load({ sessionID, messageID, messages: messages() })
    expect(UltraVerify.filter(state, { ultra_verify: 1, task: 2, read: 3 })).toEqual({ ultra_verify: 1 })
    expect(UltraVerify.begin(state)).toBeUndefined()
    expect(
      UltraVerify.complete(state, {
        kind: "analysis",
        baseline: "Code answer",
        answer: "Verified answer",
        sessions: ["ses_1"],
      }),
    ).toBe(true)
    expect(state.phase).toBe("complete")
    expect(state.kind).toBe("analysis")
    expect(UltraVerify.delivery(state)?.text).toBe("Verified answer")
  })

  test("unlocks the parent only after read-only verification for implementation requests", () => {
    const state = UltraVerify.load({ sessionID, messageID, messages: messages() })
    expect(UltraVerify.begin(state)).toBeUndefined()
    expect(
      UltraVerify.complete(state, {
        kind: "implementation",
        baseline: "Code plan",
        answer: "Verified plan",
        sessions: [],
      }),
    ).toBe(true)
    expect(state.phase).toBe("ready")
    expect(UltraVerify.delivery(state)).toBeUndefined()
    expect(UltraVerify.filter(state, { ultra_verify: 1, task: 2, edit: 3, read: 4 })).toEqual({ edit: 3, read: 4 })
  })

  test("keeps review requests read-only and delivers their synthesis exactly", () => {
    const state = UltraVerify.load({ sessionID, messageID, messages: messages() })
    expect(UltraVerify.begin(state)).toBeUndefined()
    expect(
      UltraVerify.complete(state, {
        kind: "review",
        baseline: "Code review",
        answer: "Verified review",
        sessions: [],
      }),
    ).toBe(true)
    expect(state.phase).toBe("complete")
    expect(UltraVerify.filter(state, { task: 1, edit: 2, read: 3 })).toEqual({ edit: 2, read: 3 })
    expect(UltraVerify.delivery(state)?.text).toBe("Verified review")
  })

  test("restores the exact synthesized answer from completed tool evidence", () => {
    const output = [
      "ULTRA_VERIFY_RESULT",
      JSON.stringify({
        baseline: "Frozen Code answer",
        answer: "Independent synthesized answer",
        sessions: ["ses_code", "ses_1", "ses_2", "ses_3", "ses_synth"],
      }),
    ].join("\n")
    const state = UltraVerify.load({ sessionID, messageID, messages: messages(output) })
    expect(state.phase).toBe("complete")
    expect(state.sessions).toHaveLength(5)
    expect(UltraVerify.delivery(state)?.text).toBe("Independent synthesized answer")
  })

  test("restores the persisted request kind from current result records", () => {
    const output = [
      "ULTRA_VERIFY_RESULT",
      JSON.stringify({
        kind: "implementation",
        baseline: "Frozen Code plan",
        answer: "Independent synthesized plan",
        sessions: ["ses_code", "ses_1", "ses_2", "ses_3", "ses_synth"],
      }),
    ].join("\n")
    const state = UltraVerify.load({ sessionID, messageID, messages: messages(output) })
    expect(state.kind).toBe("implementation")
    expect(state.phase).toBe("ready")
    expect(UltraVerify.delivery(state)).toBeUndefined()
  })

  test("creates one deterministic empty local call only while pending", () => {
    const state = UltraVerify.load({ sessionID, messageID, messages: messages() })
    const first = UltraVerify.dispatch(state)
    expect(first).toEqual({
      id: expect.stringMatching(/^call_ultra_verify_[0-9a-f]{24}$/),
      name: "ultra_verify",
      input: {},
    })
    expect(UltraVerify.dispatch(state)).toEqual(first)
    UltraVerify.begin(state)
    expect(UltraVerify.dispatch(state)).toBeUndefined()
  })

  test("fails closed after one incomplete local dispatch without provider retries", () => {
    const state = UltraVerify.load({ sessionID, messageID, messages: messages() })
    expect(UltraVerify.gate(state, "break", false, "stop")).toBe("continue")
    expect(state.phase).toBe("failed")
    expect(UltraVerify.delivery(state)?.text).toContain("三路独立证据验证未能形成完整答案")
    expect(UltraVerify.delivery(state)?.text).toContain("local Ultra verification dispatch")
  })
})
