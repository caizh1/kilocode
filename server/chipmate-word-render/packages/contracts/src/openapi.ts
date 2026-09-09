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
  "429": {
    description: "Rate limited",
    headers: { "Retry-After": { schema: { type: "string" } } },
    content: json(ref("ApiError")),
  },
  "500": { description: "Internal error", content: json(ref("ApiError")) },
})
const body = (schema: Json) => ({ required: true, content: json(schema) })
const param = (name: string, where: "path" | "query" | "header", required = false) => ({
  name,
  in: where,
  required: where === "path" || required,
  schema: { type: "string" },
})

const adminIdentity = {
  type: "object", required: ["subject", "username", "displayName"],
  properties: {
    subject: { type: "string" }, username: { type: "string" }, displayName: { type: "string" },
    email: { type: "string" }, dn: { type: "string" }, userId: { type: "string" },
  },
}
const adminChange = { type: "object", required: ["ok", "changed", "sessionsRevoked"],
  properties: { ok: { const: true }, changed: { type: "boolean" }, sessionsRevoked: { type: "boolean" } } }

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
const ldapConfig: Json = {
  type: "object",
  additionalProperties: false,
  required: [
    "enabled",
    "name",
    "host",
    "port",
    "security",
    "verifyCertificate",
    "bindDn",
    "userSearchBase",
    "userFilter",
    "usernameAttribute",
    "emailAttribute",
    "attributesInBindContext",
    "insecureAcknowledged",
  ],
  properties: {
    enabled: { type: "boolean" },
    name: { type: "string" },
    host: { type: "string" },
    port: { type: "integer", minimum: 1, maximum: 65535 },
    security: { enum: ["unencrypted", "starttls", "ldaps"] },
    verifyCertificate: { type: "boolean" },
    bindDn: { type: "string" },
    userSearchBase: { type: "string" },
    userFilter: { type: "string" },
    adminFilter: { type: "string" },
    restrictedFilter: { type: "string" },
    usernameAttribute: { type: "string" },
    firstNameAttribute: { type: "string" },
    surnameAttribute: { type: "string" },
    emailAttribute: { type: "string" },
    attributesInBindContext: { type: "boolean" },
    insecureAcknowledged: { type: "boolean" },
    group: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "searchBase", "filter", "memberAttribute", "userAttribute"],
      properties: {
        enabled: { type: "boolean" },
        searchBase: { type: "string" },
        filter: { type: "string" },
        memberAttribute: { type: "string" },
        userAttribute: { type: "string" },
      },
    },
  },
}
const tokenPair: Json = {
  type: "object",
  additionalProperties: false,
  required: ["accessToken", "refreshToken", "tokenType", "expiresIn", "refreshExpiresIn", "user"],
  properties: {
    accessToken: { type: "string" },
    refreshToken: { type: "string" },
    tokenType: { const: "Bearer" },
    expiresIn: { type: "integer" },
    refreshExpiresIn: { type: "integer" },
    user: ref("MarketUser"),
  },
}

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "ChipMate Skill Market API",
    version: "1.0.0",
    description: "Shared aligned-v1 contract for the Web market and ChipMate Marketplace.",
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
    { name: "administration" },
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
          required: ["username", "password"],
          properties: {
            username: { type: "string", minLength: 1 },
            password: { type: "string", minLength: 1 },
          },
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
    "/api/v1/auth/status": {
      get: {
        operationId: "getAuthStatus",
        tags: ["identity"],
        responses: ok({ type: "object" }),
      },
    },
    "/api/v1/auth/device/code": {
      post: {
        operationId: "createDeviceCode",
        tags: ["identity"],
        responses: ok({ type: "object" }),
      },
    },
    "/api/v1/auth/device/approve": {
      post: {
        operationId: "approveDeviceCode",
        tags: ["identity"],
        security: [{ cookieSession: [] }],
        parameters: [param("X-CSRF-Token", "header", true)],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["userCode"],
          properties: { userCode: { type: "string" } },
        }),
        responses: ok({ type: "object", required: ["ok"], properties: { ok: { const: true } } }),
      },
    },
    "/api/v1/auth/device/deny": {
      post: {
        operationId: "denyDeviceCode",
        tags: ["identity"],
        security: [{ cookieSession: [] }],
        parameters: [param("X-CSRF-Token", "header", true)],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["userCode"],
          properties: { userCode: { type: "string" } },
        }),
        responses: ok({ type: "object", required: ["ok"], properties: { ok: { const: true } } }),
      },
    },
    "/api/v1/auth/device/token": {
      post: {
        operationId: "exchangeDeviceCode",
        tags: ["identity"],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["deviceCode"],
          properties: { deviceCode: { type: "string" } },
        }),
        responses: ok(tokenPair),
      },
    },
    "/api/v1/auth/token/refresh": {
      post: {
        operationId: "refreshAccessToken",
        tags: ["identity"],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string" } },
        }),
        responses: ok(tokenPair),
      },
    },
    "/api/v1/auth/token/revoke": {
      post: {
        operationId: "revokeAccessToken",
        tags: ["identity"],
        security: [{ bearerKey: [] }],
        responses: ok({ type: "object", required: ["ok"], properties: { ok: { const: true } } }),
      },
    },
    "/api/v1/admin/auth/session": {
      get: {
        operationId: "getAdminSession", tags: ["administration"],
        responses: ok({ type: "object", required: ["mode"], properties: {
          mode: { type: "string", enum: ["ldap", "break-glass"] }, expiresAt: { type: "string", format: "date-time" },
          subject: { type: "string" }, userId: { type: "string" },
        } }),
      },
      delete: {
        operationId: "deleteBreakGlassSession", tags: ["administration"],
        parameters: [param("X-CSRF-Token", "header", true)],
        responses: ok({ type: "object", required: ["ok"], properties: { ok: { const: true } } }),
      },
      post: {
        operationId: "createBreakGlassSession",
        tags: ["administration"],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["key"],
          properties: { key: { type: "string" } },
        }),
        responses: ok({ type: "object", required: ["ok"], properties: { ok: { const: true } } }),
      },
    },
    "/api/v1/admin/auth/admins": {
      get: {
        operationId: "listServerAdministrators", tags: ["administration"],
        responses: ok({ type: "object", required: ["items"], properties: { items: { type: "array", items: {
          ...adminIdentity, required: [...adminIdentity.required, "grantedAt", "grantedBy"],
          properties: { ...adminIdentity.properties, grantedAt: { type: "string", format: "date-time" }, grantedBy: { type: "string" } },
        } } } }),
      },
      post: {
        operationId: "grantServerAdministrator", tags: ["administration"], parameters: [param("X-CSRF-Token", "header", true)],
        requestBody: body({ type: "object", additionalProperties: false, required: ["username", "subject"],
          properties: { username: { type: "string", minLength: 1 }, subject: { type: "string", minLength: 1 } } }),
        responses: ok(adminChange),
      },
    },
    "/api/v1/admin/auth/admins/resolve": {
      post: {
        operationId: "resolveServerAdministrator", tags: ["administration"], parameters: [param("X-CSRF-Token", "header", true)],
        requestBody: body({ type: "object", additionalProperties: false, required: ["username"], properties: { username: { type: "string", minLength: 1 } } }),
        responses: ok(adminIdentity),
      },
    },
    "/api/v1/admin/auth/admins/{subject}": {
      delete: {
        operationId: "revokeServerAdministrator", tags: ["administration"],
        parameters: [param("subject", "path"), param("X-CSRF-Token", "header", true)], responses: ok(adminChange),
      },
    },
    "/api/v1/admin/auth/ldap": {
      get: {
        operationId: "getLdapConfig",
        tags: ["administration"],
        responses: ok({ type: "object" }),
      },
      put: {
        operationId: "putLdapConfig",
        tags: ["administration"],
        parameters: [param("X-CSRF-Token", "header", true)],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["config"],
          properties: { config: ldapConfig, bindPassword: { type: "string" }, testUsername: { type: "string" } },
        }),
        responses: ok({ type: "object" }),
      },
    },
    "/api/v1/admin/auth/ldap/test": {
      post: {
        operationId: "testLdapConfig",
        tags: ["administration"],
        parameters: [param("X-CSRF-Token", "header", true)],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["config"],
          properties: { config: ldapConfig, bindPassword: { type: "string" }, username: { type: "string" } },
        }),
        responses: ok({ type: "object" }),
      },
    },
    "/api/v1/admin/auth/identity-mappings": {
      get: {
        operationId: "listIdentityMappings",
        tags: ["administration"],
        responses: ok({ type: "object" }),
      },
      post: {
        operationId: "createIdentityMapping",
        tags: ["administration"],
        parameters: [param("X-CSRF-Token", "header", true)],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["username", "userId"],
          properties: { username: { type: "string" }, userId: { type: "string" } },
        }),
        responses: ok({ type: "object" }),
      },
    },
    "/api/v1/admin/auth/identity-mappings/{subject}": {
      delete: {
        operationId: "deleteIdentityMapping",
        tags: ["administration"],
        parameters: [param("subject", "path"), param("X-CSRF-Token", "header", true)],
        responses: ok({ type: "object" }),
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
            headers: {
              "Content-Disposition": { schema: { type: "string" } },
              "Content-Length": { schema: { type: "integer" } },
              "Accept-Ranges": { schema: { type: "string", enum: ["none"] } },
              "X-Content-Sha256": { schema: { type: "string" } },
            },
            content: { "application/gzip": { schema: { type: "string", format: "binary" } } },
          },
          "416": { description: "Range requests are not supported" },
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
    "/api/v1/publications/{runId}/undo": {
      post: {
        operationId: "undoPublication",
        tags: ["publications"],
        security: [{ cookieSession: [] }, { bearerKey: [] }],
        parameters: [run, param("Idempotency-Key", "header", true), param("X-CSRF-Token", "header")],
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
        description: "Upload one VSIX file. The first successful publisher owns the extension ID; successful ChipMate uploads immediately enter the automatic update manifest. Same-version, same-target content conflicts are rejected without replacing either artifact.",
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
        responses: {
          ...ok(ref("ExtensionPublicationRun")),
          "408": { description: "Upload idle or absolute timeout", content: json(ref("ApiError")) },
          "503": { description: "All publication slots are busy; retry after the response Retry-After interval", content: json(ref("ApiError")) },
          "507": { description: "Extension artifact storage is under pressure", content: json(ref("ApiError")) },
        },
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
          required: ["ok", "transport", "render", "market", "packages", "auth"],
          properties: {
            ok: { type: "boolean" },
            transport: { enum: ["trusted-http", "https"] },
            render: { enum: ["ready", "degraded", "unavailable"] },
            market: { enum: ["ready", "degraded", "unavailable"] },
            packages: { enum: ["ready", "degraded", "unavailable"] },
            auth: { type: "object" },
            extensions: {
              type: "object",
              additionalProperties: false,
              required: ["enabled", "database", "scanner", "drop", "artifacts", "temporary", "warnings"],
              properties: {
                enabled: { type: "boolean" },
                database: { enum: ["ready", "degraded"] },
                scanner: { enum: ["starting", "scanning", "ready"] },
                drop: { type: "boolean" },
                artifacts: { type: "boolean" },
                temporary: { type: "boolean" },
                warnings: { type: "array", items: { type: "string" } },
                activeUploads: { type: "integer", minimum: 0 },
                maxActiveUploads: { type: "integer", minimum: 1 },
                reservedBytes: { type: "integer", minimum: 0 },
                freeBytes: { type: "integer", minimum: 0 },
                minimumFreeBytes: { type: "integer", minimum: 0 },
                storagePressure: { type: "boolean" },
              },
            },
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
