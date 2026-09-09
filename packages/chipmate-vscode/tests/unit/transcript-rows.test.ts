import { describe, expect, it } from "bun:test"
import { messageTurns } from "../../webview-ui/src/context/session-queue"
import { partitionRows, retainTurn, stabilize, transcriptRows } from "../../webview-ui/src/context/transcript-rows"
import type { Message, Part } from "../../webview-ui/src/types/messages"

const base = {
  sessionID: "session",
  createdAt: "2026-01-01T00:00:00.000Z",
  time: { created: 1 },
}

const user = (id: string, opts: Partial<Message> = {}): Message => ({ ...base, id, role: "user", ...opts })
const assistant = (id: string, parentID: string, opts: Partial<Message> = {}): Message => ({
  ...base,
  id,
  parentID,
  role: "assistant",
  ...opts,
})
const part = (id: string, messageID: string): Part => ({ id, messageID, type: "text", text: id })
const finish = (id: string, messageID: string, ttftMs: number, output = 80, elapsed = 1_000): Part => ({
  id,
  messageID,
  type: "step-finish",
  metrics: { generation: (output * 1_000) / (elapsed - ttftMs), ttftMs, source: "computed" },
  tokens: { input: 20, output, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { start: 0, end: elapsed, elapsed },
})
const lookup = (values: Record<string, Part[]>) => (id: string) => values[id] ?? []

describe("transcriptRows", () => {
  it("停止后没有模型摘要也保留普通 Agent 的按轮审阅入口", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1", { error: { name: "MessageAbortedError" } })
    const messages = [u1, a1]
    const rows = transcriptRows(messageTurns(messages), lookup({}), { messages, turnChanges: true })
    expect(rows.filter((row) => row.type === "diff").map((row) => row.message.id)).toEqual(["u1"])
    expect(transcriptRows(messageTurns(messages), lookup({}), { messages }).some((row) => row.type === "diff")).toBe(false)
  })

  it("shows a completed duration only below the final assistant chunk", () => {
    const u1 = user("u1", { time: { created: 1_000 } })
    const a1 = assistant("a1", "u1", { finish: "stop", time: { created: 2_000, completed: 159_000 } })
    const parts = Array.from({ length: 10 }, (_, index) => part(`p${index}`, "a1"))
    const rows = transcriptRows(messageTurns([u1, a1]), lookup({ a1: parts }), { messages: [u1, a1], size: 3 })

    expect(rows.filter((row) => row.type === "assistant").map((row) => row.completionElapsed)).toEqual([
      undefined,
      undefined,
      undefined,
      158_000,
    ])
  })

  it("attaches a completed duration to the copied text row and preserves the final agent", () => {
    const u1 = user("u1", { time: { created: 1_000 } })
    const prose = assistant("a1", "u1", { agent: "code", time: { created: 2_000 } })
    const completed = assistant("a2", "u1", {
      agent: "Ultra",
      finish: "stop",
      time: { created: 3_000, completed: 159_000 },
    })
    const rows = transcriptRows(messageTurns([u1, prose, completed]), lookup({ a1: [part("p1", "a1")] }), {
      messages: [u1, prose, completed],
    })
    const assistantRows = rows.filter((row) => row.type === "assistant")

    expect(assistantRows.map((row) => row.message)).toEqual([prose, completed])
    expect(assistantRows.map((row) => [row.completionElapsed, row.completionAgent])).toEqual([
      [158_000, "Ultra"],
      [undefined, undefined],
    ])
  })

  it("attaches response performance only to the latest successful completed turn", () => {
    const u1 = user("u1", { time: { created: 1_000 } })
    const a1 = assistant("a1", "u1", { finish: "stop", time: { created: 1_100, completed: 2_000 } })
    const u2 = user("u2", { time: { created: 3_000 } })
    const a2 = assistant("a2", "u2", { finish: "stop", time: { created: 3_100, completed: 4_000 } })
    const values = {
      a1: [part("p1", "a1"), finish("f1", "a1", 200)],
      a2: [part("p2", "a2"), finish("f2", "a2", 400)],
    }
    const rows = transcriptRows(messageTurns([u1, a1, u2, a2]), lookup(values), {
      messages: [u1, a1, u2, a2],
    }).filter((row) => row.type === "assistant")

    expect(rows.find((row) => row.message.id === "a1")?.performance).toBeUndefined()
    expect(rows.find((row) => row.message.id === "a2")?.performance).toEqual({
      generation: (80 * 1_000) / 600,
      ttftMs: 400,
      source: "computed",
    })
    expect(rows.find((row) => row.message.id === "a2")?.completionElapsed).toBe(1_000)
  })

  it("keeps the previous performance while a newer turn is live, failed, or cancelled", () => {
    const u1 = user("u1", { time: { created: 1_000 } })
    const a1 = assistant("a1", "u1", { finish: "stop", time: { created: 1_100, completed: 2_000 } })
    const u2 = user("u2", { time: { created: 3_000 } })
    const live = assistant("a2", "u2", { time: { created: 3_100 } })
    const failed = assistant("a3", "u2", {
      finish: "error",
      error: { name: "ProviderError" },
      time: { created: 3_200, completed: 4_000 },
    })
    const values = {
      a1: [part("p1", "a1"), finish("f1", "a1", 250)],
      a2: [part("p2", "a2"), finish("f2", "a2", 100)],
      a3: [part("p3", "a3"), finish("f3", "a3", 100)],
    }

    for (const tail of [[live], [failed], [assistant("a4", "u2", { error: { name: "MessageAbortedError" } })]]) {
      const messages = [u1, a1, u2, ...tail]
      const rows = transcriptRows(messageTurns(messages), lookup(values), { messages }).filter(
        (row) => row.type === "assistant",
      )
      expect(rows.find((row) => row.message.id === "a1")?.performance?.ttftMs).toBe(250)
      expect(rows.filter((row) => row.message.id !== "a1").every((row) => !row.performance)).toBe(true)
    }
  })

  it("does not carry response performance across session transcript inputs", () => {
    const u1 = user("u1", { time: { created: 1_000 } })
    const a1 = assistant("a1", "u1", { finish: "stop", time: { created: 1_100, completed: 2_000 } })
    const first = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [part("p1", "a1"), finish("f1", "a1", 300)] }), {
      messages: [u1, a1],
    })
    const otherUser = user("u9", { sessionID: "other", time: { created: 3_000 } })
    const other = transcriptRows(messageTurns([otherUser]), lookup({}), { messages: [otherUser] }, first)

    expect(first.some((row) => row.type === "assistant" && row.performance?.ttftMs === 300)).toBe(true)
    expect(other.some((row) => row.type === "assistant" && row.performance)).toBe(false)
  })

  it("renders one fork action but uses the final assistant record as its inclusive boundary", () => {
    const u1 = user("u1")
    const prose = assistant("a1", "u1")
    const terminal = assistant("a2", "u1", { finish: "stop" })
    const rows = transcriptRows(messageTurns([u1, prose, terminal]), lookup({ a1: [part("p1", "a1")] }))
    const assistantRows = rows.filter((row) => row.type === "assistant")

    expect(assistantRows.map((row) => row.forkAfterMessageID)).toEqual(["a2", undefined])
    const live = transcriptRows(messageTurns([u1, prose, terminal]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u1"]),
    })
    expect(live.filter((row) => row.type === "assistant").every((row) => !row.forkAfterMessageID)).toBe(true)
  })

  it("keeps a resumed compaction reply tied to its original submission time", () => {
    const original = user("u1", { time: { created: 100 } })
    const compacted = user("u2", {
      time: { created: 600 },
      parts: [{ id: "compact", messageID: "u2", type: "compaction", auto: false }],
    })
    const resumed = assistant("a2", "u1", { finish: "stop", time: { created: 800, completed: 2_100 } })
    const rows = transcriptRows(
      messageTurns([original, compacted, resumed]),
      lookup({ u2: compacted.parts ?? [], a2: [part("p1", "a2")] }),
      { messages: [original, compacted, resumed] },
    )

    expect(rows.find((row) => row.type === "assistant" && row.message.id === resumed.id)).toMatchObject({
      completionElapsed: 2_000,
    })
  })

  it("preserves turn order across user, bounded assistant, diff, and error rows", () => {
    const u1 = user("u1", { summary: { diffs: [{ file: "a.ts" }] } })
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1", { error: { name: "ProviderError" } })
    const u2 = user("u2")
    const a3 = assistant("a3", "u2")
    const parts = {
      u1: [part("up1", "u1")],
      a1: Array.from({ length: 10 }, (_, i) => part(`p${i}`, "a1")),
      a2: [part("p10", "a2")],
      a3: [part("p11", "a3")],
    }

    const rows = transcriptRows(messageTurns([u1, a1, a2, u2, a3]), lookup(parts))

    expect(rows.map((row) => `${row.turn}:${row.type}`)).toEqual([
      "u1:user",
      "u1:assistant",
      "u1:assistant",
      "u1:assistant",
      "u1:diff",
      "u1:error",
      "u2:user",
      "u2:assistant",
    ])
    expect(rows.filter((row) => row.type === "assistant").map((row) => row.parts.length)).toEqual([8, 2, 1, 1])
  })

  it("uses the configured bound and keeps an empty assistant renderable", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const rows = transcriptRows(
      messageTurns([u1, a1, a2]),
      lookup({ a1: Array.from({ length: 7 }, (_, i) => part(`p${i}`, "a1")) }),
      { size: 3 },
    )

    expect(rows.filter((row) => row.type === "assistant").map((row) => row.parts.length)).toEqual([3, 3, 1, 0])
  })

  it("omits synthetic users for partial turns and carries row metadata", () => {
    const a1 = assistant("a1", "u1")
    const rows = transcriptRows(messageTurns([a1]), lookup({ a1: [part("p1", "a1")] }), {
      queued: new Set(["u1"]),
      live: new Set(["u1"]),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: "assistant", turn: "u1", partial: true, queued: true, live: true })
  })

  it("places only the first visible non-abort error after diffs", () => {
    const u1 = user("u1", { summary: { diffs: [{ file: "a.ts" }] } })
    const a1 = assistant("a1", "u1", { error: { name: "MessageAbortedError" } })
    const a2 = assistant("a2", "u1", { error: { name: "HiddenError" } })
    const a3 = assistant("a3", "u1", { error: { name: "ShownError" } })
    const rows = transcriptRows(messageTurns([u1, a1, a2, a3]), lookup({}), { hidden: (id) => id === "a2" })

    expect(rows.slice(-2).map((row) => row.type)).toEqual(["diff", "error"])
    expect(rows.at(-1)).toMatchObject({ type: "error", message: a3, error: a3.error })
  })

  it("hides provider errors at and after an assistant part boundary", () => {
    const revert = { messageID: "message_2", partID: "part_2" }
    const u1 = user("message_1")
    const a1 = assistant("message_2", "message_1", { error: { name: "ProviderError" } })
    const a2 = assistant("message_3", "message_1", { error: { name: "ProviderError" } })
    const parts = { message_2: [part("part_1", "message_2"), part("part_2", "message_2")] }
    const rows = transcriptRows(messageTurns([u1, a1, a2], revert), lookup(parts), { revert })

    expect(rows.map((row) => row.type)).toEqual(["user", "assistant"])
    expect(rows.filter((row) => row.type === "assistant").flatMap((row) => row.parts.map((item) => item.id))).toEqual([
      "part_1",
    ])
    expect(rows.some((row) => row.message.id === "message_3")).toBe(false)
  })

  it("keeps provider errors before an assistant part boundary", () => {
    const revert = { messageID: "message_3", partID: "part_2" }
    const u1 = user("message_1")
    const a1 = assistant("message_2", "message_1", { error: { name: "ProviderError" } })
    const a2 = assistant("message_3", "message_1")
    const parts = { message_3: [part("part_1", "message_3"), part("part_2", "message_3")] }
    const rows = transcriptRows(messageTurns([u1, a1, a2], revert), lookup(parts), { revert })

    expect(rows.at(-1)).toMatchObject({ type: "error", message: a1 })
  })

  it("keeps keys stable when older turns are prepended and parts are appended", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const parts = Array.from({ length: 8 }, (_, i) => part(`p${i}`, "a1"))
    const current = transcriptRows(messageTurns([u1, a1]), lookup({ a1: parts }))
    const older = user("u0")
    const next = transcriptRows(messageTurns([older, u1, a1]), lookup({ a1: [...parts, part("p8", "a1")] }))

    expect(next.find((row) => row.type === "user" && row.turn === "u1")?.key).toBe(current[0]?.key)
    expect(next.find((row) => row.type === "assistant" && row.parts[0]?.id === "p0")?.key).toBe(current[1]?.key)
  })

  it("reuses unchanged rows across prepend and append updates", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const p1 = part("p1", "a1")
    const first = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [p1] }))
    const u0 = user("u0")
    const a2 = assistant("a2", "u2")
    const second = transcriptRows(messageTurns([u0, u1, a1, u2, a2]), lookup({ a1: [p1] }), {}, first)

    expect(second[1]).toBe(first[0])
    expect(second[2]).toBe(first[1])
    expect(second[3]).not.toBe(first[2])
    expect(second[4]).not.toBe(first[2])
  })

  it("selects the last real assistant text part as the copy target", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const a2 = assistant("a2", "u1")
    const synthetic: Part = { ...part("p2", "a2"), synthetic: true }
    const blank: Part = { ...part("p3", "a2"), text: " " }
    const rows = transcriptRows(messageTurns([u1, a1, a2]), lookup({ a1: [part("p1", "a1")], a2: [synthetic, blank] }))

    expect(rows.filter((row) => row.type === "assistant").map((row) => row.copy)).toEqual(["p1", "p1"])
  })

  it("keeps compaction replies ordered under the compacted turn and respects revert turns", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2", {
      parts: [{ id: "compact", messageID: "u2", type: "compaction", auto: false }],
    })
    const a2 = assistant("a2", "u1")
    const u3 = user("u3")
    const turns = messageTurns([u1, a1, u2, a2, u3], { messageID: "u3" })
    const rows = transcriptRows(turns, (id) => (id === "u2" ? (u2.parts ?? []) : []))

    expect(rows.map((row) => `${row.turn}:${row.message.id}`)).toEqual(["u1:u1", "u1:a1", "u2:a2"])
  })

  it("hides internal compaction summaries while preserving their errors", () => {
    const u1 = user("u1", {
      parts: [{ id: "compact", messageID: "u1", type: "compaction", auto: false }],
    })
    const summary = assistant("a1", "u1", { summary: true })
    const failed = assistant("a2", "u1", { summary: true, error: { name: "ProviderError" } })
    const rows = transcriptRows(
      messageTurns([u1, summary, failed]),
      lookup({ u1: u1.parts ?? [], a1: [part("p1", "a1")], a2: [part("p2", "a2")] }),
    )

    expect(rows.map((row) => row.type)).toEqual(["error"])
    expect(rows.at(-1)).toMatchObject({ message: failed, error: failed.error })
  })

  it("renders one durable compaction row for every lifecycle state", () => {
    const states = ["running", "succeeded", "failed", "interrupted"] as const
    const messages = states.map((state, index) => user(`u${index}`, { time: { created: index + 1 } }))
    const values = Object.fromEntries(
      states.map((state, index) => {
        const id = `u${index}`
        return [
          id,
          [
            { id: `compact-${id}`, messageID: id, type: "compaction", auto: index % 2 === 0 },
            {
              id: `status-${id}`,
              messageID: id,
              type: "text",
              text: "",
              synthetic: true,
              metadata: {
                "chipmate.compaction": {
                  state,
                  source: index % 2 === 0 ? "auto" : "manual",
                  startedAt: 1_000 + index,
                  ...(state === "running" ? {} : { completedAt: 2_000 + index }),
                },
              },
            },
          ] satisfies Part[],
        ]
      }),
    )

    const rows = transcriptRows(
      messageTurns(messages, undefined, (message) => values[message.id] ?? []),
      lookup(values),
    )

    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.type)).toEqual(["compaction", "compaction", "compaction", "compaction"])
    expect(rows.map((row) => (row.type === "compaction" ? [row.status.state, row.status.source] : undefined))).toEqual([
      ["running", "auto"],
      ["succeeded", "manual"],
      ["failed", "auto"],
      ["interrupted", "manual"],
    ])
  })

  it("renders the compaction status after the triggering context error", () => {
    const compacted = user("u1", {
      parts: [
        { id: "compact", messageID: "u1", type: "compaction", auto: true },
        {
          id: "status",
          messageID: "u1",
          type: "text",
          text: "",
          synthetic: true,
          metadata: {
            "chipmate.compaction": {
              state: "running",
              source: "auto",
              startedAt: 1_000,
            },
          },
        },
      ],
    })
    const failed = assistant("a1", "u1", {
      error: { name: "ContextOverflowError", data: { message: "maximum context length" } },
    })
    const rows = transcriptRows(messageTurns([compacted, failed]), lookup({ u1: compacted.parts ?? [] }))

    expect(rows.map((row) => row.type)).toEqual(["assistant", "error", "compaction"])
    expect(rows.at(-1)).toMatchObject({ type: "compaction", status: { state: "running", source: "auto" } })
  })

  it("keeps every compaction lifecycle state at the end of its turn without reordering QA rows", () => {
    const states = ["running", "succeeded", "failed", "interrupted"] as const

    for (const [index, state] of states.entries()) {
      const id = `u${index}`
      const compacted = user(id, {
        summary: { diffs: [{ file: `${id}.ts` }] },
        parts: [
          { id: `compact-${id}`, messageID: id, type: "compaction", auto: index % 2 === 0 },
          {
            id: `status-${id}`,
            messageID: id,
            type: "text",
            text: "",
            synthetic: true,
            metadata: {
              "chipmate.compaction": {
                state,
                source: index % 2 === 0 ? "auto" : "manual",
                startedAt: 1_000,
                ...(state === "running" ? {} : { completedAt: 2_000 }),
              },
            },
          },
        ],
      })
      const answer = assistant(`a${index}`, id)
      const failed = assistant(`e${index}`, id, { error: { name: "ProviderError" } })
      const rows = transcriptRows(
        messageTurns([compacted, answer, failed]),
        lookup({ [id]: compacted.parts ?? [], [answer.id]: [part(`p${index}`, answer.id)] }),
      )

      expect(rows.map((row) => row.type)).toEqual(["assistant", "assistant", "diff", "error", "compaction"])
      expect(rows.at(-1)).toMatchObject({ type: "compaction", status: { state } })
    }
  })

  it("does not change ordinary QA transcript ordering", () => {
    const u1 = user("u1", { summary: { diffs: [{ file: "a.ts" }] } })
    const answer = assistant("a1", "u1")
    const failed = assistant("a2", "u1", { error: { name: "ProviderError" } })
    const rows = transcriptRows(messageTurns([u1, answer, failed]), lookup({ a1: [part("p1", "a1")] }))

    expect(rows.map((row) => row.type)).toEqual(["user", "assistant", "assistant", "diff", "error"])
  })

  it("replaces only rows whose data or metadata changed", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const p1 = part("p1", "a1")
    const first = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [p1] }))
    const changed = { ...p1, text: "changed" }
    const second = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [changed] }), {}, first)

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])

    const live = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [changed] }), { live: new Set(["u1"]) }, second)
    expect(live[0]).not.toBe(second[0])
    expect(live[1]).not.toBe(second[1])
  })
})

describe("retainTurn", () => {
  it("keeps the completed turn mounted until another turn takes ownership", () => {
    const active = retainTurn(undefined, "session", "u1", false)
    expect(retainTurn(active, "session", undefined, false)).toBe(active)
    expect(retainTurn(active, "session", "u2", false)).toEqual({ sid: "session", turn: "u2" })
  })

  it("keeps the paused turn and clears it when the session changes", () => {
    const active = { sid: "session", turn: "u1" }
    expect(retainTurn(active, "session", "u2", true)).toBe(active)
    expect(retainTurn(active, "other", undefined, false)).toBeUndefined()
  })
})

describe("partitionRows", () => {
  it("keeps completed history and the active user row virtualized", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const a2 = assistant("a2", "u2")
    const parts = Array.from({ length: 18 }, (_, i) => part(`p${i}`, "a2"))
    const rows = transcriptRows(messageTurns([u1, a1, u2, a2]), lookup({ a1: [part("old", "a1")], a2: parts }), {
      live: new Set(["u2"]),
    })
    const result = partitionRows(rows, new Set(["u2"]))

    expect(result.virtual.map((row) => `${row.turn}:${row.type}`)).toEqual([
      "u1:user",
      "u1:assistant",
      "u2:user",
      "u2:assistant",
      "u2:assistant",
    ])
    expect(result.direct.flatMap((row) => (row.type === "assistant" ? row.parts : [])).map((item) => item.id)).toEqual([
      "p16",
      "p17",
    ])
  })

  it("keeps trailing diff and error rows after the direct assistant suffix", () => {
    const u1 = user("u1", { summary: { diffs: [{ file: "a.ts" }] } })
    const a1 = assistant("a1", "u1", { error: { name: "ProviderError" } })
    const rows = transcriptRows(messageTurns([u1, a1]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u1"]),
    })
    const result = partitionRows(rows, new Set(["u1"]))

    expect(result.virtual.map((row) => row.type)).toEqual(["user"])
    expect(result.direct.map((row) => row.type)).toEqual(["assistant", "diff", "error"])
  })

  it("returns a completed suffix to virtual history after queue handoff", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const first = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u1"]),
      queued: new Set(["u2"]),
    })
    const active = partitionRows(first, new Set(["u1"]))
    expect(active.virtual.map((row) => row.type)).toEqual(["user"])
    expect(active.direct.map((row) => row.turn)).toEqual(["u1"])
    expect(active.queued.map((row) => row.turn)).toEqual(["u2"])

    const second = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u2"]),
    })
    const handed = partitionRows(second, new Set(["u2"]))

    expect(handed.direct).toEqual([])
    expect(handed.virtual.filter((row) => row.turn === "u1")).toHaveLength(2)
    expect(handed.virtual.filter((row) => row.turn === "u2")).toHaveLength(1)
  })

  it("does not retain an older turn after a newer visible turn", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const rows = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [part("p1", "a1")] }))
    const result = partitionRows(rows, new Set(["u1"]))

    expect(result.virtual.map((row) => `${row.turn}:${row.type}`)).toEqual(["u1:user", "u1:assistant", "u2:user"])
    expect(result.direct).toEqual([])
  })

  it("skips a held turn without assistant output", () => {
    const u1 = user("u1")
    const u2 = user("u2")
    const a2 = assistant("a2", "u2")
    const rows = transcriptRows(messageTurns([u1, u2, a2]), lookup({ a2: [part("p1", "a2")] }))
    const result = partitionRows(rows, new Set(["u1", "u2"]))

    expect(result.virtual.map((row) => row.turn)).toEqual(["u1", "u2"])
    expect(result.direct.map((row) => `${row.turn}:${row.type}`)).toEqual(["u2:assistant"])
  })

  it("keeps queued rows after virtual and direct rows", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const rows = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [part("p1", "a1")] }), {
      live: new Set(["u1"]),
      queued: new Set(["u2"]),
    })
    const result = partitionRows(rows, new Set(["u1"]))

    expect(result.virtual.map((row) => row.type)).toEqual(["user"])
    expect(result.direct.map((row) => row.type)).toEqual(["assistant"])
    expect(result.queued.map((row) => row.turn)).toEqual(["u2"])
    expect(result.queued[0]).toMatchObject({ type: "user", queued: true })
  })
})

describe("stabilize", () => {
  it("keeps 500 historical rows and their keys stable across 100 live tail deltas", () => {
    const messages: Message[] = []
    const parts: Record<string, Part[]> = {}
    for (let i = 0; i < 250; i += 1) {
      const uid = `history-user-${i}`
      const aid = `history-assistant-${i}`
      messages.push(user(uid), assistant(aid, uid))
      parts[aid] = [part(`history-part-${i}`, aid)]
    }

    const uid = "live-user"
    const aid = "live-assistant"
    messages.push(user(uid), assistant(aid, uid))
    parts[aid] = [part("live-part", aid)]

    const opts = { live: new Set([uid]) }
    const direct = new Set([uid])
    let rows = transcriptRows(messageTurns(messages), lookup(parts), opts)
    let virtual = stabilize(partitionRows(rows, direct).virtual)
    let keys = stabilize(virtual.map((row) => row.key))

    expect(virtual.filter((row) => row.turn !== uid)).toHaveLength(500)

    for (let i = 0; i < 100; i += 1) {
      parts[aid] = [{ ...parts[aid]![0]!, text: `delta-${i}` }]
      const next = transcriptRows(messageTurns(messages), lookup(parts), opts, rows)
      const history = stabilize(partitionRows(next, direct).virtual, virtual)
      const nextKeys = stabilize(
        history.map((row) => row.key),
        keys,
      )

      expect(history).toBe(virtual)
      expect(nextKeys).toBe(keys)
      rows = next
      virtual = history
      keys = nextKeys
    }
  })

  it("returns new virtual arrays for prepend, revert, and part removal", () => {
    const u1 = user("u1")
    const a1 = assistant("a1", "u1")
    const u2 = user("u2")
    const p1 = part("p1", "a1")
    const rows = transcriptRows(messageTurns([u1, a1, u2]), lookup({ a1: [p1] }))
    const virtual = stabilize(partitionRows(rows).virtual)

    const u0 = user("u0")
    const prepended = transcriptRows(messageTurns([u0, u1, a1, u2]), lookup({ a1: [p1] }), {}, rows)
    expect(stabilize(partitionRows(prepended).virtual, virtual)).not.toBe(virtual)

    const reverted = transcriptRows(messageTurns([u1, a1, u2], { messageID: "u2" }), lookup({ a1: [p1] }))
    expect(stabilize(partitionRows(reverted).virtual, virtual)).not.toBe(virtual)

    const removed = transcriptRows(messageTurns([u1, a1, u2]), lookup({}), {}, rows)
    expect(stabilize(partitionRows(removed).virtual, virtual)).not.toBe(virtual)
  })
})
