import { describe, expect, test } from "bun:test"
import { CodeIndexStateManager } from "../../../src/indexing/state-manager"

describe("CodeIndexStateManager", () => {
  test("keeps file unit in the initial snapshot", () => {
    const state = new CodeIndexStateManager()

    expect(state.getCurrentStatus()).toMatchObject({
      systemStatus: "Standby",
      processedItems: 0,
      totalItems: 0,
      currentItemUnit: "files",
      percent: 0,
    })
  })

  test("reports file-based indexing progress", () => {
    const state = new CodeIndexStateManager()

    state.reportFileProgress(2, 5, "foo.ts")

    expect(state.getCurrentStatus()).toMatchObject({
      systemStatus: "Indexing",
      processedItems: 2,
      totalItems: 5,
      currentItemUnit: "files",
      percent: 40,
      message: "Processed 2 / 5 files (40%). Current: foo.ts",
    })
  })

  test("reports active code graph progress separately", () => {
    const state = new CodeIndexStateManager()

    state.reportCodeGraphProgress(2, 4, "main.c")

    expect(state.getCodeGraphProgress()).toEqual({
      state: "Indexing",
      message: "Built 2 / 4 code graph files (50%). Current: main.c",
      processedFiles: 2,
      totalFiles: 4,
      percent: 50,
    })
  })

  test("preserves final file counts on completion", () => {
    const state = new CodeIndexStateManager()

    state.reportFileQueueProgress(3, 3, "bar.ts")
    state.setSystemState("Indexed", "Index up-to-date.")

    expect(state.getCurrentStatus()).toMatchObject({
      systemStatus: "Indexed",
      processedItems: 3,
      totalItems: 3,
      currentItemUnit: "files",
      percent: 100,
    })
  })

  test("clears the prior terminal progress in the first event of a new RAG run", () => {
    const state = new CodeIndexStateManager()
    const events: ReturnType<CodeIndexStateManager["getCurrentStatus"]>[] = []
    state.reportFileQueueProgress(3, 3, "bar.ts")
    state.setSystemState("Indexed", "Index up-to-date.")
    state.onProgressUpdate.on((status) => events.push(status))

    state.setSystemState("Indexing", "Validating embedding configuration...")
    state.setActivePipeline("rag")

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      systemStatus: "Indexing",
      processedItems: 0,
      totalItems: 0,
      percent: 0,
    })
    expect(events[1]?.activePipeline).toBe("rag")
  })
})
