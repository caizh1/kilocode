import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Agent } from "../../src/agent/agent"
import { ChipMateToolRegistry } from "../../src/chipmate/tool/registry"
import { RenderPlantUmlDiagramTool } from "../../src/chipmate/tool/plantuml-diagram"
import { MessageID, SessionID } from "../../src/session/schema"
import * as Tool from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
const SOURCE = "@startuml\nclass Controller\nController --> Service\n@enduml"
const rt = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

afterAll(async () => {
  await rt.dispose()
})

function context(agent: string, asks: Parameters<Tool.Context["ask"]>[0][]): Tool.Context {
  return {
    sessionID: SessionID.make("ses_plantuml_tool"),
    messageID: MessageID.make("msg_plantuml_tool"),
    agent,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: (input) => Effect.sync(() => asks.push(input)),
  }
}

async function tool() {
  return rt.runPromise(RenderPlantUmlDiagramTool.pipe(Effect.flatMap(Tool.init)))
}

async function server(
  body: Record<string, unknown>,
  requests: Array<Record<string, unknown>>,
  delay = 0,
  headersFirst = false,
) {
  const service = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.once("end", async () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
      if (headersFirst) {
        response.writeHead(200, { "content-type": "application/json" })
        response.flushHeaders()
      }
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      if (!headersFirst) response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(body))
    })
  })
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve))
  const address = service.address()
  if (!address || typeof address === "string") throw new Error("PlantUML test server did not bind")
  return {
    endpoint: `http://127.0.0.1:${address.port}/render/plantuml`,
    close: () => new Promise<void>((resolve, reject) => service.close((err) => (err ? reject(err) : resolve()))),
  }
}

function rendered() {
  return {
    ok: true,
    png: { contentType: "image/png", base64: PNG },
    width: 1,
    height: 1,
    issues: [],
    elapsedMs: 12,
    metadata: { verified: true },
    renderer: {
      kind: "remote-opencode",
      diagramToPng: "plantuml-java",
      plantumlVersion: "1.2026.6",
      javaPath: "/server/java",
    },
  }
}

async function withEndpoint<T>(endpoint: string | undefined, fn: () => Promise<T>) {
  const previous = process.env["CHIPMATE_PLANTUML_RENDER_ENDPOINT"]
  if (endpoint === undefined) delete process.env["CHIPMATE_PLANTUML_RENDER_ENDPOINT"]
  if (endpoint !== undefined) process.env["CHIPMATE_PLANTUML_RENDER_ENDPOINT"] = endpoint
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env["CHIPMATE_PLANTUML_RENDER_ENDPOINT"]
    if (previous !== undefined) process.env["CHIPMATE_PLANTUML_RENDER_ENDPOINT"] = previous
  }
}

describe("render_plantuml_diagram", () => {
  test.serial("returns a chat PNG attachment without creating workspace files", async () => {
    await using temp = await tmpdir()
    const requests: Array<Record<string, unknown>> = []
    const service = await server(rendered(), requests)
    try {
      await provideTestInstance({
        directory: temp.path,
        fn: () =>
          withEndpoint(service.endpoint, async () => {
            const asks: Parameters<Tool.Context["ask"]>[0][] = []
            const result = await rt.runPromise(
              Effect.gen(function* () {
                const def = yield* RenderPlantUmlDiagramTool.pipe(Effect.flatMap(Tool.init))
                return yield* def.execute(
                  { source: SOURCE, outputMode: "chat", title: "Cortex R8" },
                  context("ask", asks),
                )
              }),
            )

            expect(asks.map((item) => item.permission)).toEqual(["render_plantuml_diagram"])
            expect(requests).toHaveLength(1)
            expect(requests[0]?.source).toBe(SOURCE)
            expect(result.metadata).toMatchObject({ rendered: true, validated: true, width: 1, height: 1 })
            expect(result.attachments).toHaveLength(1)
            expect(result.attachments?.[0]).toMatchObject({
              mime: "image/png",
              filename: "Cortex-R8.png",
            })
            expect(result.attachments?.[0]?.url).toBe(`data:image/png;base64,${PNG}`)
            expect(result.output).not.toContain(PNG)
            expect(await fs.stat(path.join(temp.path, ".chipmate-v2")).catch(() => undefined)).toBeUndefined()
          }),
      })
    } finally {
      await service.close()
    }
  })

  test.serial("saves only requested files in Code and preserves source when rendering fails", async () => {
    await using temp = await tmpdir()
    const requests: Array<Record<string, unknown>> = []
    const service = await server(
      {
        ok: false,
        issues: [{ severity: "error", code: "plantuml-syntax-error", message: "bad syntax" }],
      },
      requests,
    )
    try {
      await provideTestInstance({
        directory: temp.path,
        fn: () =>
          withEndpoint(service.endpoint, async () => {
            const asks: Parameters<Tool.Context["ask"]>[0][] = []
            const result = await rt.runPromise(
              Effect.gen(function* () {
                const def = yield* RenderPlantUmlDiagramTool.pipe(Effect.flatMap(Tool.init))
                return yield* def.execute(
                  {
                    source: SOURCE,
                    outputMode: "file",
                    sourcePath: "docs/cortex-r8.puml",
                    pngPath: "docs/cortex-r8.png",
                  },
                  context("code", asks),
                )
              }),
            )

            expect(asks.map((item) => item.permission)).toEqual(["render_plantuml_diagram", "write"])
            expect(requests).toHaveLength(1)
            expect(await fs.readFile(path.join(temp.path, "docs/cortex-r8.puml"), "utf8")).toBe(SOURCE)
            expect(await fs.stat(path.join(temp.path, "docs/cortex-r8.png")).catch(() => undefined)).toBeUndefined()
            expect(result.metadata).toMatchObject({
              rendered: false,
              sourcePath: "docs/cortex-r8.puml",
              quality: "failed",
            })
            expect(result.attachments).toBeUndefined()
          }),
      })
    } finally {
      await service.close()
    }
  })

  test.serial("writes a requested PNG without creating a source file", async () => {
    await using temp = await tmpdir()
    const requests: Array<Record<string, unknown>> = []
    const service = await server(rendered(), requests)
    try {
      await provideTestInstance({
        directory: temp.path,
        fn: () =>
          withEndpoint(service.endpoint, async () => {
            const result = await rt.runPromise(
              Effect.gen(function* () {
                const def = yield* RenderPlantUmlDiagramTool.pipe(Effect.flatMap(Tool.init))
                return yield* def.execute(
                  { source: SOURCE, outputMode: "file", pngPath: "docs/cortex-r8.png" },
                  context("code", []),
                )
              }),
            )

            expect(Buffer.from(await fs.readFile(path.join(temp.path, "docs/cortex-r8.png"))).toString("base64")).toBe(
              PNG,
            )
            expect(await fs.stat(path.join(temp.path, "docs/cortex-r8.puml")).catch(() => undefined)).toBeUndefined()
            expect(result.metadata).toMatchObject({ rendered: true, pngPath: "docs/cortex-r8.png" })
            expect(result.attachments).toBeUndefined()
          }),
      })
    } finally {
      await service.close()
    }
  })

  test.serial("blocks file mode outside Code before permissions, network, or writes", async () => {
    await using temp = await tmpdir()
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const asks: Parameters<Tool.Context["ask"]>[0][] = []
        const def = await tool()
        const result = await rt.runPromise(
          def.execute({ source: SOURCE, outputMode: "file", sourcePath: "diagram.puml" }, context("plan", asks)),
        )

        expect(asks).toEqual([])
        expect(result.metadata.nextAction).toBe("switch-to-code")
        expect(await fs.stat(path.join(temp.path, "diagram.puml")).catch(() => undefined)).toBeUndefined()
      },
    })
  })

  test.serial("rejects incomplete, multiple, mismatched, and unsafe requests before rendering", async () => {
    await using temp = await tmpdir()
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const def = await tool()
        const ctx = context("code", [])
        const invalid = [
          { source: "@startuml\nclass A", outputMode: "chat" as const },
          { source: `${SOURCE}\n${SOURCE}`, outputMode: "chat" as const },
          { source: SOURCE, outputMode: "chat" as const, pngPath: "diagram.png" },
          { source: SOURCE, outputMode: "file" as const },
          { source: SOURCE, outputMode: "file" as const, sourcePath: "../diagram.puml" },
          { source: SOURCE, outputMode: "file" as const, pngPath: "diagram.jpg" },
          { source: `@startuml\n'${"x".repeat(128 * 1024)}\n@enduml`, outputMode: "chat" as const },
        ]
        for (const params of invalid) {
          const result = await rt.runPromise(def.execute(params, ctx))
          expect(result.metadata.rendered).toBe(false)
        }
      },
    })
  })

  test.serial("rejects missing endpoint, unverified metadata, invalid PNG, and dimension mismatches", async () => {
    await using temp = await tmpdir()
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const def = await tool()
        const missing = await withEndpoint(undefined, () =>
          rt.runPromise(def.execute({ source: SOURCE, outputMode: "chat" }, context("ask", []))),
        )
        expect(missing.metadata.error).toContain("CHIPMATE_PLANTUML_RENDER_ENDPOINT")

        const huge = Buffer.from(PNG, "base64")
        huge.writeUInt32BE(4097, 16)
        for (const body of [
          { ...rendered(), metadata: { verified: false } },
          { ...rendered(), png: { contentType: "image/png", base64: "not-png!" } },
          { ...rendered(), width: 2 },
          { ...rendered(), png: { contentType: "image/png", base64: huge.toString("base64") }, width: 4097 },
        ]) {
          const requests: Array<Record<string, unknown>> = []
          const service = await server(body, requests)
          try {
            const result = await withEndpoint(service.endpoint, () =>
              rt.runPromise(def.execute({ source: SOURCE, outputMode: "chat" }, context("ask", []))),
            )
            expect(result.metadata.rendered).toBe(false)
            expect(result.attachments).toBeUndefined()
          } finally {
            await service.close()
          }
        }
      },
    })
  })

  test.serial(
    "applies timeout until the complete response body arrives",
    async () => {
      await using temp = await tmpdir()
      const requests: Array<Record<string, unknown>> = []
      const service = await server(rendered(), requests, 5_500, true)
      try {
        await provideTestInstance({
          directory: temp.path,
          fn: () =>
            withEndpoint(service.endpoint, async () => {
              const def = await tool()
              const result = await rt.runPromise(
                def.execute({ source: SOURCE, outputMode: "chat", timeoutMs: 5_000 }, context("ask", [])),
              )
              expect(result.metadata).toMatchObject({
                rendered: false,
                error: "PlantUML rendering timed out after 5000ms.",
              })
              expect(result.attachments).toBeUndefined()
              expect(requests).toHaveLength(1)
            }),
        })
      } finally {
        await service.close()
      }
    },
    8_000,
  )

  test("requires an explicit destination choice and keeps the tool scoped to Ask, Code, and Plan", async () => {
    const def = await tool()
    expect(def.description).toContain("if the user has not said whether")
    expect(def.description).toContain("ask that question before calling this tool")
    expect(def.description).toContain("Never probe local PlantUML, Java, or Graphviz")
    expect(def.description).toContain("never fall back to Mermaid")

    const agent = (name: string) => ({ name, mode: "primary" }) as Agent.Info
    expect(ChipMateToolRegistry.available(def, agent("ask"))).toBe(true)
    expect(ChipMateToolRegistry.available(def, agent("code"))).toBe(true)
    expect(ChipMateToolRegistry.available(def, agent("plan"))).toBe(true)
    expect(ChipMateToolRegistry.available(def, agent("debug"))).toBe(false)
    expect(ChipMateToolRegistry.available(def, agent("explore"))).toBe(false)
    expect(ChipMateToolRegistry.available(def, agent("compaction"))).toBe(false)
  })
})
