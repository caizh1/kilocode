import assert from "node:assert/strict"
import test from "node:test"
import { Value } from "@sinclair/typebox/value"
import {
  MARKET_ERROR_CODES,
  LEGACY_ROUTES,
  MarketCapabilitiesSchema,
  PUBLICATION_LABELS,
  PUBLICATION_STATUSES,
  ValidationIssueSchema,
} from "../src/index.ts"

test("public publication states and labels remain complete", () => {
  assert.equal(PUBLICATION_STATUSES.length, 10)
  assert.equal(PUBLICATION_LABELS.CAPABILITY_UNSUPPORTED, "服务器能力不支持")
  assert.ok(MARKET_ERROR_CODES.includes("INTENT_REPLAYED"))
})

test("Fastify registers the complete frozen legacy route list", () => {
  assert.equal(LEGACY_ROUTES.length, 15)
  assert.ok(LEGACY_ROUTES.some((route) => route.method === "POST" && route.url === "/convert/word-to-images"))
  assert.ok(LEGACY_ROUTES.some((route) => route.method === "POST" && route.url === "/render/word"))
  assert.ok(LEGACY_ROUTES.some((route) => route.method === "POST" && route.url === "/render/plantuml"))
  assert.ok(LEGACY_ROUTES.some((route) => route.method === "GET" && route.url === "/marketplace/skills/*"))
})

test("word render response exposes exact page evidence and an optional refreshed DOCX", () => {
  const route = LEGACY_ROUTES.find((item) => item.method === "POST" && item.url === "/render/word")
  assert.ok(route?.schema.response?.[200])
  assert.equal(
    Value.Check(route.schema.response[200], {
      ok: true,
      pageCount: 3,
      returnedPageCount: 3,
      pageCountKind: "exact",
      fieldRefreshStatus: "completed",
      fieldRefreshDiagnostics: [],
      tocHeadingCount: 2,
      tocEntryCount: 2,
      tocPageNumberCount: 2,
      updatedDocxBase64: "UEsDBA==",
      pdf: { contentType: "application/pdf", base64: "JVBERg==" },
      pages: [1, 2, 3].map((page) => ({
        page,
        contentType: "image/png",
        base64: "iVBORw==",
        width: 100,
        height: 100,
        visualSummary: {},
      })),
      textQa: {
        ok: true,
        titlePresent: true,
        firstHeadingPresent: true,
        sourceCjkCount: 20,
        pdfCjkCount: 20,
        cjkCoverage: 1,
        sentinelCount: 3,
        matchedSentinelCount: 3,
        sentinelCoverage: 1,
        diagnostics: [],
      },
      issues: [],
      renderer: { wordFieldRefresh: "libreoffice" },
    }),
    true,
  )
})

test("word render response reports failed field refresh without claiming an updated DOCX", () => {
  const route = LEGACY_ROUTES.find((item) => item.method === "POST" && item.url === "/render/word")
  assert.ok(route?.schema.response?.[200])
  assert.equal(
    Value.Check(route.schema.response[200], {
      ok: true,
      pageCount: 3,
      returnedPageCount: 3,
      pageCountKind: "exact",
      fieldRefreshStatus: "failed",
      fieldRefreshDiagnostics: ["TOC entries have no materialized page numbers"],
      tocHeadingCount: 2,
      tocEntryCount: 2,
      tocPageNumberCount: 0,
      pdf: { contentType: "application/pdf", base64: "JVBERg==" },
      pages: [1, 2, 3].map((page) => ({
        page,
        contentType: "image/png",
        base64: "iVBORw==",
        width: 100,
        height: 100,
        visualSummary: {},
      })),
      textQa: {
        ok: false,
        titlePresent: true,
        firstHeadingPresent: false,
        sourceCjkCount: 20,
        pdfCjkCount: 20,
        cjkCoverage: 1,
        sentinelCount: 3,
        matchedSentinelCount: 2,
        sentinelCoverage: 2 / 3,
        diagnostics: ["first heading has no refreshed page mapping"],
      },
      issues: [{ severity: "warning", code: "word-field-refresh-failed", message: "refresh failed" }],
      renderer: { wordFieldRefresh: "failed" },
    }),
    true,
  )
})

test("ValidationIssue enforces the frozen structured fields", () => {
  const issue = {
    code: "frontmatter-missing",
    severity: "error",
    file: "SKILL.md",
    line: 1,
    field: "frontmatter",
    message: "SKILL.md must start with YAML frontmatter.",
    expected: "---",
    actual: "# title",
    fixable: true,
    repairKind: "deterministic",
    riskLevel: "none",
  }
  assert.equal(Value.Check(ValidationIssueSchema, issue), true)
  assert.equal(Value.Check(ValidationIssueSchema, { ...issue, unknown: true }), false)
})

test("MarketCapabilities distinguishes aligned-v1 from legacy", () => {
  const capabilities = {
    mode: "aligned-v1",
    apiVersion: "1.0.0",
    catalogVersion: "1",
    skillSpecVersion: "agent-skills-1",
    features: {
      versions: true,
      favorites: true,
      installations: true,
      publications: true,
      repairs: true,
      analytics: true,
      events: true,
    },
  }
  assert.equal(Value.Check(MarketCapabilitiesSchema, capabilities), true)
})
