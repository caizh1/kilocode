import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { InvalidRequestError } from "@/server/routes/instance/httpapi/errors"

const ID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64), Schema.isPattern(/^[A-Za-z0-9_-]+$/))
const Result = described(Schema.Unknown, "Patent Radar result")
const AnalysisModel = Schema.Struct({
  providerID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  modelID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
})
const ScanScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("workspace") }),
  Schema.Struct({
    kind: Schema.Literal("module"),
    moduleId: Schema.optional(ID),
    name: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
    corePaths: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(200),
    ),
    expansionPolicy: Schema.Literals(["quality-first", "balanced"]),
  }),
])

export const PatentRadarScanPayload = Schema.Struct({
  cutoffDate: Schema.optional(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
  serverBaseUrl: Schema.optional(Schema.String),
  analysisModel: Schema.optional(AnalysisModel),
  scope: Schema.optional(ScanScope),
  confirmLargeClosure: Schema.optional(Schema.Boolean),
})

const ModulePayload = Schema.Struct({
  id: Schema.optional(ID),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  corePaths: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
  ),
  expansionPolicy: Schema.Literals(["quality-first", "balanced"]),
  autoScan: Schema.optional(Schema.Boolean),
})

export const PatentRadarResearchPayload = Schema.Struct({ serverBaseUrl: Schema.optional(Schema.String), candidateId: Schema.optional(ID) })

export const PatentRadarReviewPayload = Schema.Struct({
  candidateId: ID,
  reviewer: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  decision: Schema.Literals(["worthy", "reject", "needs-arbitration"]),
  note: Schema.String.check(Schema.isMaxLength(4000)),
})

export const PatentRadarReviewImportPayload = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  runId: ID,
  sourceFingerprint: Schema.String,
  methodVersion: Schema.String,
  reviews: Schema.Array(
    Schema.Struct({
      candidateId: ID,
      reviewer: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
      decision: Schema.Literals(["worthy", "reject", "needs-arbitration"]),
      note: Schema.String.check(Schema.isMaxLength(4000)),
    }),
  ),
})

const root = "/patent-radar/runs"
const scopeRoot = "/patent-radar/scopes"
const moduleRoot = "/patent-radar/modules"
const errors = [HttpApiError.BadRequest, InvalidRequestError] as const

export const PatentRadarApi = HttpApi.make("patent-radar")
  .add(
    HttpApiGroup.make("patent-radar")
      .add(
        HttpApiEndpoint.post("scan", root, {
          query: WorkspaceRoutingQuery,
          payload: PatentRadarScanPayload,
          success: Result,
          error: errors,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "patentRadar.scan", summary: "Scan workspace for patent candidates" }),
        ),
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.list", summary: "List Patent Radar runs" })),
        HttpApiEndpoint.post("previewScope", `${scopeRoot}/preview`, {
          query: WorkspaceRoutingQuery,
          payload: ScanScope,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.previewScope", summary: "Preview a Patent Radar scope" })),
        HttpApiEndpoint.get("listModules", moduleRoot, {
          query: WorkspaceRoutingQuery,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.listModules", summary: "List saved Patent Radar modules" })),
        HttpApiEndpoint.post("saveModule", moduleRoot, {
          query: WorkspaceRoutingQuery,
          payload: ModulePayload,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.saveModule", summary: "Save a Patent Radar module" })),
        HttpApiEndpoint.delete("deleteModule", `${moduleRoot}/:moduleID`, {
          params: { moduleID: ID },
          query: WorkspaceRoutingQuery,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.deleteModule", summary: "Delete a Patent Radar module" })),
        HttpApiEndpoint.get("get", `${root}/:runID`, {
          params: { runID: ID },
          query: WorkspaceRoutingQuery,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.get", summary: "Get Patent Radar run" })),
        HttpApiEndpoint.post("evidence", `${root}/:runID/evidence`, {
          params: { runID: ID },
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ evidenceIds: Schema.Array(ID).check(Schema.isMaxLength(200)) }),
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.evidence", summary: "Read Patent Radar evidence by ID" })),
        HttpApiEndpoint.post("cancel", `${root}/:runID/cancel`, {
          params: { runID: ID },
          query: WorkspaceRoutingQuery,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.cancel", summary: "Cancel Patent Radar run" })),
        HttpApiEndpoint.post("resume", `${root}/:runID/resume`, {
          params: { runID: ID },
          query: WorkspaceRoutingQuery,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.resume", summary: "Resume Patent Radar run" })),
        HttpApiEndpoint.post("research", `${root}/:runID/research`, {
          params: { runID: ID },
          query: WorkspaceRoutingQuery,
          payload: PatentRadarResearchPayload,
          success: Result,
          error: errors,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "patentRadar.research", summary: "Research one Patent Radar run" }),
        ),
        HttpApiEndpoint.post("review", `${root}/:runID/reviews`, {
          params: { runID: ID },
          query: WorkspaceRoutingQuery,
          payload: PatentRadarReviewPayload,
          success: Result,
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "patentRadar.review", summary: "Add Patent Radar review" })),
        HttpApiEndpoint.post("importReviews", `${root}/:runID/reviews/import`, {
          params: { runID: ID },
          query: WorkspaceRoutingQuery,
          payload: PatentRadarReviewImportPayload,
          success: Result,
          error: errors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "patentRadar.importReviews",
            summary: "Import blind Patent Radar reviews",
          }),
        ),
        HttpApiEndpoint.post("export", `${root}/:runID/export`, {
          params: { runID: ID },
          query: WorkspaceRoutingQuery,
          success: Result,
          error: errors,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "patentRadar.export", summary: "Export Patent Radar evidence package" }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "patent-radar", description: "本地源码与设计文档专利候选预检。" }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({ title: "chipmate HttpApi", version: "0.0.1" }))
