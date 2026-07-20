import { Type, type TSchema } from "@sinclair/typebox"

const issue = Type.Object(
  {
    severity: Type.String(),
    code: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: true },
)
const error = Type.Object(
  {
    ok: Type.Literal(false),
    code: Type.Optional(Type.String()),
    issues: Type.Optional(Type.Array(issue)),
  },
  { additionalProperties: true },
)
const word = Type.Object(
  {
    filename: Type.Optional(Type.String()),
    docxBase64: Type.String(),
    timeoutMs: Type.Optional(Type.Number()),
    maxPages: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
)
const mermaid = Type.Object(
  {
    source: Type.String(),
    filename: Type.Optional(Type.String()),
    scale: Type.Optional(Type.Number()),
    timeoutMs: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
)
const textQa = Type.Object({
  ok: Type.Boolean(),
  titlePresent: Type.Boolean(),
  firstHeadingPresent: Type.Boolean(),
  sourceCjkCount: Type.Number({ minimum: 0 }),
  pdfCjkCount: Type.Number({ minimum: 0 }),
  cjkCoverage: Type.Number({ minimum: 0, maximum: 1 }),
  sentinelCount: Type.Number({ minimum: 0 }),
  matchedSentinelCount: Type.Number({ minimum: 0 }),
  sentinelCoverage: Type.Number({ minimum: 0, maximum: 1 }),
  diagnostics: Type.Array(Type.String()),
})
const page = Type.Object(
  {
    page: Type.Number({ minimum: 1 }),
    contentType: Type.Literal("image/png"),
    base64: Type.String({ minLength: 1 }),
    width: Type.Number({ minimum: 1 }),
    height: Type.Number({ minimum: 1 }),
    visualSummary: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: true },
)
const wordRendered = Type.Object(
  {
    ok: Type.Literal(true),
    pageCount: Type.Number({ minimum: 1 }),
    returnedPageCount: Type.Number({ minimum: 1 }),
    pageCountKind: Type.Union([Type.Literal("exact"), Type.Literal("lower-bound"), Type.Literal("unknown")]),
    fieldRefreshStatus: Type.Union([
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("not-required"),
    ]),
    fieldRefreshDiagnostics: Type.Array(Type.String()),
    tocHeadingCount: Type.Number({ minimum: 0 }),
    tocEntryCount: Type.Number({ minimum: 0 }),
    tocPageNumberCount: Type.Number({ minimum: 0 }),
    updatedDocxBase64: Type.Optional(Type.String()),
    pdf: Type.Object({ contentType: Type.Literal("application/pdf"), base64: Type.String({ minLength: 1 }) }),
    pages: Type.Array(page),
    textQa,
    issues: Type.Array(issue),
    renderer: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: true },
)
const rendered = Type.Object({ ok: Type.Boolean() }, { additionalProperties: true })

export interface LegacyRoute {
  method: "GET" | "POST"
  url: string
  schema: {
    body?: TSchema
    response?: Record<number, TSchema>
  }
}

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  { method: "GET", url: "/", schema: { response: { 200: Type.Object({}, { additionalProperties: true }) } } },
  { method: "GET", url: "/health", schema: { response: { 200: Type.Object({}, { additionalProperties: true }) } } },
  { method: "POST", url: "/render/word", schema: { body: word, response: { 200: wordRendered, 413: error, 422: error, 500: error } } },
  {
    method: "POST",
    url: "/render/mermaid",
    schema: { body: mermaid, response: { 200: rendered, 422: rendered, 500: error } },
  },
  {
    method: "POST",
    url: "/auth/new-api/resolve-user",
    schema: {
      body: Type.Object({ apiKey: Type.String() }, { additionalProperties: true }),
      response: {
        200: Type.Object({}, { additionalProperties: true }),
        400: error,
        404: error,
        429: error,
        503: error,
      },
    },
  },
  {
    method: "GET",
    url: "/packages/manifest.json",
    schema: { response: { 200: Type.Object({}, { additionalProperties: true }) } },
  },
  { method: "GET", url: "/marketplace/skills", schema: { response: { 200: Type.Unknown() } } },
  {
    method: "POST",
    url: "/marketplace/skills",
    schema: {
      body: Type.Object({}, { additionalProperties: true }),
      response: { 200: Type.Unknown(), 201: Type.Unknown(), 401: error },
    },
  },
  {
    method: "GET",
    url: "/marketplace/manifest.json",
    schema: { response: { 200: Type.Object({}, { additionalProperties: true }) } },
  },
  {
    method: "GET",
    url: "/marketplace/skills/:id/files",
    schema: { response: { 200: Type.Object({}, { additionalProperties: true }), 404: error } },
  },
  {
    method: "POST",
    url: "/marketplace/skills/:id/stars",
    schema: { response: { 200: Type.Object({}, { additionalProperties: true }), 401: error, 404: error } },
  },
  {
    method: "GET",
    url: "/marketplace/skills/*",
    schema: { response: { 200: Type.Unknown(), 400: error, 403: error, 404: error } },
  },
  { method: "GET", url: "/packages/*", schema: { response: { 200: Type.Unknown(), 403: error, 404: error } } },
]
