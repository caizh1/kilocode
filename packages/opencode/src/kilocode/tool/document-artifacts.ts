import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import {
  declareArtifact,
  exportArtifactDiagnostics,
  listArtifacts,
  resolveOpenArtifact,
  type ArtifactQualityStatus,
} from "@/kilocode/documents/artifacts"

const QualityStatus = Schema.Union([
  Schema.Literal("ok"),
  Schema.Literal("warning"),
  Schema.Literal("failed"),
  Schema.Literal("unknown"),
])

const DeclareParameters = Schema.Struct({
  kind: Schema.String.annotate({ description: "Artifact kind, for example word-document, mermaid-diagram, design-doc, or terminal-report." }),
  title: Schema.optional(Schema.String).annotate({ description: "Human-readable artifact title." }),
  taskSlug: Schema.optional(Schema.String).annotate({ description: "Optional slug used when creating a new artifact directory." }),
  artifactDir: Schema.optional(Schema.String).annotate({ description: "Existing artifact directory relative to the workspace, under .kilo/artifacts." }),
  primaryFile: Schema.optional(Schema.String).annotate({ description: "Primary artifact file path relative to the artifact directory." }),
  derivedFiles: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Derived artifact file paths relative to the artifact directory." }),
  sourceFiles: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Source file paths relative to the artifact directory." }),
  warnings: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Artifact warnings to persist in the manifest." }),
  qualityStatus: Schema.optional(QualityStatus).annotate({ description: "Artifact quality status." }),
})

const ListParameters = Schema.Struct({})

const OpenParameters = Schema.Struct({
  path: Schema.String.annotate({ description: "Workspace-relative artifact file or directory path to open." }),
  target: Schema.optional(Schema.Union([Schema.Literal("path"), Schema.Literal("folder")])).annotate({
    description: "Return the path itself or its containing folder when the path is a file.",
  }),
})

const ExportParameters = Schema.Struct({})

type ArtifactMeta = {
  artifactDir?: string
  manifestPath?: string
  path?: string
  count?: number
  qualityStatus?: ArtifactQualityStatus
  artifacts?: unknown
  failed?: boolean
  error?: string
}

function artifactFailure(title: string, err: unknown, metadata: ArtifactMeta = {}): Tool.ExecuteResult<ArtifactMeta> {
  const message = formatError(err)
  return {
    title,
    metadata: { ...metadata, failed: true, error: message },
    output: [
      `${title}: ${message}`,
      "This generated-artifact sidecar operation failed; Kilo native QA, code understanding, and document_search are not replaced by this tool.",
    ].join("\n"),
  }
}

function runArtifactOperation<T>(
  operation: () => T | Promise<T>,
  onSuccess: (result: T) => Tool.ExecuteResult<ArtifactMeta>,
  failureTitle: string,
  metadata?: ArtifactMeta,
): Effect.Effect<Tool.ExecuteResult<ArtifactMeta>> {
  return Effect.tryPromise({ try: async () => operation(), catch: (err) => err }).pipe(
    Effect.match({
      onFailure: (err) => artifactFailure(failureTitle, err, metadata),
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

export const DeclareArtifactTool = Tool.define(
  "declare_artifact",
  Effect.succeed({
    description:
      "Declare or update a generated document artifact manifest. Use only when a deliverable file artifact is created or updated; do not use for ordinary QA.",
    parameters: DeclareParameters,
    execute: (params: Schema.Schema.Type<typeof DeclareParameters>, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<ArtifactMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "declare_artifact",
          patterns: [params.title ?? params.kind],
          always: ["*"],
          metadata: { kind: params.kind, title: params.title, artifactDir: params.artifactDir },
        })

        return yield* runArtifactOperation(
          () =>
            declareArtifact(mutable({
              ...params,
              qualityStatus: params.qualityStatus as ArtifactQualityStatus | undefined,
            })),
          (result) => ({
            title: "Artifact Declared",
            metadata: {
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              qualityStatus: result.manifest.quality.status,
            },
            output: [
              `Declared ${result.manifest.kind} artifact: ${result.manifest.title}`,
              `Artifact directory: ${result.artifactDir}`,
              `Manifest: ${result.manifestPath}`,
              `Quality: ${result.manifest.quality.status}`,
              result.manifest.warnings.length ? `Warnings: ${result.manifest.warnings.join("; ")}` : "Warnings: none",
            ].join("\n"),
          }),
          "Artifact Declaration Failed",
          { artifactDir: params.artifactDir },
        )
      }).pipe(Effect.orDie),
  }),
)

export const ListArtifactsTool = Tool.define(
  "list_artifacts",
  Effect.succeed({
    description:
      "List generated document artifacts in the current workspace. Use for artifact management only, not for answering source-code or document-grounded QA.",
    parameters: ListParameters,
    execute: (): Effect.Effect<Tool.ExecuteResult<ArtifactMeta>> =>
      Effect.gen(function* () {
        return yield* runArtifactOperation(
          () => listArtifacts(),
          (artifacts) => ({
            title: "Artifacts",
            metadata: {
              count: artifacts.length,
              artifacts,
            },
            output:
              artifacts.length === 0
                ? "No document artifacts found in .kilo/artifacts."
                : [
                    `Found ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}.`,
                    "",
                    ...artifacts.map((artifact, index) =>
                      [
                        `${index + 1}. ${artifact.manifest.title}`,
                        `   kind: ${artifact.manifest.kind}`,
                        `   directory: ${artifact.artifactDir}`,
                        `   manifest: ${artifact.manifestPath}`,
                        `   quality: ${artifact.manifest.quality.status}`,
                      ].join("\n"),
                    ),
                  ].join("\n"),
          }),
          "Artifact List Failed",
        )
      }).pipe(Effect.orDie),
  }),
)

export const OpenArtifactTool = Tool.define(
  "open_artifact",
  Effect.succeed({
    description:
      "Resolve an artifact file or folder path for opening. Use only for generated artifacts; do not use for source-code QA or document search.",
    parameters: OpenParameters,
    execute: (params: Schema.Schema.Type<typeof OpenParameters>): Effect.Effect<Tool.ExecuteResult<ArtifactMeta>> =>
      Effect.gen(function* () {
        return yield* runArtifactOperation(
          () => resolveOpenArtifact({ path: params.path, target: params.target }),
          (result) => ({
            title: "Artifact Path",
            metadata: {
              path: result.path,
            },
            output: [`Artifact path: ${result.path}`, `Type: ${result.isDirectory ? "directory" : "file"}`].join("\n"),
          }),
          "Artifact Open Failed",
          { path: params.path },
        )
      }).pipe(Effect.orDie),
  }),
)

export const ExportArtifactDiagnosticsTool = Tool.define(
  "export_artifact_diagnostics",
  Effect.succeed({
    description:
      "Export document artifact diagnostics for support or migration review. Use only when the user asks to diagnose or review generated artifacts.",
    parameters: ExportParameters,
    execute: (_params: Schema.Schema.Type<typeof ExportParameters>, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<ArtifactMeta>> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "export_artifact_diagnostics",
          patterns: [".kilo/artifacts"],
          always: ["*"],
          metadata: {},
        })

        return yield* runArtifactOperation(
          () => exportArtifactDiagnostics(),
          (result) => ({
            title: "Artifact Diagnostics",
            metadata: {
              path: result.path,
              count: result.diagnostics.artifacts.length,
            },
            output: [`Exported artifact diagnostics: ${result.path}`, `Artifacts: ${result.diagnostics.artifacts.length}`].join("\n"),
          }),
          "Artifact Diagnostics Export Failed",
        )
      }).pipe(Effect.orDie),
  }),
)

export const DocumentArtifactTools = Effect.all({
  declare: DeclareArtifactTool,
  list: ListArtifactsTool,
  open: OpenArtifactTool,
  diagnostics: ExportArtifactDiagnosticsTool,
})
