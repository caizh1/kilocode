import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { SessionID, MessageID } from "@/session/schema"
import { Mutation, Result } from "@/chipmate/turn-changes/schema"

const params = { sessionID: SessionID, messageID: MessageID }
const route = "/session/:sessionID/turn-changes/:messageID"
const annotate = (identifier: string, summary: string) =>
  OpenApi.annotations({ identifier: `turnChanges.${identifier}`, summary })
export const TurnChangesApi = HttpApi.make("turn-changes").add(
  HttpApiGroup.make("turn-changes")
    .add(
      HttpApiEndpoint.get("get", route, { params, query: WorkspaceRoutingQuery, success: Result }).annotateMerge(
        annotate("get", "读取本轮修改清单"),
      ),
      HttpApiEndpoint.get("detail", `${route}/file/:fileID`, {
        params: { ...params, fileID: Schema.String },
        query: WorkspaceRoutingQuery,
        success: Result,
      }).annotateMerge(annotate("detail", "审阅本轮文件和差异块")),
      HttpApiEndpoint.post("mutate", route, {
        params,
        query: WorkspaceRoutingQuery,
        payload: Mutation,
        success: Result,
      }).annotateMerge(annotate("mutate", "撤销或恢复本轮修改")),
      HttpApiEndpoint.post("external", "/turn-changes/external", {
        query: WorkspaceRoutingQuery,
        payload: Schema.Struct({ file: Schema.String }),
        success: Result,
      }).annotateMerge(annotate("external", "记录执行期间的人工编辑")),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
