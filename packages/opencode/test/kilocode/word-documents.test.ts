import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import {
  applyWordDocumentEdits,
  applyWordTemplateStyles,
  createWordDocument,
  diffWordDocuments,
  inspectWordDocument,
  insertWordPngImage,
  materializeWordFields,
  mergeWordDocuments,
  normalizeWordTableSpec,
  renderWordDocument,
} from "../../src/kilocode/documents/word"
import { provideTmpdirInstance } from "../fixture/fixture"

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

describe("kilocode Word documents", () => {
  test("creates a docx artifact and inspects bounded document structure", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            await fs.writeFile(path.join(dir, "diagram.png"), Buffer.from(PNG_1X1, "base64"))

            const created = await createWordDocument({
              title: "Interface Design",
              documentType: "Design",
              outputFile: "interface-design.docx",
              summary: ["Generated from source evidence."],
              sections: [
                {
                  title: "Overview",
                  level: 1,
                  paragraphs: ["This module handles requests."],
                  bullets: ["Validate input", "Dispatch command"],
                  numberedItems: ["Initialize", "Run", "Cleanup"],
                  tables: [{ headers: ["Field", "Meaning"], rows: [["cmd", "Command code"]] }],
                  images: [{ type: "image", path: "diagram.png", caption: "Figure 1. Flow", width: 1, height: 1 }],
                  blocks: [{ type: "code", text: "int main(void) { return 0; }" }],
                },
              ],
            })

            expect(created.artifactDir).toStartWith(".kilo/artifacts/")
            expect(created.path).toBe(`${created.artifactDir}/interface-design.docx`)
            expect(created.manifestPath).toBe(`${created.artifactDir}/artifact.json`)
            expect(await fs.stat(path.join(dir, created.path))).toBeDefined()

            const inspection = await inspectWordDocument({ path: created.path })
            expect(inspection.path).toBe(created.path)
            expect(inspection.outline[0]?.title).toBe("Overview")
            expect(inspection.paragraphs.some((item) => item.text.includes("This module handles requests."))).toBe(true)
            expect(inspection.tables[0]?.rows[0]).toEqual(["Field", "Meaning"])
            expect(inspection.images[0]?.contentType).toBe("image/png")
            expect(inspection.styles).toContain("Heading1")
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("applies standard business brief geometry, fixed tables, real numbering, and page-fit figures", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            await fs.writeFile(path.join(dir, "large.png"), Buffer.from(PNG_1X1, "base64"))
            const created = await createWordDocument({
              title: "Source-backed Design",
              documentType: "Detailed Design",
              outputFile: "standard-business-brief.docx",
              sections: [
                {
                  title: "Architecture",
                  bullets: ["First responsibility", "Second responsibility"],
                  numberedItems: ["Initialize", "Dispatch", "Cleanup"],
                  tables: [
                    {
                      caption: "Table 1. Capability coverage",
                      headers: ["ID", "Status", "Detailed explanation"],
                      rows: [
                        ["A1", "PASS", "Long source-backed explanation for the capability and its evidence."],
                        ["A2", "PARTIAL", "Another detailed explanation with branch and lifecycle coverage."],
                      ],
                    },
                  ],
                  blocks: [
                    { type: "code", language: "typescript", text: "const ready = true\nreturn ready" },
                    {
                      type: "image",
                      path: "large.png",
                      title: "Figure 1. Architecture",
                      caption: "Source-backed architecture with module boundaries.",
                      altText: "Architecture diagram showing module boundaries and dependencies",
                      width: 1200,
                      height: 1600,
                    },
                  ],
                },
              ],
            })

            const bytes = new Uint8Array(await fs.readFile(path.join(dir, created.path)))
            const reader = new ZipReader(new Uint8ArrayReader(bytes))
            const entries = await reader.getEntries()
            const byName = new Map(entries.map((entry) => [entry.filename, entry]))
            const document = await byName.get("word/document.xml")!.getData!(new TextWriter())
            const styles = await byName.get("word/styles.xml")!.getData!(new TextWriter())
            const numbering = await byName.get("word/numbering.xml")!.getData!(new TextWriter())
            const rels = await byName.get("word/_rels/document.xml.rels")!.getData!(new TextWriter())
            const types = await byName.get("[Content_Types].xml")!.getData!(new TextWriter())
            const header = await byName.get("word/header1.xml")!.getData!(new TextWriter())
            const footer = await byName.get("word/footer1.xml")!.getData!(new TextWriter())
            const settings = await byName.get("word/settings.xml")!.getData!(new TextWriter())
            await reader.close()

            expect(document).toContain('<w:pgSz w:w="12240" w:h="15840"/>')
            expect(document).toContain(
              '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>',
            )
            expect(document).toContain('<w:headerReference w:type="default" r:id="rIdHeader"/>')
            expect(document).toContain('<w:footerReference w:type="default" r:id="rIdFooter"/>')
            expect(document).not.toContain('w:w="11906" w:h="16838"')

            expect(styles).toContain('<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri"')
            expect(styles).toContain('<w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/>')
            expect(styles).toContain('<w:spacing w:before="320" w:after="160"/>')
            expect(styles).toContain('<w:color w:val="2E74B5"/><w:sz w:val="32"')
            expect(styles).toContain('<w:spacing w:before="240" w:after="120"/>')
            expect(styles).toContain('<w:spacing w:before="160" w:after="80"/>')

            expect(numbering).toContain('<w:ind w:left="720" w:hanging="360"/>')
            expect(numbering).toContain('<w:spacing w:after="160" w:line="280" w:lineRule="auto"/>')
            expect(document).toContain('<w:numId w:val="1"/>')
            expect(document).toContain('<w:numId w:val="2"/>')

            expect(document).toContain('<w:tblW w:w="9360" w:type="dxa"/>')
            expect(document).toContain('<w:tblInd w:w="120" w:type="dxa"/>')
            expect(document).toContain('<w:tblLayout w:type="fixed"/>')
            expect(document).toContain("<w:tblHeader/>")
            expect(document.match(/<w:cantSplit\/>/g)).toHaveLength(3)
            expect(document).toContain('w:fill="F2F4F7"')
            expect(document).not.toContain('w:type="auto"')
            const grid = [...document.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1]))
            expect(grid.reduce((sum, width) => sum + width, 0)).toBe(9360)
            expect(grid[2]).toBeGreaterThan(grid[0]!)

            expect(document).toContain('<wp:extent cx="5143500" cy="6858000"/>')
            expect(document).toContain('<a:graphicFrameLocks noChangeAspect="1"/>')
            expect(document).toContain('<a:picLocks noChangeAspect="1"/>')
            expect(document).toContain('<w:jc w:val="center"/>')
            expect(document).toContain('descr="Architecture diagram showing module boundaries and dependencies"')
            expect(document).toContain('<w:pStyle w:val="Code"/><w:keepLines/>')
            expect(document).toContain("const ready = true</w:t></w:r><w:r><w:br/></w:r><w:r>")
            const figureOrder = [
              "Figure 1. Architecture",
              'r:embed="rIdImage1"',
              "Source-backed architecture with module boundaries.",
            ].map((token) => document.indexOf(token))
            expect(figureOrder.every((index, offset) => offset === 0 || index > figureOrder[offset - 1]!)).toBe(true)

            expect(rels).toContain('Id="rIdHeader"')
            expect(rels).toContain('Id="rIdFooter"')
            expect(rels).toContain('Id="rIdSettings"')
            expect(types).toContain('PartName="/word/header1.xml"')
            expect(types).toContain('PartName="/word/footer1.xml"')
            expect(header).toContain("Source-backed Design")
            expect(footer).toContain(" PAGE ")
            expect(settings).toContain('<w:updateFields w:val="true"/>')
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("embeds ordered image blocks in target sections with matching OOXML relationships", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            await fs.writeFile(path.join(dir, "architecture.png"), Buffer.from(PNG_1X1, "base64"))
            await fs.writeFile(path.join(dir, "states.png"), Buffer.from(PNG_1X1, "base64"))

            const created = await createWordDocument({
              title: "Two Diagram Design",
              outputFile: "two-diagrams.docx",
              sections: [
                {
                  title: "Architecture",
                  blocks: [
                    { type: "paragraph", text: "Before architecture diagram" },
                    {
                      type: "image",
                      path: "architecture.png",
                      contentType: "image/png",
                      title: "Architecture diagram",
                      caption: "Figure 1. Architecture flow",
                      altText: "Architecture components and flow",
                      width: 480,
                      height: 280,
                    },
                    { type: "paragraph", text: "After architecture diagram" },
                  ],
                },
                {
                  title: "State Flow",
                  blocks: [
                    { type: "paragraph", text: "Before state diagram" },
                    {
                      type: "image",
                      path: "states.png",
                      contentType: "image/png",
                      title: "State diagram",
                      caption: "Figure 2. State flow",
                      altText: "State transitions",
                      width: 420,
                      height: 260,
                    },
                  ],
                },
              ],
            })

            const inspection = await inspectWordDocument({ path: created.path })
            expect(inspection.images).toHaveLength(2)
            expect(inspection.images.every((image) => image.contentType === "image/png")).toBe(true)

            const bytes = new Uint8Array(await fs.readFile(path.join(dir, created.path)))
            const reader = new ZipReader(new Uint8ArrayReader(bytes))
            const entries = await reader.getEntries()
            const byName = new Map(entries.map((entry) => [entry.filename, entry]))
            const media = entries.filter((entry) => entry.filename.startsWith("word/media/") && !entry.directory)
            const document = await byName.get("word/document.xml")!.getData!(new TextWriter())
            const rels = await byName.get("word/_rels/document.xml.rels")!.getData!(new TextWriter())
            const types = await byName.get("[Content_Types].xml")!.getData!(new TextWriter())
            await reader.close()

            expect(media.map((entry) => entry.filename).sort()).toEqual([
              "word/media/image1.png",
              "word/media/image2.png",
            ])
            expect(rels.match(/relationships\/image/g)).toHaveLength(2)
            expect(rels).toContain('Id="rIdImage1"')
            expect(rels).toContain('Target="media/image1.png"')
            expect(rels).toContain('Id="rIdImage2"')
            expect(rels).toContain('Target="media/image2.png"')
            expect(types).toContain('<Default Extension="png" ContentType="image/png"/>')

            const order = [
              "Architecture",
              "Before architecture diagram",
              "Architecture diagram",
              'r:embed="rIdImage1"',
              "Figure 1. Architecture flow",
              "After architecture diagram",
              "State Flow",
              "Before state diagram",
              "State diagram",
              'r:embed="rIdImage2"',
              "Figure 2. State flow",
            ].map((token) => document.indexOf(token))
            expect(order.every((index) => index >= 0)).toBe(true)
            expect(order.every((index, offset) => offset === 0 || index > order[offset - 1]!)).toBe(true)
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("chains repeated image insertions with unique OOXML relationships", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const created = await createWordDocument({
              title: "Sequential Figure Repair",
              outputFile: "sequential-figures.docx",
              sections: [
                { title: "Architecture", paragraphs: ["Architecture evidence."] },
                { title: "State Flow", paragraphs: ["State evidence."] },
              ],
            })
            const first = await insertWordPngImage({
              sourcePath: created.path,
              pngBase64: PNG_1X1,
              heading: "Architecture",
              caption: "Figure 1. Architecture",
              width: 1,
              height: 1,
            })
            const second = await insertWordPngImage({
              sourcePath: first.path,
              pngBase64: PNG_1X1,
              heading: "State Flow",
              caption: "Figure 2. State flow",
              width: 1,
              height: 1,
            })

            const inspection = await inspectWordDocument({ path: second.path })
            expect(inspection.images).toHaveLength(2)

            const bytes = new Uint8Array(await fs.readFile(path.join(dir, second.path)))
            const reader = new ZipReader(new Uint8ArrayReader(bytes))
            const entries = await reader.getEntries()
            const byName = new Map(entries.map((entry) => [entry.filename, entry]))
            const document = await byName.get("word/document.xml")!.getData!(new TextWriter())
            const rels = await byName.get("word/_rels/document.xml.rels")!.getData!(new TextWriter())
            const media = entries.filter((entry) => entry.filename.startsWith("word/media/") && !entry.directory)
            await reader.close()

            const embeds = [...document.matchAll(/r:embed="([^"]+)"/g)].map((match) => match[1])
            expect(embeds).toHaveLength(2)
            expect(new Set(embeds).size).toBe(2)
            expect(embeds.every((id) => rels.includes(`Id="${id}"`))).toBe(true)
            expect(media).toHaveLength(2)
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("rejects unsafe image and inspect paths outside the workspace", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.promise(async () => {
            await expect(
              createWordDocument({
                title: "Unsafe",
                sections: [{ title: "Images", images: [{ type: "image", path: "../outside.png" }] }],
              }),
            ).rejects.toThrow("path must be inside .")

            await expect(inspectWordDocument({ path: "../outside.docx" })).rejects.toThrow("path must be inside .")
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("dry-runs and applies structured Word edits into a new artifact", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            await fs.writeFile(path.join(dir, "diagram.png"), Buffer.from(PNG_1X1, "base64"))
            const created = await createWordDocument({
              title: "Editable Design",
              outputFile: "editable.docx",
              sections: [
                {
                  title: "Overview",
                  paragraphs: ["Old paragraph"],
                  tables: [{ headers: ["A", "B"], rows: [["1", "2"]] }],
                  images: [{ type: "image", path: "diagram.png", width: 1, height: 1 }],
                },
                {
                  title: "Old Section",
                  paragraphs: ["Remove me"],
                },
              ],
            })

            const dryRun = await applyWordDocumentEdits({
              sourcePath: created.path,
              dryRun: true,
              edits: [{ op: "delete_section", locator: { heading: "Old Section" } }],
            })
            expect(dryRun.dryRun).toBe(true)
            expect(dryRun.path).toBeUndefined()
            expect(dryRun.impacts[0]?.summary).toContain("delete section")

            const defaultDeleteDryRun = await applyWordDocumentEdits({
              sourcePath: created.path,
              edits: [{ op: "delete_paragraph", locator: { paragraphText: "Old paragraph" } }],
            })
            expect(defaultDeleteDryRun.dryRun).toBe(true)
            expect(defaultDeleteDryRun.path).toBeUndefined()

            const edited = await applyWordDocumentEdits({
              sourcePath: created.path,
              outputFile: "editable-updated.docx",
              dryRun: false,
              edits: [
                {
                  op: "insert_after_heading",
                  locator: { heading: "Overview" },
                  blocks: [{ type: "paragraph", text: "Inserted after heading." }],
                },
                { op: "replace_paragraph", locator: { paragraphText: "Old paragraph" }, text: "New paragraph" },
                {
                  op: "update_table",
                  locator: { tableIndex: 1 },
                  headers: ["Field", "Meaning"],
                  rows: [["cmd", "Command"]],
                },
                { op: "delete_section", locator: { heading: "Old Section" } },
                {
                  op: "replace_image",
                  locator: { imageIndex: 1 },
                  image: { type: "image", path: "diagram.png", contentType: "image/png" },
                },
              ],
            })

            expect(edited.dryRun).toBe(false)
            expect(edited.path).toBe(`${edited.artifactDir}/editable-updated.docx`)
            expect(edited.backupPath).toBe(`${edited.artifactDir}/editable-source-backup.docx`)
            expect(edited.renderAfterEdit).toBe(false)
            expect(await fs.stat(path.join(dir, edited.path!))).toBeDefined()
            expect(await fs.stat(path.join(dir, edited.backupPath!))).toBeDefined()

            const inspection = await inspectWordDocument({ path: edited.path! })
            expect(inspection.paragraphs.some((item) => item.text === "Inserted after heading.")).toBe(true)
            expect(inspection.paragraphs.some((item) => item.text === "New paragraph")).toBe(true)
            expect(inspection.paragraphs.some((item) => item.text === "Remove me")).toBe(false)
            expect(inspection.tables[0]?.rows[0]).toEqual(["Field", "Meaning"])
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("replaces a paragraph with complex blocks and rejects ambiguous locators", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.promise(async () => {
            const created = await createWordDocument({
              title: "Complex Edit Design",
              outputFile: "complex-edit.docx",
              sections: [
                {
                  title: "Edits",
                  paragraphs: ["TODO", "Keep me", "TODO"],
                },
              ],
            })

            await expect(
              applyWordDocumentEdits({
                sourcePath: created.path,
                dryRun: false,
                edits: [{ op: "replace_paragraph", locator: { paragraphText: "TODO" }, text: "Ambiguous update" }],
              }),
            ).rejects.toThrow("Ambiguous paragraphText")

            const edited = await applyWordDocumentEdits({
              sourcePath: created.path,
              outputFile: "complex-edit-updated.docx",
              dryRun: false,
              edits: [
                {
                  op: "replace_paragraph_with_blocks",
                  locator: { paragraphText: "TODO", occurrence: 2 },
                  blocks: [
                    { type: "paragraph", text: "Resolved replacement" },
                    { type: "list", ordered: true, items: ["Validate", "Apply"] },
                    { type: "table", headers: ["Field", "Value"], rows: [["mode", "safe"]] },
                  ],
                },
              ],
            })

            const inspection = await inspectWordDocument({ path: edited.path! })
            expect(inspection.paragraphs.some((item) => item.text === "Resolved replacement")).toBe(true)
            expect(inspection.paragraphs.some((item) => item.text === "Keep me")).toBe(true)
            expect(inspection.tables[0]?.rows[0]).toEqual(["Field", "Value"])
            expect(inspection.tables[0]?.rows[1]).toEqual(["mode", "safe"])
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("applies controlled OOXML patches and fills content controls", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const created = await createWordDocument({
              title: "Template Design",
              outputFile: "template-source.docx",
              sections: [
                {
                  title: "Template",
                  paragraphs: ["Template placeholder", "Patch me"],
                },
              ],
            })

            const patched = await applyWordDocumentEdits({
              sourcePath: created.path,
              outputFile: "template-with-control.docx",
              edits: [
                {
                  op: "patch_ooxml_part",
                  patch: {
                    part: "word/document.xml",
                    find: '<w:p><w:r><w:t xml:space="preserve">Template placeholder</w:t></w:r></w:p>',
                    replace:
                      '<w:sdt><w:sdtPr><w:alias w:val="Requirement"/><w:tag w:val="req"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t xml:space="preserve">Template placeholder</w:t></w:r></w:p></w:sdtContent></w:sdt>',
                  },
                },
                {
                  op: "patch_ooxml_part",
                  patch: {
                    part: "word/document.xml",
                    find: "Patch me",
                    replace: "Patched via OOXML",
                  },
                },
              ],
            })

            expect(await fs.stat(path.join(dir, patched.path!))).toBeDefined()
            const patchedInspection = await inspectWordDocument({ path: patched.path! })
            expect(patchedInspection.contentControls[0]?.tag).toBe("req")
            expect(patchedInspection.paragraphs.some((item) => item.text === "Patched via OOXML")).toBe(true)

            const filled = await applyWordDocumentEdits({
              sourcePath: patched.path!,
              outputFile: "template-filled.docx",
              edits: [
                { op: "fill_content_control", locator: { contentControlTag: "req" }, text: "Filled requirement" },
              ],
            })
            const filledInspection = await inspectWordDocument({ path: filled.path! })
            expect(filledInspection.contentControls[0]?.text).toBe("Filled requirement")
            expect(filledInspection.paragraphs.some((item) => item.text === "Filled requirement")).toBe(true)

            await expect(
              applyWordDocumentEdits({
                sourcePath: created.path,
                edits: [{ op: "patch_ooxml_part", patch: { part: "../word/document.xml", find: "x", replace: "y" } }],
              }),
            ).rejects.toThrow("unsafe OOXML part path")
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("applies template styles, materializes fields, merges docs with images, and writes bounded diffs", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            await fs.writeFile(path.join(dir, "diagram.png"), Buffer.from(PNG_1X1, "base64"))
            const source = await createWordDocument({
              title: "M4 Source",
              outputFile: "m4-source.docx",
              sections: [
                {
                  title: "Overview",
                  paragraphs: [
                    "{{TOC}}",
                    "{{CAPTION:Figure:Main flow}}",
                    "Figure sequence {{SEQ:Figure}}",
                    "Old diff line",
                  ],
                },
              ],
            })
            const template = await createWordDocument({
              title: "M4 Template",
              outputFile: "m4-template.docx",
              sections: [{ title: "Template", paragraphs: ["Template body"] }],
            })

            const styled = await applyWordTemplateStyles({
              sourcePath: source.path,
              templatePath: template.path,
              outputFile: "m4-styled.docx",
              fontFamily: "Aptos",
            })
            expect(styled.appliedParts).toContain("word/styles.xml")
            expect(styled.warnings.some((item) => item.includes("override source style ids"))).toBe(true)
            expect(await fs.stat(path.join(dir, styled.path))).toBeDefined()

            const materialized = await materializeWordFields({
              sourcePath: styled.path,
              outputFile: "m4-fields.docx",
              tocMode: "materialize",
            })
            expect(materialized.summary.captions).toBe(1)
            expect(materialized.summary.seqFields).toBe(1)
            expect(materialized.summary.toc).toBe("materialized")
            const materializedInspection = await inspectWordDocument({ path: materialized.path })
            expect(materializedInspection.paragraphs.some((item) => item.text === "Figure 1. Main flow")).toBe(true)

            const imageDoc = await createWordDocument({
              title: "M4 Image",
              outputFile: "m4-image.docx",
              sections: [
                { title: "Image Section", images: [{ type: "image", path: "diagram.png", width: 1, height: 1 }] },
              ],
            })
            const merged = await mergeWordDocuments({
              sources: [materialized.path, imageDoc.path],
              outputFile: "m4-merged.docx",
            })
            expect(merged.sourceCount).toBe(2)
            expect(merged.copiedImages).toBe(1)
            const mergedInspection = await inspectWordDocument({ path: merged.path })
            expect(mergedInspection.images.length).toBeGreaterThanOrEqual(1)
            expect(mergedInspection.outline.some((item) => item.title === "Image Section")).toBe(true)

            const changed = await applyWordDocumentEdits({
              sourcePath: materialized.path,
              outputFile: "m4-changed.docx",
              edits: [{ op: "replace_paragraph", locator: { paragraphText: "Old diff line" }, text: "New diff line" }],
            })
            const diff = await diffWordDocuments({
              beforePath: materialized.path,
              afterPath: changed.path!,
              outputFile: "m4-diff.md",
              maxChanges: 10,
            })
            expect(diff.markdownPath).toBe(`${diff.artifactDir}/m4-diff.md`)
            expect(diff.jsonPath).toBe(`${diff.artifactDir}/m4-diff.json`)
            expect(diff.diagnostics.added).toContain("New diff line")
            expect(diff.diagnostics.removed).toContain("Old diff line")
            expect(await fs.stat(path.join(dir, diff.markdownPath))).toBeDefined()
            expect(await fs.stat(path.join(dir, diff.jsonPath))).toBeDefined()

            const normalized = normalizeWordTableSpec({
              maxColumns: 2,
              fillMissingCells: "N/A",
              tables: [{ headers: ["A", "B", "C"], rows: [[" 1 "], ["2", "3", "4"]] }],
            })
            expect(normalized.tables[0]?.headers).toEqual(["A", "B"])
            expect(normalized.tables[0]?.rows[0]).toEqual(["1", "N/A"])
            expect(normalized.warnings.length).toBeGreaterThan(0)
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("renders Word documents through an external endpoint or returns endpoint warnings", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            await fs.writeFile(path.join(dir, "diagram.png"), Buffer.from(PNG_1X1, "base64"))
            const source = await createWordDocument({
              title: "Renderable",
              outputFile: "renderable.docx",
              sections: [{ title: "Render", images: [{ type: "image", path: "diagram.png", width: 1, height: 1 }] }],
            })

            const previousPath = process.env["PATH"]
            const previousEndpoint = process.env["KILO_WORD_RENDER_ENDPOINT"]
            const previousSoffice = process.env["KILO_WORD_RENDER_SOFFICE"]
            const previousPdftoppm = process.env["KILO_WORD_RENDER_PDFTOPPM"]
            try {
              process.env["PATH"] = ""
              delete process.env["KILO_WORD_RENDER_ENDPOINT"]
              delete process.env["KILO_WORD_RENDER_SOFFICE"]
              delete process.env["KILO_WORD_RENDER_PDFTOPPM"]
              const missingEndpoint = await renderWordDocument({ sourcePath: source.path })
              expect(missingEndpoint.pdfPath).toBeUndefined()
              expect(missingEndpoint.pageCount).toBe(0)
              expect(missingEndpoint.visualQaStatus).toBe("skipped")
              expect(missingEndpoint.visualQaSkipReason).toBe("renderer-unavailable")
              expect(
                missingEndpoint.diagnostics.some((item) => item.code === "word-render-endpoint-not-configured"),
              ).toBe(true)
              expect(await fs.stat(path.join(dir, missingEndpoint.diagnosticsPath))).toBeDefined()
            } finally {
              if (previousPath === undefined) delete process.env["PATH"]
              else process.env["PATH"] = previousPath
              if (previousSoffice === undefined) delete process.env["KILO_WORD_RENDER_SOFFICE"]
              else process.env["KILO_WORD_RENDER_SOFFICE"] = previousSoffice
              if (previousPdftoppm === undefined) delete process.env["KILO_WORD_RENDER_PDFTOPPM"]
              else process.env["KILO_WORD_RENDER_PDFTOPPM"] = previousPdftoppm
            }

            const fakeSoffice = path.join(dir, "fake-soffice")
            const fakePdftoppm = path.join(dir, "fake-pdftoppm")
            await fs.writeFile(
              fakeSoffice,
              [
                "#!/usr/bin/env bun",
                'import path from "node:path"',
                "const args = process.argv.slice(2)",
                'const outdir = args[args.indexOf("--outdir") + 1]',
                "const source = args[args.length - 1]",
                'await Bun.write(path.join(outdir, path.basename(source, path.extname(source)) + ".pdf"), "%PDF-1.4\\n%%EOF")',
                "",
              ].join("\n"),
              { mode: 0o755 },
            )
            await fs.writeFile(
              fakePdftoppm,
              [
                "#!/usr/bin/env bun",
                "const prefix = process.argv[process.argv.length - 1]",
                `await Bun.write(prefix + "-1.png", Buffer.from("${PNG_1X1}", "base64"))`,
                "",
              ].join("\n"),
              { mode: 0o755 },
            )
            try {
              process.env["KILO_WORD_RENDER_SOFFICE"] = fakeSoffice
              process.env["KILO_WORD_RENDER_PDFTOPPM"] = fakePdftoppm
              const localRendered = await renderWordDocument({
                sourcePath: source.path,
                outputFile: "local-rendered.pdf",
                maxPages: 3,
              })
              expect(localRendered.pdfPath).toBe(`${localRendered.artifactDir}/local-rendered.pdf`)
              expect(localRendered.pageCount).toBe(1)
              expect(localRendered.visualQaStatus).toBe("completed")
              expect(localRendered.visualQaSkipReason).toBeUndefined()
              expect(localRendered.pagePngPaths[0]).toBe(`${localRendered.artifactDir}/rendered/page-001.png`)
              expect(await fs.stat(path.join(dir, localRendered.pdfPath!))).toBeDefined()
              expect(await fs.stat(path.join(dir, localRendered.pagePngPaths[0]!))).toBeDefined()

              const failedRemote = Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                fetch: async () => new Response("offline", { status: 503 }),
              })
              try {
                const fallback = await renderWordDocument({
                  sourcePath: source.path,
                  remoteEndpoint: `http://127.0.0.1:${failedRemote.port}`,
                  outputFile: "remote-fallback.pdf",
                })
                expect(fallback.visualQaStatus).toBe("completed")
                expect(fallback.pageCount).toBe(1)
                expect(fallback.diagnostics).toContainEqual(
                  expect.objectContaining({ code: "word-render-remote-failed", severity: "warning" }),
                )
              } finally {
                failedRemote.stop(true)
              }
            } finally {
              if (previousEndpoint === undefined) delete process.env["KILO_WORD_RENDER_ENDPOINT"]
              else process.env["KILO_WORD_RENDER_ENDPOINT"] = previousEndpoint
              if (previousSoffice === undefined) delete process.env["KILO_WORD_RENDER_SOFFICE"]
              else process.env["KILO_WORD_RENDER_SOFFICE"] = previousSoffice
              if (previousPdftoppm === undefined) delete process.env["KILO_WORD_RENDER_PDFTOPPM"]
              else process.env["KILO_WORD_RENDER_PDFTOPPM"] = previousPdftoppm
            }

            const server = Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async () =>
                Response.json({
                  pdfBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
                  pages: [
                    { fileName: "rendered/page-001.png", pngBase64: PNG_1X1, blank: true },
                    { fileName: "rendered/page-002.png", pngBase64: Buffer.from("not-png").toString("base64") },
                  ],
                  detectedImageCount: 0,
                  warnings: ["renderer note"],
                }),
            })
            try {
              const rendered = await renderWordDocument({
                sourcePath: source.path,
                remoteEndpoint: `http://127.0.0.1:${server.port}`,
                outputFile: "rendered.pdf",
              })
              expect(rendered.pdfPath).toBe(`${rendered.artifactDir}/rendered.pdf`)
              expect(rendered.pageCount).toBe(1)
              expect(rendered.visualQaStatus).toBe("skipped")
              expect(rendered.visualQaSkipReason).toBe("invalid-page-image")
              expect(rendered.pagePngPaths[0]).toBe(`${rendered.artifactDir}/rendered/page-001.png`)
              expect(rendered.diagnostics.some((item) => item.code === "blank-page")).toBe(true)
              expect(rendered.diagnostics.some((item) => item.code === "png-invalid")).toBe(true)
              expect(rendered.diagnostics.some((item) => item.code === "image-loss-suspected")).toBe(true)
              expect(await fs.stat(path.join(dir, rendered.pdfPath!))).toBeDefined()
              expect(await fs.stat(path.join(dir, rendered.pagePngPaths[0]!))).toBeDefined()
              expect(await fs.stat(path.join(dir, rendered.diagnosticsPath))).toBeDefined()
              const manifest = JSON.parse(await fs.readFile(path.join(dir, rendered.manifestPath), "utf8"))
              expect(manifest.primaryFile).toBe("rendered.pdf")
              expect(manifest.derivedFiles).toContain("rendered/page-001.png")
              expect(manifest.derivedFiles).toContain("render-diagnostics.json")
            } finally {
              server.stop(true)
            }

            const nested = Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async () =>
                Response.json({
                  ok: true,
                  pageCount: 1,
                  pdf: {
                    contentType: "application/pdf",
                    base64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
                  },
                  pages: [
                    {
                      page: 1,
                      contentType: "image/png",
                      base64: PNG_1X1,
                      width: 1224,
                      height: 1584,
                      visualSummary: { page: 1, inkPixels: 200, inkRatio: 0.15 },
                    },
                  ],
                  issues: [{ severity: "warning", code: "word-qa-note", message: "review page spacing" }],
                  renderer: { kind: "remote-opencode", docxToPdf: "libreoffice", pdfToPng: "pdftoppm" },
                }),
            })
            try {
              const rendered = await renderWordDocument({
                sourcePath: source.path,
                remoteEndpoint: `http://127.0.0.1:${nested.port}`,
                outputFile: "nested-rendered.pdf",
              })
              expect(rendered.pdfPath).toBe(`${rendered.artifactDir}/nested-rendered.pdf`)
              expect(rendered.pageCount).toBe(1)
              expect(rendered.visualQaStatus).toBe("completed")
              expect(rendered.visualQaSkipReason).toBeUndefined()
              expect(rendered.issues).toEqual([
                { severity: "warning", code: "word-qa-note", message: "review page spacing" },
              ])
              expect(rendered.renderer).toEqual({
                kind: "remote-opencode",
                docxToPdf: "libreoffice",
                pdfToPng: "pdftoppm",
              })
              expect(rendered.pageQa).toEqual([
                {
                  page: 1,
                  width: 1224,
                  height: 1584,
                  visualSummary: { page: 1, inkPixels: 200, inkRatio: 0.15 },
                },
              ])
              expect(rendered.diagnostics).toContainEqual({
                code: "word-render-remote-failed",
                severity: "warning",
                message: "word-qa-note: review page spacing",
              })
              expect(rendered.diagnostics.some((item) => item.code === "pdf-missing")).toBe(false)
            } finally {
              nested.stop(true)
            }
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })
})
