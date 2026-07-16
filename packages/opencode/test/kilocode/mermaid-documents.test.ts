import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { PhotonImage } from "@silvia-odwyer/photon-node"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import {
  insertMermaidIntoWord,
  renderMermaidDiagram,
  saveMermaidArtifact,
  validateMermaidDiagram,
} from "../../src/kilocode/documents/mermaid"
import { createWordDocument, inspectWordDocument } from "../../src/kilocode/documents/word"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SIMPLE_MERMAID = "flowchart TD\n  A[Start] --> B[Done]"

function provideTmpdirInstance<A, E>(
  self: (dir: string) => Effect.Effect<A, E>,
  options?: { git?: boolean },
) {
  return Effect.promise(async () => {
    await using temp = await tmpdir(options)
    return await provideTestInstance({
      directory: temp.path,
      fn: () => Effect.runPromise(self(temp.path).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer))),
    })
  })
}

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
              const png = await fs.readFile(path.join(dir, rendered.pngPath!))
              expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
            } finally {
              await server.stop(true)
            }

            const requests: Array<Record<string, unknown>> = []
            const nested = Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async (request) => {
                requests.push((await request.json()) as Record<string, unknown>)
                return Response.json({
                  ok: true,
                  png: { contentType: "image/png", base64: PNG_1X1 },
                  width: 480,
                  height: 280,
                  pixelWidth: 1440,
                  pixelHeight: 840,
                  scale: 3,
                  contentBounds: { x: 10, y: 20, width: 448, height: 238 },
                  cropBounds: { x: 0, y: 0, width: 480, height: 280 },
                  padding: 32,
                  contentCropRatio: 0.79,
                  elapsedMs: 321,
                  renderer: { kind: "remote-opencode", diagramToPng: "mermaid-chromium" },
                  warnings: ["renderer warning"],
                  issues: [
                    {
                      severity: "warning",
                      code: "mermaid-render-content-bounds-suspicious",
                      message: "content bounds need review",
                    },
                  ],
                })
              },
            })
            try {
              const rendered = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                remoteEndpoint: `http://127.0.0.1:${nested.port}`,
                sourceFile: "nested.mmd",
                pngFile: "nested.png",
                scale: 3,
                timeoutMs: 15_000,
              })
              expect(rendered.rendered).toBe(true)
              expect(requests).toEqual([
                {
                  background: "white",
                  source: SIMPLE_MERMAID,
                  filename: "nested.mmd",
                  scale: 3,
                  timeoutMs: 15_000,
                },
              ])
              expect(rendered.width).toBe(480)
              expect(rendered.height).toBe(280)
              expect(rendered.pixelWidth).toBe(1440)
              expect(rendered.pixelHeight).toBe(840)
              expect(rendered.scale).toBe(3)
              expect(rendered.contentBounds).toEqual({ x: 10, y: 20, width: 448, height: 238 })
              expect(rendered.cropBounds).toEqual({ x: 0, y: 0, width: 480, height: 280 })
              expect(rendered.padding).toBe(32)
              expect(rendered.contentCropRatio).toBe(0.79)
              expect(rendered.elapsedMs).toBe(321)
              expect(rendered.renderer).toEqual({ kind: "remote-opencode", diagramToPng: "mermaid-chromium" })
              expect(rendered.issues).toEqual([
                {
                  severity: "warning",
                  code: "mermaid-render-content-bounds-suspicious",
                  message: "content bounds need review",
                },
              ])
              expect(rendered.warnings).toContain("mermaid-render-failed: renderer warning")
              expect(rendered.warnings).toContain(
                "mermaid-render-failed: mermaid-render-content-bounds-suspicious: content bounds need review",
              )
              const png = await fs.readFile(path.join(dir, rendered.pngPath!))
              expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
            } finally {
              await nested.stop(true)
            }

            const rejected = Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async () =>
                Response.json({
                  ok: false,
                  issues: [{ severity: "error", code: "mermaid-source-empty", message: "source is required" }],
                }),
            })
            try {
              const rendered = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                remoteEndpoint: `http://127.0.0.1:${rejected.port}`,
              })
              expect(rendered.rendered).toBe(false)
              expect(rendered.issues).toEqual([
                { severity: "error", code: "mermaid-source-empty", message: "source is required" },
              ])
              expect(rendered.diagnostics).toContainEqual(
                expect.objectContaining({
                  code: "mermaid-render-failed",
                  severity: "error",
                  message: expect.stringContaining("mermaid-source-empty: source is required"),
                }),
              )
            } finally {
              await rejected.stop(true)
            }

            const empty = Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async () => Response.json({ ok: true, issues: [] }),
            })
            try {
              const rendered = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                remoteEndpoint: `http://127.0.0.1:${empty.port}`,
              })
              expect(rendered.rendered).toBe(false)
              expect(rendered.diagnostics).toContainEqual({
                code: "mermaid-render-failed",
                severity: "error",
                message: "remote Mermaid renderer returned no PNG",
              })
            } finally {
              await empty.stop(true)
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
              await slow.stop(true)
            }
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("renders with local mmdc scale, crops content bounds, and falls back after remote failure", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const pixels = new Uint8Array(600 * 450 * 4).fill(255)
            for (let y = 150; y < 300; y += 1) {
              for (let x = 200; x < 400; x += 1) {
                const offset = (y * 600 + x) * 4
                pixels[offset] = 20
                pixels[offset + 1] = 40
                pixels[offset + 2] = 60
              }
            }
            const image = new PhotonImage(pixels, 600, 450)
            const png = Buffer.from(image.get_bytes())
            image.free()

            const fake = path.join(dir, "fake-mmdc")
            const argsPath = path.join(dir, "mmdc-args.json")
            await fs.writeFile(
              fake,
              [
                "#!/usr/bin/env bun",
                "const args = process.argv.slice(2)",
                'const output = args[args.indexOf("-o") + 1]',
                'await Bun.write(output, Buffer.from(process.env["FAKE_MMDC_PNG"]!, "base64"))',
                'await Bun.write(process.env["FAKE_MMDC_ARGS"]!, JSON.stringify(args))',
                "",
              ].join("\n"),
              { mode: 0o755 },
            )

            const previousCommand = process.env["KILO_MERMAID_MMDC"]
            const previousPng = process.env["FAKE_MMDC_PNG"]
            const previousArgs = process.env["FAKE_MMDC_ARGS"]
            const previousEndpoint = process.env["KILO_MERMAID_RENDER_ENDPOINT"]
            process.env["KILO_MERMAID_MMDC"] = fake
            process.env["FAKE_MMDC_PNG"] = png.toString("base64")
            process.env["FAKE_MMDC_ARGS"] = argsPath
            delete process.env["KILO_MERMAID_RENDER_ENDPOINT"]
            try {
              const local = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                sourceFile: "local.mmd",
                pngFile: "local.png",
              })
              expect(local.rendered).toBe(true)
              expect(local.scale).toBe(3)
              expect(local.pixelWidth).toBe(392)
              expect(local.pixelHeight).toBe(342)
              expect(local.width).toBeCloseTo(392 / 3)
              expect(local.height).toBe(114)
              expect(local.contentBounds).toEqual({ x: 200 / 3, y: 50, width: 200 / 3, height: 50 })
              expect(local.cropBounds).toEqual({ x: 104 / 3, y: 18, width: 392 / 3, height: 114 })
              expect(local.padding).toBe(32)
              expect(local.contentCropRatio).toBeCloseTo((200 * 150) / (392 * 342))
              expect(local.renderer).toEqual({
                kind: "local-mmdc",
                diagramToPng: "mmdc",
                crop: "pixel-content-bounds",
              })
              const args = JSON.parse(await fs.readFile(argsPath, "utf8")) as string[]
              expect(args).toContain("white")
              expect(args.slice(args.indexOf("-s"), args.indexOf("-s") + 2)).toEqual(["-s", "3"])

              const remote = Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                fetch: async () => new Response("offline", { status: 503 }),
              })
              try {
                const fallback = await renderMermaidDiagram({
                  source: SIMPLE_MERMAID,
                  remoteEndpoint: `http://127.0.0.1:${remote.port}`,
                  scale: 4,
                })
                expect(fallback.rendered).toBe(true)
                expect(fallback.scale).toBe(4)
                expect(fallback.renderer?.kind).toBe("local-mmdc")
                expect(fallback.diagnostics).toContainEqual(
                  expect.objectContaining({ code: "mermaid-render-remote-failed", severity: "warning" }),
                )
              } finally {
                await remote.stop(true)
              }
            } finally {
              if (previousCommand === undefined) delete process.env["KILO_MERMAID_MMDC"]
              else process.env["KILO_MERMAID_MMDC"] = previousCommand
              if (previousPng === undefined) delete process.env["FAKE_MMDC_PNG"]
              else process.env["FAKE_MMDC_PNG"] = previousPng
              if (previousArgs === undefined) delete process.env["FAKE_MMDC_ARGS"]
              else process.env["FAKE_MMDC_ARGS"] = previousArgs
              if (previousEndpoint === undefined) delete process.env["KILO_MERMAID_RENDER_ENDPOINT"]
              else process.env["KILO_MERMAID_RENDER_ENDPOINT"] = previousEndpoint
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
