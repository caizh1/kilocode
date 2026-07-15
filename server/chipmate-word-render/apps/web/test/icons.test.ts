import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import test from "node:test"
import { art, image } from "../src/icons.ts"

test("assigns stable category-colored art and keeps the curated ChipMate mark", () => {
  assert.equal(art({ id: "source-backed-detail-design", category: "documents" }), "/assets/chipmate-icon.png")
  assert.match(art({ id: "docs-a", category: "documents" }), /^\/assets\/skill-icons\/docs-/)
  assert.match(art({ id: "dev-a", category: "development" }), /^\/assets\/skill-icons\/dev-/)
  assert.match(art({ id: "test-a", category: "testing" }), /^\/assets\/skill-icons\/test-/)
  assert.match(art({ id: "ops-a", category: "operations" }), /^\/assets\/skill-icons\/ops-/)
  assert.equal(art({ id: "dev-a", category: "development" }), art({ id: "dev-a", category: "development" }))
})

test("uses author artwork first and gives unknown categories a stable family", () => {
  const artwork = {
    type: "icon" as const,
    url: "https://example.test/custom.png",
    mime: "image/png",
    width: 256,
    height: 256,
    sha256: "a".repeat(64),
  }
  assert.equal(image({ id: "custom", category: "unlisted", artwork }), artwork.url)
  assert.equal(art({ id: "custom", category: "unlisted" }), art({ id: "custom", category: "unlisted" }))
})

test("ships twenty independent generated skill icons", async () => {
  const files = (await readdir(new URL("../public/assets/skill-icons/", import.meta.url))).filter((file) =>
    file.endsWith(".webp"),
  )
  assert.equal(files.length, 20)
  assert.equal(new Set(files).size, 20)
})

test("keeps the preview Top 10 varied within each category", () => {
  const groups = {
    development: [
      "api-contract-guardian",
      "cpp-codebase-analysis",
      "architecture-decision-writer",
      "mermaid-system-mapper",
    ],
    testing: ["test-evidence-builder", "security-review-checklist", "migration-plan-auditor"],
    operations: ["release-notes-composer", "repository-onboarding-guide"],
  }
  for (const [category, ids] of Object.entries(groups)) {
    const icons = ids.map((id) => art({ id, category }))
    assert.equal(new Set(icons).size, icons.length)
  }
})
