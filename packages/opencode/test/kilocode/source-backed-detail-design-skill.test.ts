import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const skillRoot = path.join(repoRoot, ".kilo/skills/source-backed-detail-design")

describe("source-backed detail design skill migration boundary", () => {
  test("uses Kilo-native tools and keeps ChipMate runtime out of the migrated skill", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const allowedTools = frontmatterList(skill, "allowed-tools")

    expect(frontmatterValue(skill, "name")).toBe("source-backed-detail-design")
    expect(frontmatterValue(skill, "description")).toBe(
      "Generate or update source-backed detailed design documents with Kilo native code/document evidence tools, Mermaid PNG artifacts, Word docx output, and render diagnostics.",
    )
    expect(allowedTools).toEqual([
      "codebase_analysis",
      "semantic_search",
      "document_search",
      "read",
      "grep",
      "glob",
      "declare_artifact",
      "list_artifacts",
      "open_artifact",
      "export_artifact_diagnostics",
      "validate_mermaid_diagram",
      "render_mermaid_diagram",
      "save_mermaid_artifact",
      "insert_mermaid_into_word",
      "create_word_document",
      "inspect_word_document",
      "apply_word_document_edits",
      "apply_word_template_styles",
      "materialize_word_fields",
      "merge_word_documents",
      "diff_word_documents",
      "normalize_word_table_spec",
      "render_word_document",
    ])
    expect(skill).toContain("codebase_analysis")
    expect(skill).toContain("semantic_search")
    expect(skill).toContain("document_search")
    expect(skill).toContain("render_mermaid_diagram")
    expect(skill).toContain("create_word_document")
    expect(skill).toContain("inspect_word_document")
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
      await fs.readFile(
        path.join(repoRoot, "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-e2e.json"),
        "utf8",
      ),
    ) as {
      expectedNativeEvidenceTools: string[]
      expectedArtifactTools: string[]
      expectedOutputs: string[]
      expectedCapabilityGroups: string[]
      expectedOutline: string[]
      expectedUnitTopics: string[]
      forbiddenRuntimeMarkers: string[]
      forbiddenContractMarkers: string[]
      forbiddenSampleMarkers: string[]
    }

    for (const tool of [...fixture.expectedNativeEvidenceTools, ...fixture.expectedArtifactTools]) {
      expect(skill).toContain(tool)
    }
    for (const output of fixture.expectedOutputs) {
      expect(output.length).toBeGreaterThan(0)
    }
    for (const group of fixture.expectedCapabilityGroups) {
      expect(skill).toContain(group)
    }
    ordered(skill, fixture.expectedOutline)
    ordered(skill, fixture.expectedUnitTopics)

    const files = await collectFiles(skillRoot)
    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")
    const allowedTools = frontmatterList(skill, "allowed-tools")
    for (const marker of fixture.forbiddenRuntimeMarkers) {
      expect(allowedTools).not.toContain(marker)
    }
    for (const marker of [...fixture.forbiddenContractMarkers, ...fixture.forbiddenSampleMarkers]) {
      expect(combined).not.toContain(marker)
    }
  })

  test("covers full document, state-machine-only, update, and evidence coverage guidance", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const stateMachineRules = await fs.readFile(
      path.join(skillRoot, "references", "06-state-machine-extraction-rules.md"),
      "utf8",
    )
    const outputTemplate = await fs.readFile(
      path.join(skillRoot, "references", "10-detail-design-output-templates.md"),
      "utf8",
    )
    const diffRules = await fs.readFile(
      path.join(skillRoot, "references", "11-feature-diff-completeness-rules.md"),
      "utf8",
    )
    const qualityRules = await fs.readFile(
      path.join(skillRoot, "references", "13-quality-gates-and-validator.md"),
      "utf8",
    )
    const businessCoverageRules = await fs.readFile(
      path.join(skillRoot, "references", "15-business-flow-abstraction-rules.md"),
      "utf8",
    )

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

  test("uses existing Mermaid and Word image-block tools without stale document APIs", async () => {
    const files = await collectFiles(skillRoot)
    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")

    expect(combined).toContain("diagramId -> targetSection -> pngPath -> QA status")
    expect(combined).toContain("sections[].blocks[]")
    expect(combined).toContain('"type": "image"')
    expect(combined).toContain('"path": "<pngPath returned by render_mermaid_diagram>"')
    expect(combined).toContain("inspect_word_document.imageCount")

    for (const forbidden of [
      "start_word_document_draft",
      "append_word_document_sections",
      "finalize_word_document_draft",
      "WordDocSpec",
      "FigureSpec",
      "artifactPath",
      "sections[].figures[]",
    ]) {
      expect(combined).not.toContain(forbidden)
    }
  })

  test("requires five source-backed diagram views and explicit image/page visual review", async () => {
    const files = await collectFiles(skillRoot)
    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")

    expect(combined).toContain(
      "| Parent/target module | Required | Required | Required | Required or evidenced `N/A` | Required |",
    )
    expect(combined).toContain(
      "| Every important submodule | Required | Required | Required | Required or evidenced `N/A` | Required |",
    )
    expect(combined).toContain("architecture: boundaries")
    expect(combined).toContain("business flow: trigger")
    expect(combined).toContain("code flow: entry functions")
    expect(combined).toContain("state machine: states")
    expect(combined).toContain("data/lifecycle: creation")
    expect(combined).toContain("Codex `standard_business_brief`")
    expect(combined).toContain("open it at 100%")
    expect(combined).toContain("inspect pages containing complex diagrams, tables, or code again at 200%")
    expect(combined).toContain("visualQaStatus: skipped")
    expect(combined).toContain("Do not use mechanical node or edge counts as a quality target")
    expect(combined).toContain("Mutations to the same Word document are strictly serial")
    expect(combined).toContain("every call uses the path returned by the immediately preceding successful mutation")
    expect(combined).toContain("do not mark Word assembly complete")
    expect(combined).toContain("semanticPurpose -> sourceEvidence")
    expect(combined).toContain("An image-count match does not compensate for a missing chapter")
    expect(combined).toContain("Automated `pageQa`, ink ratios, edge checks")
    expect(combined).toContain("cannot substitute for actually opening all pages")
    expect(combined).toContain('tocMode: "materialize"')
    expect(combined).toContain("one summary item whose complete text is exactly `{{TOC}}`")
    expect(combined).toContain("write a manual directory as Normal paragraphs")
    expect(combined).toContain('styleId: "Title"')
    expect(combined).toContain("the first outline entry to be `阅读路径`")
    expect(combined).toContain("does not accumulate `-edited` suffixes")
  })

  test("preserves all non-contract capability families after chapter restructuring", async () => {
    const files = await collectFiles(skillRoot)
    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")

    for (const marker of [
      "候选源码范围评分",
      "SRC-0001",
      "08-diagram-edge-coverage.csv",
      "business-flow-steps",
      "Canonical Full-Document Outline",
      "Both、CodeOnly、DocOnly",
      "resume-state.md",
      "00-input/",
      "08-word-export/",
      "Build targets, module registration, initialization order",
    ]) {
      expect(combined).toContain(marker)
    }
  })

  test("keeps full and narrow deliverables on the same skill without broadening QA", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")

    expect(skill).toContain("A full Word delivery")
    expect(skill).toContain("A single-chapter or single-submodule delivery")
    expect(skill).toContain("A state-machine-only delivery")
    expect(skill).toContain("An existing-document update")
    expect(skill).toContain("A source-versus-document difference report")
    expect(skill).toContain("A quick update")
    expect(skill).toContain("Do not expand a narrow request into a full Word deliverable")
    expect(skill).toContain("Do not force ordinary code QA")
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

function frontmatterValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  return match?.[1]?.trim()
}

function ordered(text: string, items: string[]) {
  items.reduce((last, item) => {
    const next = text.indexOf(item, last + 1)
    expect(next).toBeGreaterThan(last)
    return next
  }, -1)
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
