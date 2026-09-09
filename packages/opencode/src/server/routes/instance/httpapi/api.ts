import { TurnChangesApi } from "@/chipmate/server/httpapi/groups/turn-changes" // chipmate_change
import { Schema } from "effect"
import { HttpApi } from "effect/unstable/httpapi"
import { EventV2 } from "@opencode-ai/core/event"
import { EventManifest } from "@/event-manifest"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { SkillV2 } from "@opencode-ai/core/skill"
import { InstanceDisposed } from "@/server/event"
import { Question } from "@/question"
import { BusEvent } from "@/bus/bus-event" // chipmate_change - include legacy ChipMate events until they migrate to EventV2
import { ConfigApi } from "./groups/config"
import { ControlApi } from "./groups/control"
import { ControlPlaneApi } from "./groups/control-plane"
import { EventApi } from "./groups/event"
import { ExperimentalApi } from "./groups/experimental"
import { FileApi } from "./groups/file"
import { InstanceApi } from "./groups/instance"
import { McpApi } from "./groups/mcp"
import { PermissionApi } from "./groups/permission"
import { ProjectApi } from "./groups/project"
import { ProjectCopyApi } from "./groups/project-copy"
import { ProviderApi } from "./groups/provider"
import { PtyApi, PtyConnectApi } from "./groups/pty"
import { QuestionApi } from "./groups/question"
import { SessionApi } from "./groups/session"
import { SyncApi } from "./groups/sync"
import { TuiApi } from "./groups/tui"
import { WorkspaceApi } from "./groups/workspace"
// chipmate_change start - ChipMate HttpApi groups
import { AgentBuilderApi } from "@/chipmate/server/httpapi/groups/agent-builder"
import { BranchNameApi } from "@/chipmate/server/httpapi/groups/branch-name"
import { CommitMessageApi } from "@/chipmate/server/httpapi/groups/commit-message"
import { BackgroundProcessApi } from "@/chipmate/server/httpapi/groups/background-process"
import { ConfigConsoleApi } from "@/chipmate/server/httpapi/groups/config-console"
import { DesignDocApi } from "@/chipmate/server/httpapi/groups/design-doc"
import { EnhancePromptApi } from "@/chipmate/server/httpapi/groups/enhance-prompt"
import { IndexingApi } from "@/chipmate/server/httpapi/groups/indexing"
import { InstanceReloadApi } from "@/chipmate/server/httpapi/groups/instance-reload"
import { InteractiveTerminalApi } from "@/chipmate/server/httpapi/groups/interactive-terminal"
import { ChipMateGatewayApi } from "@/chipmate/server/httpapi/groups/chipmate-gateway"
import { ChipMateApi } from "@/chipmate/server/httpapi/groups/chipmate"
import { NetworkApi } from "@/chipmate/server/httpapi/groups/network"
import { PatentRadarApi } from "@/chipmate/server/httpapi/groups/patent-radar"
import { RemoteApi } from "@/chipmate/server/httpapi/groups/remote"
import { SandboxApi } from "@/chipmate/server/httpapi/groups/sandbox"
import { SessionImportApi } from "@/chipmate/server/httpapi/groups/session-import"
import { SuggestionApi } from "@/chipmate/server/httpapi/groups/suggestion"
import { TelemetryApi } from "@/chipmate/server/httpapi/groups/telemetry"
import { MemoryApi } from "@/chipmate/server/httpapi/groups/memory" // chipmate_change
// chipmate_change end
import { makeApi } from "@opencode-ai/protocol/api"
import { LocationMiddleware } from "@opencode-ai/server/location"
import { SessionLocationMiddleware } from "@opencode-ai/server/middleware/session-location"
import { GlobalApi } from "./groups/global"
import { Authorization } from "./middleware/authorization"
import { SchemaErrorMiddleware } from "./middleware/schema-error"

const EventSchema = Schema.Union([
  ...EventManifest.Latest.values()
    .map((definition) =>
      Schema.Struct({
        id: EventV2.ID,
        type: Schema.Literal(definition.type),
        properties: definition.data,
      }).annotate({ identifier: `Event.${definition.type}` }),
    )
    .toArray(),
  ...BusEvent.effectPayloads(), // chipmate_change - include legacy ChipMate events until they migrate to EventV2
  InstanceDisposed,
]).annotate({ identifier: "Event" })

export const ServerApi = makeApi({
  definitions: EventManifest.Latest.values().toArray(),
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

export const RootHttpApi = HttpApi.make("opencode-root")
  .addHttpApi(ControlApi)
  .addHttpApi(ControlPlaneApi)
  .addHttpApi(GlobalApi)
  .middleware(SchemaErrorMiddleware)
  .middleware(Authorization)

export const InstanceHttpApi = HttpApi.make("opencode-instance")
  .addHttpApi(ConfigApi)
  .addHttpApi(ExperimentalApi)
  .addHttpApi(FileApi)
  .addHttpApi(InstanceApi)
  .addHttpApi(McpApi)
  .addHttpApi(ProjectApi)
  .addHttpApi(ProjectCopyApi)
  .addHttpApi(PtyApi)
  .addHttpApi(QuestionApi)
  .addHttpApi(PermissionApi)
  .addHttpApi(ProviderApi)
  .addHttpApi(SessionApi)
  .addHttpApi(SyncApi)
  .addHttpApi(TuiApi)
  .addHttpApi(WorkspaceApi)
  // chipmate_change start - ChipMate HttpApi groups
  .addHttpApi(AgentBuilderApi)
  .addHttpApi(BackgroundProcessApi)
  .addHttpApi(BranchNameApi)
  .addHttpApi(TurnChangesApi)
  .addHttpApi(CommitMessageApi)
  .addHttpApi(ConfigConsoleApi)
  .addHttpApi(DesignDocApi)
  .addHttpApi(EnhancePromptApi)
  .addHttpApi(IndexingApi)
  .addHttpApi(InstanceReloadApi)
  .addHttpApi(InteractiveTerminalApi)
  .addHttpApi(ChipMateGatewayApi)
  .addHttpApi(ChipMateApi)
  .addHttpApi(NetworkApi)
  .addHttpApi(PatentRadarApi)
  .addHttpApi(RemoteApi)
  .addHttpApi(SandboxApi)
  .addHttpApi(SessionImportApi)
  .addHttpApi(SuggestionApi)
  .addHttpApi(TelemetryApi)
  .addHttpApi(MemoryApi)
  // chipmate_change end
  .middleware(SchemaErrorMiddleware)

export const OpenCodeHttpApi = HttpApi.make("opencode")
  .addHttpApi(RootHttpApi)
  .addHttpApi(EventApi)
  .addHttpApi(InstanceHttpApi)
  .addHttpApi(ServerApi)
  .addHttpApi(PtyConnectApi)
  .annotate(HttpApi.AdditionalSchemas, [
    EventSchema,
    Question.Replied,
    Question.Rejected,
    Credential.Value,
    Integration.Inputs,
    Integration.Method,
    Integration.Ref,
    SkillV2.Source,
  ])

export type RootHttpApiType = typeof RootHttpApi
export type InstanceHttpApiType = typeof InstanceHttpApi
