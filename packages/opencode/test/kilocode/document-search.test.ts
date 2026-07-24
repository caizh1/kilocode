import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Agent } from "../../src/agent/agent"
import { DocumentSearchTool } from "../../src/kilocode/tool/document-search"
import { KiloIndexing } from "../../src/kilocode/indexing"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"

const rt = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

async function initTool() {
  return rt.runPromise(
    Effect.gen(function* () {
      const info = yield* DocumentSearchTool
      return yield* Tool.init(info)
    }),
  )
}

const baseCtx = {
  sessionID: SessionID.make("ses_test-document-search"),
  messageID: MessageID.make("msg_test-document-search"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
} satisfies Tool.Context

function stub(state: KiloIndexing.Status["state"] = "Complete") {
  const pipeline = {
    state,
    message: state,
    processedFiles: 1,
    totalFiles: 1,
    percent: state === "Complete" ? 100 : 50,
    errorCount: state === "Error" ? 1 : 0,
    staleCount: 0,
    skippedCount: 0,
  }
  const ready = spyOn(KiloIndexing, "documentReady").mockReturnValue(true)
  const current = spyOn(KiloIndexing, "current").mockResolvedValue({
    state,
    message: state,
    processedFiles: 1,
    totalFiles: 1,
    percent: state === "Complete" ? 100 : 50,
    pipelines: {
      codeGraph: pipeline,
      rag: pipeline,
      documents: pipeline,
    },
  })
  return () => {
    ready.mockRestore()
    current.mockRestore()
  }
}

describe("tool.document_search", () => {
  test("describes indexed workspace document search", async () => {
    const tool = await initTool()

    expect(tool.description).toContain("Search indexed workspace and explicitly approved external documents")
    expect(tool.description).toContain("PDF")
    expect(tool.description).toContain("XLSX")
  })

  test("throws when query is empty", async () => {
    const tool = await initTool()
    expect(rt.runPromise(tool.execute({ query: "" }, baseCtx))).rejects.toThrow("query is required")
  })

  test("asks permission and forwards normalized relative path to document search", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const search = spyOn(KiloIndexing, "searchDocuments").mockResolvedValue([])
        const restore = stub()

        try {
          const tool = await initTool()
          const result = await rt.runPromise(
            tool.execute(
              {
                query: "retention policy",
                path: "./docs/../docs/policy",
                maxResults: 50,
              },
              {
                ...baseCtx,
                ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
                  requests.push(req)
                  return Effect.void
                },
              },
            ),
          )

          expect(requests).toHaveLength(1)
          expect(requests[0]?.permission).toBe("document_search")
          expect(requests[0]?.metadata).toEqual({
            query: "retention policy",
            path: "./docs/../docs/policy",
            maxResults: 50,
          })
          expect(search).toHaveBeenCalledWith("retention policy", {
            directoryPrefix: path.normalize("docs/policy"),
            maxResults: 20,
          })
          expect(result.output).toBe('No relevant documents found for "retention policy" in docs/policy.')
        } finally {
          restore()
          search.mockRestore()
        }
      },
    })
  })

  test("formats and truncates document results", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const search = spyOn(KiloIndexing, "searchDocuments").mockResolvedValue([
          {
            filePath: "docs\\policy.pdf",
            sourceRef: "docs\\policy.pdf#page=4",
            score: 0.923456,
            content: "Alpha ".repeat(400),
            startLine: 4,
            endLine: 4,
          },
        ])
        const restore = stub()

        try {
          const tool = await initTool()
          const result = await rt.runPromise(
            tool.execute({ query: "retention", maxResults: 3, maxPackChars: 1000 }, baseCtx),
          )

          expect(search).toHaveBeenCalledWith("retention", {
            maxResults: 3,
          })
          expect(result.metadata.results).toHaveLength(1)
          expect(result.metadata.truncated).toBe(true)
          expect(result.metadata.maxPackChars).toBe(1000)
          expect(result.output).toContain('Found 1 document result for "retention".')
          expect(result.output).toContain("1. docs/policy.pdf#page=4 (score 0.9235)")
          expect(result.output).toContain("[Document search output truncated by maxPackChars.]")
        } finally {
          restore()
          search.mockRestore()
        }
      },
    })
  })

  test("rejects paths outside the workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const search = spyOn(KiloIndexing, "searchDocuments").mockResolvedValue([])

        try {
          const tool = await initTool()
          expect(rt.runPromise(tool.execute({ query: "policy", path: "../outside" }, baseCtx))).rejects.toThrow(
            "path must be within the current workspace: ../outside",
          )
          expect(search).not.toHaveBeenCalled()
        } finally {
          search.mockRestore()
        }
      },
    })
  })

  test("forwards absolute paths for engine-side approved-root validation", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const search = spyOn(KiloIndexing, "searchDocuments").mockResolvedValue([])
        const restore = stub()
        const external = path.resolve(tmp.path, "..", "manuals")

        try {
          const tool = await initTool()
          await rt.runPromise(tool.execute({ query: "policy", path: external }, baseCtx))

          expect(search).toHaveBeenCalledWith("policy", {
            directoryPrefix: external,
            maxResults: 8,
          })
        } finally {
          restore()
          search.mockRestore()
        }
      },
    })
  })

  test("returns a bounded fallback without asking permission when indexing is not ready", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const ready = spyOn(KiloIndexing, "documentReady").mockReturnValue(false)
        const search = spyOn(KiloIndexing, "searchDocuments").mockResolvedValue([])
        const requests: unknown[] = []

        try {
          const tool = await initTool()
          const result = await rt.runPromise(
            tool.execute(
              { query: "retention policy", maxPackChars: 1000 },
              {
                ...baseCtx,
                ask: (req) => {
                  requests.push(req)
                  return Effect.void
                },
              },
            ),
          )

          expect(result.output).toContain("Document index is not ready yet")
          expect(result.output).toContain("do not repeatedly retry document_search")
          expect(result.output.length).toBeLessThan(240)
          expect(result.metadata.maxPackChars).toBe(1000)
          expect(requests).toHaveLength(0)
          expect(search).not.toHaveBeenCalled()
        } finally {
          ready.mockRestore()
          search.mockRestore()
        }
      },
    })
  })

  test("returns a short fallback when document indexing is in error", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const search = spyOn(KiloIndexing, "searchDocuments").mockResolvedValue([])
        const restore = stub("Error")

        try {
          const tool = await initTool()
          const result = await rt.runPromise(tool.execute({ query: "retention policy" }, baseCtx))

          expect(result.output).toContain("Document index is unavailable (Error)")
          expect(search).not.toHaveBeenCalled()
        } finally {
          restore()
          search.mockRestore()
        }
      },
    })
  })
})
