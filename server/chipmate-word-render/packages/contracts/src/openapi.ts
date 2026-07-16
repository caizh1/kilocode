import { SCHEMAS } from "./schema.ts"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const json = (schema: Json) => ({ "application/json": { schema } })
const ok = (schema: Json, description = "OK") => ({
  "200": { description, content: json(schema) },
  "400": { description: "Bad request", content: json(ref("ApiError")) },
  "401": { description: "Authentication required", content: json(ref("ApiError")) },
  "403": { description: "Forbidden", content: json(ref("ApiError")) },
  "404": { description: "Not found", content: json(ref("ApiError")) },
  "409": { description: "Conflict", content: json(ref("ApiError")) },
  "500": { description: "Internal error", content: json(ref("ApiError")) },
})
const body = (schema: Json) => ({ required: true, content: json(schema) })
const param = (name: string, where: "path" | "query" | "header", required = false) => ({
  name,
  in: where,
  required: where === "path" || required,
  schema: { type: "string" },
})

function clean(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value
  }
  if (Array.isArray(value)) return value.map(clean)
  if (typeof value !== "object") throw new Error("OpenAPI schema contains a non-JSON value")
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key === "$ref" && typeof item === "string" && !item.startsWith("#")) {
        return [key, `#/components/schemas/${item}`]
      }
      return [key, clean(item)]
    }),
  )
}

const schemas = Object.fromEntries(Object.entries(SCHEMAS).map(([name, schema]) => [name, clean(schema)]))
const page = [param("cursor", "query"), param("limit", "query")]
const skill = param("id", "path")
const revision = param("revision", "path")
const run = param("runId", "path")
const token = param("token", "path")

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "ChipMate Skill Market API",
    version: "1.0.0",
    description: "Shared aligned-v1 contract for the Web market and Kilo Marketplace.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "capabilities" },
    { name: "identity" },
    { name: "catalog" },
    { name: "favorites" },
    { name: "installations" },
    { name: "publications" },
    { name: "analytics" },
    { name: "extensions" },
    { name: "status" },
  ],
  paths: {
    "/api/v1/capabilities": {
      get: {
        operationId: "getCapabilities",
        tags: ["capabilities"],
        responses: ok(ref("MarketCapabilities")),
      },
    },
    "/api/v1/market/stream": {
      get: {
        operationId: "streamMarketEvents",
        tags: ["capabilities"],
        parameters: [param("Last-Event-ID", "header"), param("catalogVersion", "query")],
        responses: {
          "200": {
            description: "Market invalidation event stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/api/v1/auth/session": {
      post: {
        operationId: "createSession",
        tags: ["identity"],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["apiKey"],
          properties: { apiKey: { type: "string", minLength: 1 } },
        }),
        responses: ok(ref("MarketUser")),
      },
      delete: {
        operationId: "deleteSession",
        tags: ["identity"],
        security: [{ cookieSession: [] }],
        parameters: [param("X-CSRF-Token", "header", true)],
        responses: ok({ type: "object", required: ["ok"], properties: { ok: { const: true } } }),
      },
    },
    "/api/v1/auth/me": {
      get: {
        operationId: "getCurrentUser",
        tags: ["identity"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        responses: ok(ref("MarketUser")),
      },
    },
    "/api/v1/skills": {
      get: {
        operationId: "listSkills",
        tags: ["catalog"],
        parameters: [
          ...page,
          param("q", "query"),
          param("category", "query"),
          param("author", "query"),
          param("updatedAfter", "query"),
          param("sort", "query"),
        ],
        responses: ok({
          type: "object",
          additionalProperties: false,
          required: ["items", "catalogVersion"],
          properties: {
            items: { type: "array", items: ref("SkillSummary") },
            nextCursor: { type: "string" },
            catalogVersion: { type: "string" },
          },
        }),
      },
    },
    "/api/v1/skills/{id}": {
      get: {
        operationId: "getSkill",
        tags: ["catalog"],
        parameters: [skill],
        responses: ok(ref("SkillDetail")),
      },
    },
    "/api/v1/skills/{id}/releases": {
      get: {
        operationId: "listSkillReleases",
        tags: ["catalog"],
        parameters: [skill, ...page],
        responses: ok({ type: "array", items: ref("SkillRelease") }),
      },
    },
    "/api/v1/skills/{id}/releases/{revision}": {
      get: {
        operationId: "getSkillRelease",
        tags: ["catalog"],
        parameters: [skill, revision],
        responses: ok(ref("SkillRelease")),
      },
    },
    "/api/v1/skills/{id}/releases/{revision}/archive": {
      get: {
        operationId: "downloadSkillRelease",
        tags: ["catalog"],
        parameters: [skill, revision],
        responses: {
          "200": {
            description: "Immutable skill release archive",
            content: { "application/gzip": { schema: { type: "string", format: "binary" } } },
          },
        },
      },
    },
    "/api/v1/skills/{id}/files": {
      get: {
        operationId: "listSkillFiles",
        tags: ["catalog"],
        parameters: [skill, revision],
        responses: ok({ type: "array", items: ref("SkillFile") }),
      },
    },
    "/api/v1/skills/{id}/files/{path}": {
      get: {
        operationId: "getSkillFile",
        tags: ["catalog"],
        parameters: [skill, param("path", "path"), revision],
        responses: ok({
          type: "object",
          additionalProperties: false,
          required: ["file"],
          properties: { file: ref("SkillFile"), text: { type: "string" }, dataUrl: { type: "string" } },
        }),
      },
    },
    "/api/v1/categories": {
      get: {
        operationId: "listCategories",
        tags: ["catalog"],
        responses: ok({
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "count"],
            properties: { id: { type: "string" }, name: { type: "string" }, count: { type: "integer" } },
          },
        }),
      },
    },
    "/api/v1/authors/{id}": {
      get: {
        operationId: "getAuthor",
        tags: ["catalog"],
        parameters: [skill],
        responses: ok({
          type: "object",
          additionalProperties: false,
          required: ["id", "displayName", "skills"],
          properties: {
            id: { type: "string" },
            displayName: { type: "string" },
            skills: { type: "array", items: ref("SkillSummary") },
          },
        }),
      },
    },
    "/api/v1/favorites/{id}": {
      put: {
        operationId: "putFavorite",
        tags: ["favorites"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [skill, param("X-CSRF-Token", "header")],
        responses: ok(ref("FavoriteState")),
      },
      delete: {
        operationId: "deleteFavorite",
        tags: ["favorites"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [skill, param("X-CSRF-Token", "header")],
        responses: ok(ref("FavoriteState")),
      },
    },
    "/api/v1/me/favorites": {
      get: {
        operationId: "listFavorites",
        tags: ["favorites"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        responses: ok({ type: "array", items: ref("SkillSummary") }),
      },
    },
    "/api/v1/me/installations": {
      get: {
        operationId: "listInstallations",
        tags: ["installations"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        responses: ok({ type: "array", items: ref("InstallationState") }),
      },
    },
    "/api/v1/installations/{id}": {
      put: {
        operationId: "putInstallation",
        tags: ["installations"],
        security: [{ bearerKey: [] }],
        parameters: [skill],
        requestBody: body(ref("InstallationState")),
        responses: ok(ref("InstallationState")),
      },
      delete: {
        operationId: "deleteInstallation",
        tags: ["installations"],
        security: [{ bearerKey: [] }],
        parameters: [skill],
        requestBody: body(ref("InstallationState")),
        responses: ok(ref("InstallationState")),
      },
    },
    "/api/v1/skills/{id}/install-intents": {
      post: {
        operationId: "createInstallIntent",
        tags: ["installations"],
        security: [{ cookieSession: [] }],
        parameters: [skill, param("X-CSRF-Token", "header", true)],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          properties: { revision: { type: "integer", minimum: 1 } },
        }),
        responses: ok({
          type: "object",
          additionalProperties: false,
          required: ["token", "expiresAt"],
          properties: { token: { type: "string" }, expiresAt: { type: "string", format: "date-time" } },
        }),
      },
    },
    "/api/v1/install-intents/{token}/consume": {
      post: {
        operationId: "consumeInstallIntent",
        tags: ["installations"],
        security: [{ bearerKey: [] }],
        parameters: [token],
        responses: ok({
          type: "object",
          additionalProperties: false,
          required: ["skillId", "revision", "sha256", "downloadUrl"],
          properties: {
            skillId: { type: "string" },
            revision: { type: "integer", minimum: 1 },
            sha256: { type: "string" },
            downloadUrl: { type: "string" },
          },
        }),
      },
    },
    "/api/v1/publications": {
      post: {
        operationId: "createPublication",
        tags: ["publications"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [param("Idempotency-Key", "header", true), param("X-CSRF-Token", "header")],
        requestBody: body({ type: "string", format: "binary" }),
        responses: ok(ref("PublicationRun")),
      },
    },
    "/api/v1/me/publications": {
      get: {
        operationId: "listPublications",
        tags: ["publications"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        responses: ok({ type: "array", items: ref("PublicationRun") }),
      },
    },
    "/api/v1/publications/{runId}": {
      get: {
        operationId: "getPublication",
        tags: ["publications"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [run],
        responses: ok(ref("PublicationRun")),
      },
    },
    "/api/v1/publications/{runId}/patches": {
      post: {
        operationId: "putPublicationPatches",
        tags: ["publications"],
        security: [{ bearerKey: [] }],
        parameters: [run],
        requestBody: body({ type: "array", items: ref("RepairPatch") }),
        responses: ok(ref("PublicationRun")),
      },
    },
    "/api/v1/publications/{runId}/apply": {
      post: {
        operationId: "applyPublicationPatches",
        tags: ["publications"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [run, param("X-CSRF-Token", "header")],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["patchIds"],
          properties: { patchIds: { type: "array", items: { type: "string" } } },
        }),
        responses: ok(ref("PublicationRun")),
      },
    },
    "/api/v1/skills/{id}/unpublish": {
      post: {
        operationId: "unpublishSkill",
        tags: ["publications"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [skill, param("X-CSRF-Token", "header")],
        responses: ok(ref("PublicationRun")),
      },
    },
    "/api/v1/events/batch": {
      post: {
        operationId: "postEvents",
        tags: ["analytics"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        requestBody: body({ type: "array", maxItems: 100, items: ref("AnalyticsEvent") }),
        responses: ok({
          type: "object",
          required: ["accepted"],
          properties: { accepted: { type: "integer", minimum: 0 } },
        }),
      },
    },
    "/api/v1/analytics/overview": {
      get: {
        operationId: "getAnalyticsOverview",
        tags: ["analytics"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        responses: ok({ type: "array", items: ref("AnalyticsSeries") }),
      },
    },
    "/api/v1/analytics/skills/{id}": {
      get: {
        operationId: "getSkillAnalytics",
        tags: ["analytics"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [skill],
        responses: ok({ type: "array", items: ref("AnalyticsSeries") }),
      },
    },
    "/api/v1/extensions": {
      get: {
        operationId: "listExtensions",
        tags: ["extensions"],
        parameters: [
          ...page,
          param("q", "query"),
          param("category", "query"),
          param("target", "query"),
          param("uploader", "query"),
          param("sort", "query"),
        ],
        responses: ok({
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: { items: { type: "array", items: ref("ExtensionSummary") }, nextCursor: { type: "string" } },
        }),
      },
    },
    "/api/v1/extensions/{id}": {
      get: {
        operationId: "getExtension",
        tags: ["extensions"],
        parameters: [skill],
        responses: ok(ref("ExtensionDetail")),
      },
    },
    "/api/v1/extension-publications": {
      post: {
        operationId: "publishExtension",
        tags: ["extensions"],
        description: "Upload one VSIX file. Web clients extract folders and archives locally; each user may submit at most 100 VSIX files per rolling hour.",
        security: [{ cookieSession: [] }],
        parameters: [
          param("Idempotency-Key", "header", true),
          param("X-Publication-Run-Id", "header", true),
          param("X-VSIX-Filename", "header", true),
          param("X-CSRF-Token", "header", true),
        ],
        requestBody: {
          required: true,
          content: { "application/vnd.microsoft.vscode.vsix": { schema: { type: "string", format: "binary" } } },
        },
        responses: ok(ref("ExtensionPublicationRun")),
      },
    },
    "/api/v1/extension-publications/{runId}": {
      get: {
        operationId: "getExtensionPublication",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [run],
        responses: ok(ref("ExtensionPublicationRun")),
      },
    },
    "/api/v1/extensions/{id}/artifacts/{artifactId}/download": {
      get: {
        operationId: "downloadExtensionArtifact",
        tags: ["extensions"],
        parameters: [skill, param("artifactId", "path"), param("source", "query")],
        responses: {
          "200": {
            description: "Original VSIX artifact",
            content: { "application/vnd.microsoft.vscode.vsix": { schema: { type: "string", format: "binary" } } },
          },
          "404": { description: "Not found", content: json(ref("ApiError")) },
          "416": { description: "Range requests are not supported" },
        },
      },
    },
    "/api/v1/extension-favorites/{id}": {
      put: {
        operationId: "favoriteExtension",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [skill, param("X-CSRF-Token", "header")],
        responses: ok({ type: "object" }),
      },
      delete: {
        operationId: "unfavoriteExtension",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [skill, param("X-CSRF-Token", "header")],
        responses: ok({ type: "object" }),
      },
    },
    "/api/v1/extensions/{id}/review": {
      get: {
        operationId: "listExtensionReviews",
        tags: ["extensions"],
        parameters: [skill],
        responses: ok({ type: "array", items: ref("ExtensionReview") }),
      },
      put: {
        operationId: "putExtensionReview",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [skill, param("X-CSRF-Token", "header")],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["rating"],
          properties: {
            rating: { type: "integer", minimum: 1, maximum: 5 },
            comment: { type: "string", maxLength: 2000 },
            artifactId: { type: "string" },
          },
        }),
        responses: ok(ref("ExtensionReview")),
      },
      delete: {
        operationId: "deleteExtensionReview",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [skill, param("X-CSRF-Token", "header")],
        responses: ok({ type: "object" }),
      },
    },
    "/api/v1/me/extensions/uploads": {
      get: {
        operationId: "listMyExtensionUploads",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        responses: ok({ type: "array", items: ref("ExtensionArtifact") }),
      },
    },
    "/api/v1/me/extensions/favorites": {
      get: {
        operationId: "listMyExtensionFavorites",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        responses: ok({ type: "array", items: ref("ExtensionSummary") }),
      },
    },
    "/api/v1/me/extensions/reviews": {
      get: {
        operationId: "listMyExtensionReviews",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        responses: ok({ type: "array", items: ref("ExtensionReview") }),
      },
    },
    "/api/v1/extension-artifacts/{artifactId}": {
      delete: {
        operationId: "deleteExtensionArtifact",
        tags: ["extensions"],
        security: [{ cookieSession: [] }],
        parameters: [param("artifactId", "path"), param("X-CSRF-Token", "header", true)],
        responses: ok(ref("ExtensionArtifact")),
      },
    },
    "/api/v1/analytics/extensions/overview": {
      get: {
        operationId: "getExtensionAnalytics",
        tags: ["extensions"],
        responses: ok(ref("ExtensionAnalytics")),
      },
    },
    "/api/v1/analytics/extension-artifacts/{artifactId}/sources": {
      get: {
        operationId: "getExtensionArtifactSources",
        tags: ["extensions"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [param("artifactId", "path")],
        responses: ok({ type: "array", items: { type: "object" } }),
      },
    },
    "/api/v1/status": {
      get: {
        operationId: "getMarketStatus",
        tags: ["status"],
        responses: ok({
          type: "object",
          additionalProperties: false,
          required: ["ok", "transport", "render", "market", "packages"],
          properties: {
            ok: { type: "boolean" },
            transport: { enum: ["trusted-http", "https"] },
            render: { enum: ["ready", "degraded", "unavailable"] },
            market: { enum: ["ready", "degraded", "unavailable"] },
            packages: { enum: ["ready", "degraded", "unavailable"] },
            warnings: { type: "array", items: { type: "string" } },
          },
        }),
      },
    },
  },
  components: {
    securitySchemes: {
      bearerKey: { type: "http", scheme: "bearer" },
      cookieSession: { type: "apiKey", in: "cookie", name: "chipmate_market_session" },
    },
    schemas,
  },
} as const
