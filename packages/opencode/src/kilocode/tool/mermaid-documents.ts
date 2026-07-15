import { Effect, Schema } from "effect"
import {
  insertMermaidIntoWord,
  renderMermaidDiagram,
  saveMermaidArtifact,
  validateMermaidDiagram,
} from "@/kilocode/documents/mermaid"
import * as Tool from "@/tool/tool"

const ValidateMermaidParameters = Schema.Struct({
  source: Schema.String.annotate({ description: "Mermaid diagram source text." }),
  diagramType: Schema.optional(Schema.String).annotate({ description: "Optional expected diagram type label." }),
})

const SaveMermaidParameters = Schema.Struct({
  source: Schema.String.annotate({ description: "Mermaid diagram source text to save as .mmd." }),
  pngBase64: Schema.optional(Schema.String).annotate({ description: "Optional rendered PNG payload to save." }),
  pngPath: Schema.optional(Schema.String).annotate({
    description: "Optional workspace-relative PNG path to copy into the artifact.",
  }),
  title: Schema.optional(Schema.String),
  taskSlug: Schema.optional(Schema.String),
  sourceFile: Schema.optional(Schema.String),
  pngFile: Schema.optional(Schema.String),
})

const RenderMermaidParameters = Schema.Struct({
  source: Schema.String.annotate({ description: "Mermaid diagram source text to render." }),
  title: Schema.optional(Schema.String),
  taskSlug: Schema.optional(Schema.String),
  sourceFile: Schema.optional(Schema.String),
  pngFile: Schema.optional(Schema.String),
  remoteEndpoint: Schema.optional(Schema.String).annotate({
    description:
      "Optional external Mermaid renderer endpoint. If omitted, KILO_MERMAID_RENDER_ENDPOINT or external mmdc is used.",
  }),
  theme: Schema.optional(Schema.String),
  background: Schema.optional(Schema.String),
  scale: Schema.optional(Schema.Number).annotate({
    description: "Optional render scale forwarded to the configured Mermaid render service.",
  }),
  timeoutMs: Schema.optional(Schema.Number),
})

const InsertMermaidIntoWordParameters = Schema.Struct({
  wordPath: Schema.String.annotate({ description: "Workspace-relative source .docx path." }),
  source: Schema.String.annotate({ description: "Mermaid diagram source text." }),
  pngBase64: Schema.optional(Schema.String),
  pngPath: Schema.optional(Schema.String),
  remoteEndpoint: Schema.optional(Schema.String),
  heading: Schema.optional(Schema.String).annotate({
    description: "Optional Word heading after which to insert the rendered PNG.",
  }),
  caption: Schema.optional(Schema.String),
  outputFile: Schema.optional(Schema.String),
  taskSlug: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
})

type MermaidMeta = {
  artifactDir?: string
  manifestPath?: string
  sourcePath?: string
  pngPath?: string
  diagnosticsPath?: string
  wordPath?: string
  inserted?: boolean
  rendered?: boolean
  width?: number
  height?: number
  pixelWidth?: number
  pixelHeight?: number
  scale?: number
  issues?: Array<{ severity?: string; code?: string; message?: string }>
  valid?: boolean
  failed?: boolean
  error?: string
}

function mermaidFailure(title: string, err: unknown, metadata: MermaidMeta = {}): Tool.ExecuteResult<MermaidMeta> {
  const message = formatError(err)
  return {
    title,
    metadata: { ...metadata, failed: true, error: message },
    output: [
      `${title}: ${message}`,
      "This Mermaid sidecar operation failed; Kilo native QA, code understanding, and document_search are not replaced by this tool.",
    ].join("\n"),
  }
}

function runMermaidOperation<T>(
  operation: () => T | Promise<T>,
  onSuccess: (result: T) => Tool.ExecuteResult<MermaidMeta>,
  failureTitle: string,
  metadata?: MermaidMeta,
): Effect.Effect<Tool.ExecuteResult<MermaidMeta>> {
  return Effect.tryPromise({ try: async () => operation(), catch: (err) => err }).pipe(
    Effect.match({
      onFailure: (err) => mermaidFailure(failureTitle, err, metadata),
      onSuccess,
    }),
  )
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return JSON.stringify(err) ?? String(err)
}

export const ValidateMermaidDiagramTool = Tool.define(
  "validate_mermaid_diagram",
  Effect.succeed({
    description:
      "Validate Mermaid source syntax at a bounded, renderer-oriented level. This tool does not decide business flow, exception flow, state roles, or diagram semantics.",
    parameters: ValidateMermaidParameters,
    execute: (
      params: Schema.Schema.Type<typeof ValidateMermaidParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<MermaidMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "validate_mermaid_diagram",
          patterns: [params.diagramType ?? "mermaid"],
          always: ["*"],
          metadata: { diagramType: params.diagramType },
        })
        return yield* runMermaidOperation(
          () => validateMermaidDiagram(params),
          (result) => ({
            title: result.valid ? "Mermaid Diagram Valid" : "Mermaid Diagram Invalid",
            metadata: { valid: result.valid },
            output: JSON.stringify(result, null, 2),
          }),
          "Mermaid Diagram Validation Failed",
        )
      }).pipe(Effect.orDie),
  }),
)

export const SaveMermaidArtifactTool = Tool.define(
  "save_mermaid_artifact",
  Effect.succeed({
    description:
      "Save Mermaid .mmd source and optional PNG into a document artifact with diagnostics. This is an artifact operation, not a code or document QA tool.",
    parameters: SaveMermaidParameters,
    execute: (
      params: Schema.Schema.Type<typeof SaveMermaidParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<MermaidMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "save_mermaid_artifact",
          patterns: [params.title ?? params.sourceFile ?? "mermaid"],
          always: ["*"],
          metadata: { title: params.title, hasPng: Boolean(params.pngBase64 || params.pngPath) },
        })
        return yield* runMermaidOperation(
          () => saveMermaidArtifact(params),
          (result) => ({
            title: "Mermaid Artifact Saved",
            metadata: {
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              sourcePath: result.sourcePath,
              pngPath: result.pngPath,
              diagnosticsPath: result.diagnosticsPath,
            },
            output: JSON.stringify(result, null, 2),
          }),
          "Mermaid Artifact Save Failed",
          { sourcePath: params.sourceFile },
        )
      }).pipe(Effect.orDie),
  }),
)

export const RenderMermaidDiagramTool = Tool.define(
  "render_mermaid_diagram",
  Effect.succeed({
    description:
      "Render Mermaid source into PNG using an external renderer endpoint or externally installed mmdc, then return the PNG path, display and pixel dimensions, scale, warnings, and render QA issues. It does not infer business semantics.",
    parameters: RenderMermaidParameters,
    execute: (
      params: Schema.Schema.Type<typeof RenderMermaidParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<MermaidMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "render_mermaid_diagram",
          patterns: [params.title ?? params.sourceFile ?? "mermaid"],
          always: ["*"],
          metadata: {
            hasRemoteEndpoint: Boolean(params.remoteEndpoint),
            scale: params.scale,
            timeoutMs: params.timeoutMs,
          },
        })
        return yield* runMermaidOperation(
          () => renderMermaidDiagram(params),
          (result) => ({
            title: result.rendered ? "Mermaid Diagram Rendered" : "Mermaid Diagram Render Failed",
            metadata: {
              rendered: result.rendered,
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              sourcePath: result.sourcePath,
              pngPath: result.pngPath,
              diagnosticsPath: result.diagnosticsPath,
              width: result.width,
              height: result.height,
              pixelWidth: result.pixelWidth,
              pixelHeight: result.pixelHeight,
              scale: result.scale,
              issues: result.issues,
            },
            output: JSON.stringify(result, null, 2),
          }),
          "Mermaid Diagram Render Failed",
          { sourcePath: params.sourceFile },
        )
      }).pipe(Effect.orDie),
  }),
)

export const InsertMermaidIntoWordTool = Tool.define(
  "insert_mermaid_into_word",
  Effect.succeed({
    description:
      "Render or save a Mermaid PNG and insert it into a new Word .docx artifact. This does not modify the original docx and does not replace Word or document_search QA.",
    parameters: InsertMermaidIntoWordParameters,
    execute: (
      params: Schema.Schema.Type<typeof InsertMermaidIntoWordParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<MermaidMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "insert_mermaid_into_word",
          patterns: [params.wordPath],
          always: ["*"],
          metadata: {
            wordPath: params.wordPath,
            heading: params.heading,
            hasPng: Boolean(params.pngBase64 || params.pngPath),
          },
        })
        return yield* runMermaidOperation(
          () => insertMermaidIntoWord(params),
          (result) => ({
            title: result.inserted ? "Mermaid Inserted Into Word" : "Mermaid Insert Into Word Skipped",
            metadata: {
              inserted: result.inserted,
              wordPath: result.wordPath,
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              pngPath: result.mermaidPngPath,
            },
            output: JSON.stringify(result, null, 2),
          }),
          "Mermaid Insert Into Word Failed",
          { wordPath: params.wordPath },
        )
      }).pipe(Effect.orDie),
  }),
)

export const MermaidDocumentTools = Effect.all({
  validate: ValidateMermaidDiagramTool,
  render: RenderMermaidDiagramTool,
  save: SaveMermaidArtifactTool,
  insertIntoWord: InsertMermaidIntoWordTool,
})
