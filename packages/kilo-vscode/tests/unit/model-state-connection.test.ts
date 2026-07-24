import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { SuggestionContext } from "../../src/kilo-provider/handlers/suggestion"

const { routeEarlyMessage } = await import("../../src/kilo-provider/early-message")
const dir = await mkdtemp(join(tmpdir(), "chipmate-model-state-"))

afterAll(() => rm(dir, { force: true, recursive: true }))

describe("model state connection", () => {
  it("waits for the shared backend before reading an early model selection", async () => {
    await writeFile(
      join(dir, "model.json"),
      JSON.stringify({
        model: {
          "agent-console": {
            providerID: "qa-local",
            modelID: "qa-chat-model",
          },
        },
      }),
    )
    const client = {
      path: {
        get: async () => ({ data: { state: dir } }),
      },
    } as unknown as KiloClient
    const calls: string[] = []
    const sent: unknown[] = []
    const connection = {
      getClientAsync: async (root: string) => {
        calls.push(root)
        return client
      },
    } as unknown as KiloConnectionService
    const handled = await routeEarlyMessage(
      { type: "requestModelSelections" },
      {
        question: {} as SuggestionContext,
        client: null,
        connection,
        dir: "C:\\qa\\workspace",
        post: (message) => sent.push(message),
        exportTranscript: async () => undefined,
        openSessions: () => undefined,
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(["C:\\qa\\workspace"])
    expect(sent).toEqual([
      {
        type: "modelSelectionsLoaded",
        selections: {
          "agent-console": {
            providerID: "qa-local",
            modelID: "qa-chat-model",
          },
        },
      },
    ])
  })
})
