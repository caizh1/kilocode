import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import {
  applyWordDocumentEdits,
  applyWordTemplateStyles,
  createWordDocument,
  diffWordDocuments,
  inspectWordDocument,
  materializeWordFields,
  mergeWordDocuments,
  normalizeWordTableSpec,
  renderWordDocument,
} from "@/kilocode/documents/word"

const ImageBlock = Schema.Struct({
  type: Schema.Literal("image"),
  title: Schema.optional(Schema.String),
  caption: Schema.optional(Schema.String),
  altText: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  base64: Schema.optional(Schema.String),
  contentType: Schema.optional(Schema.Union([Schema.Literal("image/png"), Schema.Literal("image/jpeg")])),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
})

const WordBlock = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("heading"),
    level: Schema.optional(Schema.Union([Schema.Literal(1), Schema.Literal(2), Schema.Literal(3)])),
    text: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("paragraph"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("list"),
    ordered: Schema.optional(Schema.Boolean),
    items: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("table"),
    headers: Schema.Array(Schema.String),
    rows: Schema.Array(Schema.Array(Schema.String)),
    caption: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("code"), language: Schema.optional(Schema.String), text: Schema.String }),
  ImageBlock,
])

const WordSection = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.String,
  level: Schema.optional(Schema.Union([Schema.Literal(1), Schema.Literal(2), Schema.Literal(3)])),
  blocks: Schema.optional(Schema.Array(WordBlock)),
  paragraphs: Schema.optional(Schema.Array(Schema.String)),
  bullets: Schema.optional(Schema.Array(Schema.String)),
  numberedItems: Schema.optional(Schema.Array(Schema.String)),
  tables: Schema.optional(
    Schema.Array(
      Schema.Struct({
        headers: Schema.Array(Schema.String),
        rows: Schema.Array(Schema.Array(Schema.String)),
        caption: Schema.optional(Schema.String),
      }),
    ),
  ),
  images: Schema.optional(Schema.Array(ImageBlock)),
})

const WordTableSpec = Schema.Struct({
  headers: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Array(Schema.String)),
  caption: Schema.optional(Schema.String),
})

const CreateParameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Word document title." }),
  documentType: Schema.optional(Schema.String).annotate({ description: "Optional document type label." }),
  author: Schema.optional(Schema.String).annotate({ description: "Optional document author." }),
  artifactTitle: Schema.optional(Schema.String).annotate({ description: "Optional artifact title." }),
  taskSlug: Schema.optional(Schema.String).annotate({ description: "Optional artifact directory slug." }),
  outputFile: Schema.optional(Schema.String).annotate({
    description: "Optional .docx filename inside the artifact directory.",
  }),
  summary: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Optional intro summary paragraphs." }),
  sections: Schema.Array(WordSection).annotate({ description: "Document sections with structured blocks." }),
})

const EditLocator = Schema.Struct({
  heading: Schema.optional(Schema.String),
  occurrence: Schema.optional(Schema.Number),
  paragraphIndex: Schema.optional(Schema.Number),
  paragraphText: Schema.optional(Schema.String),
  tableIndex: Schema.optional(Schema.Number),
  imageIndex: Schema.optional(Schema.Number),
  imageRelId: Schema.optional(Schema.String),
  contentControlIndex: Schema.optional(Schema.Number),
  contentControlTag: Schema.optional(Schema.String),
  contentControlTitle: Schema.optional(Schema.String),
})

const OoxmlPartPatch = Schema.Struct({
  part: Schema.String,
  find: Schema.String,
  replace: Schema.String,
  occurrence: Schema.optional(Schema.Number),
  replaceAll: Schema.optional(Schema.Boolean),
})

const EditOperation = Schema.Union([
  Schema.Struct({ op: Schema.Literal("insert_after_heading"), locator: EditLocator, blocks: Schema.Array(WordBlock) }),
  Schema.Struct({ op: Schema.Literal("insert_before_heading"), locator: EditLocator, blocks: Schema.Array(WordBlock) }),
  Schema.Struct({ op: Schema.Literal("append_blocks"), blocks: Schema.Array(WordBlock) }),
  Schema.Struct({ op: Schema.Literal("replace_paragraph"), locator: EditLocator, text: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("replace_paragraph_with_blocks"),
    locator: EditLocator,
    blocks: Schema.Array(WordBlock),
  }),
  Schema.Struct({
    op: Schema.Literal("replace_section"),
    locator: EditLocator,
    title: Schema.optional(Schema.String),
    level: Schema.optional(Schema.Union([Schema.Literal(1), Schema.Literal(2), Schema.Literal(3)])),
    blocks: Schema.Array(WordBlock),
  }),
  Schema.Struct({ op: Schema.Literal("delete_paragraph"), locator: EditLocator }),
  Schema.Struct({ op: Schema.Literal("delete_section"), locator: EditLocator }),
  Schema.Struct({ op: Schema.Literal("delete_table"), locator: EditLocator }),
  Schema.Struct({
    op: Schema.Literal("update_table"),
    locator: EditLocator,
    headers: Schema.Array(Schema.String),
    rows: Schema.Array(Schema.Array(Schema.String)),
    caption: Schema.optional(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("replace_image"), locator: EditLocator, image: ImageBlock }),
  Schema.Struct({ op: Schema.Literal("fill_content_control"), locator: EditLocator, text: Schema.String }),
  Schema.Struct({ op: Schema.Literal("patch_ooxml_part"), patch: OoxmlPartPatch }),
])

const ApplyEditParameters = Schema.Struct({
  sourcePath: Schema.String.annotate({ description: "Workspace-relative source .docx path." }),
  outputFile: Schema.optional(Schema.String).annotate({
    description: "Optional output .docx filename inside the new artifact directory.",
  }),
  taskSlug: Schema.optional(Schema.String).annotate({ description: "Optional artifact directory slug." }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional edited artifact title." }),
  backup: Schema.optional(Schema.Boolean).annotate({
    description:
      "Copy the source docx into the artifact directory before writing the edited version. Defaults to true.",
  }),
  renderAfterEdit: Schema.optional(Schema.Boolean).annotate({
    description: "Render the edited docx after writing it. Defaults to false.",
  }),
  dryRun: Schema.optional(Schema.Boolean).annotate({
    description: "When true, only report impacted targets without writing a new docx.",
  }),
  edits: Schema.Array(EditOperation).annotate({ description: "Structured Word edit operations." }),
})

const InspectParameters = Schema.Struct({
  path: Schema.String.annotate({ description: "Workspace-relative .docx path to inspect." }),
  maxParagraphs: Schema.optional(Schema.Number).annotate({
    description: "Maximum paragraphs to include in bounded inspection output.",
  }),
  maxTables: Schema.optional(Schema.Number).annotate({
    description: "Maximum tables to include in bounded inspection output.",
  }),
})

const ApplyTemplateStylesParameters = Schema.Struct({
  sourcePath: Schema.String.annotate({ description: "Workspace-relative source .docx path." }),
  templatePath: Schema.optional(Schema.String).annotate({
    description: "Optional workspace-relative template .docx path to inherit styles, numbering, and theme from.",
  }),
  outputFile: Schema.optional(Schema.String).annotate({
    description: "Optional output .docx filename inside the new artifact directory.",
  }),
  taskSlug: Schema.optional(Schema.String).annotate({ description: "Optional artifact directory slug." }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional styled artifact title." }),
  fontFamily: Schema.optional(Schema.String).annotate({
    description: "Optional default font family to inject into styles.xml.",
  }),
})

const MaterializeFieldsParameters = Schema.Struct({
  sourcePath: Schema.String.annotate({ description: "Workspace-relative source .docx path." }),
  outputFile: Schema.optional(Schema.String).annotate({
    description: "Optional output .docx filename inside the new artifact directory.",
  }),
  taskSlug: Schema.optional(Schema.String).annotate({ description: "Optional artifact directory slug." }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional field-materialized artifact title." }),
  tocMode: Schema.optional(
    Schema.Union([Schema.Literal("preserve"), Schema.Literal("materialize"), Schema.Literal("remove")]),
  ).annotate({ description: "How to handle {{TOC}} placeholders." }),
})

const MergeDocumentsParameters = Schema.Struct({
  sources: Schema.Array(Schema.String).annotate({ description: "Workspace-relative .docx paths to merge in order." }),
  outputFile: Schema.optional(Schema.String).annotate({
    description: "Optional output .docx filename inside the new artifact directory.",
  }),
  taskSlug: Schema.optional(Schema.String).annotate({ description: "Optional artifact directory slug." }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional merged artifact title." }),
  separatorHeading: Schema.optional(Schema.Boolean).annotate({
    description: "Insert a heading before each appended document.",
  }),
})

const DiffDocumentsParameters = Schema.Struct({
  beforePath: Schema.String.annotate({ description: "Workspace-relative baseline .docx path." }),
  afterPath: Schema.String.annotate({ description: "Workspace-relative candidate .docx path." }),
  outputFile: Schema.optional(Schema.String).annotate({
    description: "Optional Markdown diff filename inside the artifact directory.",
  }),
  taskSlug: Schema.optional(Schema.String).annotate({ description: "Optional artifact directory slug." }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional diff artifact title." }),
  maxChanges: Schema.optional(Schema.Number).annotate({
    description: "Maximum added/removed/changed paragraph entries to include.",
  }),
})

const NormalizeTableSpecParameters = Schema.Struct({
  tables: Schema.Array(WordTableSpec).annotate({
    description: "Word table specs to normalize before document creation or table update.",
  }),
  trimCells: Schema.optional(Schema.Boolean).annotate({
    description: "Trim whitespace around table cells. Defaults to true.",
  }),
  fillMissingCells: Schema.optional(Schema.String).annotate({
    description: "Cell value used to pad short rows. Defaults to empty string.",
  }),
  maxColumns: Schema.optional(Schema.Number).annotate({
    description: "Optional maximum column count; wider rows are truncated with warnings.",
  }),
})

const RenderWordDocumentParameters = Schema.Struct({
  sourcePath: Schema.String.annotate({ description: "Workspace-relative source .docx path." }),
  remoteEndpoint: Schema.optional(Schema.String).annotate({
    description:
      "Optional external renderer endpoint. If omitted, KILO_WORD_RENDER_ENDPOINT is used; if neither is set, the tool returns a warning artifact.",
  }),
  outputFile: Schema.optional(Schema.String).annotate({
    description: "Optional PDF filename inside the render artifact directory.",
  }),
  taskSlug: Schema.optional(Schema.String).annotate({ description: "Optional artifact directory slug." }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional render artifact title." }),
  timeoutMs: Schema.optional(Schema.Number).annotate({ description: "Remote renderer timeout in milliseconds." }),
  maxPages: Schema.optional(Schema.Number).annotate({ description: "Maximum page PNGs to accept from the renderer." }),
})

type WordMeta = {
  path?: string
  artifactDir?: string
  manifestPath?: string
  outlineCount?: number
  paragraphCount?: number
  tableCount?: number
  imageCount?: number
  contentControlCount?: number
  sourceCount?: number
  copiedImages?: number
  appliedParts?: string[]
  markdownPath?: string
  jsonPath?: string
  pdfPath?: string
  pageCount?: number
  diagnosticsPath?: string
  visualQaStatus?: "completed" | "skipped"
  visualQaSkipReason?: string
  truncated?: boolean
  failed?: boolean
  error?: string
}

function wordFailure(title: string, err: unknown, metadata: WordMeta = {}): Tool.ExecuteResult<WordMeta> {
  const message = formatError(err)
  return {
    title,
    metadata: { ...metadata, failed: true, error: message },
    output: [
      `${title}: ${message}`,
      "This Word sidecar operation failed; Kilo native QA, code understanding, and document_search are not replaced by this tool.",
    ].join("\n"),
  }
}

function runWordOperation<T>(
  operation: () => T | Promise<T>,
  onSuccess: (result: T) => Tool.ExecuteResult<WordMeta>,
  failureTitle: string,
  metadata?: WordMeta,
): Effect.Effect<Tool.ExecuteResult<WordMeta>> {
  return Effect.tryPromise({ try: async () => operation(), catch: (err) => err }).pipe(
    Effect.match({
      onFailure: (err) => wordFailure(failureTitle, err, metadata),
      onSuccess,
    }),
  )
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return JSON.stringify(err) ?? String(err)
}

type MutableDeep<T> = T extends readonly (infer U)[]
  ? MutableDeep<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: MutableDeep<T[K]> }
    : T

function mutable<T>(value: T): MutableDeep<T> {
  return value as MutableDeep<T>
}

export const CreateWordDocumentTool = Tool.define(
  "create_word_document",
  Effect.succeed({
    description:
      "Create a Word .docx artifact from a structured document spec. Use only when the user explicitly asks to generate a Word/docx deliverable; do not use for ordinary QA.",
    parameters: CreateParameters,
    execute: (
      params: Schema.Schema.Type<typeof CreateParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "create_word_document",
          patterns: [params.title],
          always: ["*"],
          metadata: { title: params.title, outputFile: params.outputFile },
        })
        return yield* runWordOperation(
          () => createWordDocument(mutable(params)),
          (created) => ({
            title: "Word Document Created",
            metadata: {
              path: created.path,
              artifactDir: created.artifactDir,
              manifestPath: created.manifestPath,
            },
            output: [
              `Created Word document: ${created.path}`,
              `Artifact directory: ${created.artifactDir}`,
              `Manifest: ${created.manifestPath}`,
              created.warnings.length ? `Warnings: ${created.warnings.join("; ")}` : "Warnings: none",
            ].join("\n"),
          }),
          "Word Document Creation Failed",
          { path: params.outputFile },
        )
      }).pipe(Effect.orDie),
  }),
)

export const InspectWordDocumentTool = Tool.define(
  "inspect_word_document",
  Effect.succeed({
    description:
      "Inspect a Word .docx artifact and return bounded outline, paragraph, table, image, and style summaries. Use for Word edit planning, not for general document QA; use document_search for indexed document questions.",
    parameters: InspectParameters,
    execute: (
      params: Schema.Schema.Type<typeof InspectParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "inspect_word_document",
          patterns: [params.path],
          always: ["*"],
          metadata: { path: params.path },
        })
        return yield* runWordOperation(
          () => inspectWordDocument(mutable(params)),
          (inspection) => ({
            title: "Word Document Inspection",
            metadata: {
              path: inspection.path,
              outlineCount: inspection.outline.length,
              paragraphCount: inspection.paragraphs.length,
              tableCount: inspection.tables.length,
              imageCount: inspection.images.length,
              contentControlCount: inspection.contentControls.length,
              truncated: inspection.truncated,
            },
            output: JSON.stringify(
              {
                path: inspection.path,
                title: inspection.title,
                outline: inspection.outline,
                paragraphs: inspection.paragraphs,
                tables: inspection.tables,
                images: inspection.images,
                imageCount: inspection.images.length,
                contentControls: inspection.contentControls,
                styles: inspection.styles,
                warnings: inspection.warnings,
                truncated: inspection.truncated,
              },
              null,
              2,
            ),
          }),
          "Word Document Inspection Failed",
          { path: params.path },
        )
      }).pipe(Effect.orDie),
  }),
)

export const ApplyWordDocumentEditsTool = Tool.define(
  "apply_word_document_edits",
  Effect.succeed({
    description:
      "Apply structured edits to an existing Word .docx and write a new artifact. Delete operations should be dry-run first. Use only for explicit Word/docx edit requests.",
    parameters: ApplyEditParameters,
    execute: (
      params: Schema.Schema.Type<typeof ApplyEditParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "apply_word_document_edits",
          patterns: [params.sourcePath],
          always: ["*"],
          metadata: { sourcePath: params.sourcePath, dryRun: params.dryRun, editCount: params.edits.length },
        })
        return yield* runWordOperation(
          () => applyWordDocumentEdits(mutable(params)),
          (result) => ({
            title: result.dryRun ? "Word Edit Dry Run" : "Word Document Edited",
            metadata: {
              path: result.path,
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              backupPath: result.backupPath,
              renderAfterEdit: result.renderAfterEdit,
            },
            output: JSON.stringify(
              {
                dryRun: result.dryRun,
                path: result.path,
                artifactDir: result.artifactDir,
                manifestPath: result.manifestPath,
                backupPath: result.backupPath,
                renderAfterEdit: result.renderAfterEdit,
                renderResult: result.renderResult,
                impacts: result.impacts,
                warnings: result.warnings,
              },
              null,
              2,
            ),
          }),
          "Word Document Edit Failed",
          { path: params.sourcePath },
        )
      }).pipe(Effect.orDie),
  }),
)

export const ApplyWordTemplateStylesTool = Tool.define(
  "apply_word_template_styles",
  Effect.succeed({
    description:
      "Apply template styles, numbering, theme, or default font settings to a Word .docx and write a new artifact. This is not mail merge and should only be used for explicit Word/docx styling requests.",
    parameters: ApplyTemplateStylesParameters,
    execute: (
      params: Schema.Schema.Type<typeof ApplyTemplateStylesParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "apply_word_template_styles",
          patterns: [params.sourcePath, params.templatePath ?? ""].filter(Boolean),
          always: ["*"],
          metadata: { sourcePath: params.sourcePath, templatePath: params.templatePath },
        })
        return yield* runWordOperation(
          () => applyWordTemplateStyles(mutable(params)),
          (result) => ({
            title: "Word Template Styles Applied",
            metadata: {
              path: result.path,
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              appliedParts: result.appliedParts,
            },
            output: JSON.stringify(result, null, 2),
          }),
          "Word Template Style Application Failed",
          { path: params.sourcePath },
        )
      }).pipe(Effect.orDie),
  }),
)

export const MaterializeWordFieldsTool = Tool.define(
  "materialize_word_fields",
  Effect.succeed({
    description:
      "Materialize supported Word field placeholders such as {{CAPTION:Figure:...}}, {{SEQ:Figure}}, and {{TOC}} into a new .docx artifact. It does not provide full mail-merge behavior.",
    parameters: MaterializeFieldsParameters,
    execute: (
      params: Schema.Schema.Type<typeof MaterializeFieldsParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "materialize_word_fields",
          patterns: [params.sourcePath],
          always: ["*"],
          metadata: { sourcePath: params.sourcePath, tocMode: params.tocMode },
        })
        return yield* runWordOperation(
          () => materializeWordFields(mutable(params)),
          (result) => ({
            title: "Word Fields Materialized",
            metadata: {
              path: result.path,
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
            },
            output: JSON.stringify(result, null, 2),
          }),
          "Word Field Materialization Failed",
          { path: params.sourcePath },
        )
      }).pipe(Effect.orDie),
  }),
)

export const MergeWordDocumentsTool = Tool.define(
  "merge_word_documents",
  Effect.succeed({
    description:
      "Merge multiple Word .docx artifacts into a new .docx while remapping copied images, relationships, content types, and bookmark ids. Use only for explicit Word/docx merge requests.",
    parameters: MergeDocumentsParameters,
    execute: (
      params: Schema.Schema.Type<typeof MergeDocumentsParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "merge_word_documents",
          patterns: params.sources,
          always: ["*"],
          metadata: { sourceCount: params.sources.length },
        })
        return yield* runWordOperation(
          () => mergeWordDocuments(mutable(params)),
          (result) => ({
            title: "Word Documents Merged",
            metadata: {
              path: result.path,
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              sourceCount: result.sourceCount,
              copiedImages: result.copiedImages,
            },
            output: JSON.stringify(result, null, 2),
          }),
          "Word Document Merge Failed",
          { sourceCount: params.sources.length },
        )
      }).pipe(Effect.orDie),
  }),
)

export const DiffWordDocumentsTool = Tool.define(
  "diff_word_documents",
  Effect.succeed({
    description:
      "Compare two Word .docx artifacts and emit bounded Markdown plus JSON diagnostics. The output is summarized and should not place full document contents into model context.",
    parameters: DiffDocumentsParameters,
    execute: (
      params: Schema.Schema.Type<typeof DiffDocumentsParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "diff_word_documents",
          patterns: [params.beforePath, params.afterPath],
          always: ["*"],
          metadata: { beforePath: params.beforePath, afterPath: params.afterPath, maxChanges: params.maxChanges },
        })
        return yield* runWordOperation(
          () => diffWordDocuments(mutable(params)),
          (result) => ({
            title: "Word Documents Diffed",
            metadata: {
              markdownPath: result.markdownPath,
              jsonPath: result.jsonPath,
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              truncated: result.diagnostics.truncated,
            },
            output: JSON.stringify(
              {
                markdownPath: result.markdownPath,
                jsonPath: result.jsonPath,
                diagnostics: result.diagnostics,
                warnings: result.warnings,
              },
              null,
              2,
            ),
          }),
          "Word Document Diff Failed",
          { path: params.afterPath },
        )
      }).pipe(Effect.orDie),
  }),
)

export const NormalizeWordTableSpecTool = Tool.define(
  "normalize_word_table_spec",
  Effect.succeed({
    description:
      "Normalize and diagnose structured Word table specs before creating or updating a .docx table. This only returns bounded table JSON and does not answer ordinary code or document QA.",
    parameters: NormalizeTableSpecParameters,
    execute: (
      params: Schema.Schema.Type<typeof NormalizeTableSpecParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "normalize_word_table_spec",
          patterns: [`${params.tables.length} table(s)`],
          always: ["*"],
          metadata: { tableCount: params.tables.length, maxColumns: params.maxColumns },
        })
        return yield* runWordOperation(
          () => normalizeWordTableSpec(mutable(params)),
          (result) => ({
            title: "Word Table Specs Normalized",
            metadata: {
              tableCount: result.tables.length,
              truncated: result.warnings.length > 0,
            },
            output: JSON.stringify(result, null, 2),
          }),
          "Word Table Spec Normalization Failed",
          { tableCount: params.tables.length },
        )
      }).pipe(Effect.orDie),
  }),
)

export const RenderWordDocumentTool = Tool.define(
  "render_word_document",
  Effect.succeed({
    description:
      "Render a Word .docx through an external renderer endpoint, or through locally installed soffice/pdftoppm when configured or present on PATH, into PDF and page PNG artifacts, then return bounded quality diagnostics. Does not bundle LibreOffice, Chromium, or Poppler and should only be used for explicit render/export requests.",
    parameters: RenderWordDocumentParameters,
    execute: (
      params: Schema.Schema.Type<typeof RenderWordDocumentParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<WordMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "render_word_document",
          patterns: [params.sourcePath],
          always: ["*"],
          metadata: {
            sourcePath: params.sourcePath,
            hasRemoteEndpoint: Boolean(params.remoteEndpoint),
            maxPages: params.maxPages,
          },
        })
        return yield* runWordOperation(
          () => renderWordDocument(mutable(params)),
          (result) => ({
            title: "Word Document Rendered",
            metadata: {
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              pdfPath: result.pdfPath,
              pageCount: result.pageCount,
              diagnosticsPath: result.diagnosticsPath,
              visualQaStatus: result.visualQaStatus,
              visualQaSkipReason: result.visualQaSkipReason,
            },
            output: JSON.stringify(result, null, 2),
          }),
          "Word Document Render Failed",
          { path: params.sourcePath },
        )
      }).pipe(Effect.orDie),
  }),
)

export const WordDocumentTools = Effect.all({
  create: CreateWordDocumentTool,
  inspect: InspectWordDocumentTool,
  applyEdits: ApplyWordDocumentEditsTool,
  applyTemplateStyles: ApplyWordTemplateStylesTool,
  materializeFields: MaterializeWordFieldsTool,
  merge: MergeWordDocumentsTool,
  diff: DiffWordDocumentsTool,
  normalizeTableSpec: NormalizeWordTableSpecTool,
  render: RenderWordDocumentTool,
})
