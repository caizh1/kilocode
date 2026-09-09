import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ChipMateCompactionStatus } from "../../src/chipmate/session/compaction-status"
import { MessageID, SessionID } from "../../src/session/schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ChipMateSessionPrompt } from "../../src/chipmate/session/prompt"

const sessionID = SessionID.make("ses_compaction_status")
const messageID = MessageID.make("msg_compaction_status")

describe("ChipMateCompactionStatus", () => {
  test("keeps the first terminal result when a later abort races with committed success", async () => {
    let stored: SessionV1.Part = ChipMateCompactionStatus.create({
      sessionID,
      messageID,
      source: "auto",
      now: 1_000,
    })
    const store = {
      getPart: () => Effect.succeed(stored),
      updatePart: <T extends SessionV1.Part>(part: T) =>
        Effect.sync(() => {
          stored = part
          return part
        }),
    }

    await Effect.runPromise(
      ChipMateCompactionStatus.transition({
        part: stored as ChipMateCompactionStatus.Part,
        state: "succeeded",
        store,
        now: 2_000,
      }),
    )
    await Effect.runPromise(
      ChipMateCompactionStatus.transition({
        part: stored as ChipMateCompactionStatus.Part,
        state: "interrupted",
        store,
        now: 3_000,
      }),
    )

    expect(ChipMateCompactionStatus.value(stored)).toEqual({
      state: "succeeded",
      source: "auto",
      startedAt: 1_000,
      completedAt: 2_000,
      attempt: 1,
      attemptMode: "selected",
      phase: "preparing",
    })
  })

  test("replaces progress snapshots while preserving lifecycle identity", async () => {
    let stored: SessionV1.Part = ChipMateCompactionStatus.create({
      sessionID,
      messageID,
      source: "manual",
      now: 1_000,
    })
    const store = {
      getPart: () => Effect.succeed(stored),
      updatePart: <T extends SessionV1.Part>(part: T) =>
        Effect.sync(() => {
          stored = part
          return part
        }),
    }

    await Effect.runPromise(
      ChipMateCompactionStatus.progress({
        part: stored as ChipMateCompactionStatus.Part,
        value: {
          attempt: 1,
          attemptMode: "selected",
          phase: "chunk",
          completedUnits: 2,
          totalUnits: 5,
          activity: "splitting",
        },
        store,
      }),
    )
    await Effect.runPromise(
      ChipMateCompactionStatus.progress({
        part: stored as ChipMateCompactionStatus.Part,
        value: {
          attempt: 2,
          attemptMode: "none",
          phase: "generating",
        },
        store,
      }),
    )

    expect(ChipMateCompactionStatus.value(stored)).toEqual({
      state: "running",
      source: "manual",
      startedAt: 1_000,
      completedAt: undefined,
      attempt: 2,
      attemptMode: "none",
      phase: "generating",
      completedUnits: undefined,
      totalUnits: undefined,
      reduceDepth: undefined,
      activity: undefined,
    })
    expect(stored.type).toBe("text")
    if (stored.type !== "text") return
    expect(stored.metadata?.[ChipMateCompactionStatus.key]).toEqual({
      state: "running",
      source: "manual",
      startedAt: 1_000,
      attempt: 2,
      attemptMode: "none",
      phase: "generating",
    })
  })

  test("rejects malformed metadata instead of inferring a terminal result", () => {
    const part = ChipMateCompactionStatus.create({ sessionID, messageID, source: "manual", now: 1_000 })
    expect(
      ChipMateCompactionStatus.value({ ...part, metadata: { [ChipMateCompactionStatus.key]: {} } }),
    ).toBeUndefined()
  })

  test("recovers an old running marker as failed when an idle session resumes", async () => {
    let stored = ChipMateCompactionStatus.create({ sessionID, messageID, source: "manual", now: 1_000 })
    const marker = {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 1_000 },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      },
      parts: [
        {
          id: "prt_compaction",
          messageID,
          sessionID,
          type: "compaction",
          auto: false,
        },
        stored,
      ],
    } as SessionV1.WithParts
    const sessions = {
      messages: () => Effect.succeed([marker]),
      removeMessage: () => Effect.die("unexpected remove"),
      getPart: () => Effect.succeed(stored),
      updatePart: <T extends SessionV1.Part>(part: T) =>
        Effect.sync(() => {
          stored = part as ChipMateCompactionStatus.Part
          return part
        }),
    }

    await Effect.runPromise(
      ChipMateSessionPrompt.recoverDanglingAssistant({
        sessionID,
        status: { get: () => Effect.succeed({ type: "idle" as const }) },
        sessions,
      }),
    )

    expect(ChipMateCompactionStatus.value(stored)?.state).toBe("failed")
  })
})
