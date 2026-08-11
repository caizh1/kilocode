import fs from "fs/promises"
import { execFile as execFileCallback } from "child_process"
import { createHash } from "node:crypto"
import http from "node:http"
import https from "node:https"
import os from "os"
import path from "path"
import { promisify } from "util"
import { TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { extractDocxPlantUml } from "@kilocode/kilo-indexing/engine"
import { declareArtifact } from "@/kilocode/documents/artifacts"
import { assertValidWordDocumentBytes, prepareWordDocumentBytes } from "@/kilocode/documents/word-validation"
import { Instance } from "@/kilocode/instance"
import { userEnv } from "@/kilocode/product-env"

const execFile = promisify(execFileCallback)

const PAGE_WIDTH_DXA = 12_240
const PAGE_HEIGHT_DXA = 15_840
const PAGE_MARGIN_DXA = 1_440
const HEADER_FOOTER_DXA = 708
const CONTENT_WIDTH_DXA = 9_360
const TABLE_INDENT_DXA = 120
const TABLE_CELL_MARGIN_X_DXA = 120
const TABLE_CELL_MARGIN_Y_DXA = 80
const MAX_FIGURE_WIDTH_PX = 624
const MAX_FIGURE_HEIGHT_PX = 720
const EMU_PER_CSS_PIXEL = 9_525
const CJK_FONT =
  process.platform === "darwin"
    ? "Heiti SC"
    : process.platform === "win32"
      ? "Microsoft YaHei"
      : "Noto Sans CJK SC"
const NEAR_BLANK_INK_RATIO = 0.0005
const MAX_REMOTE_WORD_RENDER_RESPONSE_BYTES = 512 * 1024 * 1024

type Photon = typeof import("@silvia-odwyer/photon-node")
type PhotonLoad = { module: Photon } | { error: unknown }

const photon = (() => {
  const state: { value?: Promise<PhotonLoad> } = {}
  return () => {
    state.value ??= (async () => {
      try {
        const wasm = (await import("@silvia-odwyer/photon-node/photon_rs_bg.wasm", { with: { type: "file" } })).default
        ;(globalThis as typeof globalThis & { __KILOCODE_PHOTON_WASM_PATH?: string }).__KILOCODE_PHOTON_WASM_PATH = wasm
        return { module: await import("@silvia-odwyer/photon-node") }
      } catch (error) {
        return { error }
      }
    })()
    return state.value
  }
})()

export type WordBlock =
  | { type: "heading"; level?: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][]; caption?: string }
  | { type: "code"; language?: string; text: string }
  | {
      type: "image"
      title?: string
      caption?: string
      altText?: string
      path?: string
      base64?: string
      contentType?: "image/png" | "image/jpeg"
      width?: number
      height?: number
    }

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
  /** Internal caller-owned artifact directory. Public Word tools intentionally do not expose this. */
  artifactDir?: string
  documentType?: string
  author?: string
  language?: "en-US" | "zh-CN"
  headingNumbering?: "none" | "decimal"
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
  /** Internal caller-owned artifact directory. Public Word tools intentionally do not expose this. */
  artifactDir?: string
  outputFile?: string
  taskSlug?: string
  title?: string
  tocMode?: "preserve" | "materialize" | "remove"
  /** Internal deterministic TOC depth. Public tools keep the default three-level behavior. */
  tocMaxLevel?: 1 | 2 | 3
}

export type MaterializedWordFields = {
  path: string
  artifactDir: string
  manifestPath: string
  summary: {
    seqFields: number
    captions: number
    toc: "none" | "preserved" | "materialized" | "removed"
    tocEntryCount: number
    needsLayoutRefresh: boolean
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
  /** Internal caller-owned artifact directory. Public Word tools intentionally do not expose this. */
  artifactDir?: string
  remoteEndpoint?: string
  outputFile?: string
  taskSlug?: string
  title?: string
  timeoutMs?: number
  maxPages?: number
}

export type WordRenderDiagnostic = {
  code:
    | "word-render-endpoint-not-configured"
    | "word-render-remote-failed"
    | "word-render-local-failed"
    | "word-render-local-field-refresh-failed"
    | "word-render-local-page-renderer-not-configured"
    | "pdf-missing"
    | "pdf-invalid"
    | "png-invalid"
    | "page-count-zero"
    | "page-count-exceeds-limit"
    | "page-count-incomplete"
    | "blank-page"
    | "near-blank-page"
    | "page-summary-failed"
    | "image-loss-suspected"
    | "word-render-field-refresh-failed"
    | "word-render-text-qa-failed"
    | "word-render-cjk-font-missing"
    | "word-render-refreshed-docx-invalid"
    | "word-render-response-invalid"
    | "word-render-page-sequence-invalid"
    | "word-render-page-duplicate"
    | "word-render-pdf-page-count-mismatch"
  severity: "warning" | "error"
  message: string
}

export type WordRenderIssue = {
  severity?: string
  code?: string
  message?: string
}

export type WordRenderPageQa = {
  page?: number
  width?: number
  height?: number
  visualSummary?: Record<string, unknown>
}

export type WordRenderTextQa = {
  ok: boolean
  titlePresent: boolean
  firstHeadingPresent: boolean
  sourceCjkCount: number
  pdfCjkCount: number
  cjkCoverage: number
  sentinelCount: number
  matchedSentinelCount: number
  sentinelCoverage: number
  diagnostics: string[]
}

export type RenderedWordDocument = {
  artifactDir: string
  manifestPath: string
  pdfPath?: string
  pagePngPaths: string[]
  diagnosticsPath: string
  pageCount: number
  expectedPageCount?: number
  returnedPageCount?: number
  pageCountKind: "exact" | "lower-bound" | "unknown"
  warnings: string[]
  diagnostics: WordRenderDiagnostic[]
  issues?: WordRenderIssue[]
  renderer?: Record<string, unknown>
  pageQa?: WordRenderPageQa[]
  textQa?: WordRenderTextQa
  pageEvidenceStatus: "completed" | "incomplete" | "unavailable"
  visualQaStatus: "completed" | "skipped"
  fieldRefreshStatus?: "completed" | "failed" | "not-required"
  fieldRefreshDiagnostics?: string[]
  tocHeadingCount?: number
  tocEntryCount?: number
  tocPageNumberCount?: number
  refreshedDocxPath?: string
  visualQaSkipReason?:
    | "renderer-unavailable"
    | "render-failed"
    | "page-images-missing"
    | "page-count-incomplete"
    | "invalid-page-image"
    | "page-quality-failed"
}

export type InsertWordPngImageInput = {
  sourcePath: string
  pngPath?: string
  pngBase64?: string
  heading?: string
  caption?: string
  figureTitle?: string
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
  firstHeading?: string
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
    headingPath: string[]
    title?: string
    caption?: string
    visibleId?: string
    altText?: string
    mediaPath?: string
    sha256?: string
    plantUmlSource?: string
    plantUmlVersion?: string
  }>
  imageDiagnostics: {
    drawingCount: number
    relationshipCount: number
    orphanRelationshipIds: string[]
    missingRelationshipIds: string[]
    missingMediaTargets: string[]
    duplicateMediaHashes: Array<{ sha256: string; relIds: string[] }>
  }
  contentControls: Array<{
    index: number
    tag?: string
    title?: string
    text: string
  }>
  styles: string[]
  warnings: string[]
  totalParagraphs: number
  totalTables: number
  paragraphsTruncated: boolean
  tablesTruncated: boolean
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
  const built = await buildDocx(spec, context)
  const prepared = await prepareWordDocumentBytes(built, "create_word_document candidate")
  const artifact = await declareArtifact({
    kind: "word-document",
    title: spec.artifactTitle ?? spec.title,
    taskSlug: spec.taskSlug ?? spec.title,
    artifactDir: spec.artifactDir,
    primaryFile: safeDocxName(spec.outputFile ?? spec.title),
    warnings: prepared.warnings,
    qualityStatus: prepared.warnings.length ? "warning" : "unknown",
  })
  const output = path.join(
    Instance.directory,
    artifact.artifactDir,
    artifact.manifest.primaryFile ?? safeDocxName(spec.title),
  )
  assertInside(path.join(Instance.directory, artifact.artifactDir), output, "outputFile")
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, prepared.bytes)
  return {
    path: normalizePortable(path.relative(Instance.directory, output)),
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
    warnings: prepared.warnings,
  }
}

export async function inspectWordDocument(input: {
  path: string
  maxParagraphs?: number
  maxTables?: number
  /** Internal controller-only caps. Public tool schema intentionally does not expose these fields. */
  internalMaxParagraphs?: number
  internalMaxTables?: number
}): Promise<WordDocumentInspection> {
  const absolute = resolveWorkspacePath(input.path)
  const bytes = new Uint8Array(await fs.readFile(absolute))
  await assertValidWordDocumentBytes(bytes, `inspect_word_document source ${input.path}`)
  const zip = new ZipReader(new Uint8ArrayReader(bytes))
  try {
    const entries = await zip.getEntries()
    const byName = new Map(entries.map((entry) => [entry.filename, entry]))
    const documentXml = await readEntryText(byName, "word/document.xml")
    if (!documentXml) throw new Error(`DOCX is missing word/document.xml: ${input.path}`)
    const relsXml = await readEntryText(byName, "word/_rels/document.xml.rels")
    const stylesXml = await readEntryText(byName, "word/styles.xml")
    const paragraphs = parseParagraphs(documentXml)
    const tables = parseTables(documentXml)
    const maxParagraphs =
      input.internalMaxParagraphs === undefined
        ? clamp(input.maxParagraphs ?? 120, 1, 1_000)
        : clamp(input.internalMaxParagraphs, 1, 10_000)
    const maxTables =
      input.internalMaxTables === undefined
        ? clamp(input.maxTables ?? 20, 1, 200)
        : clamp(input.internalMaxTables, 1, 1_000)
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
    const paragraphsTruncated = paragraphs.length > inspectedParagraphs.length
    const tablesTruncated = tables.length > maxTables
    const imageInspection = await inspectImages(documentXml, relsXml ?? "", byName)
    const plantuml = await extractDocxPlantUml(bytes).catch((err: unknown) => ({
      diagrams: [],
      warnings: [`Embedded PlantUML extraction failed: ${err instanceof Error ? err.message : String(err)}`],
      truncated: true,
    }))
    const diagrams = new Map(plantuml.diagrams.map((diagram) => [diagram.mediaPath, diagram]))
    return {
      path: normalizePortable(path.relative(Instance.directory, absolute)),
      title: paragraphs.find((paragraph) => paragraph.styleId === "Title")?.text,
      firstHeading: outline[0]?.title,
      paragraphs: inspectedParagraphs,
      outline,
      tables: tables.slice(0, maxTables).map((table, index) => ({
        index: index + 1,
        rows: table,
        headingPath: [],
      })),
      images: imageInspection.images.map((image) => {
        const diagram = image.mediaPath ? diagrams.get(image.mediaPath) : undefined
        return {
          ...image,
          plantUmlSource: diagram?.source,
          plantUmlVersion: diagram?.version,
        }
      }),
      imageDiagnostics: imageInspection.diagnostics,
      contentControls: parseContentControls(documentXml).map((item) => ({
        index: item.index,
        tag: item.tag,
        title: item.title,
        text: item.text,
      })),
      styles: parseStyles(stylesXml ?? ""),
      warnings: [
        ...plantuml.warnings,
        ...(plantuml.truncated ? ["Embedded PlantUML extraction was truncated by safety limits."] : []),
      ],
      totalParagraphs: paragraphs.length,
      totalTables: tables.length,
      paragraphsTruncated,
      tablesTruncated,
      truncated: paragraphsTruncated || tablesTruncated,
    }
  } finally {
    await zip.close()
  }
}

export async function applyWordDocumentEdits(input: ApplyWordDocumentEditsInput): Promise<AppliedWordDocumentEdits> {
  if (!Array.isArray(input.edits) || input.edits.length === 0)
    throw new Error("apply_word_document_edits edits must not be empty")
  for (const edit of input.edits) {
    if (edit.op === "patch_ooxml_part") safeOoxmlPart(edit.patch.part)
  }
  const effectiveDryRun = input.dryRun ?? input.edits.some(isDeleteEdit)
  const source = resolveWorkspacePath(input.sourcePath)
  const bytes = new Uint8Array(await fs.readFile(source))
  await assertValidWordDocumentBytes(bytes, `apply_word_document_edits source ${input.sourcePath}`)
  const zip = new ZipReader(new Uint8ArrayReader(bytes))
  const warnings: string[] = []
  try {
    const entries = await zip.getEntries()
    const byName = new Map(entries.map((entry) => [entry.filename, entry]))
    let documentXml = await readEntryText(byName, "word/document.xml")
    if (!documentXml) throw new Error(`DOCX is missing word/document.xml: ${input.sourcePath}`)
    let relsXml =
      (await readEntryText(byName, "word/_rels/document.xml.rels")) ??
      documentRelationshipsXml({ images: [], imageMap: new WeakMap() })
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

    const nextBytes = await rewriteDocx(
      entries,
      {
        "word/document.xml": documentXml,
        "word/_rels/document.xml.rels": relsXml,
        ...textOverrides,
      },
      mediaUpdates,
    )
    const prepared = await prepareWordDocumentBytes(nextBytes, "apply_word_document_edits candidate")
    warnings.push(...prepared.warnings)

    const backupEnabled = input.backup ?? true
    const backupFile = backupEnabled
      ? safeDocxName(`${path.basename(input.sourcePath, ".docx")}-source-backup.docx`)
      : undefined
    const artifact = await declareArtifact({
      kind: "word-document",
      title: input.title ?? `Edited ${path.basename(input.sourcePath)}`,
      taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-edited`,
      primaryFile: safeDocxName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}-edited.docx`),
      derivedFiles: backupFile ? [backupFile] : [],
      warnings,
      qualityStatus: warnings.length ? "warning" : "unknown",
    })
    const output = path.join(
      Instance.directory,
      artifact.artifactDir,
      artifact.manifest.primaryFile ?? safeDocxName("edited.docx"),
    )
    assertInside(path.join(Instance.directory, artifact.artifactDir), output, "outputFile")
    await fs.mkdir(path.dirname(output), { recursive: true })
    const backupPath = backupFile ? path.join(Instance.directory, artifact.artifactDir, backupFile) : undefined
    if (backupPath) {
      assertInside(path.join(Instance.directory, artifact.artifactDir), backupPath, "backupFile")
      await fs.writeFile(backupPath, bytes)
    }
    await fs.writeFile(output, prepared.bytes)
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
      const conflicts = parseStyles(sourceStyles ?? "").filter((styleId) =>
        parseStyles(templateStyles).includes(styleId),
      )
      if (conflicts.length)
        warnings.push(`template styles override source style ids: ${conflicts.slice(0, 20).join(", ")}`)
      textOverrides["word/styles.xml"] = input.fontFamily
        ? applyDefaultFontToStyles(templateStyles, input.fontFamily)
        : templateStyles
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
        textOverrides["word/_rels/document.xml.rels"] ??
          snapshotText(source, "word/_rels/document.xml.rels") ??
          documentRelationshipsXml({ images: [], imageMap: new WeakMap() }),
        "rIdKiloTheme",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
        "theme/theme1.xml",
      )
      textOverrides["[Content_Types].xml"] = ensureContentTypeOverride(
        textOverrides["[Content_Types].xml"] ??
          snapshotText(source, "[Content_Types].xml") ??
          contentTypesXml({ images: [], imageMap: new WeakMap() }),
        "/word/theme/theme1.xml",
        "application/vnd.openxmlformats-officedocument.theme+xml",
      )
      appliedParts.push("word/theme/theme1.xml")
    }
  } else if (input.fontFamily?.trim()) {
    textOverrides["word/styles.xml"] = applyDefaultFontToStyles(
      snapshotText(source, "word/styles.xml") ?? stylesXml(),
      input.fontFamily,
    )
    appliedParts.push("word/styles.xml")
  } else {
    warnings.push(
      "apply_word_template_styles did not receive templatePath or fontFamily; source document is copied unchanged",
    )
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
  const result = materializeFieldsInDocument(documentXml, input.tocMode ?? "preserve", input.tocMaxLevel ?? 3)
  const warnings = [...result.warnings]
  if (!result.summary.seqFields && !result.summary.captions && result.summary.toc === "none")
    warnings.push("no supported Word field placeholders were found")
  const written = await writeDocxArtifact(source, { "word/document.xml": result.xml }, new Map(), {
    title: input.title ?? `Fields ${path.basename(input.sourcePath)}`,
    taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-fields`,
    outputFile: safeDocxName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}-fields.docx`),
    warnings,
    artifactDir: input.artifactDir,
  })
  return { ...written, summary: result.summary, warnings }
}

export async function mergeWordDocuments(input: MergeWordDocumentsInput): Promise<MergedWordDocuments> {
  if (!Array.isArray(input.sources) || input.sources.length < 2)
    throw new Error("merge_word_documents requires at least two source documents")
  const snapshots = await Promise.all(input.sources.map(readDocxSnapshot))
  const base = snapshots[0]!
  const baseDocumentXml = requiredSnapshotText(base, "word/document.xml", input.sources[0]!)
  const baseBody = splitDocumentBody(baseDocumentXml)
  let relsXml =
    snapshotText(base, "word/_rels/document.xml.rels") ??
    documentRelationshipsXml({ images: [], imageMap: new WeakMap() })
  let contentTypes =
    snapshotText(base, "[Content_Types].xml") ?? contentTypesXml({ images: [], imageMap: new WeakMap() })
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
      relsXml = appendRelationship(
        relsXml,
        newRelId,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        newTarget,
      )
      contentTypes = ensureImageContentType(contentTypes, newTarget)
      copiedImages += 1
    }
    if (input.separatorHeading ?? true) bodyParts.push(paragraph(label.replace(/\.docx$/i, ""), "Heading1"))
    bodyParts.push(body)
  }
  const documentXml = replaceDocumentBody(baseDocumentXml, `${bodyParts.join("")}${baseBody.sectPr}`)
  const written = await writeDocxArtifact(
    base,
    {
      "word/document.xml": documentXml,
      "word/_rels/document.xml.rels": relsXml,
      "[Content_Types].xml": contentTypes,
    },
    binaryOverrides,
    {
      title: input.title ?? "Merged Word Document",
      taskSlug: input.taskSlug ?? "merged-word-document",
      outputFile: safeDocxName(input.outputFile ?? "merged-word-document.docx"),
      warnings,
    },
  )
  return { ...written, sourceCount: input.sources.length, copiedImages, warnings }
}

export async function diffWordDocuments(input: DiffWordDocumentsInput): Promise<DiffWordDocumentsResult> {
  const before = await readDocxSnapshot(input.beforePath)
  const after = await readDocxSnapshot(input.afterPath)
  const beforeParagraphs = parseParagraphs(requiredSnapshotText(before, "word/document.xml", input.beforePath))
    .map((item) => item.text)
    .filter(Boolean)
  const afterParagraphs = parseParagraphs(requiredSnapshotText(after, "word/document.xml", input.afterPath))
    .map((item) => item.text)
    .filter(Boolean)
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
  if (!Array.isArray(input.tables) || input.tables.length === 0)
    throw new Error("normalize_word_table_spec tables must not be empty")
  const tables = input.tables.map((table, index) =>
    normalizeTableSpec(table, {
      trimCells: input.trimCells ?? true,
      fillMissingCells: input.fillMissingCells ?? "",
      maxColumns: input.maxColumns,
      label: `tables[${index}]`,
    }),
  )
  return {
    tables,
    warnings: tables.flatMap((table, index) => table.warnings.map((warning) => `tables[${index}]: ${warning}`)),
  }
}

export async function renderWordDocument(input: RenderWordDocumentInput): Promise<RenderedWordDocument> {
  const source = resolveWorkspacePath(input.sourcePath)
  const docxBytes = new Uint8Array(await fs.readFile(source))
  await assertValidWordDocumentBytes(docxBytes, `render_word_document source ${input.sourcePath}`)
  const endpoint = input.remoteEndpoint?.trim() || process.env["KILO_WORD_RENDER_ENDPOINT"]?.trim()
  const diagnostics: WordRenderDiagnostic[] = []
  const maxPages = clamp(input.maxPages ?? 500, 1, 2_000)
  const diagnosticsFile = "render-diagnostics.json"
  const timeoutMs = input.timeoutMs ?? 120_000
  if (!endpoint) {
    const local = await tryLocalWordRenderer(source, input, maxPages, timeoutMs)
    if (!local) {
      diagnostics.push({
        code: "word-render-endpoint-not-configured",
        severity: "warning",
        message:
          "Word render remote endpoint is not configured and no local soffice executable was found; set remoteEndpoint, KILO_WORD_RENDER_ENDPOINT, KILO_WORD_RENDER_SOFFICE, or put soffice on PATH to render PDF/page PNG artifacts.",
      })
      return writeSkippedWordRender(input, source, diagnostics, diagnosticsFile, "renderer-unavailable")
    }
    diagnostics.push(...local.diagnostics)
    return writeRenderedWordArtifacts(input, source, local.response, diagnostics, maxPages, diagnosticsFile)
  }
  let response: RemoteWordRenderResponse
  try {
    response = await callWordRenderer(
      endpoint,
      {
        filename: path.basename(input.sourcePath),
        fileName: path.basename(input.sourcePath),
        docxBase64: Buffer.from(docxBytes).toString("base64"),
        output: { pdf: true, pngPages: true },
        timeoutMs: input.timeoutMs,
        maxPages,
      },
      timeoutMs,
    )
  } catch (err) {
    const remote: WordRenderDiagnostic = {
      code: "word-render-remote-failed",
      severity: "warning",
      message: err instanceof Error ? err.message : String(err),
    }
    const local = await tryLocalWordRenderer(source, input, maxPages, timeoutMs)
    if (local) {
      diagnostics.push(remote, ...local.diagnostics)
      return writeRenderedWordArtifacts(input, source, local.response, diagnostics, maxPages, diagnosticsFile)
    }
    diagnostics.push({ ...remote, severity: "error" })
    return writeSkippedWordRender(input, source, diagnostics, diagnosticsFile, "render-failed")
  }
  return writeRenderedWordArtifacts(input, source, response, diagnostics, maxPages, diagnosticsFile)
}

async function writeSkippedWordRender(
  input: RenderWordDocumentInput,
  source: string,
  diagnostics: WordRenderDiagnostic[],
  diagnosticsFile: string,
  reason: RenderedWordDocument["visualQaSkipReason"],
): Promise<RenderedWordDocument> {
  const warnings = diagnostics.map((item) => `${item.code}: ${item.message}`)
  const artifact = await declareArtifact({
    kind: "word-render",
    title: input.title ?? `Render ${path.basename(input.sourcePath)}`,
    taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-render`,
    artifactDir: input.artifactDir,
    derivedFiles: [diagnosticsFile],
    sourceFiles: [normalizePortable(path.relative(Instance.directory, source))],
    warnings,
    qualityStatus: diagnostics.some((item) => item.severity === "error") ? "failed" : "warning",
  })
  const artifactDir = path.join(Instance.directory, artifact.artifactDir)
  const diagnosticsPath = path.join(artifactDir, diagnosticsFile)
  await fs.writeFile(
    diagnosticsPath,
    `${JSON.stringify(
      {
        diagnostics,
        warnings,
        pageCount: 0,
        pageCountKind: "unknown",
        pageEvidenceStatus: "unavailable",
        pagePngPaths: [],
        visualQaStatus: "skipped",
        visualQaSkipReason: reason,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  return {
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
    diagnosticsPath: normalizePortable(path.relative(Instance.directory, diagnosticsPath)),
    pagePngPaths: [],
    pageCount: 0,
    pageCountKind: "unknown",
    warnings,
    diagnostics,
    pageEvidenceStatus: "unavailable",
    visualQaStatus: "skipped",
    visualQaSkipReason: reason,
  }
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
  const sourceInspection = await inspectWordDocument({ path: input.sourcePath, maxParagraphs: 1_000, maxTables: 200 })
  const sourceBytes = new Uint8Array(await fs.readFile(source))
  for (const issue of response.issues ?? []) {
    diagnostics.push({
      code: "word-render-remote-failed",
      severity: issue.severity === "error" ? "error" : "warning",
      message: `${issue.code ? `${issue.code}: ` : ""}${issue.message ?? "Word renderer reported an issue."}`,
    })
  }
  for (const warning of response.warnings ?? []) {
    diagnostics.push({ code: "word-render-remote-failed", severity: "warning", message: warning })
  }
  if (response.textQa?.ok !== true)
    diagnostics.push({
      code: "word-render-text-qa-failed",
      severity: "warning",
      message: `Rendered PDF text QA did not pass: ${(response.textQa?.diagnostics ?? ["renderer did not return textQa evidence"]).join("; ")}`,
    })
  if (response.fieldRefreshStatus === "failed")
    diagnostics.push({
      code: "word-render-field-refresh-failed",
      severity: "warning",
      message: `Native Word field refresh failed: ${(response.fieldRefreshDiagnostics ?? ["no diagnostic supplied"]).join("; ")}`,
    })
  const pdf = response.pdfBase64?.trim() || response.pdf?.base64?.trim()
  const pdfBytes = pdf ? Buffer.from(pdf, "base64") : undefined
  if (!pdfBytes?.length)
    diagnostics.push({
      code: "pdf-missing",
      severity: "warning",
      message: "Renderer response did not include a PDF payload.",
    })
  if (pdfBytes?.length && !isPdf(pdfBytes))
    diagnostics.push({
      code: "pdf-invalid",
      severity: "error",
      message: "Renderer PDF payload is not a valid PDF header.",
    })
  const pagePayloads = response.pages ?? []
  const expectedPages = Math.max(0, response.pageCount ?? pagePayloads.length)
  const returnedPages = response.returnedPageCount ?? pagePayloads.length
  const pageCountKind: RenderedWordDocument["pageCountKind"] =
    response.pageCountKind ?? (typeof response.pageCount === "number" ? "exact" : "unknown")
  if (pagePayloads.length === 0)
    diagnostics.push({ code: "page-count-zero", severity: "warning", message: "Renderer returned zero page PNGs." })
  if (pagePayloads.length > maxPages || expectedPages > maxPages)
    diagnostics.push({
      code: "page-count-exceeds-limit",
      severity: "warning",
      message: `Renderer reported ${expectedPages || pagePayloads.length} pages, exceeding maxPages ${maxPages}.`,
    })
  if (expectedPages > pagePayloads.length || pageCountKind !== "exact")
    diagnostics.push({
      code: "page-count-incomplete",
      severity: "warning",
      message: `Renderer page count is ${pageCountKind}: reported ${expectedPages} and returned ${pagePayloads.length} page payloads.`,
    })
  if (returnedPages !== pagePayloads.length)
    diagnostics.push({
      code: "word-render-page-sequence-invalid",
      severity: "error",
      message: `Renderer returnedPageCount ${returnedPages} does not match ${pagePayloads.length} page payloads.`,
    })
  const pageNumbers = pagePayloads.map((page, index) => page.page ?? index + 1)
  if (
    new Set(pageNumbers).size !== pageNumbers.length ||
    pageNumbers.some((page, index) => !Number.isInteger(page) || page !== index + 1)
  )
    diagnostics.push({
      code: "word-render-page-sequence-invalid",
      severity: "error",
      message: `Renderer page identifiers must be the unique ordered sequence 1..N; received ${pageNumbers.join(", ")}.`,
    })
  if (pdfBytes?.length && isPdf(pdfBytes)) {
    const pdfPages = await pdfPageCount(pdfBytes, input.timeoutMs ?? 120_000)
    if (!pdfPages || pdfPages !== expectedPages)
      diagnostics.push({
        code: "word-render-pdf-page-count-mismatch",
        severity: "error",
        message: `PDF page count ${pdfPages ?? "unknown"} does not match renderer pageCount ${expectedPages}.`,
      })
  }
  if (typeof response.detectedImageCount === "number" && response.detectedImageCount < sourceInspection.images.length) {
    diagnostics.push({
      code: "image-loss-suspected",
      severity: "warning",
      message: `Source document has ${sourceInspection.images.length} image(s), renderer reported ${response.detectedImageCount}.`,
    })
  }
  const pdfName = safePdfName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}.pdf`)
  const pngEntries: Array<{ name: string; bytes: Buffer; qa: WordRenderPageQa }> = []
  const pageHashes = new Set<string>()
  for (const [index, page] of pagePayloads.slice(0, maxPages).entries()) {
    const pageBytes =
      page.pngBase64 || page.base64 ? Buffer.from(page.pngBase64 ?? page.base64 ?? "", "base64") : undefined
    const name = safePngName(page.fileName ?? `rendered/page-${String(index + 1).padStart(3, "0")}.png`, index + 1)
    if (!pageBytes?.length || !isPng(pageBytes)) {
      diagnostics.push({
        code: "png-invalid",
        severity: "error",
        message: `Renderer page ${index + 1} is missing or not a valid PNG.`,
      })
      continue
    }
    const hash = createHash("sha256").update(pageBytes).digest("hex")
    if (pageHashes.has(hash))
      diagnostics.push({
        code: "word-render-page-duplicate",
        severity: "error",
        message: `Renderer returned duplicate PNG content for page ${page.page ?? index + 1}.`,
      })
    pageHashes.add(hash)
    const scanned = await summarizePagePng(pageBytes)
    const visualSummary = scanned.summary
    const summaryError =
      scanned.error ?? (typeof visualSummary?.["summaryError"] === "string" ? visualSummary["summaryError"] : undefined)
    if (summaryError)
      diagnostics.push({
        code: "page-summary-failed",
        severity: "error",
        message: `Could not summarize renderer page ${index + 1}: ${summaryError}`,
      })
    const inkPixels = numberField(visualSummary, "bodyInkPixels")
    const inkRatio = numberField(visualSummary, "bodyInkRatio")
    if (page.blank || inkPixels === 0)
      diagnostics.push({
        code: "blank-page",
        severity: "warning",
        message: `Renderer marked page ${index + 1} as blank.`,
      })
    else if (inkRatio !== undefined && inkRatio < NEAR_BLANK_INK_RATIO)
      diagnostics.push({
        code: "near-blank-page",
        severity: "warning",
        message: `Renderer page ${index + 1} has an ink ratio of ${inkRatio.toFixed(6)} and requires review.`,
      })
    pngEntries.push({
      name,
      bytes: pageBytes,
      qa: {
        page: page.page ?? index + 1,
        width: page.width ?? numberField(visualSummary, "width"),
        height: page.height ?? numberField(visualSummary, "height"),
        visualSummary,
      },
    })
  }
  const refreshed = response.fieldRefreshStatus === "completed" ? response.updatedDocxBase64?.trim() : undefined
  const refreshedBytes = refreshed ? Buffer.from(refreshed, "base64") : undefined
  const refresh = refreshedBytes?.length
    ? await verifyRefreshedDocx(sourceBytes, refreshedBytes, response)
    : { ok: false, diagnostics: ["Renderer did not return a refreshed DOCX payload."] }
  const validRefreshed = Boolean(refreshedBytes?.length && refresh.ok)
  const fieldRefreshStatus: RenderedWordDocument["fieldRefreshStatus"] =
    response.fieldRefreshStatus === "completed" && !validRefreshed ? "failed" : response.fieldRefreshStatus
  const fieldRefreshDiagnostics =
    response.fieldRefreshStatus === "completed" && !validRefreshed
      ? [...(response.fieldRefreshDiagnostics ?? []), ...refresh.diagnostics]
      : response.fieldRefreshDiagnostics
  if (response.fieldRefreshStatus === "completed" && !validRefreshed)
    diagnostics.push({
      code: "word-render-refreshed-docx-invalid",
      severity: "error",
      message: `Renderer claimed completed field refresh, but client verification failed: ${refresh.diagnostics.join("; ")}`,
    })
  warnings.push(...diagnostics.map((item) => `${item.code}: ${item.message}`))
  const refreshedName = `refreshed/${safeDocxName(path.basename(input.sourcePath))}`
  const derivedFiles = [
    ...pngEntries.map((item) => item.name),
    ...(validRefreshed ? [refreshedName] : []),
    diagnosticsFile,
  ]
  const artifact = await declareArtifact({
    kind: "word-render",
    title: input.title ?? `Render ${path.basename(input.sourcePath)}`,
    taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-render`,
    artifactDir: input.artifactDir,
    primaryFile: pdfBytes?.length && isPdf(pdfBytes) ? pdfName : undefined,
    derivedFiles,
    sourceFiles: [normalizePortable(path.relative(Instance.directory, source))],
    warnings,
    replaceDerivedFiles: true,
    qualityStatus: diagnostics.some((item) => item.severity === "error")
      ? "failed"
      : diagnostics.length
        ? "warning"
        : "ok",
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
  let refreshedDocxPath: string | undefined
  if (validRefreshed && refreshedBytes) {
    const output = path.join(artifactDir, refreshedName)
    assertInside(artifactDir, output, "refreshedDocx")
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, refreshedBytes)
    refreshedDocxPath = normalizePortable(path.relative(Instance.directory, output))
  }
  const diagnosticsPath = path.join(artifactDir, diagnosticsFile)
  const invalidPages = diagnostics.some((item) => item.code === "png-invalid")
  const defectivePages = diagnostics.some((item) =>
    ["blank-page", "near-blank-page", "page-summary-failed"].includes(item.code),
  )
  const defectiveText =
    response.textQa?.ok !== true || response.issues?.some((item) => item.code === "word-render-text-loss-suspected")
  const pageIntegrityFailure = diagnostics.some((item) =>
    ["word-render-page-sequence-invalid", "word-render-page-duplicate", "word-render-pdf-page-count-mismatch"].includes(
      item.code,
    ),
  )
  const completePages =
    pageCountKind === "exact" &&
    expectedPages > 0 &&
    pngEntries.length === expectedPages &&
    returnedPages === expectedPages &&
    expectedPages <= maxPages &&
    !pageIntegrityFailure
  const pageEvidenceStatus: RenderedWordDocument["pageEvidenceStatus"] = completePages ? "completed" : "incomplete"
  const visualQaStatus: RenderedWordDocument["visualQaStatus"] =
    completePages && !invalidPages && !defectivePages && !defectiveText ? "completed" : "skipped"
  const visualQaSkipReason: RenderedWordDocument["visualQaSkipReason"] | undefined =
    visualQaStatus === "completed"
      ? undefined
      : invalidPages
        ? "invalid-page-image"
        : defectivePages || defectiveText
          ? "page-quality-failed"
          : expectedPages === 0
            ? "page-images-missing"
            : "page-count-incomplete"
  await fs.writeFile(
    diagnosticsPath,
    `${JSON.stringify(
      {
        diagnostics,
        warnings,
        issues: response.issues ?? [],
        renderer: response.renderer,
        pageQa: pngEntries.map((entry) => entry.qa),
        textQa: response.textQa,
        pdfPath,
        refreshedDocxPath,
        pagePngPaths,
        pageCount: pngEntries.length,
        expectedPageCount: expectedPages,
        returnedPageCount: returnedPages,
        pageCountKind,
        pageEvidenceStatus,
        visualQaStatus,
        visualQaSkipReason,
        fieldRefreshStatus,
        fieldRefreshDiagnostics,
        tocHeadingCount: response.tocHeadingCount,
        tocEntryCount: response.tocEntryCount,
        tocPageNumberCount: response.tocPageNumberCount,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  return {
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
    pdfPath,
    refreshedDocxPath,
    pagePngPaths,
    diagnosticsPath: normalizePortable(path.relative(Instance.directory, diagnosticsPath)),
    pageCount: pngEntries.length,
    expectedPageCount: expectedPages,
    returnedPageCount: returnedPages,
    pageCountKind,
    warnings,
    diagnostics,
    issues: response.issues ?? [],
    renderer: response.renderer,
    pageQa: pngEntries.map((entry) => entry.qa),
    textQa: response.textQa,
    pageEvidenceStatus,
    visualQaStatus,
    visualQaSkipReason,
    fieldRefreshStatus,
    fieldRefreshDiagnostics,
    tocHeadingCount: response.tocHeadingCount,
    tocEntryCount: response.tocEntryCount,
    tocPageNumberCount: response.tocPageNumberCount,
  }
}

export async function insertWordPngImage(input: InsertWordPngImageInput): Promise<InsertedWordPngImage> {
  const source = await readDocxSnapshot(input.sourcePath)
  const documentXml = requiredSnapshotText(source, "word/document.xml", input.sourcePath)
  let relsXml =
    snapshotText(source, "word/_rels/document.xml.rels") ??
    documentRelationshipsXml({ images: [], imageMap: new WeakMap() })
  let contentTypes =
    snapshotText(source, "[Content_Types].xml") ?? contentTypesXml({ images: [], imageMap: new WeakMap() })
  const bytes = input.pngBase64?.trim()
    ? Buffer.from(input.pngBase64, "base64")
    : input.pngPath?.trim()
      ? Buffer.from(await fs.readFile(resolveWorkspacePath(input.pngPath)))
      : undefined
  if (!bytes?.length) throw new Error("insertWordPngImage requires pngPath or pngBase64")
  if (!isPng(bytes)) throw new Error("insertWordPngImage payload is not a valid PNG")
  const relId = `rIdInsertedImage${maxRelationshipNumber(relsXml) + 1}`
  const mediaName = `media/inserted-${Date.now()}.png`
  relsXml = appendRelationship(
    relsXml,
    relId,
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
    mediaName,
  )
  contentTypes = ensureImageContentType(contentTypes, mediaName)
  const imageXml = `${input.figureTitle ? paragraph(input.figureTitle, "Caption", { keepNext: true, keepLines: true }) : ""}${imageXmlFromRel(relId, input.altText ?? input.caption ?? input.figureTitle ?? "Inserted image", positive(input.width, 640), positive(input.height, 360), Boolean(input.caption))}${input.caption ? paragraph(input.caption, "Caption", { keepLines: true }) : ""}`
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
  const written = await writeDocxArtifact(
    source,
    {
      "word/document.xml": nextDocumentXml,
      "word/_rels/document.xml.rels": relsXml,
      "[Content_Types].xml": contentTypes,
    },
    binaryOverrides,
    {
      title: input.title ?? `Image ${path.basename(input.sourcePath)}`,
      taskSlug: input.taskSlug ?? `${path.basename(input.sourcePath, ".docx")}-image`,
      outputFile: safeDocxName(input.outputFile ?? `${path.basename(input.sourcePath, ".docx")}-image.docx`),
      warnings,
    },
  )
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
  await writer.add("word/styles.xml", new TextReader(stylesXml(spec)))
  await writer.add("word/numbering.xml", new TextReader(numberingXml(spec)))
  await writer.add("word/header1.xml", new TextReader(headerXml(spec)))
  await writer.add("word/footer1.xml", new TextReader(footerXml()))
  await writer.add("word/settings.xml", new TextReader(settingsXml()))
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
    const current = existingTextOverrides[part] ?? (await readEntryText(byName, part))
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
      documentXml: splice(
        documentXml,
        edit.op === "insert_after_heading" ? target.end : target.start,
        edit.op === "insert_after_heading" ? target.end : target.start,
        xml,
      ),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: {
        op: edit.op,
        target: targetLabel(target),
        summary: `${edit.op === "insert_after_heading" ? "insert after" : "insert before"} heading "${target.text}"`,
      },
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
      impact: {
        op: edit.op,
        target: targetLabel(target),
        summary: `replace paragraph ${target.paragraphIndex} with ${edit.blocks.length} block(s)`,
      },
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
    const replacement =
      edit.op === "replace_section"
        ? `${paragraph(edit.title ?? target.text, `Heading${edit.level ?? target.headingLevel ?? 1}`)}${await renderBlocks(edit.blocks)}`
        : ""
    return {
      documentXml: splice(documentXml, range.start, range.end, replacement),
      relsXml,
      textOverrides: {},
      mediaUpdates,
      impact: {
        op: edit.op,
        target: targetLabel(target),
        summary: `${edit.op === "replace_section" ? "replace" : "delete"} section "${target.text}"`,
      },
      warnings,
    }
  }
  if (edit.op === "replace_image") {
    const rel = findImageRelationship(relsXml, edit.locator)
    const existingContentType = contentTypeFor(rel.target)
    if (edit.image.contentType && existingContentType && edit.image.contentType !== existingContentType) {
      throw new Error(
        `replace_image contentType ${edit.image.contentType} does not match existing media target ${rel.target}`,
      )
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
    throw new Error(
      "image blocks inside structural Word edits are not supported in v1; use replace_image for existing images",
    )
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
    const bytes = await imageBytes(block)
    const size = imageFigureSize(block, contentType, bytes)
    const item: ImagePart = {
      relId: `rIdImage${index}`,
      mediaPath: `word/media/image${index}.${extension}`,
      target: `media/image${index}.${extension}`,
      contentType,
      extension,
      bytes,
      width: size.width,
      height: size.height,
      altText: block.altText ?? block.title ?? block.caption ?? `Image ${index}`,
    }
    images.push(item)
    imageMap.set(block, item)
  }
  return { images, imageMap }
}

function documentXml(spec: CreateWordDocumentSpec, context: RenderContext): string {
  const body: string[] = []
  const zh = spec.language === "zh-CN"
  body.push(paragraph(spec.title, "Title"))
  body.push(paragraph(spec.documentType ?? (zh ? "详细设计" : "Detailed Design"), "Subtitle"))
  if (spec.author) body.push(paragraph(zh ? `作者：${spec.author}` : `Author: ${spec.author}`, "Normal"))
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
  body.push(
    `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${PAGE_WIDTH_DXA}" w:h="${PAGE_HEIGHT_DXA}"/><w:pgMar w:top="${PAGE_MARGIN_DXA}" w:right="${PAGE_MARGIN_DXA}" w:bottom="${PAGE_MARGIN_DXA}" w:left="${PAGE_MARGIN_DXA}" w:header="${HEADER_FOOTER_DXA}" w:footer="${HEADER_FOOTER_DXA}" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>`,
  )
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
      return codeParagraph(block.text)
    case "image":
      return imageXml(block, context)
  }
}

function paragraph(
  text: string,
  style = "Normal",
  options: { align?: "left" | "center" | "right"; keepNext?: boolean; keepLines?: boolean } = {},
): string {
  const properties = [
    style === "Normal" ? "" : `<w:pStyle w:val="${escapeAttr(style)}"/>`,
    options.align ? `<w:jc w:val="${options.align}"/>` : "",
    options.keepNext ? "<w:keepNext/>" : "",
    options.keepLines ? "<w:keepLines/>" : "",
  ].join("")
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function codeParagraph(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const runs = lines
    .map(
      (line, index) =>
        `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`,
    )
    .join("")
  return `<w:p><w:pPr><w:pStyle w:val="Code"/><w:keepLines/></w:pPr>${runs}</w:p>`
}

function list(items: string[], ordered: boolean): string[] {
  return items.map(
    (item) =>
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${ordered ? 2 : 1}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(item)}</w:t></w:r></w:p>`,
  )
}

function tableXml(headers: string[], rows: string[][], caption?: string): string {
  const table = normalizeTableSpec({ headers, rows, caption }, { trimCells: false, fillMissingCells: "" })
  const widths = tableWidths(table.headers, table.rows)
  const rowXml = [table.headers, ...table.rows]
    .map(
      (row, rowIndex) =>
        `<w:tr><w:trPr>${rowIndex === 0 ? "<w:tblHeader/>" : ""}<w:cantSplit/></w:trPr>${Array.from({ length: table.columnCount }, (_, index) => tableCellXml(row[index] ?? "", widths[index]!, rowIndex === 0, tableColumnAlignment(index, table.headers, table.rows))).join("")}</w:tr>`,
    )
    .join("")
  const properties = [
    `<w:tblW w:w="${CONTENT_WIDTH_DXA}" w:type="dxa"/>`,
    `<w:tblInd w:w="${TABLE_INDENT_DXA}" w:type="dxa"/>`,
    '<w:tblLayout w:type="fixed"/>',
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D0D7DE"/><w:left w:val="single" w:sz="4" w:color="D0D7DE"/><w:bottom w:val="single" w:sz="4" w:color="D0D7DE"/><w:right w:val="single" w:sz="4" w:color="D0D7DE"/><w:insideH w:val="single" w:sz="4" w:color="D0D7DE"/><w:insideV w:val="single" w:sz="4" w:color="D0D7DE"/></w:tblBorders>',
    `<w:tblCellMar><w:top w:w="${TABLE_CELL_MARGIN_Y_DXA}" w:type="dxa"/><w:start w:w="${TABLE_CELL_MARGIN_X_DXA}" w:type="dxa"/><w:bottom w:w="${TABLE_CELL_MARGIN_Y_DXA}" w:type="dxa"/><w:end w:w="${TABLE_CELL_MARGIN_X_DXA}" w:type="dxa"/></w:tblCellMar>`,
  ].join("")
  return `${table.caption ? paragraph(table.caption, "Caption", { keepNext: true, keepLines: true }) : ""}<w:tbl><w:tblPr>${properties}</w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rowXml}</w:tbl>`
}

function tableCellXml(text: string, width: number, header: boolean, align: "left" | "center"): string {
  const properties = [
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    '<w:vAlign w:val="center"/>',
    header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/>' : "",
  ].join("")
  return `<w:tc><w:tcPr>${properties}</w:tcPr>${paragraph(text, header ? "TableHeader" : "Normal", { align, keepLines: true })}</w:tc>`
}

function tableWidths(headers: string[], rows: string[][]): number[] {
  const weights = headers.map((header, index) =>
    Math.max(1, ...[header, ...rows.map((row) => row[index] ?? "")].map((cell) => Math.min(80, textWeight(cell)))),
  )
  const floor = Math.min(1_200, Math.floor(CONTENT_WIDTH_DXA / Math.max(2, headers.length * 2)))
  const remaining = CONTENT_WIDTH_DXA - floor * headers.length
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const widths = weights.map((weight) => floor + Math.floor((remaining * weight) / total))
  widths[widths.length - 1] = (widths.at(-1) ?? 0) + CONTENT_WIDTH_DXA - widths.reduce((sum, width) => sum + width, 0)
  return widths
}

function textWeight(text: string): number {
  return [...text].reduce((total, char) => total + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1), 0)
}

function tableColumnAlignment(index: number, headers: string[], rows: string[][]): "left" | "center" {
  const values = [headers[index] ?? "", ...rows.map((row) => row[index] ?? "")]
  return values.every((value) => !value.includes("\n") && textWeight(value) <= 18) ? "center" : "left"
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
  const sourceWidth = Math.max(rawHeaders.length, ...rawRows.map((row) => (Array.isArray(row) ? row.length : 0)), 1)
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
  const drawing = drawingParagraph(
    image.relId,
    image.altText,
    image.width,
    image.height,
    context.images.indexOf(image) + 1,
    Boolean(block.caption),
  )
  return `${block.title ? paragraph(block.title, "Caption", { keepNext: true, keepLines: true }) : ""}${drawing}${block.caption ? paragraph(block.caption, "Caption", { keepLines: true }) : ""}`
}

function imageXmlFromRel(relId: string, altText: string, width: number, height: number, keepNext = false): string {
  const size = figureSize(width, height)
  return drawingParagraph(relId, altText, size.width, size.height, Date.now() % 100_000, keepNext)
}

function drawingParagraph(
  relId: string,
  altText: string,
  width: number,
  height: number,
  id: number,
  keepNext: boolean,
): string {
  const cx = Math.round(width * EMU_PER_CSS_PIXEL)
  const cy = Math.round(height * EMU_PER_CSS_PIXEL)
  const alt = escapeAttr(altText)
  const properties = `<w:pPr><w:jc w:val="center"/><w:keepLines/>${keepNext ? "<w:keepNext/>" : ""}</w:pPr>`
  const drawing = `<w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${alt}" descr="${alt}" title="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${alt}" descr="${alt}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${escapeAttr(relId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  return `<w:p>${properties}<w:r>${drawing}</w:r></w:p>`
}

function figureSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_FIGURE_WIDTH_PX / width, MAX_FIGURE_HEIGHT_PX / height)
  return { width: Math.max(1, width * scale), height: Math.max(1, height * scale) }
}

function imageFigureSize(
  block: Extract<WordBlock, { type: "image" }>,
  contentType: "image/png" | "image/jpeg",
  bytes: Uint8Array,
) {
  const intrinsic = rasterDimensions(contentType, bytes)
  if (block.width !== undefined && block.height !== undefined) {
    return figureSize(positive(block.width, 480), positive(block.height, 280))
  }
  if (block.width !== undefined && intrinsic) {
    const width = positive(block.width, 480)
    return figureSize(width, (width * intrinsic.height) / intrinsic.width)
  }
  if (block.height !== undefined && intrinsic) {
    const height = positive(block.height, 280)
    return figureSize((height * intrinsic.width) / intrinsic.height, height)
  }
  if (intrinsic) {
    const scale = Math.min(MAX_FIGURE_WIDTH_PX / intrinsic.width, MAX_FIGURE_HEIGHT_PX / intrinsic.height)
    return {
      width: Math.max(1, intrinsic.width * scale),
      height: Math.max(1, intrinsic.height * scale),
    }
  }
  return figureSize(positive(block.width, 480), positive(block.height, 280))
}

function rasterDimensions(contentType: "image/png" | "image/jpeg", bytes: Uint8Array) {
  const value = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    contentType === "image/png" &&
    value.length >= 24 &&
    value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    value.subarray(12, 16).toString("ascii") === "IHDR"
  ) {
    const width = value.readUInt32BE(16)
    const height = value.readUInt32BE(20)
    if (width && height) return { width, height }
  }
  if (contentType !== "image/jpeg" || value.length < 4 || value.readUInt16BE(0) !== 0xffd8) return
  for (let offset = 2; offset + 8 < value.length; ) {
    if (value[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = value[offset + 1]
    if (marker === 0xd9 || marker === 0xda) return
    const length = value.readUInt16BE(offset + 2)
    if (length < 2 || offset + length + 2 > value.length) return
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      const width = value.readUInt16BE(offset + 7)
      const height = value.readUInt16BE(offset + 5)
      if (width && height) return { width, height }
      return
    }
    offset += length + 2
  }
}

function contentTypesXml(context: RenderContext): string {
  const imageDefaults = new Set(context.images.map((image) => image.extension))
  return xml(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults.has("png") ? '<Default Extension="png" ContentType="image/png"/>' : ""}${imageDefaults.has("jpg") ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ""}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  )
}

function packageRelationshipsXml(): string {
  return xml(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
  )
}

function documentRelationshipsXml(context: RenderContext): string {
  return xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${context.images.map((image) => `<Relationship Id="${image.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeAttr(image.target)}"/>`).join("")}</Relationships>`,
  )
}

function stylesXml(spec: Pick<CreateWordDocumentSpec, "headingNumbering" | "language"> = {}): string {
  const eastAsia = spec.language === "zh-CN" ? CJK_FONT : "Calibri"
  const base = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="${eastAsia}" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="${eastAsia}" w:cs="Calibri"/><w:color w:val="24292F"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="160"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="17324D"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="180"/><w:keepNext/></w:pPr><w:rPr><w:color w:val="3A6EA5"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4D78"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="60" w:after="80"/><w:keepLines/></w:pPr><w:rPr><w:i/><w:color w:val="667085"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="80" w:line="240" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:keepLines/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="${eastAsia}"/><w:color w:val="1F2937"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:color w:val="24292F"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="0"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs></w:pPr></w:style></w:styles>`
  // Headless LibreOffice can ignore w:eastAsia and render CJK through the Latin slot.
  // Use the selected CJK face in every default slot so DOCX and PDF remain visually equivalent.
  const compatible = base.replaceAll(
    `w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="${eastAsia}" w:cs="Calibri"`,
    `w:ascii="${eastAsia}" w:hAnsi="${eastAsia}" w:eastAsia="${eastAsia}" w:cs="${eastAsia}"`,
  )
  if (spec.headingNumbering !== "decimal") return xml(compatible)
  const numbered = compatible
    .replace(
      '<w:outlineLvl w:val="0"/>',
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:outlineLvl w:val="0"/>',
    )
    .replace(
      '<w:outlineLvl w:val="1"/>',
      '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr><w:outlineLvl w:val="1"/>',
    )
    .replace(
      '<w:outlineLvl w:val="2"/>',
      '<w:numPr><w:ilvl w:val="2"/><w:numId w:val="3"/></w:numPr><w:outlineLvl w:val="2"/>',
    )
  return xml(numbered)
}

function numberingXml(spec: Pick<CreateWordDocumentSpec, "headingNumbering"> = {}): string {
  const headings =
    spec.headingNumbering === "decimal"
      ? '<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="0" w:hanging="0"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="0" w:hanging="0"/></w:pPr></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2.%3"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="0" w:hanging="0"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="3"/></w:num>'
      : ""
  return xml(
    `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>${headings}</w:numbering>`,
  )
}

function headerXml(spec: CreateWordDocumentSpec): string {
  return xml(
    `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="D0D7DE"/></w:pBdr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="667085"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${escapeXml(spec.title)}</w:t></w:r></w:p></w:hdr>`,
  )
}

function footerXml(): string {
  return xml(
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="667085"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>',
  )
}

function settingsXml(): string {
  return xml(
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/><w:compat/></w:settings>',
  )
}

function coreXml(spec: CreateWordDocumentSpec): string {
  return xml(
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(spec.title)}</dc:title><dc:creator>${escapeXml(spec.author ?? "Kilo")}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`,
  )
}

function appXml(): string {
  return xml(
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kilo</Application></Properties>',
  )
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
    matchAll(table, /<w:tr\b[\s\S]*?<\/w:tr>/g).map((row) =>
      matchAll(row, /<w:tc\b[\s\S]*?<\/w:tc>/g).map(textFromXml),
    ),
  )
}

async function inspectImages(
  documentXml: string,
  relsXml: string,
  byName: Map<string, { filename: string; getData?: (writer: Uint8ArrayWriter) => Promise<Uint8Array> }>,
): Promise<Pick<WordDocumentInspection, "images"> & { diagnostics: WordDocumentInspection["imageDiagnostics"] }> {
  const rels = matchAll(
    relsXml,
    /<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"[^>]*>/g,
  ).map((relationship, index) => ({
    relId: attr(relationship, /\bId="([^"]+)"/) ?? `rIdImage${index + 1}`,
    target: unescapeXml(attr(relationship, /\bTarget="([^"]+)"/) ?? ""),
  }))
  const byId = new Map(rels.map((rel) => [rel.relId, rel]))
  const hashes = new Map<string, { sha256?: string; mediaPath?: string }>()
  const missingMediaTargets = new Set<string>()
  for (const rel of rels) {
    const mediaPath = wordTarget(rel.target)
    const entry = mediaPath ? byName.get(mediaPath) : undefined
    const bytes = await entry?.getData?.(new Uint8ArrayWriter())
    if (!bytes) {
      missingMediaTargets.add(rel.target)
      hashes.set(rel.relId, { mediaPath })
      continue
    }
    hashes.set(rel.relId, {
      mediaPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
  }

  const paragraphs = matchAll(documentXml, /<w:p\b[\s\S]*?<\/w:p>/g).map((xml, index) => ({
    index,
    xml,
    text: textFromXml(xml).trim(),
    styleId: attr(xml, /<w:pStyle\b[^>]*w:val="([^"]+)"/),
  }))
  const headingPath: string[] = []
  const paths = new Map<number, string[]>()
  for (const paragraph of paragraphs) {
    const level = headingLevelFromStyle(paragraph.styleId)
    if (level && paragraph.text) {
      headingPath[level - 1] = paragraph.text
      headingPath.length = level
    }
    paths.set(paragraph.index, [...headingPath])
  }

  const images: WordDocumentInspection["images"] = []
  const used = new Set<string>()
  const missingRelationshipIds = new Set<string>()
  for (const paragraph of paragraphs) {
    const drawings = matchAll(paragraph.xml, /<w:drawing\b[\s\S]*?<\/w:drawing>/g)
    for (const drawing of drawings) {
      const relId = attr(drawing, /<a:blip\b[^>]*r:embed="([^"]+)"/)
      if (!relId) continue
      used.add(relId)
      const rel = byId.get(relId)
      if (!rel) missingRelationshipIds.add(relId)
      const previous = paragraphs[paragraph.index - 1]
      const next = paragraphs[paragraph.index + 1]
      const title = previous?.styleId === "Caption" && previous.text ? previous.text : undefined
      const caption = next?.styleId === "Caption" && next.text ? next.text : undefined
      const rawAlt =
        attr(drawing, /<wp:docPr\b[^>]*\bdescr="([^"]*)"/) ??
        attr(drawing, /<wp:docPr\b[^>]*\btitle="([^"]*)"/) ??
        attr(drawing, /<pic:cNvPr\b[^>]*\bdescr="([^"]*)"/)
      const altText = rawAlt ? unescapeXml(rawAlt) : undefined
      const target = rel?.target ?? ""
      const hash = hashes.get(relId)
      const visible = [title, caption, altText].filter(Boolean).join(" ")
      const visibleId =
        visible.match(/\bDG-[A-Za-z0-9._-]+\b/i)?.[0] ?? visible.match(/\b(?:FIG|DU)-[A-Za-z0-9._-]+\b/i)?.[0]
      images.push({
        index: images.length + 1,
        relId,
        target,
        contentType: rel && hash?.mediaPath ? contentTypeFor(rel.target) : undefined,
        headingPath: paths.get(paragraph.index) ?? [],
        title,
        caption,
        visibleId,
        altText,
        mediaPath: hash?.mediaPath,
        sha256: hash?.sha256,
      })
    }
  }

  const duplicates = new Map<string, Set<string>>()
  for (const rel of rels) {
    const hash = hashes.get(rel.relId)?.sha256
    if (!hash) continue
    const ids = duplicates.get(hash) ?? new Set<string>()
    ids.add(rel.relId)
    duplicates.set(hash, ids)
  }
  return {
    images,
    diagnostics: {
      drawingCount: images.length,
      relationshipCount: rels.length,
      orphanRelationshipIds: rels.filter((rel) => !used.has(rel.relId)).map((rel) => rel.relId),
      missingRelationshipIds: [...missingRelationshipIds],
      missingMediaTargets: [...missingMediaTargets],
      duplicateMediaHashes: [...duplicates.entries()]
        .filter(([, ids]) => ids.size > 1)
        .map(([sha256, ids]) => ({ sha256, relIds: [...ids] })),
    },
  }
}

function wordTarget(target: string): string | undefined {
  const value = target.replace(/^\//, "")
  if (!value || value.includes("\\") || value.split("/").some((part) => part === ".." || part === "." || !part))
    return undefined
  return value.startsWith("word/") ? value : `word/${value}`
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
  if (!Array.isArray(spec.sections) || spec.sections.length === 0)
    throw new Error("create_word_document spec.sections must not be empty")
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
  const base =
    input
      .replace(/\.docx$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "document"
  return `${base}.docx`
}

function safePdfName(input: string): string {
  const base =
    input
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
  const file =
    (parts.pop() ?? `page-${String(fallbackIndex).padStart(3, "0")}.png`)
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

async function readEntryText(
  byName: Map<string, { getData?: (writer: TextWriter) => Promise<string> }>,
  name: string,
): Promise<string | undefined> {
  return await byName.get(name)?.getData?.(new TextWriter())
}

function matchAll(input: string, regex: RegExp, group = 0): string[] {
  return [...input.matchAll(regex)].map((match) => match[group] ?? "")
}

function textFromXml(input: string): string {
  return matchAll(input, /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, 1)
    .map(unescapeXml)
    .join("")
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
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
}

function hasNativeToc(xml: string): boolean {
  return (
    /<w:instrText\b[^>]*>[^<]*\bTOC\b[^<]*<\/w:instrText>/i.test(xml) ||
    /<w:fldSimple\b[^>]*w:instr=(?:"[^"]*\bTOC\b[^"]*"|'[^']*\bTOC\b[^']*')/i.test(xml) ||
    /<w:docPartGallery\b[^>]*w:val=(?:"Table of Contents"|'Table of Contents')/i.test(xml)
  )
}

async function verifyRefreshedDocx(
  source: Uint8Array,
  bytes: Uint8Array,
  response: RemoteWordRenderResponse,
): Promise<{ ok: boolean; diagnostics: string[] }> {
  const diagnostics: string[] = []
  const original = await wordSemanticManifest(source).catch((error) => {
    diagnostics.push(
      `could not inspect source DOCX semantics: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  })
  const refreshed = await wordSemanticManifest(bytes).catch((error) => {
    diagnostics.push(
      `payload is not a structurally valid DOCX: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  })
  if (!original || !refreshed) return { ok: false, diagnostics }
  if (!refreshed.hasToc) diagnostics.push("refreshed DOCX has no native TOC field")
  if (original.titleCount !== 1 || !original.title)
    diagnostics.push("source DOCX must contain exactly one non-empty Title")
  if (original.headings.length === 0) diagnostics.push("source native TOC has no Heading 1-3 denominator")
  if (!sameJson(original.body, refreshed.body))
    diagnostics.push("non-TOC body paragraph sequence changed during field refresh")
  if (!sameJson(original.tables, refreshed.tables))
    diagnostics.push("table geometry or cell text changed during field refresh")
  if (!sameJson(original.images, refreshed.images))
    diagnostics.push("drawing identity, placement, alt text, or media changed")
  if (!sameJson(original.controls, refreshed.controls)) diagnostics.push("content-control text or identity changed")
  if (!sameJson(original.headers, refreshed.headers) || !sameJson(original.footers, refreshed.footers))
    diagnostics.push("header or footer semantic text changed during field refresh")
  const expected = original.headings.map((item) => item.text)
  const actual = refreshed.toc.map((item) => item.text)
  if (!sameTocHeadings(expected, actual))
    diagnostics.push(
      `materialized TOC entries do not exactly match Heading 1-3 text and order: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    )
  if (refreshed.toc.some((item) => !Number.isInteger(item.page) || item.page <= 0))
    diagnostics.push("materialized TOC contains a missing or invalid page number")
  if (
    response.tocHeadingCount !== expected.length ||
    response.tocEntryCount !== refreshed.toc.length ||
    response.tocPageNumberCount !== refreshed.toc.filter((item) => item.page > 0).length
  )
    diagnostics.push("renderer TOC counts do not match the refreshed DOCX contents")
  return { ok: diagnostics.length === 0, diagnostics }
}

type WordSemanticManifest = {
  hasToc: boolean
  title?: string
  titleCount: number
  headings: Array<{ level: number; text: string }>
  toc: Array<{ text: string; page: number }>
  body: Array<{ kind: string; text: string }>
  tables: string[][][]
  images: Array<{
    headingPath: string[]
    visibleId?: string
    title?: string
    caption?: string
    altText?: string
    sha256?: string
  }>
  controls: Array<{ tag?: string; title?: string; text: string }>
  headers: string[]
  footers: string[]
}

async function wordSemanticManifest(bytes: Uint8Array): Promise<WordSemanticManifest> {
  await assertValidWordDocumentBytes(bytes, "Word semantic manifest source")
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)))
  try {
    const entries = await zip.getEntries()
    const byName = new Map(entries.map((entry) => [entry.filename, entry]))
    const documentXml = await readEntryText(byName, "word/document.xml")
    const stylesXml = await readEntryText(byName, "word/styles.xml")
    const relsXml = await readEntryText(byName, "word/_rels/document.xml.rels")
    if (!documentXml || !stylesXml) throw new Error("DOCX is missing document.xml or styles.xml")
    const styles = semanticWordStyles(stylesXml)
    const paragraphs = matchAll(documentXml, /<w:p\b[\s\S]*?<\/w:p>/g).map((xml) => {
      const style = attr(xml, /<w:pStyle\b[^>]*w:val="([^"]+)"/) ?? ""
      const text = normalizeWordText(textFromXml(xml))
      const configured = styles.get(style) ?? {}
      const direct = style.match(/^(?:Heading|标题)\s*([1-3])$/i)
      const info = {
        title: configured.title || /^(?:Title|标题)$/i.test(style),
        toc: configured.toc || /^(?:TOC|Contents|目录)\s*[1-3]$/i.test(style),
        level: configured.level ?? (direct ? (Number(direct[1]) as 1 | 2 | 3) : undefined),
      }
      return { xml, style, text, info }
    })
    const titles = paragraphs.filter((item) => item.info.title && item.text)
    const headings = paragraphs
      .filter((item) => item.info.level && item.text)
      .map((item) => ({ level: item.info.level!, text: item.text }))
    const toc = paragraphs
      .filter((item) => item.info.toc && item.text)
      .map((item) => {
        const match = item.text.match(/^(.*?)(\d+)$/u)
        return { text: normalizeWordText(match?.[1] ?? item.text), page: match ? Number(match[2]) : 0 }
      })
    const body = paragraphs
      .filter((item) => !item.info.toc && !hasNativeToc(item.xml))
      .filter((item) => item.text && !onlyMutableFieldResult(item.xml, item.text))
      .map((item) => ({
        kind: item.info.title ? "title" : item.info.level ? `heading-${item.info.level}` : "body",
        text: item.text,
      }))
    const inspected = await inspectImages(documentXml, relsXml ?? "", byName)
    const images = inspected.images.map((item) => ({
      headingPath: item.headingPath,
      visibleId: item.visibleId,
      title: item.title,
      caption: item.caption,
      altText: item.altText,
      sha256: item.sha256,
    }))
    const parts = async (prefix: string) => {
      const result: string[] = []
      for (const entry of entries.filter(
        (item) => item.filename.startsWith(`word/${prefix}`) && item.filename.endsWith(".xml"),
      )) {
        const xml = await readEntryText(byName, entry.filename)
        if (!xml) continue
        const text = normalizeWordText(textFromXml(xml).replace(/\b\d+\b/g, ""))
        result.push(text)
      }
      return result
    }
    return {
      hasToc: hasNativeToc(documentXml),
      title: titles[0]?.text,
      titleCount: titles.length,
      headings,
      toc,
      body,
      tables: parseTables(documentXml).map((table) => table.map((row) => row.map(normalizeWordText))),
      images,
      controls: parseContentControls(documentXml)
        .filter((item) => !hasNativeToc(item.xml))
        .map((item) => ({
          tag: item.tag,
          title: item.title,
          text: normalizeWordText(item.text),
        })),
      headers: await parts("header"),
      footers: await parts("footer"),
    }
  } finally {
    await zip.close()
  }
}

function semanticWordStyles(xml: string) {
  const styles = new Map<string, { title?: boolean; toc?: boolean; level?: 1 | 2 | 3 }>()
  for (const block of matchAll(xml, /<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
    const id = attr(block, /<w:style\b[^>]*w:styleId="([^"]+)"/) ?? ""
    const name = attr(block, /<w:name\b[^>]*w:val="([^"]+)"/) ?? id
    const label = `${id} ${name}`
    const title = /(?:^|\s)(?:title|标题)(?:\s|$)/i.test(label)
    const toc = /(?:^|\s)(?:toc|contents|目录)\s*[1-3](?:\s|$)/i.test(label)
    const direct = label.match(/(?:^|\s)(?:heading|标题)\s*([1-3])(?:\s|$)/i)
    const outline = attr(block, /<w:outlineLvl\b[^>]*w:val="([0-2])"/)
    const level = title || toc ? undefined : direct ? Number(direct[1]) : outline ? Number(outline) + 1 : undefined
    styles.set(id, { title, toc, level: level as 1 | 2 | 3 | undefined })
  }
  return styles
}

function onlyMutableFieldResult(xml: string, text: string): boolean {
  return /<w:instrText\b[^>]*>[^<]*(?:PAGE|NUMPAGES|SEQ)[^<]*<\/w:instrText>/i.test(xml) && /^\d+$/u.test(text)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameTocHeadings(expected: string[], actual: string[]): boolean {
  return (
    expected.length === actual.length &&
    expected.every((value, index) => {
      const heading = normalizeWordText(value)
      const entry = normalizeWordText(actual[index] ?? "")
      return heading === entry || heading === tocHeadingText(entry)
    })
  )
}

function tocHeadingText(value: string): string {
  return normalizeWordText(value).replace(/^\d+(?:[.\-]\d+)*(?:[.)、．])?\s*/u, "")
}

function escapeXml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function escapeAttr(input: string): string {
  return escapeXml(input).replace(/"/g, "&quot;")
}

function unescapeXml(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
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
  ok?: boolean
  pageCount?: number
  returnedPageCount?: number
  pageCountKind?: "exact" | "lower-bound" | "unknown"
  fieldRefreshStatus?: "completed" | "failed" | "not-required"
  fieldRefreshDiagnostics?: string[]
  tocHeadingCount?: number
  tocEntryCount?: number
  tocPageNumberCount?: number
  updatedDocxBase64?: string
  pdfBase64?: string
  pdf?: {
    contentType?: string
    base64?: string
  }
  pages?: Array<{
    page?: number
    fileName?: string
    pngBase64?: string
    base64?: string
    contentType?: string
    width?: number
    height?: number
    visualSummary?: Record<string, unknown>
    blank?: boolean
  }>
  detectedImageCount?: number
  textQa?: WordRenderTextQa
  warnings?: string[]
  issues?: WordRenderIssue[]
  renderer?: Record<string, unknown>
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
  const candidates = exact.length
    ? exact
    : blocks.filter((block) => block.headingLevel && normalizeText(block.text).includes(normalizeText(heading)))
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
    const candidates = exact.length
      ? exact
      : blocks.filter((block) => block.kind === "paragraph" && normalizeText(block.text).includes(needle))
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
  if (candidates === blocks)
    throw new Error("content control locator requires contentControlIndex, contentControlTag, or contentControlTitle")
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

function sectionRange(
  documentXml: string,
  blocks: TopLevelBlock[],
  heading: TopLevelBlock,
): { start: number; end: number } {
  const level = heading.headingLevel ?? 1
  const next = blocks.find((block) => block.start > heading.start && block.headingLevel && block.headingLevel <= level)
  if (next) return { start: heading.start, end: next.start }
  const sect = documentXml.lastIndexOf("<w:sectPr")
  if (sect > heading.start) return { start: heading.start, end: sect }
  const bodyClose = documentXml.lastIndexOf("</w:body>")
  return { start: heading.start, end: bodyClose > heading.start ? bodyClose : documentXml.length }
}

function findImageRelationship(relsXml: string, locator: WordEditLocator): { relId: string; target: string } {
  const rels = matchAll(
    relsXml,
    /<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"[^>]*>/g,
  ).map((relationship, index) => ({
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
  if (
    !found.target ||
    found.target.includes("\\") ||
    found.target.split("/").some((segment) => segment === ".." || segment === "." || !segment)
  ) {
    throw new Error(`unsafe image target in document relationships: ${found.target}`)
  }
  return found
}

async function readDocxSnapshot(inputPath: string): Promise<DocxSnapshot> {
  const absolute = resolveWorkspacePath(inputPath)
  const source = new Uint8Array(await fs.readFile(absolute))
  await assertValidWordDocumentBytes(source, `Word source ${inputPath}`)
  const zip = new ZipReader(new Uint8ArrayReader(source))
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
    const renderEnv = await localWordRenderEnv(temp)
    const snapshot = await readDocxSnapshot(source)
    const documentXml = requiredSnapshotText(snapshot, "word/document.xml", source)
    const hasToc = hasNativeToc(documentXml)
    const fieldRefreshStatus: NonNullable<RemoteWordRenderResponse["fieldRefreshStatus"]> = hasToc
      ? "failed"
      : "not-required"
    const fieldRefreshDiagnostics = hasToc
      ? ["Local fallback does not run the verified LibreOffice UNO field-update workflow; rendered the original DOCX."]
      : ["Document has no native TOC field requiring layout refresh."]
    if (hasToc)
      diagnostics.push({
        code: "word-render-local-field-refresh-failed",
        severity: "warning",
        message: fieldRefreshDiagnostics[0],
      })
    try {
      await execFile(soffice, ["--headless", "--convert-to", "pdf", "--outdir", temp, source], {
        timeout: timeoutMs,
        windowsHide: true,
        env: renderEnv,
      })
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

    const textQa = await localWordTextQa(source, pdfPath, timeoutMs)
    const fontQa = await localCjkFontQa(pdfPath, textQa.sourceCjkCount, timeoutMs)
    if (!fontQa.ok)
      diagnostics.push({
        code: "word-render-cjk-font-missing",
        severity: "error",
        message: fontQa.message,
      })

    const pdftoppm = await findExecutable(process.env["KILO_WORD_RENDER_PDFTOPPM"], "pdftoppm")
    const pages: NonNullable<RemoteWordRenderResponse["pages"]> = []
    let pageCountKind: NonNullable<RemoteWordRenderResponse["pageCountKind"]> = "unknown"
    if (!pdftoppm) {
      diagnostics.push({
        code: "word-render-local-page-renderer-not-configured",
        severity: "warning",
        message:
          "Local PDF renderer succeeded, but pdftoppm was not found; set KILO_WORD_RENDER_PDFTOPPM or put pdftoppm on PATH to render page PNG artifacts.",
      })
    } else {
      const prefix = path.join(temp, "page")
      try {
        await execFile(pdftoppm, ["-png", "-f", "1", "-l", String(maxPages + 1), pdfPath, prefix], {
          timeout: timeoutMs,
          windowsHide: true,
          env: userEnv(process.env),
        })
        const entries = await fs.readdir(temp)
        const pageFiles = entries
          .filter((entry) => /^page-\d+\.png$/.test(entry))
          .sort((left, right) => pageNumber(left) - pageNumber(right))
        pageCountKind = pageFiles.length > maxPages ? "lower-bound" : "exact"
        for (const [index, file] of pageFiles.entries()) {
          const bytes = await fs.readFile(path.join(temp, file))
          const scanned = await summarizePagePng(bytes)
          pages.push({
            page: index + 1,
            fileName: `rendered/page-${String(index + 1).padStart(3, "0")}.png`,
            pngBase64: Buffer.from(bytes).toString("base64"),
            width: numberField(scanned.summary, "width"),
            height: numberField(scanned.summary, "height"),
            visualSummary: scanned.summary ?? { summaryError: scanned.error ?? "unknown PNG summary failure" },
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
        fieldRefreshStatus,
        fieldRefreshDiagnostics,
        textQa,
        pages,
        pageCount: pages.length,
        returnedPageCount: pages.length,
        pageCountKind,
      },
      diagnostics,
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}

async function localWordRenderEnv(temp: string) {
  const env = userEnv(process.env)
  if (env["FONTCONFIG_FILE"]) return env
  const home = os.homedir()
  const directories =
    process.platform === "darwin"
      ? [
          "/System/Library/Fonts",
          "/System/Library/Fonts/Supplemental",
          "/Library/Fonts",
          path.join(home, "Library/Fonts"),
        ]
      : process.platform === "win32"
        ? [
            path.join(process.env["WINDIR"] ?? "C:\\Windows", "Fonts"),
            path.join(process.env["LOCALAPPDATA"] ?? home, "Microsoft/Windows/Fonts"),
          ]
        : [
            "/usr/share/fonts",
            "/usr/local/share/fonts",
            path.join(home, ".local/share/fonts"),
            path.join(home, ".fonts"),
          ]
  const config = path.join(temp, "fonts.conf")
  const cache = path.join(temp, "font-cache")
  await fs.mkdir(cache, { recursive: true })
  await fs.writeFile(
    config,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>${directories.map((directory) => `<dir>${escapeXml(directory)}</dir>`).join("")}<cachedir>${escapeXml(cache)}</cachedir></fontconfig>`,
    "utf8",
  )
  return { ...env, FONTCONFIG_FILE: config }
}

async function localCjkFontQa(pdf: string, sourceCjkCount: number, timeoutMs: number) {
  if (sourceCjkCount < 10) return { ok: true, message: "CJK font QA is not required" }
  const text = await findExecutable(process.env["KILO_WORD_RENDER_PDFTOTEXT"], "pdftotext")
  const sibling = text
    ? path.join(path.dirname(text), process.platform === "win32" ? "pdffonts.exe" : "pdffonts")
    : undefined
  const executable = await findExecutable(process.env["KILO_WORD_RENDER_PDFFONTS"] ?? sibling, "pdffonts")
  if (!executable) {
    return { ok: false, message: "含中文的 DOCX 无法完成字体字形校验：pdffonts 不可用。" }
  }
  try {
    const result = await execFile(executable, [pdf], {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8",
      env: userEnv(process.env),
    })
    const fonts = String(result.stdout ?? "")
      .toLowerCase()
      .replace(/[\s_-]+/g, "")
    const families = [
      CJK_FONT,
      "Noto Sans CJK",
      "Source Han Sans",
      "Arial Unicode",
      "Hiragino Sans",
      "Microsoft YaHei",
      "Heiti",
      "Songti",
      "SimSun",
      "WenQuanYi",
      "MingLiU",
    ].map((font) => font.toLowerCase().replace(/[\s_-]+/g, ""))
    if (families.some((font) => fonts.includes(font))) return { ok: true, message: "CJK font is embedded" }
    return { ok: false, message: `含中文的 DOCX 未嵌入可识别的 CJK 字体（期望 ${CJK_FONT}），页面可能显示缺字方框。` }
  } catch (error) {
    return { ok: false, message: `CJK 字体字形校验失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

async function localWordTextQa(source: string, pdf: string, timeoutMs: number): Promise<WordRenderTextQa> {
  const executable = await findExecutable(process.env["KILO_WORD_RENDER_PDFTOTEXT"], "pdftotext")
  if (!executable) return failedWordTextQa("pdftotext is unavailable for local rendered-text QA")
  const inspection = await inspectWordDocument({ path: source, maxParagraphs: 1_000, maxTables: 200 })
  try {
    const result = await execFile(executable, ["-layout", "-enc", "UTF-8", pdf, "-"], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      encoding: "utf8",
      env: userEnv(process.env),
    })
    return evaluateWordTextQa(inspection, String(result.stdout ?? ""))
  } catch (error) {
    return failedWordTextQa(error instanceof Error ? error.message : String(error))
  }
}

function failedWordTextQa(message: string): WordRenderTextQa {
  return {
    ok: false,
    titlePresent: false,
    firstHeadingPresent: false,
    sourceCjkCount: 0,
    pdfCjkCount: 0,
    cjkCoverage: 0,
    sentinelCount: 0,
    matchedSentinelCount: 0,
    sentinelCoverage: 0,
    diagnostics: [message],
  }
}

function evaluateWordTextQa(source: WordDocumentInspection, rendered: string): WordRenderTextQa {
  const text = normalizeWordText(rendered)
  const compactText = compactWordText(rendered)
  const title = normalizeWordText(source.title ?? "")
  const heading = normalizeWordText(source.firstHeading ?? "")
  const sourceText = source.paragraphs.map((item) => item.text).join("\n")
  const sourceCjkCount = wordCjkCount(sourceText)
  const pdfCjkCount = wordCjkCount(text)
  const cjkCoverage = sourceCjkCount > 0 ? Math.min(1, pdfCjkCount / sourceCjkCount) : 1
  const sentinels = wordSentinels(source)
  const matchedSentinelCount = sentinels.filter((item) => compactText.includes(compactWordText(item))).length
  const sentinelCoverage = sentinels.length > 0 ? matchedSentinelCount / sentinels.length : 1
  const diagnostics: string[] = []
  if (!title || !text.includes(title)) diagnostics.push("document title is missing from rendered PDF text")
  if (!heading || !text.includes(heading)) diagnostics.push("first Heading is missing from rendered PDF text")
  if (sourceCjkCount >= 10 && cjkCoverage < 0.5)
    diagnostics.push(`rendered CJK coverage ${cjkCoverage.toFixed(3)} is below 0.500`)
  if (sentinels.length >= 3 && sentinelCoverage < 0.8)
    diagnostics.push(`rendered sentinel coverage ${sentinelCoverage.toFixed(3)} is below 0.800`)
  return {
    ok: diagnostics.length === 0,
    titlePresent: Boolean(title && text.includes(title)),
    firstHeadingPresent: Boolean(heading && text.includes(heading)),
    sourceCjkCount,
    pdfCjkCount,
    cjkCoverage,
    sentinelCount: sentinels.length,
    matchedSentinelCount,
    sentinelCoverage,
    diagnostics,
  }
}

function wordSentinels(source: WordDocumentInspection): string[] {
  const values = [
    ...source.outline.map((item) => item.title),
    ...source.tables.flatMap((table) => table.rows.flat()).filter((item) => item.trim().length >= 4),
    ...source.paragraphs
      .filter((item) => !item.headingLevel && item.text.trim().length >= 12)
      .filter((_, index, items) => index === 0 || index === Math.floor(items.length / 2) || index === items.length - 1)
      .map((item) => item.text),
  ]
  return [...new Set(values.map(normalizeWordText).filter(Boolean))]
}

function normalizeWordText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim()
}

function compactWordText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "")
}

function wordCjkCount(value: string): number {
  return value.match(/[\u3400-\u4dbf\u4e00-\u9fff]/gu)?.length ?? 0
}

async function pdfPageCount(bytes: Uint8Array, timeoutMs: number): Promise<number | undefined> {
  const executable = await findExecutable(process.env["KILO_WORD_RENDER_PDFINFO"], "pdfinfo")
  if (executable) {
    const dir = await fs.mkdtemp(path.join(Instance.directory, ".kilo-pdf-info-"))
    const file = path.join(dir, "rendered.pdf")
    try {
      await fs.writeFile(file, bytes)
      const result = await execFile(executable, [file], {
        timeout: timeoutMs,
        windowsHide: true,
        encoding: "utf8",
        env: userEnv(process.env),
      })
      const match = String(result.stdout ?? "").match(/^Pages:\s+(\d+)\s*$/m)
      const count = match ? Number(match[1]) : 0
      return Number.isInteger(count) && count > 0 ? count : undefined
    } catch {
      return undefined
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
  const raw = Buffer.from(bytes).toString("latin1")
  const count = [...raw.matchAll(/\/Type\s*\/Page\b/g)].length
  return count > 0 ? count : undefined
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

async function summarizePagePng(bytes: Uint8Array): Promise<{ summary?: Record<string, unknown>; error?: string }> {
  const loaded = await photon()
  if ("error" in loaded) return { error: loaded.error instanceof Error ? loaded.error.message : String(loaded.error) }
  try {
    const image = loaded.module.PhotonImage.new_from_byteslice(bytes)
    try {
      const width = image.get_width()
      const height = image.get_height()
      const pixels = image.get_raw_pixels()
      let inkPixels = 0
      let bodyInkPixels = 0
      const bodyTop = Math.floor(height * 0.08)
      const bodyBottom = Math.ceil(height * 0.92)
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3] ?? 0
        if (alpha === 0) continue
        const red = pixels[index] ?? 255
        const green = pixels[index + 1] ?? 255
        const blue = pixels[index + 2] ?? 255
        if (red < 250 || green < 250 || blue < 250) {
          inkPixels += 1
          const y = Math.floor(index / 4 / width)
          if (y >= bodyTop && y < bodyBottom) bodyInkPixels += 1
        }
      }
      const totalPixels = width * height
      const bodyPixels = width * Math.max(0, bodyBottom - bodyTop)
      return {
        summary: {
          width,
          height,
          totalPixels,
          inkPixels,
          inkRatio: totalPixels > 0 ? inkPixels / totalPixels : 0,
          bodyInkPixels,
          bodyInkRatio: bodyPixels > 0 ? bodyInkPixels / bodyPixels : 0,
        },
      }
    } finally {
      image.free()
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function numberField(value: Record<string, unknown> | undefined, field: string): number | undefined {
  const item = value?.[field]
  return typeof item === "number" && Number.isFinite(item) ? item : undefined
}

async function callWordRenderer(
  endpoint: string,
  payload: unknown,
  timeoutMs: number,
): Promise<RemoteWordRenderResponse> {
  const target = new URL(endpoint)
  const transport = target.protocol === "https:" ? https : target.protocol === "http:" ? http : undefined
  if (!transport) throw new Error(`unsupported Word renderer protocol: ${target.protocol}`)
  const requestBody = Buffer.from(JSON.stringify(payload), "utf8")
  const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = <T>(fn: (value: T) => void, value: T) => {
      if (timer) clearTimeout(timer)
      fn(value)
    }
    const request = transport.request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(requestBody.byteLength),
          connection: "close",
        },
      },
      (response) => {
        const declared = Number(response.headers["content-length"] ?? 0)
        if (Number.isFinite(declared) && declared > MAX_REMOTE_WORD_RENDER_RESPONSE_BYTES) {
          response.destroy()
          finish(reject, new Error(`Word renderer response exceeds ${MAX_REMOTE_WORD_RENDER_RESPONSE_BYTES} bytes`))
          return
        }
        const chunks: Buffer[] = []
        let received = 0
        response.on("data", (chunk: Buffer | Uint8Array | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          received += bytes.byteLength
          if (received > MAX_REMOTE_WORD_RENDER_RESPONSE_BYTES) {
            response.destroy()
            finish(reject, new Error(`Word renderer response exceeds ${MAX_REMOTE_WORD_RENDER_RESPONSE_BYTES} bytes`))
            return
          }
          chunks.push(bytes)
        })
        response.once("error", (error) => finish(reject, error))
        response.once("end", () =>
          finish(resolve, {
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks, received).toString("utf8"),
          }),
        )
      },
    )
    request.once("error", (error) => finish(reject, error))
    timer = setTimeout(() => request.destroy(new Error(`Word renderer request timed out after ${timeoutMs}ms`)), timeoutMs)
    request.end(requestBody)
  })
  let body: RemoteWordRenderResponse
  try {
    body = JSON.parse(text) as RemoteWordRenderResponse
  } catch {
    throw new Error("renderer returned an invalid JSON body")
  }
  if (!body || typeof body !== "object") throw new Error("renderer returned an invalid JSON body")
  if (status < 200 || status >= 300 || body.ok !== true) {
    const issues = body.issues
      ?.map((item) => `${item.code ?? "renderer-error"}: ${item.message ?? "failed"}`)
      .join("; ")
    throw new Error(`renderer returned HTTP ${status}${issues ? `: ${issues}` : ""}`)
  }
  const invalid = validateRemoteWordRenderResponse(body)
  if (invalid.length) throw new Error(`renderer returned an invalid success payload: ${invalid.join("; ")}`)
  return body
}

function validateRemoteWordRenderResponse(body: RemoteWordRenderResponse): string[] {
  const invalid: string[] = []
  const integer = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0
  if (!integer(body.pageCount)) invalid.push("pageCount must be a non-negative integer")
  if (!integer(body.returnedPageCount)) invalid.push("returnedPageCount must be a non-negative integer")
  if (!body.pageCountKind || !["exact", "lower-bound", "unknown"].includes(body.pageCountKind))
    invalid.push("pageCountKind is required")
  if (!body.fieldRefreshStatus || !["completed", "failed", "not-required"].includes(body.fieldRefreshStatus))
    invalid.push("fieldRefreshStatus is required")
  if (!Array.isArray(body.fieldRefreshDiagnostics)) invalid.push("fieldRefreshDiagnostics is required")
  if (!Array.isArray(body.issues)) invalid.push("issues is required")
  if (!body.renderer || typeof body.renderer !== "object") invalid.push("renderer is required")
  if (!body.pdf?.base64?.trim() && !body.pdfBase64?.trim()) invalid.push("PDF payload is required")
  if (!Array.isArray(body.pages)) invalid.push("pages are required")
  if (Array.isArray(body.pages) && body.returnedPageCount !== body.pages.length)
    invalid.push("returnedPageCount does not match pages.length")
  const qa = body.textQa
  if (!qa || typeof qa !== "object") invalid.push("textQa is required")
  if (qa) {
    for (const field of ["ok", "titlePresent", "firstHeadingPresent"] as const) {
      if (typeof qa[field] !== "boolean") invalid.push(`textQa.${field} must be boolean`)
    }
    for (const field of [
      "sourceCjkCount",
      "pdfCjkCount",
      "cjkCoverage",
      "sentinelCount",
      "matchedSentinelCount",
      "sentinelCoverage",
    ] as const) {
      if (typeof qa[field] !== "number" || !Number.isFinite(qa[field]) || qa[field] < 0)
        invalid.push(`textQa.${field} must be a finite non-negative number`)
    }
    if (typeof qa.cjkCoverage === "number" && qa.cjkCoverage > 1) invalid.push("textQa.cjkCoverage exceeds 1")
    if (typeof qa.sentinelCoverage === "number" && qa.sentinelCoverage > 1)
      invalid.push("textQa.sentinelCoverage exceeds 1")
    if (!Array.isArray(qa.diagnostics)) invalid.push("textQa.diagnostics is required")
  }
  for (const field of ["tocHeadingCount", "tocEntryCount", "tocPageNumberCount"] as const) {
    if (!integer(body[field])) invalid.push(`${field} must be a non-negative integer`)
  }
  if (body.fieldRefreshStatus === "completed" && !body.updatedDocxBase64?.trim())
    invalid.push("completed field refresh requires updatedDocxBase64")
  return invalid
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
  input: { title: string; taskSlug: string; outputFile: string; warnings: string[]; artifactDir?: string },
): Promise<{ path: string; artifactDir: string; manifestPath: string }> {
  const nextBytes = await rewriteDocx(source.entries, textOverrides, binaryOverrides)
  const prepared = await prepareWordDocumentBytes(nextBytes, "Word mutation candidate")
  input.warnings.push(...prepared.warnings)
  const artifact = await declareArtifact({
    kind: "word-document",
    title: input.title,
    taskSlug: input.taskSlug,
    artifactDir: input.artifactDir,
    primaryFile: safeDocxName(input.outputFile),
    warnings: input.warnings,
    qualityStatus: input.warnings.length ? "warning" : "unknown",
  })
  const output = path.join(
    Instance.directory,
    artifact.artifactDir,
    artifact.manifest.primaryFile ?? safeDocxName(input.outputFile),
  )
  assertInside(path.join(Instance.directory, artifact.artifactDir), output, "outputFile")
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, prepared.bytes)
  return {
    path: normalizePortable(path.relative(Instance.directory, output)),
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
  }
}

function fillContentControlXml(controlXml: string, text: string): string {
  const open = controlXml.match(/<w:sdtContent\b[^>]*>/)
  const close = controlXml.lastIndexOf("</w:sdtContent>")
  if (!open || open.index === undefined || close < open.index)
    throw new Error("content control is missing w:sdtContent")
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
    : documentRelationshipsXml({ images: [], imageMap: new WeakMap() }).replace(
        "</Relationships>",
        `${relationship}</Relationships>`,
      )
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
  return contentTypes.includes("</Types>")
    ? contentTypes.replace("</Types>", `<Default Extension="${escapeAttr(ext)}" ContentType="${contentType}"/></Types>`)
    : contentTypesXml({ images: [], imageMap: new WeakMap() })
}

function materializeFieldsInDocument(
  documentXml: string,
  tocMode: "preserve" | "materialize" | "remove",
  tocMaxLevel: 1 | 2 | 3,
): {
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
  const placeholders = parseTopLevelBlocks(xml).filter((block) => block.text.includes("{{TOC}}"))
  if (placeholders.length) {
    if (tocMode === "preserve") {
      toc = "preserved"
      warnings.push("TOC placeholder preserved; use tocMode materialize to create a native Word TOC field")
      return { xml, summary: { seqFields, captions, toc, tocEntryCount: 0, needsLayoutRefresh: false }, warnings }
    }
    if (placeholders.length !== 1)
      throw new Error(
        `materialize_word_fields requires exactly one standalone {{TOC}} paragraph, found ${placeholders.length}`,
      )
    const placeholder = placeholders[0]!
    if (placeholder.kind !== "paragraph" || placeholder.text.trim() !== "{{TOC}}")
      throw new Error("materialize_word_fields requires {{TOC}} to be the only text in a standalone paragraph")
    toc = tocMode === "remove" ? "removed" : "materialized"
    const headings = parseTopLevelBlocks(xml)
      .filter((block): block is TopLevelBlock & { headingLevel: 1 | 2 | 3 } =>
        Boolean(block.headingLevel && block.headingLevel <= tocMaxLevel && block.text.trim()),
      )
      .map((block, index) => ({ ...block, bookmark: `_KiloToc${index + 1}`, bookmarkID: 10_000 + index }))
    xml = splice(
      xml,
      placeholder.start,
      placeholder.end,
      tocMode === "remove" ? "" : nativeTocXml(usesCjk(documentXml), headings, tocMaxLevel),
    )
    if (tocMode === "materialize") {
      const materializedHeadings = parseTopLevelBlocks(xml).filter(
        (block): block is TopLevelBlock & { headingLevel: 1 | 2 | 3 } =>
          Boolean(block.headingLevel && block.headingLevel <= tocMaxLevel && block.text.trim()),
      )
      for (let index = materializedHeadings.length - 1; index >= 0; index--) {
        const block = materializedHeadings[index]!
        const toc = headings[index]!
        xml = splice(xml, block.start, block.end, headingBookmarkXml(block.xml, toc.bookmark, toc.bookmarkID))
      }
    }
    return {
      xml,
      summary: {
        seqFields,
        captions,
        toc,
        tocEntryCount: tocMode === "remove" ? 0 : headings.length,
        needsLayoutRefresh: tocMode === "materialize",
      },
      warnings,
    }
  }
  return { xml, summary: { seqFields, captions, toc, tocEntryCount: 0, needsLayoutRefresh: false }, warnings }
}

function nativeTocXml(
  cjk: boolean,
  headings: Array<TopLevelBlock & { headingLevel: 1 | 2 | 3; bookmark: string; bookmarkID: number }>,
  tocMaxLevel: 1 | 2 | 3,
): string {
  const title = cjk ? "目录" : "Table of Contents"
  const heading = `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/><w:pageBreakBefore/><w:keepNext/><w:keepLines/></w:pPr><w:r><w:t xml:space="preserve">${title}</w:t></w:r></w:p>`
  const start = `<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${tocMaxLevel}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>`
  const entries = headings
    .map(
      (item) =>
        `<w:p><w:pPr><w:pStyle w:val="TOC${item.headingLevel}"/></w:pPr><w:hyperlink w:anchor="${item.bookmark}" w:history="1"><w:r><w:t xml:space="preserve">${escapeXml(item.text.trim())}</w:t></w:r></w:hyperlink><w:r><w:tab/></w:r><w:fldSimple w:instr=" PAGEREF ${item.bookmark} \\h "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>`,
    )
    .join("")
  const end = '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  const page = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  return `${heading}${start}${entries}${end}${page}`
}

function headingBookmarkXml(paragraphXml: string, name: string, id: number) {
  const start = `<w:bookmarkStart w:id="${id}" w:name="${name}"/>`
  const end = `<w:bookmarkEnd w:id="${id}"/>`
  const properties = paragraphXml.indexOf("</w:pPr>")
  const offset = properties >= 0 ? properties + "</w:pPr>".length : paragraphXml.indexOf(">") + 1
  return `${paragraphXml.slice(0, offset)}${start}${paragraphXml.slice(offset, -"</w:p>".length)}${end}</w:p>`
}

function usesCjk(documentXml: string): boolean {
  return parseTopLevelBlocks(documentXml).some((block) => /[\u3400-\u9fff]/.test(block.text))
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
  return matchAll(
    relsXml,
    /<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"[^>]*>/g,
  )
    .map((relationship, index) => ({
      relId: attr(relationship, /\bId="([^"]+)"/) ?? `rIdImage${index + 1}`,
      target: attr(relationship, /\bTarget="([^"]+)"/) ?? "",
    }))
    .filter(
      (item) =>
        item.target &&
        !item.target.includes("\\") &&
        !item.target.split("/").some((segment) => segment === ".." || segment === "." || !segment),
    )
}

function maxRelationshipNumber(relsXml: string): number {
  return Math.max(
    0,
    ...matchAll(relsXml, /\bId="rId(?:(?:Merged|Inserted)Image)?(\d+)"/g, 1)
      .map((item) => Number(item))
      .filter(Number.isFinite),
  )
}

function maxMediaImageNumber(bytes: Map<string, Uint8Array>): number {
  return Math.max(
    0,
    ...[...bytes.keys()]
      .map((name) => name.match(/word\/media\/(?:merged\d+_)?image?(\d+)/i)?.[1])
      .filter((item): item is string => Boolean(item))
      .map((item) => Number(item))
      .filter(Number.isFinite),
  )
}

function remapBookmarkIds(body: string, offset: number): string {
  return body.replace(
    /(<w:bookmark(?:Start|End)\b[^>]*\bw:id=")(\d+)(")/g,
    (_match, prefix: string, id: string, suffix: string) => `${prefix}${Number(id) + offset}${suffix}`,
  )
}

function diffParagraphText(
  before: string[],
  after: string[],
  maxChanges: number,
): DiffWordDocumentsResult["diagnostics"] {
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
  const changed = before
    .slice(0, Math.min(before.length, after.length))
    .flatMap((text, index) =>
      text !== after[index] ? [{ index: index + 1, before: text, after: after[index] ?? "" }] : [],
    )
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

function diffMarkdown(
  beforePath: string,
  afterPath: string,
  diagnostics: DiffWordDocumentsResult["diagnostics"],
): string {
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
  const base =
    input
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
  if (part.startsWith("/") || part.includes("\\") || part.includes("://") || part.includes("\0"))
    throw new Error(`unsafe OOXML part path: ${part}`)
  if (!/^[A-Za-z0-9_[\]./-]+$/.test(part)) throw new Error(`unsafe OOXML part path: ${part}`)
  const segments = part.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === ".."))
    throw new Error(`unsafe OOXML part path: ${part}`)
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
