import fs from "fs/promises"
import { execFile as execFileCallback } from "child_process"
import os from "os"
import path from "path"
import { promisify } from "util"
import { TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { declareArtifact } from "@/kilocode/documents/artifacts"
import { Instance } from "@/project/instance"

const execFile = promisify(execFileCallback)

export type WordBlock =
  | { type: "heading"; level?: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][]; caption?: string }
  | { type: "code"; language?: string; text: string }
  | { type: "image"; title?: string; caption?: string; altText?: string; path?: string; base64?: string; contentType?: "image/png" | "image/jpeg"; width?: number; height?: number }

export type WordSection = {
  id?: string
  title: string
  level?: 1 | 2 | 3
  blocks?: WordBlock[]
  paragraphs?: string[]
  bullets?: string[]
  numberedItems?: string[]
  tables?: Array<{ headers: string[]; rows: string[][]; caption?: string }>
  images?: Array<Extract<WordBlock, { type: "image" }>>
}

export type CreateWordDocumentSpec = {
  title: string
  documentType?: string
  author?: string
  artifactTitle?: string
  taskSlug?: string
  outputFile?: string
  summary?: string[]
  sections: WordSection[]
}

export type CreatedWordDocument = {
  path: string
  artifactDir: string
  manifestPath: string
  warnings: string[]
}

export type WordEditLocator = {
  heading?: string
  occurrence?: number
  paragraphIndex?: number
  paragraphText?: string
  tableIndex?: number
  imageIndex?: number
  imageRelId?: string
  contentControlIndex?: number
  contentControlTag?: string
  contentControlTitle?: string
}

export type WordOoxmlPartPatch = {
  part: string
  find: string
  replace: string
  occurrence?: number
  replaceAll?: boolean
}

export type WordEditOperation =
  | { op: "insert_after_heading"; locator: WordEditLocator; blocks: WordBlock[] }
  | { op: "insert_before_heading"; locator: WordEditLocator; blocks: WordBlock[] }
  | { op: "append_blocks"; blocks: WordBlock[] }
  | { op: "replace_paragraph"; locator: WordEditLocator; text: string }
  | { op: "replace_paragraph_with_blocks"; locator: WordEditLocator; blocks: WordBlock[] }
  | { op: "replace_section"; locator: WordEditLocator; title?: string; level?: 1 | 2 | 3; blocks: WordBlock[] }
  | { op: "delete_paragraph"; locator: WordEditLocator }
  | { op: "delete_section"; locator: WordEditLocator }
  | { op: "delete_table"; locator: WordEditLocator }
  | { op: "update_table"; locator: WordEditLocator; headers: string[]; rows: string[][]; caption?: string }
  | { op: "replace_image"; locator: WordEditLocator; image: Extract<WordBlock, { type: "image" }> }
  | { op: "fill_content_control"; locator: WordEditLocator; text: string }
  | { op: "patch_ooxml_part"; patch: WordOoxmlPartPatch }

export type WordEditImpact = {
  op: WordEditOperation["op"]
  target: string
  summary: string
}

export type ApplyWordDocumentEditsInput = {
  sourcePath: string
  outputFile?: string
  taskSlug?: string
  title?: string
  backup?: boolean
  renderAfterEdit?: boolean
  dryRun?: boolean
  edits: WordEditOperation[]
}

export type AppliedWordDocumentEdits = {
  dryRun: boolean
  path?: string
  artifactDir?: string
  manifestPath?: string
  backupPath?: string
  renderAfterEdit: boolean
  renderResult?: RenderedWordDocument
  impacts: WordEditImpact[]
  warnings: string[]
}

export type ApplyWordTemplateStylesInput = {
  sourcePath: string
  templatePath?: string
  outputFile?: string
  taskSlug?: string
  title?: string
  fontFamily?: string
}

export type AppliedWordTemplateStyles = {
  path: string
  artifactDir: string
  manifestPath: string
  appliedParts: string[]
  warnings: string[]
}

export type MaterializeWordFieldsInput = {
  sourcePath: string
  outputFile?: string
  taskSlug?: string
  title?: string
  tocMode?: "preserve" | "materialize" | "remove"
}

export type MaterializedWordFields = {
  path: string
  artifactDir: string
  manifestPath: string
  summary: {
    seqFields: number
    captions: number
    toc: "none" | "preserved" | "materialized" | "removed"
  }
  warnings: string[]
}

export type MergeWordDocumentsInput = {
  sources: string[]
  outputFile?: string
  taskSlug?: string
  title?: string
  separatorHeading?: boolean
}

export type MergedWordDocuments = {
  path: string
  artifactDir: string
  manifestPath: string
  sourceCount: number
  copiedImages: number
  warnings: string[]
}

export type DiffWordDocumentsInput = {
  beforePath: string
  afterPath: string
  outputFile?: string
  taskSlug?: string
  title?: string
  maxChanges?: number
}

export type DiffWordDocumentsResult = {
  markdownPath: string
  jsonPath: string
  artifactDir: string
  manifestPath: string
  diagnostics: {
    beforeParagraphs: number
    afterParagraphs: number
    added: string[]
    removed: string[]
    changed: Array<{ index: number; before: string; after: string }>
    truncated: boolean
  }
  warnings: string[]
}

export type NormalizeWordTableSpecInput = {
  tables: Array<{ headers: string[]; rows: string[][]; caption?: string }>
  trimCells?: boolean
  fillMissingCells?: string
  maxColumns?: number
}

export type NormalizedWordTableSpec = {
  tables: Array<{
    headers: string[]
    rows: string[][]
    caption?: string
    columnCount: number
    rowCount: number
    warnings: string[]
  }>
  warnings: string[]
}

export type RenderWordDocumentInput = {
  sourcePath: string
  remoteEndpoint?: string
  outputFile?: string
  taskSlug?: string
  title?: string
  timeoutMs?: number
  maxPages?: number
}

export type WordRenderDiagnostic = {
  code: "word-render-endpoint-not-configured" | "word-render-remote-failed" | "word-render-local-failed" | "word-render-local-page-renderer-not-configured" | "pdf-missing" | "pdf-invalid" | "png-invalid" | "page-count-zero" | "page-count-exceeds-limit" | "blank-page" | "image-loss-suspected"
  severity: "warning" | "error"
  message: string
}

export type RenderedWordDocument = {
  artifactDir: string
  manifestPath: string
  pdfPath?: string
  pagePngPaths: string[]
  diagnosticsPath: string
  pageCount: number
  warnings: string[]
  diagnostics: WordRenderDiagnostic[]
}

export type InsertWordPngImageInput = {
  sourcePath: string
  pngPath?: string
  pngBase64?: string
  heading?: string
  caption?: string
  altText?: string
  outputFile?: string
  taskSlug?: string
  title?: string
  width?: number
  height?: number
}

export type InsertedWordPngImage = {
  path: string
  artifactDir: string
  manifestPath: string
  imageRelId: string
  imagePath: string
  warnings: string[]
}

export type WordDocumentInspection = {
  path: string
  title?: string
  paragraphs: Array<{
    index: number
    text: string
    styleId?: string
    headingLevel?: 1 | 2 | 3
    headingPath: string[]
  }>
  outline: Array<{
    level: 1 | 2 | 3
    title: string
    paragraphIndex: number
    headingPath: string[]
  }>
  tables: Array<{
    index: number
    rows: string[][]
    headingPath: string[]
  }>
  images: Array<{
    index: number
    relId: string
    target: string
    contentType?: string
  }>
  contentControls: Array<{
    index: number
    tag?: string
    title?: string
    text: string
  }>
  styles: string[]
  warnings: string[]
  truncated: boolean
}

type ImagePart = {
  relId: string
  mediaPath: string
  target: string
  contentType: "image/png" | "image/jpeg"
  extension: "png" | "jpg"
  bytes: Uint8Array
  width: number
  height: number
  altText: string
}

type RenderContext = {
  images: ImagePart[]
  imageMap: WeakMap<Extract<WordBlock, { type: "image" }>, ImagePart>
}

export async function createWordDocument(spec: CreateWordDocumentSpec): Promise<CreatedWordDocument> {
  validateCreateSpec(spec)
  const context = await buildContext(spec)
  const bytes = await buildDocx(spec, context)
  const artifact = await declareArtifact({
    kind: "word-document",
    title: spec.artifactTitle ?? spec.title,
    taskSlug: spec.taskSlug ?? spec.title,
    primaryFile: safeDocxName(spec.outputFile ?? spec.title),
    qualityStatus: "unknown",
  })
  const output = path.join(Instance.directory, artifact.artifactDir, artifact.manifest.primaryFile ?? safeDocxName(spec.title))
  assertInside(path.join(Instance.directory, artifact.artifactDir), output, "outputFile")
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, bytes)
  return {
    path: normalizePortable(path.relative(Instance.directory, output)),
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
    warnings: [],
  }
}

export async function inspectWordDocument(input: { path: string; maxParagraphs?: number; maxTables?: number }): Promise<WordDocumentInspection> {
  const absolute = resolveWorkspacePath(input.path)
  const bytes = await fs.readFile(absolute)
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)))
  try {
    const entries = await zip.getEntries()
    const byName = new Map(entries.map((entry) => [entry.filename, entry]))
    const documentXml = await readEntryText(byName, "word/document.xml")
    if (!documentXml) throw new Error(`DOCX is missing word/document.xml: ${input.path}`)
    const relsXml = await readEntryText(byName, "word/_rels/document.xml.rels")
    const stylesXml = await readEntryText(byName, "word/styles.xml")
    const paragraphs = parseParagraphs(documentXml)
    const tables = parseTables(documentXml)
    const maxParagraphs = clamp(input.maxParagraphs ?? 120, 1, 1_000)
    const maxTables = clamp(input.maxTables ?? 20, 1, 200)
    const outline: WordDocumentInspection["outline"] = []
    const headingPath: string[] = []
    const inspectedParagraphs: WordDocumentInspection["paragraphs"] = []
    for (const paragraph of paragraphs) {
      const headingLevel = headingLevelFromStyle(paragraph.styleId)
      if (headingLevel && paragraph.text.trim()) {
        headingPath[headingLevel - 1] = paragraph.text.trim()
        headingPath.length = headingLevel
        outline.push({
          level: headingLevel,
          title: paragraph.text.trim(),
          paragraphIndex: paragraph.index,
          headingPath: [...headingPath],
        })
      }
      if (inspectedParagraphs.length < maxParagraphs) {
        inspectedParagraphs.push({
          ...paragraph,
          headingLevel,
          headingPath: [...headingPath],
        })
      }
    }
    return {
      path: normalizePortable(path.relative(Instance.directory, absolute)),
      title: outline[0]?.title,
      paragraphs: inspectedParagraphs,
      outline,
      tables: tables.slice(0, maxTables).map((table, index) => ({
        index: index + 1,
        rows: table,
        headingPath: [],
      })),
      images: parseImages(relsXml ?? "", byName),
      contentControls: parseContentControls(documentXml).map((item) => ({
        index: item.index,
        tag: item.tag,
        title: item.title,
        text: item.text,
      })),
      styles: parseStyles(stylesXml ?? ""),
      warnings: [],
      truncated: paragraphs.length > inspectedParagraphs.length || tables.length > maxTables,
    }
  } finally {
    await zip.close()
  }
}

export async function applyWordDocumentEdits(input: ApplyWordDocumentEditsInput): Promise<AppliedWordDocumentEdits> {
  if (!Array.isArray(input.edits) || input.edits.length === 0) throw new Error("apply_word_document_edits edits must not be empty")
  for (const edit of input.edits) {
    if (edit.op === "patch_ooxml_part") safeOoxmlPart(edit.patch.part)
  }
  const effectiveDryRun = input.dryRun ?? input.edits.some(isDeleteEdit)
  const source = resolveWorkspacePath(input.sourcePath)
  const bytes = new Uint8Array(await fs.readFile(source))
  const zip = new ZipReader(new Uint8ArrayReader(bytes))
  const warnings: string[] = []
  try {
    const entries = await zip.getEntries()
    const byName = new Map(entries.map((entry) => [entry.filename, entry]))
    let documentXml = await readEntryText(byName, "word/document.xml")
    if (!documentXml) throw new Error(`DOCX is missing word/document.xml: ${input.sourcePath}`)
    let relsXml = (await readEntryText(byName, "word/_rels/document.xml.rels")) ?? documentRelationshipsXml({ images: [], imageMap: new WeakMap() })
    const textOverrides: Record<string, string> = {}
    const mediaUpdates = new Map<string, Uint8Array>()
    const impacts: WordEditImpact[] = []
    for (const edit of input.edits) {
      const result = await planAndApplyEdit(documentXml, relsXml, edit, byName, textOverrides)
      impacts.push(result.impact)
      if (!effectiveDryRun) {
        documentXml = result.documentXml
        relsXml = result.relsXml
        Object.assign(textOverrides, result.textOverrides)
        for (const update of result.mediaUpdates) mediaUpdates.set(update.path, update.bytes)
      }
      warnings.push(...result.warnings)
    }
    if (effectiveDryRun) return { dryRun: true, renderAfterEdit: false, impacts, warnings }

    const backupEnabled = input.backup ?? true
    const backupFile = backupEnabled ? safeDocxName(`${path.basename(input.sourcePath, ".docx")}-source-backup.docx`) : undefined
    const artifact = await declareArtifact({
      kind: "word-document",
      title: input.title ?? `Edited ${path.basename(input.sourcePath)}`,
      taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-edited`,
      primaryFile: safeDocxName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}-edited.docx`),
      derivedFiles: backupFile ? [backupFile] : [],
      warnings,
      qualityStatus: warnings.length ? "warning" : "unknown",
    })
    const output = path.join(Instance.directory, artifact.artifactDir, artifact.manifest.primaryFile ?? safeDocxName("edited.docx"))
    assertInside(path.join(Instance.directory, artifact.artifactDir), output, "outputFile")
    await fs.mkdir(path.dirname(output), { recursive: true })
    const backupPath = backupFile ? path.join(Instance.directory, artifact.artifactDir, backupFile) : undefined
    if (backupPath) {
      assertInside(path.join(Instance.directory, artifact.artifactDir), backupPath, "backupFile")
      await fs.writeFile(backupPath, bytes)
    }
    const nextBytes = await rewriteDocx(entries, {
      "word/document.xml": documentXml,
      "word/_rels/document.xml.rels": relsXml,
      ...textOverrides,
    }, mediaUpdates)
    await fs.writeFile(output, nextBytes)
    const outputPath = normalizePortable(path.relative(Instance.directory, output))
    let renderResult: RenderedWordDocument | undefined
    if (input.renderAfterEdit) {
      try {
        renderResult = await renderWordDocument({
          sourcePath: outputPath,
          taskSlug: `${path.basename(input.sourcePath, ".docx")}-edited-render`,
          title: `Render ${path.basename(outputPath)}`,
        })
        warnings.push(...renderResult.warnings.map((warning) => `render-after-edit: ${warning}`))
      } catch (error) {
        warnings.push(`render-after-edit-failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return {
      dryRun: false,
      path: outputPath,
      artifactDir: artifact.artifactDir,
      manifestPath: artifact.manifestPath,
      backupPath: backupPath ? normalizePortable(path.relative(Instance.directory, backupPath)) : undefined,
      renderAfterEdit: input.renderAfterEdit === true,
      renderResult,
      impacts,
      warnings,
    }
  } finally {
    await zip.close()
  }
}

export async function applyWordTemplateStyles(input: ApplyWordTemplateStylesInput): Promise<AppliedWordTemplateStyles> {
  const source = await readDocxSnapshot(input.sourcePath)
  const warnings: string[] = []
  const textOverrides: Record<string, string> = {}
  const appliedParts: string[] = []
  if (input.templatePath?.trim()) {
    const template = await readDocxSnapshot(input.templatePath)
    const sourceStyles = snapshotText(source, "word/styles.xml")
    const templateStyles = snapshotText(template, "word/styles.xml")
    if (templateStyles) {
      const conflicts = parseStyles(sourceStyles ?? "").filter((styleId) => parseStyles(templateStyles).includes(styleId))
      if (conflicts.length) warnings.push(`template styles override source style ids: ${conflicts.slice(0, 20).join(", ")}`)
      textOverrides["word/styles.xml"] = input.fontFamily ? applyDefaultFontToStyles(templateStyles, input.fontFamily) : templateStyles
      appliedParts.push("word/styles.xml")
    } else {
      warnings.push(`template is missing word/styles.xml: ${input.templatePath}`)
    }
    const templateNumbering = snapshotText(template, "word/numbering.xml")
    if (templateNumbering) {
      textOverrides["word/numbering.xml"] = templateNumbering
      appliedParts.push("word/numbering.xml")
    }
    const templateTheme = snapshotText(template, "word/theme/theme1.xml")
    if (templateTheme) {
      textOverrides["word/theme/theme1.xml"] = templateTheme
      textOverrides["word/_rels/document.xml.rels"] = ensureRelationship(
        textOverrides["word/_rels/document.xml.rels"] ?? snapshotText(source, "word/_rels/document.xml.rels") ?? documentRelationshipsXml({ images: [], imageMap: new WeakMap() }),
        "rIdKiloTheme",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
        "theme/theme1.xml",
      )
      textOverrides["[Content_Types].xml"] = ensureContentTypeOverride(
        textOverrides["[Content_Types].xml"] ?? snapshotText(source, "[Content_Types].xml") ?? contentTypesXml({ images: [], imageMap: new WeakMap() }),
        "/word/theme/theme1.xml",
        "application/vnd.openxmlformats-officedocument.theme+xml",
      )
      appliedParts.push("word/theme/theme1.xml")
    }
  } else if (input.fontFamily?.trim()) {
    textOverrides["word/styles.xml"] = applyDefaultFontToStyles(snapshotText(source, "word/styles.xml") ?? stylesXml(), input.fontFamily)
    appliedParts.push("word/styles.xml")
  } else {
    warnings.push("apply_word_template_styles did not receive templatePath or fontFamily; source document is copied unchanged")
  }
  const written = await writeDocxArtifact(source, textOverrides, new Map(), {
    title: input.title ?? `Styled ${path.basename(input.sourcePath)}`,
    taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-styled`,
    outputFile: safeDocxName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}-styled.docx`),
    warnings,
  })
  return { ...written, appliedParts, warnings }
}

export async function materializeWordFields(input: MaterializeWordFieldsInput): Promise<MaterializedWordFields> {
  const source = await readDocxSnapshot(input.sourcePath)
  const documentXml = requiredSnapshotText(source, "word/document.xml", input.sourcePath)
  const result = materializeFieldsInDocument(documentXml, input.tocMode ?? "preserve")
  const warnings = [...result.warnings]
  if (!result.summary.seqFields && !result.summary.captions && result.summary.toc === "none") warnings.push("no supported Word field placeholders were found")
  const written = await writeDocxArtifact(source, { "word/document.xml": result.xml }, new Map(), {
    title: input.title ?? `Fields ${path.basename(input.sourcePath)}`,
    taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-fields`,
    outputFile: safeDocxName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}-fields.docx`),
    warnings,
  })
  return { ...written, summary: result.summary, warnings }
}

export async function mergeWordDocuments(input: MergeWordDocumentsInput): Promise<MergedWordDocuments> {
  if (!Array.isArray(input.sources) || input.sources.length < 2) throw new Error("merge_word_documents requires at least two source documents")
  const snapshots = await Promise.all(input.sources.map(readDocxSnapshot))
  const base = snapshots[0]!
  const baseDocumentXml = requiredSnapshotText(base, "word/document.xml", input.sources[0]!)
  const baseBody = splitDocumentBody(baseDocumentXml)
  let relsXml = snapshotText(base, "word/_rels/document.xml.rels") ?? documentRelationshipsXml({ images: [], imageMap: new WeakMap() })
  let contentTypes = snapshotText(base, "[Content_Types].xml") ?? contentTypesXml({ images: [], imageMap: new WeakMap() })
  const binaryOverrides = new Map<string, Uint8Array>()
  const bodyParts = [baseBody.content]
  const warnings: string[] = []
  let copiedImages = 0
  let nextRel = maxRelationshipNumber(relsXml) + 1
  let nextImage = maxMediaImageNumber(base.bytes) + 1
  for (let index = 1; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index]!
    const label = path.basename(input.sources[index]!)
    const documentXml = requiredSnapshotText(snapshot, "word/document.xml", input.sources[index]!)
    let body = remapBookmarkIds(splitDocumentBody(documentXml).content, index * 10_000)
    const imageRels = parseImageRelationships(snapshotText(snapshot, "word/_rels/document.xml.rels") ?? "")
    for (const rel of imageRels) {
      const mediaPath = `word/${rel.target}`
      const bytes = snapshot.bytes.get(mediaPath)
      if (!bytes) {
        warnings.push(`missing image media while merging ${label}: ${mediaPath}`)
        continue
      }
      const ext = path.extname(rel.target).toLowerCase() || ".png"
      const newRelId = `rIdMergedImage${nextRel++}`
      const newTarget = `media/merged${index + 1}_${nextImage++}${ext}`
      binaryOverrides.set(`word/${newTarget}`, bytes)
      body = body.split(`r:embed="${rel.relId}"`).join(`r:embed="${newRelId}"`)
      relsXml = appendRelationship(relsXml, newRelId, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", newTarget)
      contentTypes = ensureImageContentType(contentTypes, newTarget)
      copiedImages += 1
    }
    if (input.separatorHeading ?? true) bodyParts.push(paragraph(label.replace(/\.docx$/i, ""), "Heading1"))
    bodyParts.push(body)
  }
  const documentXml = replaceDocumentBody(baseDocumentXml, `${bodyParts.join("")}${baseBody.sectPr}`)
  const written = await writeDocxArtifact(base, {
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels": relsXml,
    "[Content_Types].xml": contentTypes,
  }, binaryOverrides, {
    title: input.title ?? "Merged Word Document",
    taskSlug: input.taskSlug ?? "merged-word-document",
    outputFile: safeDocxName(input.outputFile ?? "merged-word-document.docx"),
    warnings,
  })
  return { ...written, sourceCount: input.sources.length, copiedImages, warnings }
}

export async function diffWordDocuments(input: DiffWordDocumentsInput): Promise<DiffWordDocumentsResult> {
  const before = await readDocxSnapshot(input.beforePath)
  const after = await readDocxSnapshot(input.afterPath)
  const beforeParagraphs = parseParagraphs(requiredSnapshotText(before, "word/document.xml", input.beforePath)).map((item) => item.text).filter(Boolean)
  const afterParagraphs = parseParagraphs(requiredSnapshotText(after, "word/document.xml", input.afterPath)).map((item) => item.text).filter(Boolean)
  const diagnostics = diffParagraphText(beforeParagraphs, afterParagraphs, clamp(input.maxChanges ?? 80, 1, 500))
  const markdown = diffMarkdown(input.beforePath, input.afterPath, diagnostics)
  const warnings = diagnostics.truncated ? ["diff output truncated to maxChanges"] : []
  const primaryFile = safeMarkdownName(input.outputFile ?? "word-diff.md")
  const jsonFile = primaryFile.replace(/\.md$/i, ".json")
  const artifact = await declareArtifact({
    kind: "word-diff",
    title: input.title ?? "Word Diff",
    taskSlug: input.taskSlug ?? "word-diff",
    primaryFile,
    derivedFiles: [jsonFile],
    warnings,
    qualityStatus: warnings.length ? "warning" : "ok",
  })
  const artifactDir = path.join(Instance.directory, artifact.artifactDir)
  const markdownPath = path.join(artifactDir, primaryFile)
  const jsonPath = path.join(artifactDir, jsonFile)
  assertInside(artifactDir, markdownPath, "outputFile")
  assertInside(artifactDir, jsonPath, "jsonFile")
  await fs.mkdir(artifactDir, { recursive: true })
  await fs.writeFile(markdownPath, markdown, "utf8")
  await fs.writeFile(jsonPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8")
  return {
    markdownPath: normalizePortable(path.relative(Instance.directory, markdownPath)),
    jsonPath: normalizePortable(path.relative(Instance.directory, jsonPath)),
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
    diagnostics,
    warnings,
  }
}

export function normalizeWordTableSpec(input: NormalizeWordTableSpecInput): NormalizedWordTableSpec {
  if (!Array.isArray(input.tables) || input.tables.length === 0) throw new Error("normalize_word_table_spec tables must not be empty")
  const tables = input.tables.map((table, index) => normalizeTableSpec(table, {
    trimCells: input.trimCells ?? true,
    fillMissingCells: input.fillMissingCells ?? "",
    maxColumns: input.maxColumns,
    label: `tables[${index}]`,
  }))
  return {
    tables,
    warnings: tables.flatMap((table, index) => table.warnings.map((warning) => `tables[${index}]: ${warning}`)),
  }
}

export async function renderWordDocument(input: RenderWordDocumentInput): Promise<RenderedWordDocument> {
  const source = resolveWorkspacePath(input.sourcePath)
  const endpoint = input.remoteEndpoint?.trim() || process.env["KILO_WORD_RENDER_ENDPOINT"]?.trim()
  const diagnostics: WordRenderDiagnostic[] = []
  const warnings: string[] = []
  const maxPages = clamp(input.maxPages ?? 500, 1, 2_000)
  const diagnosticsFile = "render-diagnostics.json"
  if (!endpoint) {
    const local = await tryLocalWordRenderer(source, input, maxPages, input.timeoutMs ?? 120_000)
    if (!local) {
      diagnostics.push({
        code: "word-render-endpoint-not-configured",
        severity: "warning",
        message: "Word render remote endpoint is not configured and no local soffice executable was found; set remoteEndpoint, KILO_WORD_RENDER_ENDPOINT, KILO_WORD_RENDER_SOFFICE, or put soffice on PATH to render PDF/page PNG artifacts.",
      })
      warnings.push(...diagnostics.map((item) => `${item.code}: ${item.message}`))
      const artifact = await declareArtifact({
        kind: "word-render",
        title: input.title ?? `Render ${path.basename(input.sourcePath)}`,
        taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-render`,
        derivedFiles: [diagnosticsFile],
        sourceFiles: [normalizePortable(path.relative(Instance.directory, source))],
        warnings,
        qualityStatus: "warning",
      })
      const artifactDir = path.join(Instance.directory, artifact.artifactDir)
      const diagnosticsPath = path.join(artifactDir, diagnosticsFile)
      await fs.writeFile(diagnosticsPath, `${JSON.stringify({ diagnostics, warnings, pageCount: 0, pagePngPaths: [] }, null, 2)}\n`, "utf8")
      return {
        artifactDir: artifact.artifactDir,
        manifestPath: artifact.manifestPath,
        diagnosticsPath: normalizePortable(path.relative(Instance.directory, diagnosticsPath)),
        pagePngPaths: [],
        pageCount: 0,
        warnings,
        diagnostics,
      }
    }
    diagnostics.push(...local.diagnostics)
    return writeRenderedWordArtifacts(input, source, local.response, diagnostics, maxPages, diagnosticsFile)
  }
  const docxBytes = new Uint8Array(await fs.readFile(source))
  let response: RemoteWordRenderResponse
  try {
    response = await callWordRenderer(endpoint, {
      fileName: path.basename(input.sourcePath),
      docxBase64: Buffer.from(docxBytes).toString("base64"),
      output: { pdf: true, pngPages: true },
      timeoutMs: input.timeoutMs,
    }, input.timeoutMs ?? 120_000)
  } catch (err) {
    diagnostics.push({
      code: "word-render-remote-failed",
      severity: "error",
      message: err instanceof Error ? err.message : String(err),
    })
    warnings.push(...diagnostics.map((item) => `${item.code}: ${item.message}`))
    const artifact = await declareArtifact({
      kind: "word-render",
      title: input.title ?? `Render ${path.basename(input.sourcePath)}`,
      taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-render`,
      derivedFiles: [diagnosticsFile],
      sourceFiles: [normalizePortable(path.relative(Instance.directory, source))],
      warnings,
      qualityStatus: "failed",
    })
    const artifactDir = path.join(Instance.directory, artifact.artifactDir)
    const diagnosticsPath = path.join(artifactDir, diagnosticsFile)
    await fs.writeFile(diagnosticsPath, `${JSON.stringify({ diagnostics, warnings, pageCount: 0, pagePngPaths: [] }, null, 2)}\n`, "utf8")
    return {
      artifactDir: artifact.artifactDir,
      manifestPath: artifact.manifestPath,
      diagnosticsPath: normalizePortable(path.relative(Instance.directory, diagnosticsPath)),
      pagePngPaths: [],
      pageCount: 0,
      warnings,
      diagnostics,
    }
  }
  return writeRenderedWordArtifacts(input, source, response, diagnostics, maxPages, diagnosticsFile)
}

async function writeRenderedWordArtifacts(
  input: RenderWordDocumentInput,
  source: string,
  response: RemoteWordRenderResponse,
  diagnostics: WordRenderDiagnostic[],
  maxPages: number,
  diagnosticsFile: string,
): Promise<RenderedWordDocument> {
  const warnings: string[] = []
  const sourceInspection = await inspectWordDocument({ path: input.sourcePath, maxParagraphs: 1, maxTables: 1 })
  for (const warning of response.warnings ?? []) {
    diagnostics.push({ code: "word-render-remote-failed", severity: "warning", message: warning })
  }
  const pdfBytes = response.pdfBase64 ? Buffer.from(response.pdfBase64, "base64") : undefined
  if (!pdfBytes?.length) diagnostics.push({ code: "pdf-missing", severity: "warning", message: "Renderer response did not include pdfBase64." })
  if (pdfBytes?.length && !isPdf(pdfBytes)) diagnostics.push({ code: "pdf-invalid", severity: "error", message: "Renderer PDF payload is not a valid PDF header." })
  const pagePayloads = response.pages ?? []
  if (pagePayloads.length === 0) diagnostics.push({ code: "page-count-zero", severity: "warning", message: "Renderer returned zero page PNGs." })
  if (pagePayloads.length > maxPages) diagnostics.push({ code: "page-count-exceeds-limit", severity: "warning", message: `Renderer returned ${pagePayloads.length} pages, exceeding maxPages ${maxPages}.` })
  if (typeof response.detectedImageCount === "number" && response.detectedImageCount < sourceInspection.images.length) {
    diagnostics.push({
      code: "image-loss-suspected",
      severity: "warning",
      message: `Source document has ${sourceInspection.images.length} image(s), renderer reported ${response.detectedImageCount}.`,
    })
  }
  const pdfName = safePdfName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}.pdf`)
  const pngEntries: Array<{ name: string; bytes: Buffer }> = []
  for (const [index, page] of pagePayloads.slice(0, maxPages).entries()) {
    const pageBytes = page.pngBase64 || page.base64 ? Buffer.from(page.pngBase64 ?? page.base64 ?? "", "base64") : undefined
    const name = safePngName(page.fileName ?? `rendered/page-${String(index + 1).padStart(3, "0")}.png`, index + 1)
    if (!pageBytes?.length || !isPng(pageBytes)) {
      diagnostics.push({ code: "png-invalid", severity: "error", message: `Renderer page ${index + 1} is missing or not a valid PNG.` })
      continue
    }
    if (page.blank) diagnostics.push({ code: "blank-page", severity: "warning", message: `Renderer marked page ${index + 1} as blank.` })
    pngEntries.push({ name, bytes: pageBytes })
  }
  warnings.push(...diagnostics.map((item) => `${item.code}: ${item.message}`))
  const derivedFiles = [...pngEntries.map((item) => item.name), diagnosticsFile]
  const artifact = await declareArtifact({
    kind: "word-render",
    title: input.title ?? `Render ${path.basename(input.sourcePath)}`,
    taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-render`,
    primaryFile: pdfBytes?.length && isPdf(pdfBytes) ? pdfName : undefined,
    derivedFiles,
    sourceFiles: [normalizePortable(path.relative(Instance.directory, source))],
    warnings,
    qualityStatus: diagnostics.some((item) => item.severity === "error") ? "failed" : diagnostics.length ? "warning" : "ok",
  })
  const artifactDir = path.join(Instance.directory, artifact.artifactDir)
  let pdfPath: string | undefined
  if (pdfBytes?.length && isPdf(pdfBytes)) {
    const output = path.join(artifactDir, pdfName)
    assertInside(artifactDir, output, "pdf")
    await fs.writeFile(output, pdfBytes)
    pdfPath = normalizePortable(path.relative(Instance.directory, output))
  }
  const pagePngPaths: string[] = []
  for (const entry of pngEntries) {
    const output = path.join(artifactDir, entry.name)
    assertInside(artifactDir, output, "pagePng")
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, entry.bytes)
    pagePngPaths.push(normalizePortable(path.relative(Instance.directory, output)))
  }
  const diagnosticsPath = path.join(artifactDir, diagnosticsFile)
  await fs.writeFile(diagnosticsPath, `${JSON.stringify({ diagnostics, warnings, pdfPath, pagePngPaths, pageCount: pngEntries.length }, null, 2)}\n`, "utf8")
  return {
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
    pdfPath,
    pagePngPaths,
    diagnosticsPath: normalizePortable(path.relative(Instance.directory, diagnosticsPath)),
    pageCount: pngEntries.length,
    warnings,
    diagnostics,
  }
}

export async function insertWordPngImage(input: InsertWordPngImageInput): Promise<InsertedWordPngImage> {
  const source = await readDocxSnapshot(input.sourcePath)
  const documentXml = requiredSnapshotText(source, "word/document.xml", input.sourcePath)
  let relsXml = snapshotText(source, "word/_rels/document.xml.rels") ?? documentRelationshipsXml({ images: [], imageMap: new WeakMap() })
  let contentTypes = snapshotText(source, "[Content_Types].xml") ?? contentTypesXml({ images: [], imageMap: new WeakMap() })
  const bytes = input.pngBase64?.trim()
    ? Buffer.from(input.pngBase64, "base64")
    : input.pngPath?.trim()
      ? Buffer.from(await fs.readFile(resolveWorkspacePath(input.pngPath)))
      : undefined
  if (!bytes?.length) throw new Error("insertWordPngImage requires pngPath or pngBase64")
  if (!isPng(bytes)) throw new Error("insertWordPngImage payload is not a valid PNG")
  const relId = `rIdInsertedImage${maxRelationshipNumber(relsXml) + 1}`
  const mediaName = `media/inserted-${Date.now()}.png`
  relsXml = appendRelationship(relsXml, relId, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", mediaName)
  contentTypes = ensureImageContentType(contentTypes, mediaName)
  const imageXml = `${input.caption ? paragraph(input.caption, "Caption") : ""}${imageXmlFromRel(relId, input.altText ?? input.caption ?? "Inserted image", positive(input.width, 640), positive(input.height, 360))}`
  const blocks = parseTopLevelBlocks(documentXml)
  let nextDocumentXml: string
  if (input.heading?.trim()) {
    const heading = findHeading(blocks, { heading: input.heading })
    nextDocumentXml = splice(documentXml, heading.end, heading.end, imageXml)
  } else {
    nextDocumentXml = insertBeforeSectPr(documentXml, imageXml)
  }
  const binaryOverrides = new Map<string, Uint8Array>([[`word/${mediaName}`, bytes]])
  const warnings: string[] = []
  const written = await writeDocxArtifact(source, {
    "word/document.xml": nextDocumentXml,
    "word/_rels/document.xml.rels": relsXml,
    "[Content_Types].xml": contentTypes,
  }, binaryOverrides, {
    title: input.title ?? `Image ${path.basename(input.sourcePath)}`,
    taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-image`,
    outputFile: safeDocxName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}-image.docx`),
    warnings,
  })
  return {
    ...written,
    imageRelId: relId,
    imagePath: `word/${mediaName}`,
    warnings,
  }
}

async function buildDocx(spec: CreateWordDocumentSpec, context: RenderContext): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add("[Content_Types].xml", new TextReader(contentTypesXml(context)))
  await writer.add("_rels/.rels", new TextReader(packageRelationshipsXml()))
  await writer.add("docProps/core.xml", new TextReader(coreXml(spec)))
  await writer.add("docProps/app.xml", new TextReader(appXml()))
  await writer.add("word/_rels/document.xml.rels", new TextReader(documentRelationshipsXml(context)))
  await writer.add("word/styles.xml", new TextReader(stylesXml()))
  await writer.add("word/numbering.xml", new TextReader(numberingXml()))
  await writer.add("word/document.xml", new TextReader(documentXml(spec, context)))
  for (const image of context.images) {
    await writer.add(image.mediaPath, new Uint8ArrayReader(image.bytes))
  }
  return await writer.close()
}

async function planAndApplyEdit(
  documentXml: string,
  relsXml: string,
  edit: WordEditOperation,
  byName: Map<string, { getData?: (writer: TextWriter) => Promise<string> }>,
  existingTextOverrides: Record<string, string>,
): Promise<{
  documentXml: string
  relsXml: string
  textOverrides: Record<string, string>
  mediaUpdates: Array<{ path: string; bytes: Uint8Array }>
  impact: WordEditImpact
  warnings: string[]
}> {
  const blocks = parseTopLevelBlocks(documentXml)
  const mediaUpdates: Array<{ path: string; bytes: Uint8Array }> = []
  const warnings: string[] = []
  if (edit.op === "patch_ooxml_part") {
    const part = safeOoxmlPart(edit.patch.part)
    const current = existingTextOverrides[part] ?? await readEntryText(byName, part)
    if (current === undefined) throw new Error(`OOXML part not found: ${part}`)
    const patched = patchOoxmlPart(current, edit.patch)
    return {
      documentXml: part === "word/document.xml" ? patched.xml : documentXml,
      relsXml: part === "word/_rels/document.xml.rels" ? patched.xml : relsXml,
      textOverrides: { [part]: patched.xml },
      mediaUpdates,
      impact: {
        op: edit.op,
        target: part,
        summary: `patch ${part} (${patched.replacements} replacement${patched.replacements === 1 ? "" : "s"})`,
      },
      warnings,
    }
  }
  if (edit.op === "append_blocks") {
    return {
      documentXml: insertBeforeSectPr(documentXml, await renderBlocks(edit.blocks)),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: "document-end", summary: `append ${edit.blocks.length} block(s)` },
      warnings,
    }
  }
  if (edit.op === "fill_content_control") {
    const target = findContentControl(parseContentControls(documentXml), edit.locator)
    return {
      documentXml: splice(documentXml, target.start, target.end, fillContentControlXml(target.xml, edit.text)),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: contentControlLabel(target), summary: `fill content control ${target.index}` },
      warnings,
    }
  }
  if (edit.op === "insert_after_heading" || edit.op === "insert_before_heading") {
    const target = findHeading(blocks, edit.locator)
    const xml = await renderBlocks(edit.blocks)
    return {
      documentXml: splice(documentXml, edit.op === "insert_after_heading" ? target.end : target.start, edit.op === "insert_after_heading" ? target.end : target.start, xml),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: targetLabel(target), summary: `${edit.op === "insert_after_heading" ? "insert after" : "insert before"} heading "${target.text}"` },
      warnings,
    }
  }
  if (edit.op === "replace_paragraph") {
    const target = findParagraph(blocks, edit.locator)
    return {
      documentXml: splice(documentXml, target.start, target.end, paragraph(edit.text, target.styleId ?? "Normal")),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: targetLabel(target), summary: `replace paragraph ${target.paragraphIndex}` },
      warnings,
    }
  }
  if (edit.op === "replace_paragraph_with_blocks") {
    const target = findParagraph(blocks, edit.locator)
    return {
      documentXml: splice(documentXml, target.start, target.end, await renderBlocks(edit.blocks)),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: targetLabel(target), summary: `replace paragraph ${target.paragraphIndex} with ${edit.blocks.length} block(s)` },
      warnings,
    }
  }
  if (edit.op === "delete_paragraph") {
    const target = findParagraph(blocks, edit.locator)
    return {
      documentXml: splice(documentXml, target.start, target.end, ""),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: targetLabel(target), summary: `delete paragraph ${target.paragraphIndex}` },
      warnings,
    }
  }
  if (edit.op === "delete_table") {
    const target = findTable(blocks, edit.locator)
    return {
      documentXml: splice(documentXml, target.start, target.end, ""),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: targetLabel(target), summary: `delete table ${target.tableIndex}` },
      warnings,
    }
  }
  if (edit.op === "update_table") {
    const target = findTable(blocks, edit.locator)
    return {
      documentXml: splice(documentXml, target.start, target.end, tableXml(edit.headers, edit.rows, edit.caption)),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: targetLabel(target), summary: `replace table ${target.tableIndex}` },
      warnings,
    }
  }
  if (edit.op === "delete_section" || edit.op === "replace_section") {
    const target = findHeading(blocks, edit.locator)
    const range = sectionRange(documentXml, blocks, target)
    const replacement = edit.op === "replace_section" ? `${paragraph(edit.title ?? target.text, `Heading${edit.level ?? target.headingLevel ?? 1}`)}${await renderBlocks(edit.blocks)}` : ""
    return {
      documentXml: splice(documentXml, range.start, range.end, replacement),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: targetLabel(target), summary: `${edit.op === "replace_section" ? "replace" : "delete"} section "${target.text}"` },
      warnings,
    }
  }
  if (edit.op === "replace_image") {
    const rel = findImageRelationship(relsXml, edit.locator)
    const existingContentType = contentTypeFor(rel.target)
    if (edit.image.contentType && existingContentType && edit.image.contentType !== existingContentType) {
      throw new Error(`replace_image contentType ${edit.image.contentType} does not match existing media target ${rel.target}`)
    }
    const bytes = await imageBytes(edit.image)
    mediaUpdates.push({ path: `word/${rel.target}`, bytes })
    return {
      documentXml,
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: { op: edit.op, target: rel.relId, summary: `replace image ${rel.relId}` },
      warnings,
    }
  }
  throw new Error(`Unsupported Word edit operation: ${(edit as { op: string }).op}`)
}

async function renderBlocks(blocks: WordBlock[]): Promise<string> {
  if (blocks.some((block) => block.type === "image")) {
    throw new Error("image blocks inside structural Word edits are not supported in v1; use replace_image for existing images")
  }
  const context = await buildContext({ title: "blocks", sections: [{ title: "blocks", blocks }] })
  return blocks.map((block) => blockXml(block, context)).join("")
}

async function buildContext(spec: CreateWordDocumentSpec): Promise<RenderContext> {
  const images: ImagePart[] = []
  const imageMap = new WeakMap<Extract<WordBlock, { type: "image" }>, ImagePart>()
  for (const block of allBlocks(spec)) {
    if (block.type !== "image") continue
    const index = images.length + 1
    const contentType = block.contentType ?? "image/png"
    const extension = contentType === "image/jpeg" ? "jpg" : "png"
    const item: ImagePart = {
      relId: `rIdImage${index}`,
      mediaPath: `word/media/image${index}.${extension}`,
      target: `media/image${index}.${extension}`,
      contentType,
      extension,
      bytes: await imageBytes(block),
      width: positive(block.width, 480),
      height: positive(block.height, 280),
      altText: block.altText ?? block.title ?? block.caption ?? `Image ${index}`,
    }
    images.push(item)
    imageMap.set(block, item)
  }
  return { images, imageMap }
}

function documentXml(spec: CreateWordDocumentSpec, context: RenderContext): string {
  const body: string[] = []
  body.push(paragraph(spec.documentType ?? "Document", "Subtitle"))
  body.push(paragraph(spec.title, "Title"))
  if (spec.author) body.push(paragraph(`Author: ${spec.author}`, "Normal"))
  for (const item of spec.summary ?? []) body.push(paragraph(item, "Normal"))
  for (const section of spec.sections) {
    body.push(paragraph(section.title, `Heading${section.level ?? 1}`))
    for (const text of section.paragraphs ?? []) body.push(paragraph(text, "Normal"))
    if (section.bullets?.length) body.push(...list(section.bullets, false))
    if (section.numberedItems?.length) body.push(...list(section.numberedItems, true))
    for (const table of section.tables ?? []) body.push(tableXml(table.headers, table.rows, table.caption))
    for (const image of section.images ?? []) body.push(imageXml(image, context))
    for (const block of section.blocks ?? []) body.push(blockXml(block, context))
  }
  body.push("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr>")
  return xml(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join("")}</w:body></w:document>`,
  )
}

function blockXml(block: WordBlock, context: RenderContext): string {
  switch (block.type) {
    case "heading":
      return paragraph(block.text, `Heading${block.level ?? 1}`)
    case "paragraph":
      return paragraph(block.text, "Normal")
    case "list":
      return list(block.items, Boolean(block.ordered)).join("")
    case "table":
      return tableXml(block.headers, block.rows, block.caption)
    case "code":
      return paragraph(block.text, "Code")
    case "image":
      return imageXml(block, context)
  }
}

function paragraph(text: string, style = "Normal"): string {
  const styleXml = style === "Normal" ? "" : `<w:pPr><w:pStyle w:val="${escapeAttr(style)}"/></w:pPr>`
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function list(items: string[], ordered: boolean): string[] {
  return items.map((item) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${ordered ? 2 : 1}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(item)}</w:t></w:r></w:p>`)
}

function tableXml(headers: string[], rows: string[][], caption?: string): string {
  const table = normalizeTableSpec({ headers, rows, caption }, { trimCells: false, fillMissingCells: "" })
  const rowXml = [table.headers, ...table.rows]
    .map((row, rowIndex) =>
      `<w:tr>${Array.from({ length: table.columnCount }, (_, index) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / table.columnCount)}" w:type="dxa"/></w:tcPr>${paragraph(row[index] ?? "", rowIndex === 0 ? "TableHeader" : "Normal")}</w:tc>`).join("")}</w:tr>`,
    )
    .join("")
  return `${table.caption ? paragraph(table.caption, "Caption") : ""}<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rowXml}</w:tbl>`
}

function normalizeTableSpec(
  table: { headers: string[]; rows: string[][]; caption?: string },
  options: { trimCells?: boolean; fillMissingCells?: string; maxColumns?: number; label?: string } = {},
): NormalizedWordTableSpec["tables"][number] {
  const warnings: string[] = []
  const trimCells = options.trimCells ?? true
  const fill = options.fillMissingCells ?? ""
  const rawHeaders = Array.isArray(table.headers) ? table.headers : []
  const rawRows = Array.isArray(table.rows) ? table.rows : []
  const sourceWidth = Math.max(rawHeaders.length, ...rawRows.map((row) => Array.isArray(row) ? row.length : 0), 1)
  const maxColumns = options.maxColumns && options.maxColumns > 0 ? Math.floor(options.maxColumns) : sourceWidth
  const columnCount = Math.max(1, Math.min(sourceWidth, maxColumns))
  if (sourceWidth > columnCount) warnings.push(`table width truncated from ${sourceWidth} to ${columnCount} columns`)
  const normalizeCell = (cell: unknown): string => {
    const text = typeof cell === "string" ? cell : cell === undefined || cell === null ? "" : String(cell)
    return trimCells ? text.trim() : text
  }
  const normalizeRow = (row: unknown[], rowLabel: string): string[] => {
    const cells = row.slice(0, columnCount).map(normalizeCell)
    if (row.length > columnCount) warnings.push(`${rowLabel} truncated from ${row.length} to ${columnCount} cells`)
    if (cells.length < columnCount) {
      warnings.push(`${rowLabel} padded from ${cells.length} to ${columnCount} cells`)
      while (cells.length < columnCount) cells.push(fill)
    }
    return cells
  }
  const headers = normalizeRow(rawHeaders, "headers")
  const rows = rawRows.map((row, index) => normalizeRow(Array.isArray(row) ? row : [], `rows[${index}]`))
  return {
    headers,
    rows,
    caption: table.caption?.trim() || undefined,
    columnCount,
    rowCount: rows.length,
    warnings,
  }
}

function imageXml(block: Extract<WordBlock, { type: "image" }>, context: RenderContext): string {
  const image = context.imageMap.get(block)
  if (!image) return paragraph(`[Missing image: ${block.title ?? block.caption ?? "image"}]`, "Normal")
  const cx = Math.round(image.width * 9525)
  const cy = Math.round(image.height * 9525)
  const drawing = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${context.images.indexOf(image) + 1}" name="${escapeAttr(image.altText)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${escapeAttr(image.altText)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  return `${block.title ? paragraph(block.title, "Caption") : ""}${drawing}${block.caption ? paragraph(block.caption, "Caption") : ""}`
}

function imageXmlFromRel(relId: string, altText: string, width: number, height: number): string {
  const cx = Math.round(width * 9525)
  const cy = Math.round(height * 9525)
  const alt = escapeAttr(altText)
  return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${Date.now() % 100000}" name="${alt}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${escapeAttr(relId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

function contentTypesXml(context: RenderContext): string {
  const imageDefaults = new Set(context.images.map((image) => image.extension))
  return xml(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults.has("png") ? '<Default Extension="png" ContentType="image/png"/>' : ""}${imageDefaults.has("jpg") ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ""}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  )
}

function packageRelationshipsXml(): string {
  return xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>')
}

function documentRelationshipsXml(context: RenderContext): string {
  return xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${context.images.map((image) => `<Relationship Id="${image.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeAttr(image.target)}"/>`).join("")}</Relationships>`,
  )
}

function stylesXml(): string {
  return xml('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>')
}

function numberingXml(): string {
  return xml('<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>')
}

function coreXml(spec: CreateWordDocumentSpec): string {
  return xml(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(spec.title)}</dc:title><dc:creator>${escapeXml(spec.author ?? "Kilo")}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`)
}

function appXml(): string {
  return xml('<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kilo</Application></Properties>')
}

function parseParagraphs(documentXml: string): Array<{ index: number; text: string; styleId?: string }> {
  return matchAll(documentXml, /<w:p\b[\s\S]*?<\/w:p>/g).map((xml, index) => ({
    index: index + 1,
    text: textFromXml(xml),
    styleId: attr(xml, /<w:pStyle\b[^>]*w:val="([^"]+)"/),
  }))
}

function parseTables(documentXml: string): string[][][] {
  return matchAll(documentXml, /<w:tbl\b[\s\S]*?<\/w:tbl>/g).map((table) =>
    matchAll(table, /<w:tr\b[\s\S]*?<\/w:tr>/g).map((row) => matchAll(row, /<w:tc\b[\s\S]*?<\/w:tc>/g).map(textFromXml)),
  )
}

function parseImages(relsXml: string, byName: Map<string, { filename: string }>): WordDocumentInspection["images"] {
  return matchAll(relsXml, /<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"[^>]*>/g).map((relationship, index) => {
    const target = attr(relationship, /\bTarget="([^"]+)"/) ?? ""
    return {
      index: index + 1,
      relId: attr(relationship, /\bId="([^"]+)"/) ?? `rIdImage${index + 1}`,
      target,
      contentType: byName.has(`word/${target}`) ? contentTypeFor(target) : undefined,
    }
  })
}

function parseStyles(stylesXml: string): string[] {
  return matchAll(stylesXml, /<w:style\b[^>]*w:styleId="([^"]+)"/g, 1)
}

function headingLevelFromStyle(styleId?: string): 1 | 2 | 3 | undefined {
  if (styleId === "Heading1") return 1
  if (styleId === "Heading2") return 2
  if (styleId === "Heading3") return 3
  return undefined
}

function validateCreateSpec(spec: CreateWordDocumentSpec): void {
  if (!spec.title?.trim()) throw new Error("create_word_document spec.title is required")
  if (!Array.isArray(spec.sections) || spec.sections.length === 0) throw new Error("create_word_document spec.sections must not be empty")
  for (const [index, section] of spec.sections.entries()) {
    if (!section.title?.trim()) throw new Error(`create_word_document sections[${index}].title is required`)
  }
}

async function imageBytes(block: Extract<WordBlock, { type: "image" }>): Promise<Uint8Array> {
  if (block.base64?.trim()) return Uint8Array.from(Buffer.from(block.base64, "base64"))
  if (block.path?.trim()) return new Uint8Array(await fs.readFile(resolveWorkspacePath(block.path)))
  throw new Error(`image block is missing path or base64 payload: ${block.title ?? block.caption ?? "image"}`)
}

function allBlocks(spec: CreateWordDocumentSpec): WordBlock[] {
  return spec.sections.flatMap((section) => [...(section.blocks ?? []), ...(section.images ?? [])])
}

function safeDocxName(input: string): string {
  const base = input
    .replace(/\.docx$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "document"
  return `${base}.docx`
}

function safePdfName(input: string): string {
  const base = input
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "document"
  return `${base}.pdf`
}

function safePngName(input: string, fallbackIndex: number): string {
  const normalized = normalizePortable(input).replace(/^\/+/, "")
  const parts = normalized.split("/").filter(Boolean)
  const file = (parts.pop() ?? `page-${String(fallbackIndex).padStart(3, "0")}.png`)
    .replace(/\.png$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || `page-${String(fallbackIndex).padStart(3, "0")}`
  const folder = parts.length ? parts.map((part) => part.replace(/[\\/:*?"<>|]+/g, "-")).join("/") : "rendered"
  return `${folder}/${file}.png`
}

function resolveWorkspacePath(input: string): string {
  if (!input.trim()) throw new Error("path is required")
  const absolute = path.resolve(Instance.directory, input)
  assertInside(Instance.directory, absolute, "path")
  return absolute
}

function assertInside(base: string, target: string, label: string): void {
  const relative = path.relative(base, target)
  if (relative === "") return
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside ${normalizePortable(path.relative(Instance.directory, base) || ".")}`)
  }
}

async function readEntryText(byName: Map<string, { getData?: (writer: TextWriter) => Promise<string> }>, name: string): Promise<string | undefined> {
  return await byName.get(name)?.getData?.(new TextWriter())
}

function matchAll(input: string, regex: RegExp, group = 0): string[] {
  return [...input.matchAll(regex)].map((match) => match[group] ?? "")
}

function textFromXml(input: string): string {
  return matchAll(input, /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, 1).map(unescapeXml).join("")
}

function attr(input: string, regex: RegExp): string | undefined {
  return input.match(regex)?.[1]
}

function contentTypeFor(target: string): string | undefined {
  const ext = path.extname(target).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  return undefined
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "%PDF"
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
}

function escapeXml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeAttr(input: string): string {
  return escapeXml(input).replace(/"/g, "&quot;")
}

function unescapeXml(input: string): string {
  return input.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
}

function normalizePortable(input: string): string {
  return input.split(path.sep).join("/")
}

function positive(input: number | undefined, fallback: number): number {
  return typeof input === "number" && Number.isFinite(input) && input > 0 ? Math.round(input) : fallback
}

function clamp(input: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(input)))
}

function xml(input: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${input}`
}

type TopLevelBlock = {
  kind: "paragraph" | "table"
  start: number
  end: number
  xml: string
  text: string
  styleId?: string
  headingLevel?: 1 | 2 | 3
  paragraphIndex?: number
  tableIndex?: number
}

type ContentControlBlock = {
  index: number
  start: number
  end: number
  xml: string
  tag?: string
  title?: string
  text: string
}

type DocxSnapshot = {
  entries: Array<{
    filename: string
    directory?: boolean
    getData?: (writer: Uint8ArrayWriter) => Promise<Uint8Array>
  }>
  bytes: Map<string, Uint8Array>
}

type RemoteWordRenderResponse = {
  pdfBase64?: string
  pages?: Array<{
    fileName?: string
    pngBase64?: string
    base64?: string
    blank?: boolean
  }>
  detectedImageCount?: number
  warnings?: string[]
}

function parseTopLevelBlocks(documentXml: string): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = []
  let paragraphIndex = 0
  let tableIndex = 0
  for (const match of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g)) {
    const part = match[0]
    const start = match.index ?? 0
    const end = start + part.length
    if (part.startsWith("<w:tbl")) {
      tableIndex += 1
      blocks.push({ kind: "table", start, end, xml: part, text: textFromXml(part), tableIndex })
      continue
    }
    paragraphIndex += 1
    const styleId = attr(part, /<w:pStyle\b[^>]*w:val="([^"]+)"/)
    blocks.push({
      kind: "paragraph",
      start,
      end,
      xml: part,
      text: textFromXml(part),
      styleId,
      headingLevel: headingLevelFromStyle(styleId),
      paragraphIndex,
    })
  }
  return blocks
}

function parseContentControls(documentXml: string): ContentControlBlock[] {
  return [...documentXml.matchAll(/<w:sdt\b[\s\S]*?<\/w:sdt>/g)].map((match, offset) => {
    const xml = match[0]
    return {
      index: offset + 1,
      start: match.index ?? 0,
      end: (match.index ?? 0) + xml.length,
      xml,
      tag: attr(xml, /<w:tag\b[^>]*w:val="([^"]+)"/),
      title: attr(xml, /<w:alias\b[^>]*w:val="([^"]+)"/),
      text: textFromXml(xml),
    }
  })
}

function findHeading(blocks: TopLevelBlock[], locator: WordEditLocator): TopLevelBlock {
  const heading = locator.heading?.trim()
  if (!heading) throw new Error("heading locator is required")
  const exact = blocks.filter((block) => block.headingLevel && normalizeText(block.text) === normalizeText(heading))
  const candidates = exact.length ? exact : blocks.filter((block) => block.headingLevel && normalizeText(block.text).includes(normalizeText(heading)))
  return pickUnique(candidates, locator.occurrence, `heading "${heading}"`)
}

function findParagraph(blocks: TopLevelBlock[], locator: WordEditLocator): TopLevelBlock {
  if (locator.paragraphIndex !== undefined) {
    const found = blocks.find((block) => block.kind === "paragraph" && block.paragraphIndex === locator.paragraphIndex)
    if (!found) throw new Error(`paragraphIndex not found: ${locator.paragraphIndex}`)
    return found
  }
  if (locator.paragraphText?.trim()) {
    const needle = normalizeText(locator.paragraphText)
    const exact = blocks.filter((block) => block.kind === "paragraph" && normalizeText(block.text) === needle)
    const candidates = exact.length ? exact : blocks.filter((block) => block.kind === "paragraph" && normalizeText(block.text).includes(needle))
    return pickUnique(candidates, locator.occurrence, `paragraphText "${locator.paragraphText}"`)
  }
  if (locator.heading?.trim()) return findHeading(blocks, locator)
  throw new Error("paragraph locator requires paragraphIndex, paragraphText, or heading")
}

function findContentControl(blocks: ContentControlBlock[], locator: WordEditLocator): ContentControlBlock {
  if (locator.contentControlIndex !== undefined) {
    const found = blocks.find((block) => block.index === locator.contentControlIndex)
    if (!found) throw new Error(`contentControlIndex not found: ${locator.contentControlIndex}`)
    return found
  }
  let candidates = blocks
  if (locator.contentControlTag?.trim()) {
    candidates = candidates.filter((block) => block.tag === locator.contentControlTag)
  }
  if (locator.contentControlTitle?.trim()) {
    candidates = candidates.filter((block) => block.title === locator.contentControlTitle)
  }
  if (candidates === blocks) throw new Error("content control locator requires contentControlIndex, contentControlTag, or contentControlTitle")
  if (candidates.length === 0) throw new Error("No matching content control")
  if (locator.occurrence !== undefined) {
    const found = candidates[locator.occurrence - 1]
    if (!found) throw new Error(`No matching content control occurrence ${locator.occurrence}`)
    return found
  }
  if (candidates.length > 1) throw new Error("Ambiguous content control; provide occurrence or a more precise locator")
  return candidates[0]!
}

function findTable(blocks: TopLevelBlock[], locator: WordEditLocator): TopLevelBlock {
  const index = locator.tableIndex ?? 1
  const found = blocks.find((block) => block.kind === "table" && block.tableIndex === index)
  if (!found) throw new Error(`tableIndex not found: ${index}`)
  return found
}

function pickUnique(candidates: TopLevelBlock[], occurrence: number | undefined, label: string): TopLevelBlock {
  if (candidates.length === 0) throw new Error(`No matching ${label}`)
  if (occurrence !== undefined) {
    const found = candidates[occurrence - 1]
    if (!found) throw new Error(`No matching ${label} occurrence ${occurrence}`)
    return found
  }
  if (candidates.length > 1) throw new Error(`Ambiguous ${label}; provide occurrence or a more precise locator`)
  return candidates[0]!
}

function sectionRange(documentXml: string, blocks: TopLevelBlock[], heading: TopLevelBlock): { start: number; end: number } {
  const level = heading.headingLevel ?? 1
  const next = blocks.find((block) => block.start > heading.start && block.headingLevel && block.headingLevel <= level)
  if (next) return { start: heading.start, end: next.start }
  const sect = documentXml.lastIndexOf("<w:sectPr")
  if (sect > heading.start) return { start: heading.start, end: sect }
  const bodyClose = documentXml.lastIndexOf("</w:body>")
  return { start: heading.start, end: bodyClose > heading.start ? bodyClose : documentXml.length }
}

function findImageRelationship(relsXml: string, locator: WordEditLocator): { relId: string; target: string } {
  const rels = matchAll(relsXml, /<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"[^>]*>/g).map((relationship, index) => ({
    index: index + 1,
    relId: attr(relationship, /\bId="([^"]+)"/) ?? `rIdImage${index + 1}`,
    target: attr(relationship, /\bTarget="([^"]+)"/) ?? "",
  }))
  if (locator.imageRelId) {
    const found = rels.find((item) => item.relId === locator.imageRelId)
    if (!found) throw new Error(`imageRelId not found: ${locator.imageRelId}`)
    return found
  }
  const imageIndex = locator.imageIndex ?? 1
  const found = rels.find((item) => item.index === imageIndex)
  if (!found) throw new Error(`imageIndex not found: ${imageIndex}`)
  if (!found.target || found.target.includes("\\") || found.target.split("/").some((segment) => segment === ".." || segment === "." || !segment)) {
    throw new Error(`unsafe image target in document relationships: ${found.target}`)
  }
  return found
}

async function readDocxSnapshot(inputPath: string): Promise<DocxSnapshot> {
  const absolute = resolveWorkspacePath(inputPath)
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(await fs.readFile(absolute))))
  try {
    const entries = await zip.getEntries()
    const bytes = new Map<string, Uint8Array>()
    for (const entry of entries) {
      if (entry.directory) continue
      const data = await entry.getData?.(new Uint8ArrayWriter())
      if (data) bytes.set(entry.filename, data)
    }
    return {
      bytes,
      entries: [...bytes.entries()].map(([filename, data]) => ({
        filename,
        getData: async () => data,
      })),
    }
  } finally {
    await zip.close()
  }
}

async function tryLocalWordRenderer(
  source: string,
  input: RenderWordDocumentInput,
  maxPages: number,
  timeoutMs: number,
): Promise<{ response: RemoteWordRenderResponse; diagnostics: WordRenderDiagnostic[] } | undefined> {
  const soffice = await findExecutable(process.env["KILO_WORD_RENDER_SOFFICE"], "soffice")
  if (!soffice) return undefined

  const diagnostics: WordRenderDiagnostic[] = []
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-word-render-"))
  try {
    try {
      await execFile(soffice, ["--headless", "--convert-to", "pdf", "--outdir", temp, source], { timeout: timeoutMs })
    } catch (err) {
      diagnostics.push({
        code: "word-render-local-failed",
        severity: "error",
        message: err instanceof Error ? err.message : String(err),
      })
      return { response: { warnings: [] }, diagnostics }
    }

    const pdfPath = path.join(temp, `${path.basename(source, path.extname(source))}.pdf`)
    let pdfBytes: Buffer | undefined
    try {
      pdfBytes = Buffer.from(await fs.readFile(pdfPath))
    } catch (err) {
      diagnostics.push({
        code: "word-render-local-failed",
        severity: "error",
        message: err instanceof Error ? err.message : String(err),
      })
      return { response: { warnings: [] }, diagnostics }
    }

    const pdftoppm = await findExecutable(process.env["KILO_WORD_RENDER_PDFTOPPM"], "pdftoppm")
    const pages: NonNullable<RemoteWordRenderResponse["pages"]> = []
    if (!pdftoppm) {
      diagnostics.push({
        code: "word-render-local-page-renderer-not-configured",
        severity: "warning",
        message: "Local PDF renderer succeeded, but pdftoppm was not found; set KILO_WORD_RENDER_PDFTOPPM or put pdftoppm on PATH to render page PNG artifacts.",
      })
    } else {
      const prefix = path.join(temp, "page")
      try {
        await execFile(pdftoppm, ["-png", "-f", "1", "-l", String(maxPages), pdfPath, prefix], { timeout: timeoutMs })
        const entries = await fs.readdir(temp)
        const pageFiles = entries
          .filter((entry) => /^page-\d+\.png$/.test(entry))
          .sort((left, right) => pageNumber(left) - pageNumber(right))
          .slice(0, maxPages)
        for (const [index, file] of pageFiles.entries()) {
          const bytes = await fs.readFile(path.join(temp, file))
          pages.push({
            fileName: `rendered/page-${String(index + 1).padStart(3, "0")}.png`,
            pngBase64: Buffer.from(bytes).toString("base64"),
          })
        }
      } catch (err) {
        diagnostics.push({
          code: "word-render-local-failed",
          severity: "error",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return {
      response: {
        pdfBase64: pdfBytes.toString("base64"),
        pages,
      },
      diagnostics,
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}

async function findExecutable(configured: string | undefined, name: string): Promise<string | undefined> {
  const candidates = configured?.trim()
    ? [configured.trim()]
    : (process.env["PATH"] ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((dir) => path.join(dir, name))

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return undefined
}

function pageNumber(file: string): number {
  const match = file.match(/page-(\d+)\.png$/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

async function callWordRenderer(endpoint: string, payload: unknown, timeoutMs: number): Promise<RemoteWordRenderResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`renderer returned HTTP ${response.status}`)
    const body = await response.json() as RemoteWordRenderResponse
    if (!body || typeof body !== "object") throw new Error("renderer returned an invalid JSON body")
    return body
  } finally {
    clearTimeout(timer)
  }
}

function snapshotText(snapshot: DocxSnapshot, name: string): string | undefined {
  const data = snapshot.bytes.get(name)
  return data ? Buffer.from(data).toString("utf8") : undefined
}

function requiredSnapshotText(snapshot: DocxSnapshot, name: string, sourcePath: string): string {
  const text = snapshotText(snapshot, name)
  if (!text) throw new Error(`DOCX is missing ${name}: ${sourcePath}`)
  return text
}

async function writeDocxArtifact(
  source: DocxSnapshot,
  textOverrides: Record<string, string>,
  binaryOverrides: Map<string, Uint8Array>,
  input: { title: string; taskSlug: string; outputFile: string; warnings: string[] },
): Promise<{ path: string; artifactDir: string; manifestPath: string }> {
  const artifact = await declareArtifact({
    kind: "word-document",
    title: input.title,
    taskSlug: input.taskSlug,
    primaryFile: safeDocxName(input.outputFile),
    warnings: input.warnings,
    qualityStatus: input.warnings.length ? "warning" : "unknown",
  })
  const output = path.join(Instance.directory, artifact.artifactDir, artifact.manifest.primaryFile ?? safeDocxName(input.outputFile))
  assertInside(path.join(Instance.directory, artifact.artifactDir), output, "outputFile")
  await fs.mkdir(path.dirname(output), { recursive: true })
  const nextBytes = await rewriteDocx(source.entries, textOverrides, binaryOverrides)
  await fs.writeFile(output, nextBytes)
  return {
    path: normalizePortable(path.relative(Instance.directory, output)),
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
  }
}

function fillContentControlXml(controlXml: string, text: string): string {
  const open = controlXml.match(/<w:sdtContent\b[^>]*>/)
  const close = controlXml.lastIndexOf("</w:sdtContent>")
  if (!open || open.index === undefined || close < open.index) throw new Error("content control is missing w:sdtContent")
  return splice(controlXml, open.index + open[0].length, close, paragraph(text, "Normal"))
}

function applyDefaultFontToStyles(styles: string, fontFamily: string): string {
  const font = escapeAttr(fontFamily.trim())
  if (!font) return styles
  const docDefaults = `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/></w:rPr></w:rPrDefault></w:docDefaults>`
  if (styles.includes("<w:docDefaults")) return styles.replace(/<w:docDefaults\b[\s\S]*?<\/w:docDefaults>/, docDefaults)
  return styles.replace(/<w:styles\b([^>]*)>/, `<w:styles$1>${docDefaults}`)
}

function ensureRelationship(relsXml: string, id: string, type: string, target: string): string {
  if (relsXml.includes(`Type="${type}"`) && relsXml.includes(`Target="${target}"`)) return relsXml
  return appendRelationship(relsXml, id, type, target)
}

function appendRelationship(relsXml: string, id: string, type: string, target: string): string {
  const relationship = `<Relationship Id="${escapeAttr(id)}" Type="${escapeAttr(type)}" Target="${escapeAttr(target)}"/>`
  return relsXml.includes("</Relationships>")
    ? relsXml.replace("</Relationships>", `${relationship}</Relationships>`)
    : documentRelationshipsXml({ images: [], imageMap: new WeakMap() }).replace("</Relationships>", `${relationship}</Relationships>`)
}

function ensureContentTypeOverride(contentTypes: string, partName: string, contentType: string): string {
  if (contentTypes.includes(`PartName="${partName}"`)) return contentTypes
  const override = `<Override PartName="${escapeAttr(partName)}" ContentType="${escapeAttr(contentType)}"/>`
  return contentTypes.includes("</Types>")
    ? contentTypes.replace("</Types>", `${override}</Types>`)
    : contentTypesXml({ images: [], imageMap: new WeakMap() }).replace("</Types>", `${override}</Types>`)
}

function ensureImageContentType(contentTypes: string, target: string): string {
  const ext = path.extname(target).replace(".", "").toLowerCase()
  const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : undefined
  if (!contentType || contentTypes.includes(`Extension="${ext}"`)) return contentTypes
  return contentTypes.includes("</Types>") ? contentTypes.replace("</Types>", `<Default Extension="${escapeAttr(ext)}" ContentType="${contentType}"/></Types>`) : contentTypesXml({ images: [], imageMap: new WeakMap() })
}

function materializeFieldsInDocument(documentXml: string, tocMode: "preserve" | "materialize" | "remove"): {
  xml: string
  summary: MaterializedWordFields["summary"]
  warnings: string[]
} {
  const warnings: string[] = []
  const counters = new Map<string, number>()
  let captions = 0
  let seqFields = 0
  let xml = documentXml.replace(/\{\{CAPTION:([^:}]+):([^}]+)\}\}/g, (_match, kind: string, text: string) => {
    const next = (counters.get(kind) ?? 0) + 1
    counters.set(kind, next)
    captions += 1
    return escapeXml(`${kind} ${next}. ${unescapeXml(text)}`)
  })
  xml = xml.replace(/\{\{SEQ:([^}]+)\}\}/g, (_match, kind: string) => {
    const next = (counters.get(kind) ?? 0) + 1
    counters.set(kind, next)
    seqFields += 1
    return String(next)
  })
  let toc: MaterializedWordFields["summary"]["toc"] = "none"
  if (xml.includes("{{TOC}}")) {
    const tocLines = parseParagraphs(documentXml)
      .filter((item) => headingLevelFromStyle(item.styleId) && item.text.trim() && item.text.trim() !== "{{TOC}}")
      .map((item) => `${"  ".repeat((headingLevelFromStyle(item.styleId) ?? 1) - 1)}${item.text.trim()}`)
    if (tocMode === "preserve") {
      toc = "preserved"
      warnings.push("TOC placeholder preserved; open the document in Word to update dynamic TOC fields if needed")
    } else if (tocMode === "remove") {
      toc = "removed"
      xml = xml.replace(/<w:p\b[\s\S]*?\{\{TOC\}\}[\s\S]*?<\/w:p>/g, "")
    } else {
      toc = "materialized"
      const replacement = tocLines.length ? tocLines.map((line) => paragraph(line, "Normal")).join("") : paragraph("No headings found", "Normal")
      xml = xml.replace(/<w:p\b[\s\S]*?\{\{TOC\}\}[\s\S]*?<\/w:p>/g, replacement)
    }
  }
  return { xml, summary: { seqFields, captions, toc }, warnings }
}

function splitDocumentBody(documentXml: string): { content: string; sectPr: string } {
  const body = documentXml.match(/<w:body>([\s\S]*?)<\/w:body>/)?.[1]
  if (body === undefined) throw new Error("DOCX is missing w:body")
  const sect = body.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/)
  if (!sect || sect.index === undefined) return { content: body, sectPr: "" }
  return { content: body.slice(0, sect.index), sectPr: sect[0] }
}

function replaceDocumentBody(documentXml: string, body: string): string {
  return documentXml.replace(/<w:body>[\s\S]*?<\/w:body>/, `<w:body>${body}</w:body>`)
}

function parseImageRelationships(relsXml: string): Array<{ relId: string; target: string }> {
  return matchAll(relsXml, /<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"[^>]*>/g).map((relationship, index) => ({
    relId: attr(relationship, /\bId="([^"]+)"/) ?? `rIdImage${index + 1}`,
    target: attr(relationship, /\bTarget="([^"]+)"/) ?? "",
  })).filter((item) => item.target && !item.target.includes("\\") && !item.target.split("/").some((segment) => segment === ".." || segment === "." || !segment))
}

function maxRelationshipNumber(relsXml: string): number {
  return Math.max(0, ...matchAll(relsXml, /\bId="rId(?:MergedImage)?(\d+)"/g, 1).map((item) => Number(item)).filter(Number.isFinite))
}

function maxMediaImageNumber(bytes: Map<string, Uint8Array>): number {
  return Math.max(0, ...[...bytes.keys()].map((name) => name.match(/word\/media\/(?:merged\d+_)?image?(\d+)/i)?.[1]).filter((item): item is string => Boolean(item)).map((item) => Number(item)).filter(Number.isFinite))
}

function remapBookmarkIds(body: string, offset: number): string {
  return body.replace(/(<w:bookmark(?:Start|End)\b[^>]*\bw:id=")(\d+)(")/g, (_match, prefix: string, id: string, suffix: string) => `${prefix}${Number(id) + offset}${suffix}`)
}

function diffParagraphText(before: string[], after: string[], maxChanges: number): DiffWordDocumentsResult["diagnostics"] {
  const beforeCounts = countText(before)
  const afterCounts = countText(after)
  const added: string[] = []
  const removed: string[] = []
  for (const [text, count] of afterCounts) {
    const delta = count - (beforeCounts.get(text) ?? 0)
    for (let index = 0; index < delta; index += 1) added.push(text)
  }
  for (const [text, count] of beforeCounts) {
    const delta = count - (afterCounts.get(text) ?? 0)
    for (let index = 0; index < delta; index += 1) removed.push(text)
  }
  const changed = before.slice(0, Math.min(before.length, after.length)).flatMap((text, index) => (text !== after[index] ? [{ index: index + 1, before: text, after: after[index] ?? "" }] : []))
  const truncated = added.length > maxChanges || removed.length > maxChanges || changed.length > maxChanges
  return {
    beforeParagraphs: before.length,
    afterParagraphs: after.length,
    added: added.slice(0, maxChanges),
    removed: removed.slice(0, maxChanges),
    changed: changed.slice(0, maxChanges),
    truncated,
  }
}

function countText(items: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

function diffMarkdown(beforePath: string, afterPath: string, diagnostics: DiffWordDocumentsResult["diagnostics"]): string {
  const lines = [
    "# Word Diff Summary",
    "",
    `Before: ${beforePath}`,
    `After: ${afterPath}`,
    "",
    `Paragraphs before: ${diagnostics.beforeParagraphs}`,
    `Paragraphs after: ${diagnostics.afterParagraphs}`,
    `Added paragraphs: ${diagnostics.added.length}`,
    `Removed paragraphs: ${diagnostics.removed.length}`,
    `Changed paragraph positions: ${diagnostics.changed.length}`,
    diagnostics.truncated ? "Output truncated: true" : "Output truncated: false",
    "",
    "## Added",
    ...diagnostics.added.map((item) => `- ${item}`),
    "",
    "## Removed",
    ...diagnostics.removed.map((item) => `- ${item}`),
    "",
    "## Changed",
    ...diagnostics.changed.map((item) => `- ${item.index}: ${item.before} -> ${item.after}`),
    "",
  ]
  return `${lines.join("\n")}\n`
}

function safeMarkdownName(input: string): string {
  const base = input
    .replace(/\.md$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "word-diff"
  return `${base}.md`
}

function safeOoxmlPart(input: string): string {
  const part = input.trim()
  if (!part) throw new Error("patch_ooxml_part patch.part is required")
  if (!part.endsWith(".xml") && !part.endsWith(".rels")) throw new Error(`OOXML patch only supports XML parts: ${part}`)
  if (part.startsWith("/") || part.includes("\\") || part.includes("://") || part.includes("\0")) throw new Error(`unsafe OOXML part path: ${part}`)
  if (!/^[A-Za-z0-9_[\]./-]+$/.test(part)) throw new Error(`unsafe OOXML part path: ${part}`)
  const segments = part.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error(`unsafe OOXML part path: ${part}`)
  return part
}

function patchOoxmlPart(xml: string, patch: WordOoxmlPartPatch): { xml: string; replacements: number } {
  if (!patch.find) throw new Error("patch_ooxml_part patch.find must not be empty")
  if (patch.replaceAll) {
    const replacements = xml.split(patch.find).length - 1
    if (replacements === 0) throw new Error(`patch_ooxml_part find text was not found in ${patch.part}`)
    return { xml: xml.split(patch.find).join(patch.replace), replacements }
  }
  const occurrence = Math.floor(patch.occurrence ?? 1)
  if (occurrence < 1) throw new Error("patch_ooxml_part occurrence must be >= 1")
  let start = 0
  let found = -1
  for (let index = 0; index < occurrence; index += 1) {
    found = xml.indexOf(patch.find, start)
    if (found < 0) throw new Error(`patch_ooxml_part occurrence ${occurrence} was not found in ${patch.part}`)
    start = found + patch.find.length
  }
  return { xml: splice(xml, found, found + patch.find.length, patch.replace), replacements: 1 }
}

async function rewriteDocx(
  entries: Array<{
    filename: string
    directory?: boolean
    getData?: (writer: Uint8ArrayWriter) => Promise<Uint8Array>
  }>,
  textOverrides: Record<string, string>,
  binaryOverrides: Map<string, Uint8Array>,
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  const written = new Set<string>()
  for (const entry of entries) {
    if (entry.directory) continue
    const text = textOverrides[entry.filename]
    const binary = binaryOverrides.get(entry.filename)
    if (text !== undefined) {
      await writer.add(entry.filename, new TextReader(text.startsWith("<?xml") ? text : xml(text)))
      written.add(entry.filename)
      continue
    }
    if (binary) {
      await writer.add(entry.filename, new Uint8ArrayReader(binary))
      written.add(entry.filename)
      continue
    }
    const data = await entry.getData?.(new Uint8ArrayWriter())
    if (data) await writer.add(entry.filename, new Uint8ArrayReader(data))
    written.add(entry.filename)
  }
  for (const [filename, data] of binaryOverrides) {
    if (!written.has(filename)) {
      await writer.add(filename, new Uint8ArrayReader(data))
      written.add(filename)
    }
  }
  for (const [filename, text] of Object.entries(textOverrides)) {
    if (!written.has(filename)) await writer.add(filename, new TextReader(text.startsWith("<?xml") ? text : xml(text)))
  }
  return await writer.close()
}

function insertBeforeSectPr(documentXml: string, insertion: string): string {
  const sect = documentXml.lastIndexOf("<w:sectPr")
  if (sect >= 0) return splice(documentXml, sect, sect, insertion)
  const bodyClose = documentXml.lastIndexOf("</w:body>")
  if (bodyClose >= 0) return splice(documentXml, bodyClose, bodyClose, insertion)
  return `${documentXml}${insertion}`
}

function splice(input: string, start: number, end: number, replacement: string): string {
  return `${input.slice(0, start)}${replacement}${input.slice(end)}`
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim()
}

function targetLabel(block: TopLevelBlock): string {
  if (block.kind === "table") return `table:${block.tableIndex}`
  if (block.headingLevel) return `heading:${block.headingLevel}:${block.text}`
  return `paragraph:${block.paragraphIndex}`
}

function contentControlLabel(block: ContentControlBlock): string {
  if (block.tag) return `content-control:${block.index}:tag:${block.tag}`
  if (block.title) return `content-control:${block.index}:title:${block.title}`
  return `content-control:${block.index}`
}

function isDeleteEdit(edit: WordEditOperation): boolean {
  return edit.op === "delete_paragraph" || edit.op === "delete_section" || edit.op === "delete_table"
}
