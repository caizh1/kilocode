import { expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { testProviderConfig } from "../../lib/test-provider"

cliIt.live(
  "runs a prompt through the migrated internal chipmate provider",
  ({ llm, opencode }) =>
    Effect.gen(function* () {
      const test = testProviderConfig(llm.url)
      const source = test.provider.test
      const { apiKey: _, ...options } = source.options
      const config = {
        ...test,
        model: "chipmate/test-model",
        provider: {
          chipmate: {
            ...source,
            id: "chipmate",
            name: "ChipMate",
            options,
          },
        },
      }

      yield* llm.text("internal provider works")
      const result = yield* opencode.run("say hi", {
        model: "chipmate/test-model",
        timeoutMs: 30_000,
        printLogs: true,
        env: {
          CHIPMATE_INTERNAL_OFFLINE: "1",
          CHIPMATE_CONFIG_CONTENT: JSON.stringify(config),
          CHIPMATE_AUTH_CONTENT: JSON.stringify({ chipmate: { type: "api", key: "test-key" } }),
        },
      })

      opencode.expectExit(result, 0)
      expect(result.stdout).toBe("internal provider works\n")
      expect(result.stderr).not.toContain("JSON Parse error")
    }),
  60_000,
)
