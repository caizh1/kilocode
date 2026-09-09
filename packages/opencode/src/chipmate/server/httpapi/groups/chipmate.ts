import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import { AnacondaDesktopApi } from "./anaconda-desktop"
import { Result as AgentRequirementResult } from "@/chipmate/agent-requirements"
import {
  Failure as AgentManagerFailure,
  Request as AgentManagerRequest,
  RequestID as AgentManagerRequestID,
  Result as AgentManagerResult,
} from "@/chipmate/agent-manager/protocol"
import {
  Failure as NotebookFailure,
  Request as NotebookRequest,
  RequestID as NotebookRequestID,
  Result as NotebookResult,
} from "@/chipmate/notebook/protocol"
import {
  Failure as SkillMarketFailure,
  Request as SkillMarketRequest,
  RequestID as SkillMarketRequestID,
  Result as SkillMarketResult,
} from "@/chipmate/skill-market/protocol"
import { ModelUsage } from "@/chipmate/session/model-usage"
import { SessionID } from "@/session/schema"
import { CommandFiles } from "@/chipmate/command-files"

const root = "/chipmate"

export const SkillScope = Schema.Literals(["project", "global"])

export const HistoryMigrationActive = Schema.Struct({
  directoryID: Schema.String,
  sessions: Schema.Array(Schema.Struct({ sessionID: SessionID, status: Schema.String })),
})
export const HistoryMigrationPrepareResult = Schema.Struct({
  ready: Schema.Boolean,
  token: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  active: Schema.Array(HistoryMigrationActive),
  reason: Schema.NullOr(Schema.Literals(["locked", "active"])),
})
export const HistoryMigrationReleasePayload = Schema.Struct({ token: Schema.String })

export class SessionExportBusyError extends Schema.ErrorClass<SessionExportBusyError>("SessionExportBusyError")(
  {
    sessionIDs: Schema.Array(SessionID),
  },
  { httpApiStatus: 409 },
) {}

export const RemoveSkillPayload = Schema.Struct({
  location: Schema.String,
  scope: Schema.optional(SkillScope),
})

export const RefreshSkillsPayload = Schema.Struct({
  scope: SkillScope,
})

export const RemoveCommandPayload = Schema.Struct({
  location: Schema.String,
})

export const RemoveAgentPayload = Schema.Struct({
  name: Schema.String,
})

export const AgentRequirementQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  agent: Schema.String,
})
export const NotebookReplyPayload = Schema.Struct({ result: NotebookResult })
export const NotebookRejectPayload = Schema.Struct({ error: NotebookFailure })
export const AgentManagerReplyPayload = Schema.Struct({ result: AgentManagerResult })
export const AgentManagerRejectPayload = Schema.Struct({ error: AgentManagerFailure })
export const SkillMarketReplyPayload = Schema.Struct({ result: SkillMarketResult })
export const SkillMarketRejectPayload = Schema.Struct({ error: SkillMarketFailure })

export const ChipMatePaths = {
  heapSnapshot: `${root}/heap/snapshot`,
  agentRequirements: `${root}/agent/requirements`,
  commandFiles: `${root}/command/files`,
  removeCommand: `${root}/command/remove`,
  removeSkill: `${root}/skill/remove`,
  refreshSkills: `${root}/skill/refresh`,
  removeAgent: `${root}/agent/remove`,
  notebookList: `${root}/notebook`,
  notebookReply: `${root}/notebook/:requestID/reply`,
  notebookReject: `${root}/notebook/:requestID/reject`,
  agentManagerList: `${root}/agent-manager`,
  agentManagerReply: `${root}/agent-manager/:requestID/reply`,
  agentManagerReject: `${root}/agent-manager/:requestID/reject`,
  skillMarketList: `${root}/skill-market`,
  skillMarketReply: `${root}/skill-market/:requestID/reply`,
  skillMarketReject: `${root}/skill-market/:requestID/reject`,
  sessionModelUsage: `/session/:sessionID/model-usage`,
  sessionExport: `${root}/session/:sessionID/export`,
  historyMigrationPrepare: `${root}/history-migration/prepare`,
  historyMigrationRelease: `${root}/history-migration/release`,
} as const

export const ChipMateApi = HttpApi.make("chipmate")
  .add(
    HttpApiGroup.make("chipmate")
      .add(
        HttpApiEndpoint.post("heapSnapshot", ChipMatePaths.heapSnapshot, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.String, "Heap snapshot file path"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.heap.snapshot",
            summary: "Write heap snapshot",
            description: "Write a heap snapshot for the CLI process to the log directory.",
          }),
        ),
        HttpApiEndpoint.get("agentRequirements", ChipMatePaths.agentRequirements, {
          query: AgentRequirementQuery,
          success: described(AgentRequirementResult, "Agent requirement status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.agentRequirements",
            summary: "Check agent requirements",
            description: "Check whether the selected agent's requirements are available in the request directory.",
          }),
        ),
        HttpApiEndpoint.get("commandFiles", ChipMatePaths.commandFiles, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(CommandFiles.Info), "Command files"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.commandFiles",
            summary: "List command files",
            description: "List commands with editable file locations for settings clients.",
          }),
        ),
        HttpApiEndpoint.post("removeCommand", ChipMatePaths.removeCommand, {
          query: WorkspaceRoutingQuery,
          payload: RemoveCommandPayload,
          success: described(Schema.Boolean, "Command removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.removeCommand",
            summary: "Remove a command",
            description: "Remove a command by deleting its markdown file from disk and clearing it from cache.",
          }),
        ),
        HttpApiEndpoint.post("removeSkill", ChipMatePaths.removeSkill, {
          query: WorkspaceRoutingQuery,
          payload: RemoveSkillPayload,
          success: described(Schema.Boolean, "Skill removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.removeSkill",
            summary: "Remove a skill",
            description: "Remove a discovered user skill directory from disk and refresh the Skill cache.",
          }),
        ),
        HttpApiEndpoint.post("refreshSkills", ChipMatePaths.refreshSkills, {
          query: WorkspaceRoutingQuery,
          payload: RefreshSkillsPayload,
          success: described(Schema.Boolean, "Skill cache refreshed"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.refreshSkills",
            summary: "Refresh skills",
            description: "Refresh Skill discovery and state without disposing active workspace sessions.",
          }),
        ),
        HttpApiEndpoint.post("removeAgent", ChipMatePaths.removeAgent, {
          query: WorkspaceRoutingQuery,
          payload: RemoveAgentPayload,
          success: described(Schema.Boolean, "Agent removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.removeAgent",
            summary: "Remove a custom agent",
            description:
              "Remove a custom (non-native) agent by deleting its markdown file from disk and refreshing state.",
          }),
        ),
        HttpApiEndpoint.get("notebookList", ChipMatePaths.notebookList, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(NotebookRequest), "Pending notebook host requests"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.notebook.list",
            summary: "List pending notebook requests",
            description: "List pending native notebook requests for the routed workspace.",
          }),
        ),
        HttpApiEndpoint.post("notebookReply", ChipMatePaths.notebookReply, {
          params: { requestID: NotebookRequestID },
          query: WorkspaceRoutingQuery,
          payload: NotebookReplyPayload,
          success: described(Schema.Boolean, "Notebook reply accepted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.notebook.reply",
            summary: "Reply to a notebook request",
            description: "Complete a pending native notebook request with a structured result.",
          }),
        ),
        HttpApiEndpoint.post("notebookReject", ChipMatePaths.notebookReject, {
          params: { requestID: NotebookRequestID },
          query: WorkspaceRoutingQuery,
          payload: NotebookRejectPayload,
          success: described(Schema.Boolean, "Notebook rejection accepted"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.notebook.reject",
            summary: "Reject a notebook request",
            description: "Complete a pending native notebook request with a structured host error.",
          }),
        ),
        HttpApiEndpoint.get("agentManagerList", ChipMatePaths.agentManagerList, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(AgentManagerRequest), "Pending Agent Manager host requests"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.agentManager.list",
            summary: "List pending Agent Manager requests",
            description: "List pending native Agent Manager orchestration requests for the routed workspace.",
          }),
        ),
        HttpApiEndpoint.post("agentManagerReply", ChipMatePaths.agentManagerReply, {
          params: { requestID: AgentManagerRequestID },
          query: WorkspaceRoutingQuery,
          payload: AgentManagerReplyPayload,
          success: described(Schema.Boolean, "Agent Manager reply accepted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.agentManager.reply",
            summary: "Reply to an Agent Manager request",
            description: "Complete a pending Agent Manager orchestration request with a structured result.",
          }),
        ),
        HttpApiEndpoint.post("agentManagerReject", ChipMatePaths.agentManagerReject, {
          params: { requestID: AgentManagerRequestID },
          query: WorkspaceRoutingQuery,
          payload: AgentManagerRejectPayload,
          success: described(Schema.Boolean, "Agent Manager rejection accepted"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.agentManager.reject",
            summary: "Reject an Agent Manager request",
            description: "Complete a pending Agent Manager orchestration request with a structured host error.",
          }),
        ),
        HttpApiEndpoint.get("skillMarketList", ChipMatePaths.skillMarketList, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(SkillMarketRequest), "Pending Skill Market host requests"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.skillMarket.list",
            summary: "List pending Skill Market requests",
            description: "List pending Skill Market host requests for the routed workspace.",
          }),
        ),
        HttpApiEndpoint.post("skillMarketReply", ChipMatePaths.skillMarketReply, {
          params: { requestID: SkillMarketRequestID },
          query: WorkspaceRoutingQuery,
          payload: SkillMarketReplyPayload,
          success: described(Schema.Boolean, "Skill Market reply accepted"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.skillMarket.reply",
            summary: "Reply to a Skill Market request",
            description: "Complete a pending Skill Market host request with a structured result.",
          }),
        ),
        HttpApiEndpoint.post("skillMarketReject", ChipMatePaths.skillMarketReject, {
          params: { requestID: SkillMarketRequestID },
          query: WorkspaceRoutingQuery,
          payload: SkillMarketRejectPayload,
          success: described(Schema.Boolean, "Skill Market rejection accepted"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.skillMarket.reject",
            summary: "Reject a Skill Market request",
            description: "Complete a pending Skill Market host request with a structured host error.",
          }),
        ),
        HttpApiEndpoint.get("sessionModelUsage", ChipMatePaths.sessionModelUsage, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(ModelUsage.Info, "Model usage for a session tree"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.sessionModelUsage",
            summary: "Get session model usage",
            description: "Get token usage and direct cost by model for the complete top-level session tree.",
          }),
        ),
        HttpApiEndpoint.get("sessionExport", ChipMatePaths.sessionExport, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(
            Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/markdown; charset=utf-8" })),
            "Complete raw ChipMate QA session transcript",
          ),
          error: [HttpApiError.NotFound, SessionExportBusyError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.sessionExport",
            summary: "Export a raw QA session tree",
            description:
              "Export the routed local ChipMate QA root session and all descendants from a stable raw database snapshot.",
          }),
        ),
        HttpApiEndpoint.post("historyMigrationPrepare", ChipMatePaths.historyMigrationPrepare, {
          query: WorkspaceRoutingQuery,
          success: described(HistoryMigrationPrepareResult, "History migration maintenance gate status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.historyMigration.prepare",
            summary: "Prepare local chat history migration",
            description: "Acquire a short-lived maintenance gate only when all loaded workspaces are idle.",
          }),
        ),
        HttpApiEndpoint.post("historyMigrationRelease", ChipMatePaths.historyMigrationRelease, {
          query: WorkspaceRoutingQuery,
          payload: HistoryMigrationReleasePayload,
          success: described(Schema.Boolean, "Maintenance gate released"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chipmate.historyMigration.release",
            summary: "Release local chat history migration gate",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "chipmate",
          description: "ChipMate-specific routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .addHttpApi(AnacondaDesktopApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "chipmate HttpApi",
      version: "0.0.1",
      description: "ChipMate HttpApi surface.",
    }),
  )
