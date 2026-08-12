import { expect } from "bun:test"
import { Bus } from "@/bus"
import { SkillMarket, HostError } from "@/chipmate/skill-market/service"
import { SessionID } from "@/session/schema"
import { Effect, Fiber, Layer } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(SkillMarket.layer("2 seconds").pipe(Layer.provideMerge(Bus.layer)))
const sessionID = SessionID.make("ses_skill_market_test")

function request(market: SkillMarket.Interface) {
  return market.request({ operation: "list", sessionID, key: "skill-market-test-key", limit: 10 })
}

it.instance(
  "lists and completes a correlated Skill Market request",
  () =>
    Effect.gen(function* () {
      const market = yield* SkillMarket.Service
      const fiber = yield* request(market).pipe(Effect.forkChild)
      const pending = yield* market.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))

      yield* market.reply({ requestID: pending[0].id, result: { operation: "list", result: { skills: [] } } })
      expect(yield* Fiber.join(fiber)).toEqual({ operation: "list", result: { skills: [] } })
      expect(yield* market.list()).toEqual([])

      const late = yield* market
        .reply({ requestID: pending[0].id, result: { operation: "list", result: { skills: [] } } })
        .pipe(Effect.flip)
      expect(late._tag).toBe("SkillMarket.NotFoundError")
    }),
  { git: true },
)

it.instance(
  "propagates a structured Skill Market rejection and clears pending state",
  () =>
    Effect.gen(function* () {
      const market = yield* SkillMarket.Service
      const fiber = yield* request(market).pipe(Effect.forkChild)
      const pending = yield* market.list().pipe(Effect.repeat({ until: (items) => items.length === 1 }))

      yield* market.reject({
        requestID: pending[0].id,
        error: { code: "security_rejected", message: "Skill content failed validation" },
      })
      const error = yield* Fiber.join(fiber).pipe(Effect.flip)
      expect(error).toBeInstanceOf(HostError)
      expect(error.code).toBe("security_rejected")
      expect(error.message).toContain("failed validation")
      expect(yield* market.list()).toEqual([])
    }),
  { git: true },
)
