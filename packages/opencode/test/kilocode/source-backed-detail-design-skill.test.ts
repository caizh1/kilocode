import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../../..")
const skillRoot = path.join(root, ".kilo/skills/source-backed-detail-design")

function frontmatterValue(source: string, key: string) {
  return new RegExp(`^${key}:\\s*(.+)$`, "m").exec(source)?.[1]?.trim()
}

function allowed(source: string) {
  const value = frontmatterValue(source, "allowed-tools")
  return (
    value
      ?.slice(1, -1)
      .split(",")
      .map((item) => item.trim()) ?? []
  )
}

describe("source-backed detail design 分块控制器 Skill", () => {
  test("保留 Skill 身份并声明唯一控制器入口", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    expect(frontmatterValue(skill, "name")).toBe("source-backed-detail-design")
    expect(frontmatterValue(skill, "description")).toBe(
      "Generate or update source-backed detailed design documents with Kilo native code/document evidence tools, Mermaid PNG artifacts, Word docx output, and render diagnostics.",
    )
    expect(allowed(skill)).toContain("source_backed_design_job")
    expect(allowed(skill)).toContain("task")
    expect(allowed(skill)).toContain("write")
    expect(allowed(skill)).toContain("edit")
    expect(skill).toContain("SBDD_JOB_REVISION=2026-08-chunked-v1")
    expect(Buffer.byteLength(skill)).toBeLessThan(16 * 1024)
  })

  test("把控制器和零污染规则放在压缩后仍可见的前部", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const head = skill.slice(0, 4_000)
    for (const marker of [
      "完整源码详设 Word 必须使用 `source_backed_design_job`",
      "当前会话续作",
      "跨会话续作",
      "新会话中的普通“继续”不能扫描或恢复任务",
      "普通 QA、普通 Mermaid、普通 Word",
      "absoluteFinalDocxPath",
      "workItem.worker",
    ])
      expect(head).toContain(marker)
    expect(head).toContain("禁止直接调用 `declare_artifact`、`render_mermaid_diagram`、`create_word_document`")
  })

  test("完整保留十四项正文、逐单元五视图和详细图语义", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    for (let id = 1; id <= 14; id++) expect(skill).toContain(`${id}.`)
    for (const marker of [
      "架构图",
      "业务流程图",
      "代码流程图",
      "状态机图或证据化 `N/A`",
      "数据/生命周期图",
      "详细总览＋聚焦图",
      "调用方向",
      "源码证据",
      "current state → event → guard → action → next state",
    ])
      expect(skill).toContain(marker)
    expect(skill).toContain("简单总览不能冒充详细图")
  })

  test("保持中文、封面作者和最终绝对路径规则", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    expect(skill).toContain("默认使用简体中文")
    expect(skill).toContain("ChipMate source-backed-detail-design")
    expect(skill).toContain("禁止只写“详细设计”作为副标题")
    expect(skill).toContain("唯一权威 `.docx` 的绝对路径")
  })

  test("只使用通用角色，不写入验收项目的专有名称", async () => {
    const files = [
      path.join(skillRoot, "SKILL.md"),
      ...(await fs.readdir(path.join(skillRoot, "references"))).map((file) => path.join(skillRoot, "references", file)),
    ]
    const content = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")
    expect(content).not.toMatch(/\b(?:QEMU|OpenSSD|GreedyFTL|NVMe|WCL)\b/i)
    expect(content).not.toMatch(/\b(?:MP|CP)\b/)
    expect(content).toContain("所属上级模块")
    expect(content).toContain("不同关系必须分别取证")
  })

  test("保留全部既有 reference，并明确完整任务由控制器接管", async () => {
    const references = await fs.readdir(path.join(skillRoot, "references"))
    expect(references.sort()).toEqual([
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
    ])
    for (const file of [
      "07-diagram-planning-and-splitting-rules.md",
      "08-mermaid-png-rendering-rules.md",
      "09-parent-module-assembly-rules.md",
      "12-word-export-rules.md",
      "13-quality-gates-and-validator.md",
      "14-continuation-checkpoint-protocol.md",
    ]) {
      const text = await fs.readFile(path.join(skillRoot, "references", file), "utf8")
      expect(text.slice(0, 1_200)).toContain("source_backed_design_job")
    }
  })

  test("不引入全局路由或 runtime contract 语义", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    expect(skill).not.toMatch(/classifier|关键词路由|全局路由|runtime validator|repair steering/i)
    expect(skill).toContain("不自动创建任务")
    expect(skill).toContain("以后恢复完整任务必须重新显式加载本 Skill")
  })
})
