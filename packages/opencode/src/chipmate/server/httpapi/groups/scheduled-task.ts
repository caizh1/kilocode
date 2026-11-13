import "@/chipmate/scheduler/events"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "@/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
} from "@/server/routes/instance/httpapi/middleware/workspace-routing"
import { Command, Response } from "@/chipmate/scheduler/schema"

const endpoint = <const ID extends string, P extends Schema.Top>(id: ID, path: `/${string}`, payload: P) =>
  HttpApiEndpoint.post(id, path, {
    query: WorkspaceRoutingQuery,
    payload,
    success: Response,
  }).annotateMerge(OpenApi.annotations({ identifier: `scheduledTask.${id}`, summary: "管理当前项目的定时任务" }))

export const ScheduledTaskApi = HttpApi.make("scheduled-task").add(
  HttpApiGroup.make("scheduled-task")
    .add(
      endpoint(
        "register",
        "/scheduled-task/register",
        Schema.Struct({ clientID: Schema.String, profile: Schema.String, active: Schema.Boolean }),
      ),
      endpoint("tick", "/scheduled-task/tick", Schema.Struct({ clientID: Schema.String })),
      endpoint("command", "/scheduled-task/command", Schema.Struct({ clientID: Schema.String, command: Command })),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
