import { NodeHttpServer } from "@effect/platform-node"
import { Database } from "@opencode-ai/core/database/database"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../../src/auth"
import { KiloGatewayApi, KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { kiloGatewayHandlers } from "../../../src/kilocode/server/httpapi/handlers/kilo-gateway"
import { InstanceStore } from "../../../src/project/instance-store"
import { ModelCache } from "../../../src/provider/model-cache"
import { Provider } from "../../../src/provider/provider"
import { Session } from "../../../src/session/session"
import { Storage } from "../../../src/storage/storage"
import { Authorization } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "../../../src/server/routes/instance/httpapi/middleware/instance-context"
import { schemaErrorLayer } from "../../../src/server/routes/instance/httpapi/middleware/schema-error"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "../../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { testEffect } from "../../lib/effect"

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(KiloGatewayApi)
const auth = Layer.mock(Auth.Service)({
  get: (id) => Effect.succeed(id === "no-auth" ? undefined : new Auth.Api({ type: "api", key: "test-token" })),
})
const store = Layer.mock(InstanceStore.Service)({})
const cache = Layer.mock(ModelCache.Service)({})
const providers = Layer.mock(Provider.Service)({
  list: () =>
    Effect.succeed({
      qwen: {
        id: "qwen",
        options: {
          baseURL: "https://options.test/v1/",
          headers: { "X-Layer": "provider", "X-Provider-Option": "configured" },
        },
        models: {
          "qwen-coder-30b0": {
            id: "qwen-coder-30b0",
            api: {
              id: "qwen-coder-30b0",
              npm: "@ai-sdk/openai-compatible",
              url: "https://ignored.test/v1",
            },
            headers: { "X-Layer": "model", "X-Provider": "configured" },
          },
        },
      },
      "qwen-model-url": {
        id: "qwen-model-url",
        options: {},
        models: {
          "qwen-coder-30b0": {
            id: "qwen-coder-30b0",
            api: {
              id: "qwen-coder-30b0",
              npm: "@ai-sdk/openai-compatible",
              url: "https://model.test/v1/completions/",
            },
            headers: {},
          },
        },
      },
      "qwen-header-auth": {
        id: "qwen-header-auth",
        options: {
          baseURL: "https://header.test/v1",
          headers: { authorization: "Custom token" },
        },
        models: {
          "qwen-coder-30b0": {
            id: "qwen-coder-30b0",
            api: {
              id: "qwen-coder-30b0",
              npm: "@ai-sdk/openai-compatible",
              url: "",
            },
            headers: {},
          },
        },
      },
      "no-auth": {
        id: "no-auth",
        options: { baseURL: "https://no-auth.test/v1" },
        models: {
          "qwen-coder-30b0": {
            id: "qwen-coder-30b0",
            api: { id: "qwen-coder-30b0", npm: "@ai-sdk/openai-compatible", url: "" },
            headers: {},
          },
        },
      },
      "wrong-type": {
        id: "wrong-type",
        options: { baseURL: "https://wrong.test/v1" },
        models: {
          "qwen-coder-30b0": {
            id: "qwen-coder-30b0",
            api: { id: "qwen-coder-30b0", npm: "@ai-sdk/anthropic", url: "" },
            headers: {},
          },
        },
      },
      "missing-url": {
        id: "missing-url",
        options: {},
        models: {
          "qwen-coder-30b0": {
            id: "qwen-coder-30b0",
            api: { id: "qwen-coder-30b0", npm: "@ai-sdk/openai-compatible", url: "" },
            headers: {},
          },
        },
      },
    } as never),
})
const session = Layer.mock(Session.Service)({})
const storage = Layer.mock(Storage.Service)({})
const passthroughAuthorization = Layer.succeed(
  Authorization,
  Authorization.of((effect) => effect),
)
const passthroughInstanceContext = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) => effect),
)
const testWorkspaceRouting = Layer.succeed(
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingMiddleware.of((effect) =>
    effect.pipe(Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory: process.cwd() }))),
  ),
)
const layer = HttpRouter.serve(
  HttpApiBuilder.layer(TestHttpApi).pipe(
    Layer.provide(kiloGatewayHandlers),
    Layer.provide(schemaErrorLayer),
    Layer.provide([
      passthroughAuthorization,
      passthroughInstanceContext,
      testWorkspaceRouting,
      auth,
      store,
      cache,
      providers,
      session,
      EventV2Bridge.defaultLayer,
    ]),
    Layer.provide(Database.defaultLayer),
    Layer.provide(storage),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
const it = testEffect(layer)

function stub(run: (input?: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  // These tests run sequentially; scope the process-global override and delegate in-process server traffic.
  const original = globalThis.fetch
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (url.startsWith("http://127.0.0.1:") && headers.get("authorization") !== "Bearer test-token") {
        return original(input, init)
      }
      return run(input, init)
    },
    { preconnect: original.preconnect },
  )
  return Effect.acquireRelease(
    Effect.sync(() => {
      globalThis.fetch = fetch
    }),
    () =>
      Effect.sync(() => {
        globalThis.fetch = original
      }),
  )
}

function post(path: string, body: Record<string, unknown>) {
  return HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))
}

describe("Kilo gateway HttpApi statuses", () => {
  it.live("proxies configured Qwen FIM through the provider auth store", () =>
    Effect.gen(function* () {
      let body: Record<string, unknown> | undefined
      let headers: Headers | undefined
      let url: string | undefined
      yield* stub((input, init) => {
        url = String(input)
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        headers = new Headers(init?.headers)
        return new Response(JSON.stringify({ choices: [{ text: "return ok;" }] }))
      })

      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "qwen",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
        stop: ["<|endoftext|>"],
      })

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ text: "return ok;" })
      expect(response.headers["x-chipmate-qwen-fim-phase"]).toBe("success")
      expect(response.headers["x-chipmate-qwen-endpoint-source"]).toBe("provider-options")
      expect(body).toEqual({
        model: "qwen-coder-30b0",
        prompt: "prefix",
        max_tokens: 128,
        temperature: 0.01,
        stop: ["<|endoftext|>"],
        stream: false,
      })
      expect(body).not.toHaveProperty("suffix")
      expect(headers?.get("Authorization")).toBe("Bearer test-token")
      expect(headers?.get("X-Provider")).toBe("configured")
      expect(headers?.get("X-Provider-Option")).toBe("configured")
      expect(headers?.get("X-Layer")).toBe("model")
      expect(url).toBe("https://options.test/v1/completions")
    }),
  )

  it.live("falls back to the model API URL without duplicating the completions path", () =>
    Effect.gen(function* () {
      let url: string | undefined
      yield* stub((input) => {
        url = String(input)
        return new Response(JSON.stringify({ choices: [{ text: "ok" }] }))
      })

      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "qwen-model-url",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(200)
      expect(url).toBe("https://model.test/v1/completions")
    }),
  )

  it.live("preserves a custom provider Authorization header", () =>
    Effect.gen(function* () {
      let headers: Headers | undefined
      yield* stub((_input, init) => {
        headers = new Headers(init?.headers)
        return new Response(JSON.stringify({ choices: [{ text: "ok" }] }))
      })

      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "qwen-header-auth",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(200)
      expect(headers?.get("Authorization")).toBe("Custom token")
    }),
  )

  it.live("returns unauthorized when neither headers nor the auth store contain credentials", () =>
    Effect.gen(function* () {
      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "no-auth",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(401)
    }),
  )

  it.live("rejects providers that are not OpenAI compatible", () =>
    Effect.gen(function* () {
      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "wrong-type",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(400)
    }),
  )

  it.live("rejects providers with no usable base URL", () =>
    Effect.gen(function* () {
      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "missing-url",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(400)
    }),
  )

  it.live("rejects the incorrect 0.0.48 and 0.0.49 Qwen model", () =>
    Effect.gen(function* () {
      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "qwen",
        modelID: "qwen3-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(400)
    }),
  )

  it.live("reports an upstream non-success status without exposing the endpoint", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("temporarily unavailable", { status: 503 }))

      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "qwen",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(400)
      expect(response.headers["x-chipmate-qwen-fim-phase"]).toBe("upstream-status")
      expect(response.headers["x-chipmate-qwen-endpoint-source"]).toBe("provider-options")
      expect(response.headers["x-chipmate-qwen-upstream-status"]).toBe("503")
    }),
  )

  it.live("reports invalid upstream JSON as a distinct safe phase", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("not-json", { status: 200 }))

      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "qwen",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(400)
      expect(response.headers["x-chipmate-qwen-fim-phase"]).toBe("response-json-invalid")
    }),
  )

  it.live("reports a missing completion text as a distinct safe phase", () =>
    Effect.gen(function* () {
      yield* stub(() => Response.json({ choices: [{}] }))

      const response = yield* post(KiloGatewayPaths.qwenFim, {
        providerID: "qwen",
        modelID: "qwen-coder-30b0",
        prefix: "prefix",
        suffix: "suffix",
      })

      expect(response.status).toBe(400)
      expect(response.headers["x-chipmate-qwen-fim-phase"]).toBe("response-text-missing")
    }),
  )

  it.live("reports locally stored API authentication without a Gateway request", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new Error("unexpected Gateway request")))

      const response = yield* HttpClient.get(KiloGatewayPaths.authStatus)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ authenticated: true, type: "api" })
    }),
  )

  it.live("preserves cloud session list rate limits", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("rate limited", { status: 429 }))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSessions)

      expect(response.status).toBe(429)
      expect(yield* response.json).toEqual({ error: "Cloud sessions fetch failed: 429" })
    }),
  )

  it.live("maps cloud session list transport failures to internal errors", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new TypeError("network error")))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSessions)

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "Internal error" })
    }),
  )

  it.live("preserves missing cloud session previews", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("missing", { status: 404 }))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSession.replace(":id", "missing"))

      expect(response.status).toBe(404)
      expect(yield* response.json).toEqual({ error: "Session not found" })
    }),
  )

  it.live("preserves cloud session preview server failures", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("failed", { status: 500 }))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSession.replace(":id", "failed"))

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "Failed to fetch session" })
    }),
  )

  it.live("maps cloud session preview transport failures to internal errors", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new TypeError("network error")))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSession.replace(":id", "failed"))

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "Internal error" })
    }),
  )

  it.live("preserves cloud session import authentication failures", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("unauthorized", { status: 401 }))

      const response = yield* post(KiloGatewayPaths.cloudSessionImport, { sessionId: "unauthorized" })

      expect(response.status).toBe(401)
      expect(yield* response.json).toEqual({ error: "Import failed: 401" })
    }),
  )

  it.live("maps cloud session import transport failures to internal errors", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new TypeError("network error")))

      const response = yield* post(KiloGatewayPaths.cloudSessionImport, { sessionId: "failed" })

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "Internal error" })
    }),
  )

  it.live("preserves KiloClaw worker failures", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("worker failed", { status: 500 }))

      const response = yield* HttpClient.get(KiloGatewayPaths.clawStatus)

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "KiloClaw request failed: 500 worker failed" })
    }),
  )

  it.live("normalizes numeric KiloClaw timestamps", () =>
    Effect.gen(function* () {
      const started = 1_700_000_000_000
      yield* stub(() =>
        Response.json({
          status: "running",
          sandboxId: "sandbox",
          userId: "user",
          lastStartedAt: started,
          lastStoppedAt: null,
        }),
      )

      const response = yield* HttpClient.get(KiloGatewayPaths.clawStatus)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        status: "running",
        sandboxId: "sandbox",
        userId: "user",
        lastStartedAt: new Date(started).toISOString(),
        lastStoppedAt: null,
      })
    }),
  )

  it.live("maps KiloClaw transport failures to bad gateway", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new TypeError("network error")))

      const response = yield* HttpClient.get(KiloGatewayPaths.clawStatus)

      expect(response.status).toBe(502)
      expect(yield* response.json).toEqual({ error: "Failed to reach KiloClaw" })
    }),
  )
})
