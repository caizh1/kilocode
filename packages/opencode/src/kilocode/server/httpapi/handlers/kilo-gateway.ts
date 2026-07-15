import {
  GatewayError,
  fetchCloudSession,
  fetchCloudSessionForImport,
  getCloudSessions,
  getOrganizationId,
  getToken,
  importSessionToDb,
} from "@kilocode/kilo-gateway"
import {
  HEADER_FEATURE,
  HEADER_ORGANIZATIONID,
  KILO_API_BASE,
  KILO_CHAT_URL,
  KILO_EVENT_SERVICE_URL,
  clearModesCache,
  fetchBalance,
  fetchKilocodeNotifications,
  fetchOrganizationModes,
  fetchProfile,
} from "@kilocode/kilo-gateway"
import { DIRECT_FIM_ENV, requestMistralFim, resolveFimTarget } from "@kilocode/kilo-gateway/fim"
import { DIRECT_EDIT_ENV, extractFencedBody, resolveEditTarget } from "@kilocode/kilo-gateway/edit"
import { buildMercuryEditPrompt } from "@kilocode/kilo-gateway/edit-prompt"
import { buildKiloHeaders } from "@kilocode/kilo-gateway"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Log from "@opencode-ai/core/util/log"
import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import { Provider } from "@/provider/provider"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { Session } from "@/session/session"
import { Database } from "@/storage/db"
import { Storage } from "@/storage/storage"
import { AudioTranscriptionsBody, ClawStatus, EditBody, FimBody, QwenFimBody } from "../groups/kilo-gateway"
import { baseKey } from "../../../session-portability/cumulative-diff"
import { extractSessionDiffs, restoreSessionDiffs } from "../../../session-portability/session-diff-restore"

const FIM_TIMEOUT_MS = 30_000
const QWEN_FIM_MODEL = "qwen-coder-30b0"
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"
const log = Log.create({ service: "kilo-gateway" })

function jsonError(error: string, status: number) {
  return HttpServerResponse.jsonUnsafe({ error }, { status })
}

function logError(route: string, err: unknown) {
  log.error("unhandled error", { route, err })
}

function completionURL(url: string): string | undefined {
  const value = url.trim().replace(/\/+$/, "")
  if (!value) return undefined
  if (value.endsWith("/completions")) return value
  return `${value}/completions`
}

function configHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((item): item is [string, string] => typeof item[1] === "string"),
  )
}

function completionText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const choices = (value as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return undefined
  const first = choices[0]
  if (!first || typeof first !== "object") return undefined
  const text = (first as { text?: unknown }).text
  return typeof text === "string" && text ? text : undefined
}

export const kiloGatewayHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilo", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const store = yield* InstanceStore.Service
    const cache = yield* ModelCache.Service
    const providers = yield* Provider.Service

    const profile = Effect.fn("KiloGatewayHttpApi.profile")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      if (!info || info.type !== "oauth") return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const currentOrgId = info.accountId ?? null
      const [profile, balance] = yield* Effect.tryPromise({
        try: () => Promise.all([fetchProfile(info.access), fetchBalance(info.access, currentOrgId ?? undefined)]),
        catch: () => new HttpApiError.BadRequest({}),
      })
      return { profile, balance, currentOrgId }
    })

    const proxyAuth = Effect.fn("KiloGatewayHttpApi.proxyAuth")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      return {
        auth: info,
        token: getToken(info),
        organizationId: getOrganizationId(info),
      }
    })

    const modes = Effect.fn("KiloGatewayHttpApi.modes")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!info || info.type !== "oauth" || !info.access || !info.accountId) return { modes: [] }

      const org = info.accountId
      return yield* Effect.promise(() => fetchOrganizationModes(info.access, org)).pipe(
        Effect.map((modes) => ({ modes })),
        Effect.catch(() => Effect.succeed({ modes: [] })),
      )
    })

    const fim = Effect.fn("KiloGatewayHttpApi.fim")(function* (ctx: { payload: typeof FimBody.Type }) {
      const target = resolveFimTarget(ctx.payload.provider, ctx.payload.model)
      const info = target.provider === "kilo" ? yield* proxyAuth() : undefined
      const token = yield* Effect.gen(function* () {
        if (target.provider === "kilo") return info?.token
        const item = yield* auth.get(target.provider).pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
        if (item?.type === "api") return item.key
        return DIRECT_FIM_ENV[target.provider].map((key) => process.env[key]).find(Boolean)
      })

      if (target.provider === "kilo" && !info?.auth) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const request = yield* HttpServerRequest.HttpServerRequest
      const signal =
        request.source instanceof Request
          ? AbortSignal.any([request.source.signal, AbortSignal.timeout(FIM_TIMEOUT_MS)])
          : AbortSignal.timeout(FIM_TIMEOUT_MS)
      const response = yield* Effect.promise(async () => {
        try {
          const run = async (url: string): Promise<Response> => {
            console.info(`[FIM] request provider=${target.provider} model=${target.model} url=${url}`)
            return fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                ...(target.provider === "kilo"
                  ? buildKiloHeaders(undefined, { kilocodeOrganizationId: info?.organizationId })
                  : {}),
                ...(target.provider === "kilo" ? { [HEADER_FEATURE]: "autocomplete" } : {}),
              },
              signal,
              body: JSON.stringify({
                model: target.model,
                prompt: ctx.payload.prefix,
                suffix: ctx.payload.suffix,
                max_tokens: ctx.payload.maxTokens ?? 256,
                temperature: ctx.payload.temperature ?? 0.2,
                stream: true,
              }),
            })
          }
          if (target.provider === "mistral") return requestMistralFim(run)
          return run(target.url)
        } catch (err) {
          if (err instanceof DOMException && err.name === "TimeoutError")
            return Response.json({ error: "FIM request timed out" }, { status: 504 })
          if (signal.aborted) return Response.json({ error: "FIM request canceled" }, { status: 499 })
          throw err
        }
      })
      if (!response.ok) {
        const text = yield* Effect.promise(() => response.text())
        return HttpServerResponse.jsonUnsafe(
          { error: `FIM request failed: ${response.status} ${text}` },
          { status: response.status },
        )
      }
      if (!response.body) return HttpServerResponse.raw(null, { status: response.status })

      return HttpServerResponse.stream(
        Stream.fromReadableStream({
          evaluate: () => response.body!,
          onError: (err) => err,
        }),
        {
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        },
      )
    })

    const qwenFim = Effect.fn("KiloGatewayHttpApi.qwenFim")(function* (ctx: { payload: typeof QwenFimBody.Type }) {
      const started = Date.now()
      const report = (
        phase: string,
        status: number,
        source: "provider-options" | "model-api" | "missing" = "missing",
      ) =>
        log.info("qwen fim", {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
          phase,
          status,
          latency: Date.now() - started,
          endpointSource: source,
        })
      const reject = (
        phase: string,
        status: 400 | 401,
        source: "provider-options" | "model-api" | "missing" = "missing",
      ) => {
        report(phase, status, source)
        return HttpServerResponse.jsonUnsafe(
          { _tag: status === 401 ? "Unauthorized" : "BadRequest" },
          {
            status,
            headers: {
              "X-ChipMate-Qwen-Fim-Phase": phase,
              "X-ChipMate-Qwen-Endpoint-Source": source,
            },
          },
        )
      }
      if (ctx.payload.modelID !== QWEN_FIM_MODEL) {
        return reject("model-id-rejected", 400)
      }

      const all = yield* providers.list()
      const provider = Object.values(all).find((item) => item.id === ctx.payload.providerID)
      if (!provider) {
        return reject("provider-not-found", 400)
      }
      const model = provider && Object.values(provider.models).find((item) => item.id === ctx.payload.modelID)
      if (!model || model.api.npm !== OPENAI_COMPATIBLE) {
        return reject("provider-type-rejected", 400)
      }

      const option = typeof provider.options.baseURL === "string" ? completionURL(provider.options.baseURL) : undefined
      const fallback = completionURL(model.api.url)
      const url = option ?? fallback
      const source = option ? "provider-options" : fallback ? "model-api" : "missing"
      if (!url) {
        return reject("base-url-missing", 400)
      }

      const headers: Record<string, string> = {
        ...configHeaders(provider.options.headers),
        ...model.headers,
        "Content-Type": "application/json",
      }
      const authorized = Object.keys(headers).some((key) => key.toLowerCase() === "authorization")
      const item = authorized
        ? undefined
        : yield* auth.get(ctx.payload.providerID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!authorized && (!item || item.type !== "api" || !item.key)) {
        return reject("auth-missing", 401, source)
      }
      if (!authorized && item?.type === "api") headers.Authorization = `Bearer ${item.key}`

      const request = yield* HttpServerRequest.HttpServerRequest
      const signal =
        request.source instanceof Request
          ? AbortSignal.any([request.source.signal, AbortSignal.timeout(FIM_TIMEOUT_MS)])
          : AbortSignal.timeout(FIM_TIMEOUT_MS)
      const result = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: "POST",
            headers,
            signal,
            body: JSON.stringify({
              model: model.api.id,
              // The rendered Qwen prompt already contains <|fim_suffix|>. OpenAI-compatible
              // legacy completion endpoints may reject even an empty top-level suffix field.
              prompt: ctx.payload.prefix,
              max_tokens: ctx.payload.maxTokens ?? 128,
              temperature: ctx.payload.temperature ?? 0.01,
              stop: ctx.payload.stop,
              stream: false,
            }),
          }),
        catch: (err) => err,
      }).pipe(
        Effect.match({
          onFailure: () => ({ ok: false as const }),
          onSuccess: (response) => ({ ok: true as const, response }),
        }),
      )
      if (!result.ok) return reject("upstream-network", 400, source)
      const response = result.response
      if (!response.ok) {
        report("upstream-status", response.status, source)
        return HttpServerResponse.jsonUnsafe(
          { _tag: "BadRequest" },
          {
            status: 400,
            headers: {
              "X-ChipMate-Qwen-Fim-Phase": "upstream-status",
              "X-ChipMate-Qwen-Endpoint-Source": source,
              "X-ChipMate-Qwen-Upstream-Status": String(response.status),
            },
          },
        )
      }

      const parsed = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (err) => err,
      }).pipe(
        Effect.match({
          onFailure: () => ({ ok: false as const }),
          onSuccess: (body) => ({ ok: true as const, body }),
        }),
      )
      if (!parsed.ok) return reject("response-json-invalid", 400, source)
      const text = completionText(parsed.body)
      if (!text) {
        return reject("response-text-missing", 400, source)
      }
      report("success", 200, source)
      return HttpServerResponse.jsonUnsafe(
        { text },
        {
          status: 200,
          headers: {
            "X-ChipMate-Qwen-Fim-Phase": "success",
            "X-ChipMate-Qwen-Endpoint-Source": source,
          },
        },
      )
    })

    const edit = Effect.fn("KiloGatewayHttpApi.edit")(function* (ctx: { payload: typeof EditBody.Type }) {
      const target = resolveEditTarget(ctx.payload.provider, ctx.payload.model)
      if (target.provider === "kilo" && !target.url) {
        return yield* Effect.fail(new HttpApiError.BadRequest({}))
      }
      const proxy = target.provider === "kilo" ? yield* proxyAuth() : undefined
      const token = yield* Effect.gen(function* () {
        if (target.provider === "kilo") return proxy?.token
        const item = yield* auth.get(target.provider).pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
        if (item?.type === "api") return item.key
        return DIRECT_EDIT_ENV[target.provider].map((key) => process.env[key]).find(Boolean)
      })
      if (target.provider === "kilo" && !proxy?.auth) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const request = yield* HttpServerRequest.HttpServerRequest
      const signal =
        request.source instanceof Request
          ? AbortSignal.any([request.source.signal, AbortSignal.timeout(FIM_TIMEOUT_MS)])
          : AbortSignal.timeout(FIM_TIMEOUT_MS)

      // Assemble the Mercury sentinel prompt from the structured context the
      // client sent — same builder every editor frontend shares.
      const content = buildMercuryEditPrompt({
        currentFilePath: ctx.payload.currentFilePath,
        currentFileContent: ctx.payload.currentFileContent,
        cursorLine: ctx.payload.cursorLine,
        cursorCharacter: ctx.payload.cursorCharacter,
        editableRegionStartLine: ctx.payload.editableRegionStartLine,
        editableRegionEndLine: ctx.payload.editableRegionEndLine,
        recentlyViewedSnippets: [...ctx.payload.recentlyViewedSnippets],
        editDiffHistory: [...ctx.payload.editDiffHistory],
      })

      const response = yield* Effect.promise(async () => {
        try {
          return await fetch(target.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              ...(target.provider === "kilo"
                ? buildKiloHeaders(undefined, { kilocodeOrganizationId: proxy?.organizationId })
                : {}),
              ...(target.provider === "kilo" ? { [HEADER_FEATURE]: "autocomplete" } : {}),
            },
            signal,
            body: JSON.stringify({
              model: target.model,
              max_tokens: ctx.payload.maxTokens ?? 512,
              // Mercury rejects role:"system" on this endpoint — must be a single user message.
              messages: [{ role: "user", content }],
            }),
          })
        } catch (err) {
          if (err instanceof DOMException && err.name === "TimeoutError")
            return Response.json({ error: "Edit request timed out" }, { status: 504 })
          if (signal.aborted) return Response.json({ error: "Edit request canceled" }, { status: 499 })
          throw err
        }
      })

      if (!response.ok) {
        // Pass the upstream status through (mirrors the FIM handler) so the
        // client can distinguish auth/credit/rate-limit/server failures
        // instead of collapsing everything to 400.
        const text = yield* Effect.promise(async () => {
          try {
            return await response.text()
          } catch {
            return "<unreadable>"
          }
        })
        return HttpServerResponse.jsonUnsafe(
          { error: `Edit request failed: ${response.status} ${text}` },
          { status: response.status },
        )
      }

      const json = yield* Effect.promise(
        () =>
          response.json() as Promise<{
            choices?: Array<{ message?: { content?: string } }>
            usage?: { prompt_tokens?: number; completion_tokens?: number }
          }>,
      )
      const raw = json.choices?.[0]?.message?.content ?? ""
      const body = extractFencedBody(raw)
      return {
        content: body,
        usage: json.usage
          ? {
              prompt_tokens: json.usage.prompt_tokens,
              completion_tokens: json.usage.completion_tokens,
            }
          : undefined,
      }
    })

    const audioTranscriptions = Effect.fn("KiloGatewayHttpApi.audioTranscriptions")(function* (ctx: {
      payload: typeof AudioTranscriptionsBody.Type
    }) {
      const info = yield* proxyAuth()
      if (!info.auth) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      if (!info.token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const request = yield* HttpServerRequest.HttpServerRequest
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${KILO_API_BASE}/api/gateway/v1/audio/transcriptions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${info.token}`,
              ...buildKiloHeaders(undefined, { kilocodeOrganizationId: info.organizationId }),
              [HEADER_FEATURE]: "vscode-extension",
            },
            signal: request.source instanceof Request ? request.source.signal : undefined,
            body: JSON.stringify(ctx.payload),
          }),
        catch: () => new HttpApiError.BadRequest({}),
      })
      const text = yield* Effect.promise(() => response.text())
      return HttpServerResponse.raw(text, {
        status: response.status,
        contentType: response.headers.get("Content-Type") ?? "application/json",
      })
    })

    const notifications = Effect.fn("KiloGatewayHttpApi.notifications")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const token = getToken(info)
      if (!token) return []

      return yield* Effect.promise(() =>
        fetchKilocodeNotifications({
          kilocodeToken: token,
          kilocodeOrganizationId: getOrganizationId(info),
        }),
      )
    })

    const organization = Effect.fn("KiloGatewayHttpApi.organization")(function* (ctx) {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      if (!info || info.type !== "oauth") return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      yield* auth
        .set("kilo", {
          type: "oauth",
          refresh: info.refresh,
          access: info.access,
          expires: info.expires,
          ...(ctx.payload.organizationId && { accountId: ctx.payload.organizationId }),
        })
        .pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))

      yield* cache.clear("kilo")
      clearModesCache()
      yield* store.disposeAll().pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      return true
    })

    const clawStatus = Effect.fn("KiloGatewayHttpApi.clawStatus")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.ServiceUnavailable({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      }
      const org = getOrganizationId(info)
      if (org) headers[HEADER_ORGANIZATIONID] = org

      return yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${KILO_API_BASE}/api/kiloclaw/status`, { headers })
          if (!response.ok) throw new GatewayError(await response.text(), response.status)
          return Schema.decodeUnknownPromise(ClawStatus)(await response.json())
        },
        catch: (err) => err,
      }).pipe(
        Effect.match({
          onFailure: (err) => {
            if (err instanceof GatewayError)
              return jsonError(`KiloClaw request failed: ${err.status} ${err.message}`, err.status)
            logError("claw/status", err)
            return jsonError("Failed to reach KiloClaw", 502)
          },
          onSuccess: (result) => result,
        }),
      )
    })

    const clawChatCredentials = Effect.fn("KiloGatewayHttpApi.clawChatCredentials")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const expires = info?.type === "oauth" ? info.expires : Date.now() + 365 * 24 * 60 * 60 * 1000
      return {
        token,
        expiresAt: new Date(expires).toISOString(),
        kiloChatUrl: KILO_CHAT_URL,
        eventServiceUrl: KILO_EVENT_SERVICE_URL,
      }
    })

    const cloudSessions = Effect.fn("KiloGatewayHttpApi.cloudSessions")(function* (ctx) {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const query = {
        ...ctx.query,
        limit: ctx.query.limit === undefined ? undefined : Number(ctx.query.limit),
      }

      return yield* Effect.tryPromise({
        try: () => getCloudSessions(token, query),
        catch: (err) => err,
      }).pipe(
        Effect.match({
          onFailure: (err) => {
            if (err instanceof GatewayError) return jsonError(err.message, err.status)
            logError("cloud-sessions", err)
            return jsonError("Internal error", 500)
          },
          onSuccess: (result) => result,
        }),
      )
    })

    const cloudSession = Effect.fn("KiloGatewayHttpApi.cloudSession")(function* (ctx) {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const result = yield* Effect.tryPromise({
        try: () => fetchCloudSession(token, ctx.params.id),
        catch: (err) => err,
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            logError("cloud/session/get", err)
            return undefined
          }),
        ),
      )
      if (!result) return jsonError("Internal error", 500)
      if (!result.ok) return jsonError(result.error, result.status)
      return result.data
    })

    const cloudSessionImport = Effect.fn("KiloGatewayHttpApi.cloudSessionImport")(function* (ctx) {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const fetched = yield* Effect.tryPromise({
        try: () => fetchCloudSessionForImport(token, ctx.payload.sessionId),
        catch: (err) => err,
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            logError("cloud/session/import", err)
            return undefined
          }),
        ),
      )
      if (!fetched) return jsonError("Internal error", 500)
      if (!fetched.ok) return jsonError(fetched.error, fetched.status)
      if (!fetched.data?.info?.id) return yield* Effect.fail(new HttpApiError.BadRequest({}))

      const diffs = extractSessionDiffs(fetched.data)
      const bridge = yield* EffectBridge.make()
      return yield* Effect.tryPromise({
        try: () =>
          bridge.promise(
            Effect.gen(function* () {
              if (diffs.length > 0) {
                yield* Effect.try({
                  try: () => restoreSessionDiffs({ directory: Instance.directory, diffs }),
                  catch: (err) => err,
                }).pipe(
                  Effect.catch((err) =>
                    Effect.sync(() => {
                      logError("cloud/session/import/restore", err)
                      return undefined
                    }),
                  ),
                )
              }

              const imported = yield* Effect.sync(() =>
                importSessionToDb(fetched.data, {
                  Database,
                  Instance,
                  SessionTable,
                  MessageTable,
                  PartTable,
                  SessionToRow: Session.toRow,
                  Bus,
                  SessionCreatedEvent: Session.Event.Created,
                  Identifier,
                }),
              )

              if (diffs.length > 0) {
                yield* Storage.Service.use((storage) =>
                  Effect.all([
                    storage.write(baseKey(imported.id), diffs),
                    storage.write(["session_diff", imported.id], diffs),
                  ]),
                ).pipe(
                  Effect.catch((err) =>
                    Effect.sync(() => {
                      logError("cloud/session/import/diff", err)
                    }),
                  ),
                )
              }

              return imported
            }),
          ),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    return handlers
      .handle("profile", profile)
      .handle("modes", modes)
      .handle("fim", fim)
      .handle("qwenFim", qwenFim)
      .handle("edit", edit)
      .handle("audioTranscriptions", audioTranscriptions)
      .handle("notifications", notifications)
      .handle("organization", organization)
      .handle("clawStatus", clawStatus)
      .handle("clawChatCredentials", clawChatCredentials)
      .handle("cloudSessions", cloudSessions)
      .handle("cloudSession", cloudSession)
      .handle("cloudSessionImport", cloudSessionImport)
  }),
)
