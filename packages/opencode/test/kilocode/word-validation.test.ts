import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import {
  applyWordDocumentEdits,
  createWordDocument,
  inspectWordDocument,
  insertWordPngImage,
} from "../../src/kilocode/documents/word"
import { validateWordDocument, validateWordDocumentBytes } from "../../src/kilocode/documents/word-validation"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

function provideTmpdirInstance<A, E>(self: (dir: string) => Effect.Effect<A, E>) {
  return Effect.promise(async () => {
    await using temp = await tmpdir({ git: true })
    return await provideTestInstance({
      directory: temp.path,
      fn: () => Effect.runPromise(self(temp.path).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer))),
    })
  })
}

async function rewrite(source: string, output: string, overrides: Map<string, (bytes: Uint8Array) => Uint8Array>) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(await fs.readFile(source))))
  const writer = new ZipWriter(new Uint8ArrayWriter())
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue
      const bytes = await entry.getData?.(new Uint8ArrayWriter())
      if (!bytes) continue
      const next = overrides.get(entry.filename)?.(bytes) ?? bytes
      await writer.add(entry.filename, new Uint8ArrayReader(next))
    }
    await fs.writeFile(output, await writer.close())
  } finally {
    await reader.close()
  }
}

async function parts(source: string) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(await fs.readFile(source))))
  try {
    return new Map(
      await Promise.all(
        (await reader.getEntries())
          .filter((entry) => !entry.directory)
          .map(async (entry) => [entry.filename, await entry.getData?.(new Uint8ArrayWriter())] as const),
      ),
    )
  } finally {
    await reader.close()
  }
}

function xml(bytes: Uint8Array, transform: (source: string) => string) {
  return new TextEncoder().encode(transform(Buffer.from(bytes).toString("utf8")))
}

describe("kilocode Word XML validation", () => {
  test("reports and safely repairs the missing DrawingML prefix from the Word parser error", async () => {
    await Effect.runPromise(
      provideTmpdirInstance((dir) =>
        Effect.promise(async () => {
          const created = await createWordDocument({
            title: "Namespace Repair",
            summary: ["{{TOC}}"],
            sections: [
              {
                title: "Overview",
                blocks: [
                  { type: "paragraph", text: "Source-backed body." },
                  { type: "image", base64: PNG, contentType: "image/png", width: 1, height: 1 },
                ],
              },
            ],
          })
          const broken = path.join(dir, "missing-a-prefix.docx")
          await rewrite(
            path.join(dir, created.path),
            broken,
            new Map([
              [
                "word/document.xml",
                (bytes) =>
                  xml(bytes, (source) =>
                    source
                      .replace(' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', "")
                      .replace(
                        "<w:sectPr",
                        '<w:p><w:r><w:drawing><a:graphicFrameLocks noChangeAspect="1"/></w:drawing></w:r></w:p><w:sectPr',
                      ),
                  ),
              ],
            ]),
          )

          const invalid = await validateWordDocumentBytes(new Uint8Array(await fs.readFile(broken)))
          expect(invalid.status).toBe("invalid")
          expect(invalid.errors).toContainEqual(
            expect.objectContaining({
              part: "word/document.xml",
              code: "xml-namespace-prefix-undefined",
              prefix: "a",
              line: 1,
            }),
          )
          expect(invalid.errors.find((item) => item.prefix === "a")?.column).toBeGreaterThan(0)

          const repaired = await validateWordDocument({ path: "missing-a-prefix.docx", repairMode: "safe" })
          expect(repaired.status).toBe("repaired")
          expect(repaired.path).toBeDefined()
          expect(repaired.repairs).toContainEqual(
            expect.objectContaining({ part: "word/document.xml", code: "drawing-namespace-added", count: 1 }),
          )
          expect(
            (await validateWordDocumentBytes(new Uint8Array(await fs.readFile(path.join(dir, repaired.path!))))).status,
          ).toBe("valid")
          expect((await validateWordDocumentBytes(new Uint8Array(await fs.readFile(broken)))).status).toBe("invalid")
          const brokenParts = await parts(broken)
          const repairedParts = await parts(path.join(dir, repaired.path!))
          expect(repairedParts.get("word/_rels/document.xml.rels")).toEqual(
            brokenParts.get("word/_rels/document.xml.rels"),
          )
          expect(repairedParts.get("word/media/image1.png")).toEqual(brokenParts.get("word/media/image1.png"))
          const repairedInspection = await inspectWordDocument({ path: repaired.path! })
          expect(repairedInspection.title).toBe("Namespace Repair")
          expect(repairedInspection.paragraphs.some((item) => item.text === "{{TOC}}")).toBe(true)
          expect(repairedInspection.paragraphs.some((item) => item.text === "Source-backed body.")).toBe(true)
          expect(repairedInspection.images).toHaveLength(1)

          const missingRelationshipPrefix = path.join(dir, "missing-r-prefix.docx")
          await rewrite(
            path.join(dir, created.path),
            missingRelationshipPrefix,
            new Map([
              [
                "word/document.xml",
                (bytes) =>
                  xml(bytes, (source) =>
                    source.replace(
                      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
                      "",
                    ),
                  ),
              ],
            ]),
          )
          const repairedRelationshipPrefix = await validateWordDocument({
            path: "missing-r-prefix.docx",
            repairMode: "safe",
          })
          expect(repairedRelationshipPrefix.status).toBe("repaired")
          expect(repairedRelationshipPrefix.repairs).toContainEqual(
            expect.objectContaining({ part: "word/document.xml", code: "drawing-namespace-added", count: 1 }),
          )

          const missingAllDrawingPrefixes = path.join(dir, "missing-all-drawing-prefixes.docx")
          await rewrite(
            path.join(dir, created.path),
            missingAllDrawingPrefixes,
            new Map([
              [
                "word/document.xml",
                (bytes) =>
                  xml(bytes, (source) =>
                    source
                      .replace(/ xmlns:(?:wp|a|pic|r)="[^"]+"/g, "")
                      .replace(
                        "<w:sectPr",
                        '<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdHeader"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr',
                      ),
                  ),
              ],
            ]),
          )
          const repairedAllDrawingPrefixes = await validateWordDocument({
            path: "missing-all-drawing-prefixes.docx",
            repairMode: "safe",
          })
          expect(repairedAllDrawingPrefixes.status).toBe("repaired")
          expect(repairedAllDrawingPrefixes.repairs).toContainEqual(
            expect.objectContaining({ part: "word/document.xml", code: "drawing-namespace-added", count: 4 }),
          )
        }),
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("keeps late image insertion valid after unused root namespaces are pruned", async () => {
    await Effect.runPromise(
      provideTmpdirInstance((dir) =>
        Effect.promise(async () => {
          const created = await createWordDocument({
            title: "Pruned Namespace Source",
            sections: [{ title: "Architecture", paragraphs: ["Architecture body."] }],
          })
          const pruned = path.join(dir, "pruned.docx")
          await rewrite(
            path.join(dir, created.path),
            pruned,
            new Map([
              [
                "word/document.xml",
                (bytes) =>
                  xml(bytes, (source) =>
                    source
                      .replace(' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"', "")
                      .replace(' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', "")
                      .replace(' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"', ""),
                  ),
              ],
            ]),
          )
          expect((await validateWordDocumentBytes(new Uint8Array(await fs.readFile(pruned)))).status).toBe("valid")

          const inserted = await insertWordPngImage({
            sourcePath: "pruned.docx",
            pngBase64: PNG,
            heading: "Architecture",
            caption: "Figure 1. Architecture",
            width: 1,
            height: 1,
          })
          expect(
            (await validateWordDocumentBytes(new Uint8Array(await fs.readFile(path.join(dir, inserted.path))))).status,
          ).toBe("valid")
          expect((await inspectWordDocument({ path: inserted.path })).images).toHaveLength(1)
        }),
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("replaces invalid controls in structured Word text and records the repair", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(() =>
        Effect.promise(async () => {
          const created = await createWordDocument({
            title: "Control Character Repair",
            sections: [{ title: "Overview", paragraphs: ["Before\u0001After"] }],
          })
          expect(created.warnings.some((item) => item.includes("xml-control-character-replaced"))).toBe(true)
          const inspection = await inspectWordDocument({ path: created.path })
          expect(inspection.paragraphs.some((item) => item.text === "Before\uFFFDAfter")).toBe(true)
          const validated = await validateWordDocument({ path: created.path })
          expect(validated.status).toBe("valid")
          expect(validated.warnings.some((item) => item.code === "xml-replacement-character")).toBe(true)
        }),
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("rejects unknown prefixes and malformed raw OOXML without creating a success artifact", async () => {
    await Effect.runPromise(
      provideTmpdirInstance((dir) =>
        Effect.promise(async () => {
          const created = await createWordDocument({
            title: "Unsafe XML",
            sections: [{ title: "Overview", paragraphs: ["Body."] }],
          })
          const unknown = path.join(dir, "unknown-prefix.docx")
          await rewrite(
            path.join(dir, created.path),
            unknown,
            new Map([
              [
                "word/document.xml",
                (bytes) => xml(bytes, (source) => source.replace("<w:sectPr", "<x:unknown/><w:sectPr")),
              ],
            ]),
          )
          const invalid = await validateWordDocument({ path: "unknown-prefix.docx", repairMode: "safe" })
          expect(invalid.status).toBe("invalid")
          expect(invalid.path).toBeUndefined()
          expect(invalid.errors).toContainEqual(
            expect.objectContaining({ code: "xml-namespace-prefix-undefined", prefix: "x" }),
          )

          const root = path.join(dir, path.dirname(created.artifactDir))
          const before = await fs.readdir(root)
          await expect(
            applyWordDocumentEdits({
              sourcePath: created.path,
              dryRun: false,
              edits: [
                {
                  op: "patch_ooxml_part",
                  patch: { part: "word/document.xml", find: "</w:body>", replace: "<w:p></w:body>" },
                },
              ],
            }),
          ).rejects.toThrow("xml-parse-error")
          expect(await fs.readdir(root)).toEqual(before)
        }),
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("rejects image relationships whose media bytes have the wrong signature", async () => {
    await Effect.runPromise(
      provideTmpdirInstance((dir) =>
        Effect.promise(async () => {
          const created = await createWordDocument({
            title: "Image Signature",
            sections: [
              {
                title: "Architecture",
                blocks: [{ type: "image", base64: PNG, contentType: "image/png", width: 1, height: 1 }],
              },
            ],
          })
          const broken = path.join(dir, "bad-image.docx")
          await rewrite(
            path.join(dir, created.path),
            broken,
            new Map([["word/media/image1.png", () => new TextEncoder().encode("not a png")]]),
          )
          const invalid = await validateWordDocumentBytes(new Uint8Array(await fs.readFile(broken)), "safe")
          expect(invalid.status).toBe("invalid")
          expect(invalid.errors).toContainEqual(
            expect.objectContaining({ code: "image-signature-invalid", part: "word/_rels/document.xml.rels" }),
          )
        }),
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("rejects dangling relationship references and missing content type mappings", async () => {
    await Effect.runPromise(
      provideTmpdirInstance((dir) =>
        Effect.promise(async () => {
          const created = await createWordDocument({
            title: "OPC Integrity",
            sections: [
              {
                title: "Architecture",
                blocks: [{ type: "image", base64: PNG, contentType: "image/png", width: 1, height: 1 }],
              },
            ],
          })
          const source = path.join(dir, created.path)
          const dangling = path.join(dir, "dangling-relationship.docx")
          await rewrite(
            source,
            dangling,
            new Map([
              [
                "word/document.xml",
                (bytes) => xml(bytes, (value) => value.replace(/r:embed="[^"]+"/, 'r:embed="rIdMissing"')),
              ],
            ]),
          )
          const danglingResult = await validateWordDocumentBytes(new Uint8Array(await fs.readFile(dangling)), "safe")
          expect(danglingResult.status).toBe("invalid")
          expect(danglingResult.errors).toContainEqual(
            expect.objectContaining({
              part: "word/document.xml",
              code: "relationship-reference-missing",
            }),
          )

          const missingType = path.join(dir, "missing-content-type.docx")
          await rewrite(
            source,
            missingType,
            new Map([
              [
                "[Content_Types].xml",
                (bytes) => xml(bytes, (value) => value.replace(/<Default\b[^>]*Extension="png"[^>]*\/>/i, "")),
              ],
            ]),
          )
          const typeResult = await validateWordDocumentBytes(new Uint8Array(await fs.readFile(missingType)), "safe")
          expect(typeResult.status).toBe("invalid")
          expect(typeResult.errors).toContainEqual(
            expect.objectContaining({
              part: "[Content_Types].xml",
              code: "content-type-missing",
              message: expect.stringContaining("word/media/image1.png"),
            }),
          )
        }),
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })
})
