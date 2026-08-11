import { expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { renderMermaidDiagram } from "../../src/chipmate/documents/mermaid"
import { createWordDocument, inspectWordDocument, renderWordDocument } from "../../src/chipmate/documents/word"
import { provideTmpdirInstance } from "../fixture/fixture"

const mermaid = process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
const word = process.env["CHIPMATE_WORD_RENDER_ENDPOINT"]
const enabled = process.env["CHIPMATE_RENDER_INTEGRATION"] === "1" && Boolean(mermaid && word)

test.skipIf(!enabled)(
  "renders two Mermaid figures, embeds them by section, and runs Word render QA through the real service",
  async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const flow = await renderMermaidDiagram({
              source: "flowchart LR\n  A[Receive] --> B{Validate}\n  B -->|OK| C[Complete]\n  B -->|Fail| D[Review]",
              remoteEndpoint: mermaid,
              sourceFile: "main-flow.mmd",
              pngFile: "main-flow.png",
              scale: 3,
            })
            const state = await renderMermaidDiagram({
              source:
                "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> Idle: finish\n  Running --> Failed: error\n  Failed --> Idle: reset",
              remoteEndpoint: mermaid,
              sourceFile: "state-flow.mmd",
              pngFile: "state-flow.png",
              scale: 3,
            })

            for (const result of [flow, state]) {
              expect(result.rendered).toBe(true)
              expect(result.pngPath).toBeDefined()
              expect(result.width).toBeGreaterThan(0)
              expect(result.height).toBeGreaterThan(0)
              expect(result.pixelWidth).toBeGreaterThan(0)
              expect(result.pixelHeight).toBeGreaterThan(0)
              expect(result.scale).toBe(3)
              expect(Array.isArray(result.issues)).toBe(true)
            }

            const created = await createWordDocument({
              title: "Render Service Integration",
              outputFile: "render-service-integration.docx",
              sections: [
                {
                  title: "Main Flow",
                  blocks: [
                    { type: "paragraph", text: "The main request flow is shown below." },
                    {
                      type: "image",
                      path: flow.pngPath,
                      contentType: "image/png",
                      title: "Main flow",
                      caption: "Figure 1. Main request flow",
                      altText: "Request validation and completion flow",
                      width: flow.width ?? 480,
                      height: flow.height ?? 280,
                    },
                    { type: "paragraph", text: "Validation failures move to review." },
                  ],
                },
                {
                  title: "State Flow",
                  blocks: [
                    { type: "paragraph", text: "The lifecycle state flow is shown below." },
                    {
                      type: "image",
                      path: state.pngPath,
                      contentType: "image/png",
                      title: "State flow",
                      caption: "Figure 2. Lifecycle state transitions",
                      altText: "Idle, running, and failed state transitions",
                      width: state.width ?? 480,
                      height: state.height ?? 280,
                    },
                  ],
                },
              ],
            })

            const inspection = await inspectWordDocument({ path: created.path })
            expect(inspection.images).toHaveLength(2)
            expect(inspection.outline.map((item) => item.title)).toEqual(["Main Flow", "State Flow"])

            const bytes = new Uint8Array(await fs.readFile(path.join(dir, created.path)))
            const reader = new ZipReader(new Uint8ArrayReader(bytes))
            const entries = await reader.getEntries()
            const byName = new Map(entries.map((entry) => [entry.filename, entry]))
            const media = entries.filter((entry) => entry.filename.startsWith("word/media/") && !entry.directory)
            const rels = await byName.get("word/_rels/document.xml.rels")!.getData!(new TextWriter())
            const types = await byName.get("[Content_Types].xml")!.getData!(new TextWriter())
            await reader.close()
            expect(media).toHaveLength(2)
            expect(rels.match(/relationships\/image/g)).toHaveLength(2)
            expect(types).toContain('<Default Extension="png" ContentType="image/png"/>')

            const rendered = await renderWordDocument({
              sourcePath: created.path,
              remoteEndpoint: word,
              outputFile: "render-service-integration.pdf",
              maxPages: 20,
            })
            expect(rendered.pdfPath).toBeDefined()
            expect(rendered.pageCount).toBeGreaterThan(0)
            expect(rendered.pagePngPaths.length).toBe(rendered.pageCount)
            expect(rendered.issues).toBeDefined()
            expect(rendered.renderer?.kind).toBe("remote-opencode")
            expect(rendered.pageQa?.length).toBe(rendered.pageCount)
            expect(rendered.pageQa?.every((page) => page.visualSummary)).toBe(true)
            expect(rendered.diagnostics.some((item) => item.severity === "error")).toBe(false)

            const output = process.env["CHIPMATE_RENDER_ACCEPTANCE_DIR"]
            if (!output) return
            await fs.mkdir(output, { recursive: true })
            const files = [
              created.path,
              flow.pngPath!,
              state.pngPath!,
              rendered.pdfPath!,
              ...rendered.pagePngPaths,
              rendered.diagnosticsPath,
            ]
            for (const file of files) {
              await fs.copyFile(path.join(dir, file), path.join(output, path.basename(file)))
            }
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  },
  240_000,
)
