import { describe, expect, test } from "bun:test"
import { Result, Schema as EffectSchema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { AgentBuilderPaths } from "../../../src/chipmate/server/httpapi/groups/agent-builder"
import { BackgroundProcessPaths } from "../../../src/chipmate/server/httpapi/groups/background-process"
import { BranchNamePaths } from "../../../src/chipmate/server/httpapi/groups/branch-name"
import { ConfigConsolePaths } from "../../../src/chipmate/server/httpapi/groups/config-console"
import { IndexingPaths, ChipMateEmbeddingModel } from "../../../src/chipmate/server/httpapi/groups/indexing"
import { ChipMateGatewayPaths } from "../../../src/chipmate/server/httpapi/groups/chipmate-gateway"
import { ChipMatePaths } from "../../../src/chipmate/server/httpapi/groups/chipmate"
import { MemoryPaths } from "../../../src/chipmate/server/httpapi/groups/memory"
import { NetworkPaths } from "../../../src/chipmate/server/httpapi/groups/network"
import { TelemetryPaths } from "../../../src/chipmate/server/httpapi/groups/telemetry"
import { ExperimentalPaths } from "../../../src/server/routes/instance/httpapi/groups/experimental"
import { SessionPaths } from "../../../src/server/routes/instance/httpapi/groups/session"
import { PublicApi } from "../../../src/server/routes/instance/httpapi/public"

type Schema = {
  anyOf?: Schema[]
  items?: Schema
  properties?: Record<string, Schema>
  type?: string
  enum?: string[]
  minLength?: number
  maxLength?: number
  pattern?: string
}

type Parameter = {
  in?: string
  name?: string
  schema?: Schema
}

type Method = "get" | "post" | "patch" | "put"

type Body = {
  content?: Record<string, { schema?: Schema }>
}

describe("ChipMate PublicApi OpenAPI contract", () => {
  test("uses ChipMate branding", () => {
    const spec = OpenApi.fromApi(PublicApi)
    expect(spec.info.title).toBe("chipmate")
    expect(spec.info.description).toBe("chipmate api")
  })

  test("includes legacy ChipMate events in the generated SDK contract", () => {
    const spec = JSON.stringify(OpenApi.fromApi(PublicApi))
    for (const type of [
      "suggestion.shown",
      "session.network.asked",
      "background_process.updated",
      "interactive_terminal.updated",
      "indexing.status",
    ]) {
      expect(spec).toContain(type)
    }
  })

  test("constrains embedding model metadata", () => {
    const accepts = (dimension: number, scoreThreshold: number) =>
      Result.isSuccess(
        EffectSchema.decodeUnknownResult(ChipMateEmbeddingModel)({
          id: "provider/model",
          name: "Model",
          dimension,
          scoreThreshold,
        }),
      )

    expect(accepts(1, 0)).toBe(true)
    expect(accepts(1024, 1)).toBe(true)
    expect(accepts(0, 0.5)).toBe(false)
    expect(accepts(1.5, 0.5)).toBe(false)
    expect(accepts(1024, -0.1)).toBe(false)
    expect(accepts(1024, 1.1)).toBe(false)
  })

  test("constrains agent builder route ids", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const save = AgentBuilderPaths.save.replace(":id", "{id}")
    const params = spec.paths[save]?.put?.parameters as Parameter[] | undefined
    const schema = params?.find((param) => param.name === "id")?.schema

    expect(schema).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
    })
  })

  test("keeps workspace routing queries on background process routes", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const routes = [
      { method: "get", path: BackgroundProcessPaths.list },
      { method: "get", path: BackgroundProcessPaths.get },
      { method: "get", path: BackgroundProcessPaths.logs },
      { method: "post", path: BackgroundProcessPaths.stop },
      { method: "post", path: BackgroundProcessPaths.restart },
      { method: "post", path: BackgroundProcessPaths.stopSession },
    ] satisfies Array<{ method: Method; path: string }>

    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
      const params = spec.paths[path]?.[route.method]?.parameters as Parameter[] | undefined
      const query = params?.filter((param) => param.in === "query").map((param) => param.name)
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toEqual(["directory", "workspace"])
    }
  })

  test("keeps directory routing queries on ChipMate Console routes", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const routes = [
      { method: "get", path: ExperimentalPaths.worktreeDiff },
      { method: "get", path: ExperimentalPaths.worktreeDiffSummary },
      { method: "get", path: ExperimentalPaths.worktreeDiffFile },
      { method: "post", path: SessionPaths.viewed },
      { method: "get", path: ConfigConsolePaths.overlay },
      { method: "patch", path: ConfigConsolePaths.overlay },
      { method: "get", path: IndexingPaths.status },
      { method: "get", path: IndexingPaths.documentDiagnostics },
      { method: "get", path: IndexingPaths.models },
    ] satisfies Array<{ method: Method; path: string }>

    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
      const params = spec.paths[path]?.[route.method]?.parameters as Parameter[] | undefined
      const query = params?.filter((param) => param.in === "query").map((param) => param.name)
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toContain("directory")
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toContain("workspace")
    }
  })

  test("keeps workspace routing queries on all ChipMate-owned routed endpoints", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const routes = [
      { method: "post", path: AgentBuilderPaths.preview },
      { method: "put", path: AgentBuilderPaths.save },
      { method: "post", path: "/commit-message" },
      { method: "post", path: "/enhance-prompt" },
      { method: "get", path: NetworkPaths.list },
      { method: "post", path: NetworkPaths.reply },
      { method: "post", path: NetworkPaths.reject },
      { method: "post", path: TelemetryPaths.capture },
      { method: "post", path: TelemetryPaths.setEnabled },
      { method: "get", path: ConfigConsolePaths.sources },
      { method: "get", path: ConfigConsolePaths.effective },
      { method: "get", path: ConfigConsolePaths.rules },
      { method: "put", path: ConfigConsolePaths.rules },
      { method: "get", path: ConfigConsolePaths.modelState },
      { method: "patch", path: ConfigConsolePaths.modelState },
      { method: "get", path: ConfigConsolePaths.tuiConfig },
      { method: "get", path: ConfigConsolePaths.tuiKeybinds },
      { method: "patch", path: ConfigConsolePaths.tuiConfig },
      { method: "get", path: ChipMatePaths.sessionModelUsage },
      { method: "post", path: BranchNamePaths.generate },
      { method: "get", path: MemoryPaths.status },
      { method: "get", path: MemoryPaths.show },
      { method: "post", path: MemoryPaths.enable },
      { method: "post", path: MemoryPaths.disable },
      { method: "post", path: MemoryPaths.configure },
      { method: "post", path: MemoryPaths.rebuild },
      { method: "post", path: MemoryPaths.remember },
      { method: "post", path: MemoryPaths.correct },
      { method: "post", path: MemoryPaths.forget },
      { method: "post", path: MemoryPaths.purge },
    ] satisfies Array<{ method: Method; path: string }>

    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
      const params = spec.paths[path]?.[route.method]?.parameters as Parameter[] | undefined
      const query = params?.filter((param) => param.in === "query").map((param) => param.name)
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toContain("directory")
      expect(query, `${route.method.toUpperCase()} ${route.path}`).toContain("workspace")
    }
  })

  test("keeps personal organization resets nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const body = spec.paths[ChipMateGatewayPaths.organization]?.post?.requestBody as Body | undefined
    const schema = body?.content?.["application/json"]?.schema
    const props = schema?.properties
    expect(props?.organizationId).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
  })

  test("keeps branch-name responses nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const path = BranchNamePaths.generate.replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    const body = spec.paths[path]?.post?.responses?.["200"] as Body | undefined
    const branch = body?.content?.["application/json"]?.schema?.properties?.branch

    expect(branch).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
  })

  test("keeps ChipMate gateway responses nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const response = (path: string) => {
      const body = spec.paths[path]?.get?.responses?.["200"] as Body | undefined
      return body?.content?.["application/json"]?.schema
    }

    const profile = response(ChipMateGatewayPaths.profile)?.properties
    expect(profile?.balance).toEqual({ anyOf: [expect.objectContaining({ type: "object" }), { type: "null" }] })
    expect(profile?.chipmatePass).toEqual({ anyOf: [expect.objectContaining({ type: "object" }), { type: "null" }] })
    expect(profile?.profile?.properties?.selectedOrganizationId).toEqual({ type: "string" })
    expect(profile?.profile?.properties?.hasPersonalAccount).toEqual({ type: "boolean" })
    const pass = profile?.chipmatePass?.anyOf?.find((item) => item.type === "object")?.properties
    expect(pass?.nextBillingAt).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
    expect(profile?.currentOrgId).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })

    const auth = response(ChipMateGatewayPaths.authStatus)?.properties
    expect(auth).toEqual({
      authenticated: { type: "boolean" },
      type: { type: "string", enum: ["api", "oauth"] },
    })

    const sessions = response(ChipMateGatewayPaths.cloudSessions)?.properties
    expect(sessions?.cliSessions?.items?.properties?.title).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    })
    expect(sessions?.nextCursor).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })

    const claw = response(ChipMateGatewayPaths.clawStatus)?.properties
    expect(claw?.status).toEqual({ anyOf: [expect.objectContaining({ type: "string" }), { type: "null" }] })
    for (const field of ["openclawVersion", "lastStartedAt", "lastStoppedAt", "botName"]) {
      expect(claw?.[field]).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
    }

    expect(response(ChipMateGatewayPaths.clawChatCredentials)).toEqual({
      anyOf: [expect.objectContaining({ type: "object" }), { type: "null" }],
    })
  })

  test("keeps transcription prompts in the public contract", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const body = spec.paths[ChipMateGatewayPaths.audioTranscriptions]?.post?.requestBody as Body | undefined
    const schema = body?.content?.["application/json"]?.schema
    expect(schema?.properties?.prompt).toEqual({ type: "string" })
  })

  test("documents the transcription model catalog route", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const route = spec.paths[ChipMateGatewayPaths.transcriptionModels]?.get
    const query = (route?.parameters as Parameter[] | undefined)?.map((item) => item.name)

    expect(query).toEqual(["directory", "workspace"])
    expect(route?.responses?.["200"]?.content?.["application/json"]?.schema).toMatchObject({ type: "array" })
  })
})
