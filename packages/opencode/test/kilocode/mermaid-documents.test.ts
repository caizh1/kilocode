import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { insertMermaidIntoWord, renderMermaidDiagram, saveMermaidArtifact, validateMermaidDiagram } from "../../src/kilocode/documents/mermaid"
import { createWordDocument, inspectWordDocument } from "../../src/kilocode/documents/word"
import { provideTmpdirInstance } from "../fixture/fixture"

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
const SIMPLE_MERMAID = "flowchart TD\n  A[Start] --> B[Done]"

describe("kilocode Mermaid documents", () => {
  test("validates Mermaid source and saves source/png artifacts", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const valid = validateMermaidDiagram({ source: SIMPLE_MERMAID })
            expect(valid.valid).toBe(true)
            expect(valid.diagramType).toBe("flowchart")

            const invalid = validateMermaidDiagram({ source: "this is not Mermaid" })
            expect(invalid.valid).toBe(false)
            expect(invalid.diagnostics.some((item) => item.code === "mermaid-render-failed")).toBe(true)

            const saved = await saveMermaidArtifact({
              source: SIMPLE_MERMAID,
              pngBase64: PNG_1X1,
              sourceFile: "flow.mmd",
              pngFile: "flow.png",
            })
            expect(saved.sourcePath).toBe(`${saved.artifactDir}/flow.mmd`)
            expect(saved.pngPath).toBe(`${saved.artifactDir}/flow.png`)
            expect(await fs.stat(path.join(dir, saved.sourcePath!))).toBeDefined()
            expect(await fs.stat(path.join(dir, saved.pngPath!))).toBeDefined()
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("renders Mermaid through a remote endpoint and records timeout diagnostics", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const server = Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async () => Response.json({ pngBase64: PNG_1X1 }),
            })
            try {
              const rendered = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                remoteEndpoint: `http://127.0.0.1:${server.port}`,
                sourceFile: "remote.mmd",
                pngFile: "remote.png",
              })
              expect(rendered.rendered).toBe(true)
              expect(rendered.pngPath).toBe(`${rendered.artifactDir}/remote.png`)
              expect(await fs.stat(path.join(dir, rendered.pngPath!))).toBeDefined()
            } finally {
              server.stop(true)
            }

            const slow = Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async () => {
                await new Promise((resolve) => setTimeout(resolve, 50))
                return Response.json({ pngBase64: PNG_1X1 })
              },
            })
            try {
              const timedOut = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                remoteEndpoint: `http://127.0.0.1:${slow.port}`,
                timeoutMs: 1,
              })
              expect(timedOut.rendered).toBe(false)
              expect(timedOut.diagnostics.some((item) => item.code === "mermaid-render-timeout")).toBe(true)
            } finally {
              slow.stop(true)
            }
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("inserts a Mermaid PNG into a new Word artifact", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.promise(async () => {
            const word = await createWordDocument({
              title: "Mermaid Word",
              outputFile: "mermaid-word.docx",
              sections: [{ title: "Diagrams", paragraphs: ["Before diagram"] }],
            })

            const inserted = await insertMermaidIntoWord({
              wordPath: word.path,
              source: SIMPLE_MERMAID,
              pngBase64: PNG_1X1,
              heading: "Diagrams",
              caption: "Figure 1. Mermaid flow",
              outputFile: "mermaid-word-updated.docx",
            })

            expect(inserted.inserted).toBe(true)
            expect(inserted.wordPath).toBe(`${inserted.artifactDir}/mermaid-word-updated.docx`)
            const inspection = await inspectWordDocument({ path: inserted.wordPath! })
            expect(inspection.images.length).toBe(1)
            expect(inspection.paragraphs.some((item) => item.text === "Figure 1. Mermaid flow")).toBe(true)
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })
})
