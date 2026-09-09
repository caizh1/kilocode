import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChipMateClient } from "@chipmate/sdk/v2/client"
import type { ChipMateConnectionService } from "../../src/services/cli-backend/connection-service"
import type { SuggestionContext } from "../../src/chipmate-provider/handlers/suggestion"

const { routeEarlyMessage } = await import("../../src/chipmate-provider/early-message")
const ModelState = await import("../../src/chipmate-provider/model-state")
const dir = await mkdtemp(join(tmpdir(), "chipmate-model-state-"))

afterAll(() => rm(dir, { force: true, recursive: true }))

describe("model state connection", () => {
  it("waits for the shared backend before reading an early model selection", async () => {
    await writeFile(
      join(dir, "model.json"),
      JSON.stringify({
        model: {
          code: {
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
      global: { config: { get: async () => ({ data: {} }) } },
    } as unknown as ChipMateClient
    const calls: string[] = []
    const sent: unknown[] = []
    const connection = {
      getClientAsync: async (root: string) => {
        calls.push(root)
        return client
      },
    } as unknown as ChipMateConnectionService
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
          code: {
            providerID: "qa-local",
            modelID: "qa-chat-model",
          },
        },
      },
    ])
  })

  it("loads saved mode selections without migrating legacy extension metadata", async () => {
    await writeFile(
      join(dir, "model.json"),
      JSON.stringify({
        model: { build: { providerID: "legacy", modelID: "deepseek-v4" } },
        favorite: [{ providerID: "qa-local", modelID: "favorite" }],
      }),
    )
    const client = {
      path: { get: async () => ({ data: { state: dir } }) },
    } as unknown as ChipMateClient
    const sent: unknown[] = []

    await ModelState.handleMessage("requestModelSelections", {}, client, (message) => sent.push(message))

    expect(sent).toEqual([
      {
        type: "modelSelectionsLoaded",
        selections: { build: { providerID: "legacy", modelID: "deepseek-v4" } },
      },
    ])
    expect(JSON.parse(await readFile(join(dir, "model.json"), "utf-8"))).toEqual({
      model: { build: { providerID: "legacy", modelID: "deepseek-v4" } },
      favorite: [{ providerID: "qa-local", modelID: "favorite" }],
    })
  })

  it("clears only the explicitly requested mode selection", async () => {
    await writeFile(
      join(dir, "model.json"),
      JSON.stringify({
        model: {
          build: { providerID: "qa-local", modelID: "build" },
          plan: { providerID: "qa-local", modelID: "plan" },
        },
        favorite: [{ providerID: "qa-local", modelID: "favorite" }],
      }),
    )
    const client = {
      path: { get: async () => ({ data: { state: dir } }) },
    } as unknown as ChipMateClient

    await ModelState.handleMessage("clearModelSelection", { agent: "build" }, client, () => undefined)

    expect(JSON.parse(await readFile(join(dir, "model.json"), "utf-8"))).toEqual({
      model: { plan: { providerID: "qa-local", modelID: "plan" } },
      favorite: [{ providerID: "qa-local", modelID: "favorite" }],
    })
  })
})
