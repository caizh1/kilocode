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
  assert.equal(PUBLICATION_STATUSES.length, 9)
  assert.equal(PUBLICATION_LABELS.CAPABILITY_UNSUPPORTED, "服务器能力不支持")
  assert.ok(MARKET_ERROR_CODES.includes("INTENT_REPLAYED"))
})

test("Fastify registers the complete frozen legacy route list", () => {
  assert.equal(LEGACY_ROUTES.length, 13)
  assert.ok(LEGACY_ROUTES.some((route) => route.method === "POST" && route.url === "/render/word"))
  assert.ok(LEGACY_ROUTES.some((route) => route.method === "GET" && route.url === "/marketplace/skills/*"))
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
