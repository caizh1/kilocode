import { createHash } from "node:crypto"
import { Effect, Schema } from "effect"
import {
  insertMermaidIntoWord,
  renderMermaidDiagram,
  renderSourceBackedMermaidBatch,
  saveMermaidArtifact,
  validateMermaidDiagramRequest,
} from "@/chipmate/documents/mermaid"
import * as Tool from "@/tool/tool"
import * as SemanticGuard from "@/chipmate/documents/mermaid-semantic-guard"
import * as WorkflowGuard from "@/chipmate/skill/workflow-guard"
import * as Readiness from "@/chipmate/skill/workflow-readiness"
import { Instance } from "@/chipmate/instance"

const ValidateMermaidParameters = Schema.Struct({
  source: Schema.String.annotate({ description: "Mermaid diagram source text." }),
  diagramType: Schema.optional(Schema.String).annotate({ description: "Optional expected diagram type label." }),
  semanticMode: Schema.optional(Schema.Literal("source-backed")).annotate({
    description: "Enable source-backed claim validation for a detailed-design diagram. Omit for ordinary Mermaid.",
  }),
  semanticEvidencePath: Schema.optional(Schema.String).annotate({
    description: "Workspace-relative diagram-claims.json path required by source-backed semantic validation.",
  }),
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
  source: Schema.optional(Schema.String).annotate({
    description: "Mermaid diagram source text to render. Required unless batchManifestPath is used.",
  }),
  batchManifestPath: Schema.optional(Schema.String).annotate({
    description:
      "Workspace-relative version 1 batch manifest for source-backed detailed-design diagrams. Its optional basePath roots work-package item/result paths without changing workspace-relative source evidence. Requires semanticMode and replaces source/semanticEvidencePath for this call.",
  }),
  title: Schema.optional(Schema.String),
  taskSlug: Schema.optional(Schema.String),
  sourceFile: Schema.optional(Schema.String),
  pngFile: Schema.optional(Schema.String),
  remoteEndpoint: Schema.optional(Schema.String).annotate({
    description:
      "Optional external Mermaid renderer endpoint for ordinary Mermaid. Source-backed detailed-design rendering always uses the configured endpoint or local mmdc and ignores this override.",
  }),
  theme: Schema.optional(Schema.String),
  background: Schema.optional(Schema.String),
  scale: Schema.optional(Schema.Number).annotate({
    description: "Optional render scale forwarded to the configured Mermaid render service.",
  }),
  timeoutMs: Schema.optional(Schema.Number),
  semanticMode: Schema.optional(Schema.Literal("source-backed")).annotate({
    description: "Enable source-backed claim validation before rendering. Omit for ordinary Mermaid.",
  }),
  semanticEvidencePath: Schema.optional(Schema.String).annotate({
    description: "Workspace-relative diagram-claims.json path required by source-backed semantic validation.",
  }),
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
  figureTitle: Schema.optional(Schema.String).annotate({
    description: "Optional visible figure title inserted before the drawing.",
  }),
  altText: Schema.optional(Schema.String).annotate({
    description: "Optional independent accessible description for the inserted drawing.",
  }),
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
  quality?: "ok" | "warning" | "failed" | "unknown"
  warnings?: string[]
  valid?: boolean
  failed?: boolean
  error?: string
  semanticStatus?: "not-requested" | "valid" | "valid-with-unknowns" | "invalid"
  sourceHash?: string
  claimCount?: number
  validatedClaimCount?: number
  semanticDiagnosticsPath?: string
  wordFitScale?: number
  wordFitDensity?: number
  wordFitAspectRatio?: number
  wordFitStatus?: "readable" | "split-required"
  wordFitReasons?: string[]
  documentReady?: boolean
  pendingSplitDiagramIds?: string[]
  pendingSplitDetails?: Array<{
    diagramId: string
    missingNodes: Array<{ id: string; symbol?: string; designUnitId?: string }>
    missingEdges: Array<{ from: string; to: string; relation: string }>
    suggestedChildren: Array<{
      suggestedDiagramId: string
      splitFromDiagramId: string
      nodes: Array<{ id: string; symbol?: string; designUnitId?: string }>
      edges: Array<{ from: string; to: string; relation: string }>
    }>
  }>
  batchResultPath?: string
  requestedCount?: number
  processedCount?: number
  renderedCount?: number
  readyCount?: number
  invalidCount?: number
  splitRequiredCount?: number
  complete?: boolean
  workflowProgress?: Readiness.FigureProgress
  workflowIssues?: string[]
}

function mermaidFailure(title: string, err: unknown, metadata: MermaidMeta = {}): Tool.ExecuteResult<MermaidMeta> {
  const message = formatError(err)
  return {
    title,
    metadata: { ...metadata, failed: true, error: message, quality: "failed", warnings: [message] },
    output: [
      `${title}: ${message}`,
      "This Mermaid sidecar operation failed; ChipMate native QA, code understanding, and document_search are not replaced by this tool.",
    ].join("\n"),
  }
}

function quality(input: {
  inserted?: boolean
  rendered?: boolean
  diagnostics?: Array<{ severity?: string }>
  issues?: Array<{ severity?: string }>
  warnings?: string[]
}): MermaidMeta["quality"] {
  if (input.inserted === false || input.rendered === false) return "failed"
  if (input.diagnostics?.some((item) => item.severity === "error")) return "failed"
  if (input.issues?.some((item) => item.severity === "error")) return "failed"
  if (input.warnings?.length || input.diagnostics?.length || input.issues?.length) return "warning"
  return "ok"
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
      "Validate Mermaid syntax. This tool does not decide business flow unless source-backed semanticMode explicitly verifies claims; omit it for ordinary Mermaid. Once source-backed mode is used in a session, that session cannot render by downgrading to ordinary Mermaid.",
    parameters: ValidateMermaidParameters,
    execute: (
      params: Schema.Schema.Type<typeof ValidateMermaidParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<MermaidMeta>> =>
      Effect.gen(function* () {
        if (params.semanticMode) {
          SemanticGuard.mark(ctx.sessionID)
          const issue = params.semanticEvidencePath
            ? SemanticGuard.validate(ctx.sessionID, params.semanticEvidencePath)
            : undefined
          if (issue) {
            const sourceHash = createHash("sha256").update(params.source).digest("hex")
            return blocked("Mermaid Semantic Validation Budget Exhausted", sourceHash, issue, "valid")
          }
        }
        yield* ctx.ask({
          permission: "validate_mermaid_diagram",
          patterns: [params.diagramType ?? "mermaid"],
          always: ["*"],
          metadata: { diagramType: params.diagramType, semanticMode: params.semanticMode },
        })
        return yield* runMermaidOperation(
          () => validateMermaidDiagramRequest({ ...params, semanticSessionId: ctx.sessionID }),
          (result) => ({
            title: result.valid ? "Mermaid Diagram Valid" : "Mermaid Diagram Invalid",
            metadata: {
              valid: result.valid,
              semanticStatus: result.semanticStatus,
              sourceHash: result.sourceHash,
              claimCount: result.claimCount,
              validatedClaimCount: result.validatedClaimCount,
              semanticDiagnosticsPath: result.diagnosticsPath,
            },
            output: JSON.stringify(
              {
                ...result,
                semanticFingerprint: undefined,
                issues: result.issues.slice(0, 20),
              },
              null,
              2,
            ),
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
              quality: quality(result),
              warnings: result.warnings,
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
      "Render Mermaid source into PNG only when the user explicitly requests Mermaid or does not specify another diagram language or renderer. Never use this tool as a fallback for an explicitly requested format or tool such as UML/PlantUML, Graphviz, or draw.io. For UML/PlantUML requests, do not probe local PlantUML, Java, or Graphviz availability and do not convert the request to Mermaid; use render_plantuml_diagram when validation or rendering is requested, and use the normal Code file-writing tool when only PlantUML source is requested. For source-backed detailed-design diagrams only, semanticMode validates claims and reports documentReady/Word-fit; split-required PNGs are evidence artifacts and cannot be inserted into Word. Omit semanticMode for ordinary Mermaid. A session that already attempted source-backed validation cannot omit semanticMode to bypass an invalid result.",
    parameters: RenderMermaidParameters,
    execute: (
      params: Schema.Schema.Type<typeof RenderMermaidParameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<MermaidMeta>> =>
      Effect.gen(function* () {
        const active = WorkflowGuard.sourceBacked(ctx.sessionID, ctx.messages)
        const root = active ? WorkflowGuard.root(ctx.sessionID, ctx.messages) : undefined
        if (active && params.semanticMode !== "source-backed") {
          return mermaidFailure(
            "Source-backed Mermaid Render Blocked",
            'The active source-backed-detail-design workflow requires semanticMode="source-backed" and source-backed claims. Ordinary Mermaid rendering cannot satisfy its figure matrix.',
          )
        }
        if (active) {
          if (!WorkflowGuard.figures(ctx.sessionID, ctx.messages)) {
            return mermaidFailure(
              "Source-backed Mermaid Render Blocked",
              "Source-backed diagrams start only after the prose checkpoint and the user's uninterrupted continuation; end the initial turn without rendering.",
            )
          }
          if (!root) {
            return mermaidFailure(
              "Source-backed Mermaid Render Blocked",
              "Declare the canonical artifact root before rendering source-backed diagrams.",
            )
          }
          const ready = yield* Effect.promise(() => Readiness.prose(Instance.directory, root))
          if (ready.issues.length) {
            return mermaidFailure(
              "Source-backed Mermaid Render Blocked",
              `Complete fourteen separately headed prose topics and an owner-complete business-flow census for every frozen DesignUnit before drawing. ${ready.issues.slice(0, 20).join("; ")}`,
            )
          }
          const missing = yield* Effect.promise(() => Readiness.checkpoints(ready.root))
          if (missing.length) {
            return mermaidFailure(
              "Source-backed Mermaid Render Blocked",
              `Persist the complete prose checkpoint before rendering. ${missing.join("; ")}`,
            )
          }
          const figures = yield* Effect.promise(() => Readiness.figures(Instance.directory, root))
          for (const split of figures.pendingSplits) SemanticGuard.restore(ctx.sessionID, split)
          if (!params.batchManifestPath && (ready.census?.designUnits.length ?? 0) > 1) {
            return mermaidFailure(
              "Source-backed Mermaid Render Blocked",
              "A multi-DesignUnit full document must render a frozen source-backed batch manifest; inline single-diagram rendering is reserved for narrow one-unit work.",
            )
          }
        }
        if (params.batchManifestPath) {
          if (params.semanticMode !== "source-backed") {
            return mermaidFailure(
              "Mermaid Source-backed Batch Rejected",
              'batchManifestPath requires semanticMode="source-backed".',
            )
          }
          if (params.source !== undefined || params.semanticEvidencePath !== undefined) {
            return mermaidFailure(
              "Mermaid Source-backed Batch Rejected",
              "batchManifestPath cannot be combined with source or semanticEvidencePath; each batch item supplies its own paths.",
            )
          }
          const issue = SemanticGuard.check(ctx.sessionID, params.semanticMode)
          if (issue) return blocked("Mermaid Semantic Downgrade Blocked", "", issue, "rendered")
          yield* ctx.ask({
            permission: "render_mermaid_diagram",
            patterns: [params.batchManifestPath],
            always: ["*"],
            metadata: {
              hasRemoteEndpoint: Boolean(params.remoteEndpoint),
              scale: params.scale,
              timeoutMs: params.timeoutMs,
              semanticMode: params.semanticMode,
              batchManifestPath: params.batchManifestPath,
            },
          })
          return yield* runMermaidOperation(
            () =>
              renderSourceBackedMermaidBatch({
                manifestPath: params.batchManifestPath!,
                theme: params.theme,
                background: params.background,
                scale: params.scale,
                timeoutMs: params.timeoutMs,
                semanticSessionId: ctx.sessionID,
              }).then(async (result) => ({
                result,
                ready: active && root ? await Readiness.figures(Instance.directory, root) : undefined,
              })),
            (value) => {
              const result = value.result
              const progress = value.ready?.progress
              const issues = value.ready?.issues.slice(0, 30) ?? []
              return {
                title: result.invalidCount
                  ? "Mermaid Source-backed Batch Invalid"
                  : !result.complete
                    ? "Mermaid Source-backed Batch Needs Readability Repair"
                    : progress && !progress.wordAllowed
                      ? "Mermaid Source-backed Batch Ready - More Design Units Required"
                      : "Mermaid Source-backed Batch Ready",
                metadata: {
                  rendered: result.renderedCount === result.requestedCount,
                  quality: result.invalidCount ? "failed" : result.complete ? "ok" : "warning",
                  semanticStatus: result.invalidCount ? "invalid" : "valid",
                  batchResultPath: result.resultPath,
                  requestedCount: result.requestedCount,
                  processedCount: result.processedCount,
                  renderedCount: result.renderedCount,
                  readyCount: result.readyCount,
                  invalidCount: result.invalidCount,
                  splitRequiredCount: result.splitRequiredCount,
                  complete: result.complete,
                  resolvedSplitDiagramIds: result.resolvedSplitDiagramIds,
                  pendingSplitDiagramIds: result.pendingSplitDiagramIds,
                  pendingSplitDetails: result.pendingSplitDetails,
                  workflowProgress: progress,
                  workflowIssues: issues,
                },
                output: JSON.stringify(
                  {
                    ...result,
                    items: result.items.map((item) => ({
                      ...item,
                      issues: item.issues.slice(0, 20),
                      warnings: item.warnings.slice(0, 10),
                    })),
                    workflowProgress: progress,
                    workflowIssues: issues,
                    nextAction:
                      progress && !progress.wordAllowed
                        ? `Do not create Word. Complete the remaining DesignUnits and slots: ${progress.remainingDesignUnitIds.join(", ")}; ${progress.nextMissingSlots.join(", ")}.`
                        : undefined,
                  },
                  null,
                  2,
                ),
              }
            },
            "Mermaid Source-backed Batch Failed",
            { sourcePath: params.batchManifestPath },
          )
        }
        if (params.source === undefined) {
          return mermaidFailure(
            "Mermaid Diagram Render Failed",
            "source is required when batchManifestPath is omitted.",
          )
        }
        const source = params.source
        const issue = SemanticGuard.check(ctx.sessionID, params.semanticMode)
        if (issue) {
          const sourceHash = createHash("sha256").update(source).digest("hex")
          return blocked("Mermaid Semantic Downgrade Blocked", sourceHash, issue, "rendered")
        }
        yield* ctx.ask({
          permission: "render_mermaid_diagram",
          patterns: [params.title ?? params.sourceFile ?? "mermaid"],
          always: ["*"],
          metadata: {
            hasRemoteEndpoint: Boolean(params.remoteEndpoint),
            scale: params.scale,
            timeoutMs: params.timeoutMs,
            semanticMode: params.semanticMode,
          },
        })
        return yield* runMermaidOperation(
          () =>
            renderMermaidDiagram({
              ...params,
              source,
              remoteEndpoint: params.semanticMode === "source-backed" ? undefined : params.remoteEndpoint,
              semanticSessionId: ctx.sessionID,
            }),
          (result) => {
            const semantic = result.semanticStatus === "valid" || result.semanticStatus === "valid-with-unknowns"
            if (result.rendered && semantic) {
              if (result.documentReady !== false && result.pngPath) {
                SemanticGuard.allow(
                  ctx.sessionID,
                  result.sourceHash,
                  result.pngPath,
                  result.semanticFingerprint,
                  source,
                )
              } else {
                SemanticGuard.hold(ctx.sessionID, result.semanticFingerprint)
              }
            }
            const split = result.wordFitStatus === "split-required"
            const pending = SemanticGuard.pending(ctx.sessionID)
            const details = SemanticGuard.pendingDetails(ctx.sessionID)
            return {
              title: result.rendered
                ? split
                  ? "Mermaid Diagram Rendered - Split Required"
                  : "Mermaid Diagram Rendered"
                : "Mermaid Diagram Render Failed",
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
                quality: split ? "warning" : quality(result),
                warnings: [...result.warnings, ...(result.wordFitReasons ?? [])],
                semanticStatus: result.semanticStatus,
                sourceHash: result.sourceHash,
                claimCount: result.claimCount,
                validatedClaimCount: result.validatedClaimCount,
                semanticDiagnosticsPath: result.semanticDiagnosticsPath,
                wordFitScale: result.wordFitScale,
                wordFitDensity: result.wordFitDensity,
                wordFitAspectRatio: result.wordFitAspectRatio,
                wordFitStatus: result.wordFitStatus,
                wordFitReasons: result.wordFitReasons,
                documentReady: result.documentReady,
                pendingSplitDiagramIds: pending,
                pendingSplitDetails: details,
              },
              output: JSON.stringify(
                {
                  ...result,
                  semanticFingerprint: undefined,
                  semanticIssues: result.semanticIssues.slice(0, 20),
                  pendingSplitDiagramIds: pending,
                  pendingSplitDetails: details,
                },
                null,
                2,
              ),
            }
          },
          "Mermaid Diagram Render Failed",
          { sourcePath: params.sourceFile },
        )
      }).pipe(Effect.orDie),
  }),
)

function blocked(
  title: string,
  sourceHash: string,
  issue: SemanticGuard.Issue,
  field: "valid" | "rendered",
): Tool.ExecuteResult<MermaidMeta> {
  const status = field === "valid" ? { valid: false } : { rendered: false }
  return {
    title,
    metadata: {
      ...status,
      failed: true,
      quality: "failed" as const,
      semanticStatus: "invalid" as const,
      sourceHash,
      issues: [issue],
      warnings: [issue.message],
      error: issue.message,
    },
    output: JSON.stringify(
      {
        ...status,
        semanticStatus: "invalid",
        sourceHash,
        issues: [issue],
      },
      null,
      2,
    ),
  }
}

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
        const active = WorkflowGuard.sourceBacked(ctx.sessionID, ctx.messages)
        const root = active ? WorkflowGuard.root(ctx.sessionID, ctx.messages) : undefined
        const saved =
          active && root && params.pngPath && !params.pngBase64
            ? yield* Effect.promise(() => Readiness.image(Instance.directory, root, params.pngPath!))
            : undefined
        if (active && (!root || !params.pngPath || params.pngBase64 || !saved?.source)) {
          const issue: SemanticGuard.Issue = {
            code: "mermaid-semantic-insert-blocked",
            severity: "error",
            message:
              saved?.issue ??
              "The active source-backed workflow may insert only a persisted, semantically valid PNG from its canonical artifact results. Internal re-rendering and base64 insertion are blocked.",
          }
          return blocked(
            "Mermaid Semantic Insert Blocked",
            createHash("sha256").update(params.source).digest("hex"),
            issue,
            "rendered",
          )
        }
        const source =
          saved?.source ??
          (params.pngPath ? (SemanticGuard.source(ctx.sessionID, params.pngPath) ?? params.source) : params.source)
        const hash = createHash("sha256").update(source).digest("hex")
        if (saved?.hash && params.pngPath) {
          SemanticGuard.allow(ctx.sessionID, saved.hash, params.pngPath, undefined, source)
        }
        const issue = SemanticGuard.insert(ctx.sessionID, hash, params.pngPath, Boolean(params.pngBase64))
        if (issue) {
          return {
            title: "Mermaid Semantic Insert Blocked",
            metadata: {
              inserted: false,
              failed: true,
              quality: "failed" as const,
              semanticStatus: "invalid" as const,
              sourceHash: hash,
              issues: [issue],
              warnings: [issue.message],
              error: issue.message,
            },
            output: JSON.stringify(
              {
                inserted: false,
                semanticStatus: "invalid",
                sourceHash: hash,
                issues: [issue],
              },
              null,
              2,
            ),
          }
        }
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
          () => insertMermaidIntoWord({ ...params, source }),
          (result) => ({
            title: result.inserted ? "Mermaid Inserted Into Word" : "Mermaid Insert Into Word Skipped",
            metadata: {
              inserted: result.inserted,
              wordPath: result.wordPath,
              artifactDir: result.artifactDir,
              manifestPath: result.manifestPath,
              pngPath: result.mermaidPngPath,
              quality: quality(result),
              warnings: result.warnings,
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
