import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { Artifact, CreateJobInput, DesignDocJob, RetryWorkItemInput } from "@/kilocode/design-doc/domain"
import "@/kilocode/design-doc/event"

const ID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128), Schema.isPattern(/^[A-Za-z0-9._-]+$/))

export class DesignDocBadRequestError extends Schema.ErrorClass<DesignDocBadRequestError>("DesignDocBadRequestError")(
  { code: Schema.String, message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class DesignDocNotFoundError extends Schema.ErrorClass<DesignDocNotFoundError>("DesignDocNotFoundError")(
  { code: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class DesignDocConflictError extends Schema.ErrorClass<DesignDocConflictError>("DesignDocConflictError")(
  { code: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

export const ArtifactContent = Schema.Struct({
  artifact: Artifact,
  encoding: Schema.Literals(["utf8", "base64"]),
  content: Schema.String,
}).annotate({ identifier: "DesignDocArtifactContent" })

const root = "/design-doc/jobs"
export const DesignDocPaths = {
  create: root,
  list: root,
  get: `${root}/:jobID`,
  artifacts: `${root}/:jobID/artifacts`,
  artifact: `${root}/:jobID/artifacts/:artifactID`,
  pause: `${root}/:jobID/pause`,
  resume: `${root}/:jobID/resume`,
  cancel: `${root}/:jobID/cancel`,
  retry: `${root}/:jobID/work-items/:workItemID/retry`,
} as const

const errors = [DesignDocBadRequestError, DesignDocNotFoundError, DesignDocConflictError] as const
const AcceptedJob = HttpApiSchema.status(202)(DesignDocJob)

export const DesignDocApi = HttpApi.make("design-doc")
  .add(
    HttpApiGroup.make("design-doc")
      .add(
        HttpApiEndpoint.post("create", DesignDocPaths.create, {
          query: WorkspaceRoutingQuery,
          payload: CreateJobInput,
          success: described(AcceptedJob, "Created DesignDoc Job"),
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "designDoc.create", summary: "Create DesignDoc Job" })),
        HttpApiEndpoint.get("list", DesignDocPaths.list, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(DesignDocJob), "DesignDoc Jobs"),
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "designDoc.list", summary: "List DesignDoc Jobs" })),
        HttpApiEndpoint.get("get", DesignDocPaths.get, {
          params: { jobID: ID },
          query: WorkspaceRoutingQuery,
          success: described(DesignDocJob, "DesignDoc Job"),
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "designDoc.get", summary: "Get DesignDoc Job" })),
        HttpApiEndpoint.get("artifacts", DesignDocPaths.artifacts, {
          params: { jobID: ID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Artifact), "DesignDoc artifacts"),
          error: errors,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "designDoc.artifacts", summary: "List DesignDoc artifacts" }),
        ),
        HttpApiEndpoint.get("artifact", DesignDocPaths.artifact, {
          params: { jobID: ID, artifactID: ID },
          query: WorkspaceRoutingQuery,
          success: described(ArtifactContent, "DesignDoc artifact content"),
          error: errors,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "designDoc.artifact", summary: "Read a DesignDoc artifact" }),
        ),
      )
      .add(
        HttpApiEndpoint.post("pause", DesignDocPaths.pause, {
          params: { jobID: ID },
          query: WorkspaceRoutingQuery,
          success: described(DesignDocJob, "Paused DesignDoc Job"),
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "designDoc.pause", summary: "Pause DesignDoc Job" })),
        HttpApiEndpoint.post("resume", DesignDocPaths.resume, {
          params: { jobID: ID },
          query: WorkspaceRoutingQuery,
          success: described(AcceptedJob, "Resumed DesignDoc Job"),
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "designDoc.resume", summary: "Resume DesignDoc Job" })),
        HttpApiEndpoint.post("cancel", DesignDocPaths.cancel, {
          params: { jobID: ID },
          query: WorkspaceRoutingQuery,
          success: described(DesignDocJob, "Cancelled DesignDoc Job"),
          error: errors,
        }).annotateMerge(OpenApi.annotations({ identifier: "designDoc.cancel", summary: "Cancel DesignDoc Job" })),
        HttpApiEndpoint.post("retry", DesignDocPaths.retry, {
          params: { jobID: ID, workItemID: ID },
          query: WorkspaceRoutingQuery,
          payload: RetryWorkItemInput,
          success: described(AcceptedJob, "Retried DesignDoc Job"),
          error: errors,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "designDoc.retry", summary: "Retry one DesignDoc WorkItem" }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({ title: "design-doc", description: "Source-backed atomic DesignDoc Job routes." }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({ title: "kilo HttpApi", version: "0.0.1", description: "Kilo HttpApi surface." }))
