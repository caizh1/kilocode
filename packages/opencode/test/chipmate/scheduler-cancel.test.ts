import { afterAll, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { provide } from "../../src/chipmate/instance"
import { ChipMateSessionPromptQueue } from "../../src/chipmate/session/prompt-queue"
import { SessionID, MessageID } from "../../src/session/schema"
import { disposeTestRuntime, tmpdir } from "../fixture/fixture"

afterAll(disposeTestRuntime)
test("中断中间排队轮次后，后面的人工消息仍须等待前一轮结束", async () => {
  await using directory = await tmpdir({ git: true })
  await provide({
    directory: directory.path,
    fn: async () => {
      const gate = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const calls: string[] = []
      const session = SessionID.make("ses_scheduler_cancel")
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const first = yield* ChipMateSessionPromptQueue.enqueue(
              session,
              MessageID.ascending(),
              Effect.promise(async () => {
                calls.push("第一轮")
                entered.resolve()
                await gate.promise
              }),
              Effect.void,
            ).pipe(Effect.forkChild)
            yield* Effect.promise(() => entered.promise)
            const cancelled = yield* ChipMateSessionPromptQueue.enqueue(
              session,
              MessageID.ascending(),
              Effect.sync(() => {
                calls.push("已取消轮次")
              }),
              Effect.void,
            ).pipe(Effect.forkChild)
            yield* Effect.sleep("10 millis")
            const last = yield* ChipMateSessionPromptQueue.enqueue(
              session,
              MessageID.ascending(),
              Effect.sync(() => {
                calls.push("人工消息")
              }),
              Effect.void,
            ).pipe(Effect.forkChild)
            yield* Fiber.interrupt(cancelled)
            yield* Effect.sleep("20 millis")
            expect(calls).toEqual(["第一轮"])
            gate.resolve()
            yield* Fiber.join(first)
            yield* Fiber.join(last)
            expect(calls).toEqual(["第一轮", "人工消息"])
          }),
        ),
      )
    },
  })
})
