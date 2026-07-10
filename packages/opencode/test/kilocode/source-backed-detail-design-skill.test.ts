import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const skillRoot = path.join(repoRoot, ".kilo/skills/source-backed-detail-design")

describe("source-backed detail design skill migration boundary", () => {
  test("uses Kilo-native tools and keeps ChipMate runtime out of the migrated skill", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const allowedTools = frontmatterList(skill, "allowed-tools")

    expect(skill).toContain("codebase_analysis")
    expect(skill).toContain("semantic_search")
    expect(skill).toContain("document_search")
    expect(skill).toContain("render_mermaid_diagram")
    expect(skill).toContain("create_word_document")
    expect(skill).toContain("render_word_document")
    expect(skill).toContain("not a ChipMate runtime pipeline")
    expect(allowedTools.some((tool) => tool.startsWith("chipmate_"))).toBe(false)
    expect(allowedTools).not.toContain("DesignDocAgentFlow")
  })

  test("ships the required source-backed reference set", async () => {
    const references = [
      "01-core-principles.md",
      "02-input-and-module-scope-rules.md",
      "03-source-exploration-rules.md",
      "04-control-flow-evidence-schema.md",
      "05-submodule-business-flow-rules.md",
      "06-state-machine-extraction-rules.md",
      "07-diagram-planning-and-splitting-rules.md",
      "08-mermaid-png-rendering-rules.md",
      "09-parent-module-assembly-rules.md",
      "10-detail-design-output-templates.md",
      "11-feature-diff-completeness-rules.md",
      "12-word-export-rules.md",
      "13-quality-gates-and-validator.md",
      "14-continuation-checkpoint-protocol.md",
      "15-business-flow-abstraction-rules.md",
    ]

    for (const reference of references) {
      const text = await fs.readFile(path.join(skillRoot, "references", reference), "utf8")
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toContain("chipmate_")
    }
  })

  test("keeps an end-to-end fixture boundary for embedded C detail-design delivery", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const fixture = JSON.parse(
      await fs.readFile(path.join(repoRoot, "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-e2e.json"), "utf8"),
    ) as {
      expectedNativeEvidenceTools: string[]
      expectedArtifactTools: string[]
      expectedOutputs: string[]
      forbiddenRuntimeMarkers: string[]
    }

    for (const tool of [...fixture.expectedNativeEvidenceTools, ...fixture.expectedArtifactTools]) {
      expect(skill).toContain(tool)
    }
    for (const output of fixture.expectedOutputs) {
      expect(output.length).toBeGreaterThan(0)
    }
    const allowedTools = frontmatterList(skill, "allowed-tools")
    for (const marker of fixture.forbiddenRuntimeMarkers) {
      expect(allowedTools).not.toContain(marker)
    }
  })

  test("covers full document, state-machine-only, update, and evidence coverage guidance", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const stateMachineRules = await fs.readFile(path.join(skillRoot, "references", "06-state-machine-extraction-rules.md"), "utf8")
    const outputTemplate = await fs.readFile(path.join(skillRoot, "references", "10-detail-design-output-templates.md"), "utf8")
    const diffRules = await fs.readFile(path.join(skillRoot, "references", "11-feature-diff-completeness-rules.md"), "utf8")
    const qualityRules = await fs.readFile(path.join(skillRoot, "references", "13-quality-gates-and-validator.md"), "utf8")
    const businessCoverageRules = await fs.readFile(path.join(skillRoot, "references", "15-business-flow-abstraction-rules.md"), "utf8")

    expect(skill).toContain("Generate or update source-backed detailed design documents")
    expect(skill).toContain("enhanced-detail-design")
    expect(skill).toContain("Word docx")
    expect(skill).toContain("optionally comparing against an existing detailed design document")
    expect(skill).toContain("apply_word_document_edits")
    expect(skill).toContain("diff_word_documents")
    expect(skill).toContain("not a migrated Word/document contract")
    expect(skill).toContain("Optional Resource Loading")
    expect(skill).toContain("Suggested Work Package Order")
    expect(skill).toContain("Review Checklist")

    expect(stateMachineRules).toContain("dispatch")
    expect(stateMachineRules).toContain("state-overview")
    expect(stateMachineRules).toContain("transition-conditions")
    expect(outputTemplate).toContain("状态机章节必须引用")

    expect(diffRules).toContain("旧")
    expect(diffRules).toContain("差异")
    expect(qualityRules).toContain("Review Checklist")
    expect(qualityRules).toContain("不是 ChipMate 文档合同")
    expect(qualityRules).toContain("不要因为图没有 PNG")
    expect(businessCoverageRules).toContain("12-business-flow-edge-coverage.csv")
    expect(businessCoverageRules).toContain("13-business-text-coverage.csv")
    expect(businessCoverageRules).toContain("unverified")
  })

  test("does not migrate ChipMate document-contract repair helpers", async () => {
    const files = await collectFiles(skillRoot)
    const relativeFiles = files.map((file) => path.relative(skillRoot, file).replaceAll(path.sep, "/"))

    expect(relativeFiles).not.toContain("scripts/validate_artifacts.mjs")
    expect(relativeFiles).not.toContain("scripts/manifest.json")

    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")
    for (const forbidden of [
      "nextToolContract",
      "missingDeliverable",
      "missing-required-artifact",
      "missing-mermaid-pngs",
      "validate_artifacts",
      "缺失文档合同规划",
      "先渲染缺失图表",
    ]) {
      expect(combined).not.toContain(forbidden)
    }
  })
})

function frontmatterList(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `${key}:`)
  if (start === -1) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  - ")) break
    items.push(line.slice(4).trim())
  }
  return items
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const result: string[] = []
  for (const entry of entries) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await collectFiles(file)))
    else if (entry.isFile()) result.push(file)
  }
  return result
}
