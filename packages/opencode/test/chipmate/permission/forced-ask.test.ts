import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Bus } from "../../../src/bus"
import * as Config from "../../../src/config/config"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { Permission } from "../../../src/permission"
import { SessionID } from "../../../src/session/schema"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  Permission.layer.pipe(
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Database.defaultLayer),
  ),
  Bus.layer,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)

function withDir(self: () => Effect.Effect<any, any, any>) {
  return provideTmpdirInstance(self, { git: true })
}

describe("forced one-shot permissions", () => {
  it.live("does not let saved allow rules or allow-everything bypass forced approval", () =>
    withDir(() =>
      Effect.gen(function* () {
        const service = yield* Permission.Service
        const id = PermissionV1.ID.make("per_forced_approval")
        const asking = yield* service
          .ask({
            id,
            sessionID: SessionID.make("session_forced_approval"),
            permission: "ufs_review_validation",
            patterns: ["pwd"],
            metadata: { command: "pwd" },
            always: [],
            ruleset: Permission.fromConfig({ ufs_review_validation: "allow" }),
            forceAsk: true,
          })
          .pipe(Effect.forkScoped)

        for (let attempt = 0; attempt < 100; attempt++) {
          if ((yield* service.list()).length > 0) break
          yield* Effect.sleep("10 millis")
        }
        expect((yield* service.list()).map((item) => item.id)).toEqual([id])

        yield* service.allowEverything({ enable: true, requestID: id })
        expect((yield* service.list()).map((item) => item.id)).toEqual([id])

        yield* service.reply({ requestID: id, reply: "once" })
        yield* Fiber.join(asking)
        expect(yield* service.list()).toEqual([])
      }),
    ),
  )
})
