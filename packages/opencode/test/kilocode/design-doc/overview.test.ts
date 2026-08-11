import { describe, expect, test } from "bun:test"
import type { OverviewExtractionResult } from "@kilocode/kilo-indexing/design-doc"
import { buildOverviewEvidencePack, hasSufficientOverviewEvidence } from "@/kilocode/design-doc/evidence"
import { overviewOutputFormat } from "@/kilocode/design-doc/session-runner"
import { validateOverview } from "@/kilocode/design-doc/overview-validator"
import { overviewMermaid } from "@/kilocode/design-doc/renderer"

const source = {
  path: "module/run.ts",
  contentHash: "a".repeat(64),
  startLine: 1,
  endLine: 1,
  sourceKind: "production" as const,
}

function extraction(): OverviewExtractionResult {
  return {
    moduleID: "MOD-overview",
    sourceSnapshotHash: "b".repeat(64),
    unknowns: [],
    evidence: [
      { kind: "source-file", fact: "模块包含源码文件 module/run.ts", source, attributes: { ref: "module/run.ts", language: "typescript" }, confidence: "explicit", snippet: "export function run() {}" },
      { kind: "code-symbol", fact: "module/run.ts 声明 function run", source: { ...source, symbol: "run" }, attributes: { ref: "module/run.ts#run@1", name: "run", qualifiedName: "run", symbolKind: "function", parentRef: "module/run.ts" }, confidence: "explicit", snippet: "export function run() {}" },
      { kind: "flow-node", fact: "run 包含 entry 步骤", source: { ...source, symbol: "module/run.ts#run@1" }, attributes: { ref: "module/run.ts#run@1::entry", ownerRef: "module/run.ts#run@1", nodeKind: "entry", label: "run" }, confidence: "explicit", snippet: "export function run() {}" },
      { kind: "configuration", fact: "源码读取配置 API_ENDPOINT", source, attributes: { ref: "module/run.ts#config:API_ENDPOINT@1", key: "API_ENDPOINT", configKind: "environment" }, confidence: "explicit", snippet: "process.env.API_ENDPOINT" },
      { kind: "dependency", fact: "module/run.ts 导入 ./helper", source, attributes: { from: "module/run.ts", to: "./helper", dependencyKind: "import", internal: true }, confidence: "explicit", snippet: "import { helper } from './helper'" },
    ],
  }
}

describe("OverviewIR", () => {
  test("概览事实必须逐项精确对应源码证据", () => {
    const pack = buildOverviewEvidencePack({ extraction: extraction(), workItemID: "WI-overview", moduleName: "订单处理", maxItems: 64, maxPromptBytes: 48 * 1024, maxSnippetCharacters: 800 })
    const byRef = (ref: string) => pack.evidence.find((item) => item.attributes.ref === ref)!.id
    const candidate = {
      schemaVersion: 1 as const,
      moduleID: "MOD-overview",
      viewType: "overview" as const,
      title: "概览",
      summary: "概览",
      assumptions: [],
      unknowns: [],
      responsibilities: [{ text: "虚构职责：向火星发送支付数据", evidenceIDs: [byRef("module/run.ts#run@1::entry")] }],
      boundaries: [{ text: "虚构边界：控制仓库外部系统", evidenceIDs: [byRef("module/run.ts")] }],
      items: [
        { id: "file", kind: "file" as const, sourceRef: "module/run.ts", label: "run.ts", evidenceIDs: [byRef("module/run.ts")] },
        { id: "symbol", kind: "symbol" as const, sourceRef: "module/run.ts#run@1", label: "function run", evidenceIDs: [byRef("module/run.ts#run@1")] },
        { id: "entry", kind: "entry" as const, sourceRef: "module/run.ts#run@1", label: "run", evidenceIDs: [byRef("module/run.ts#run@1::entry")] },
        { id: "config", kind: "configuration" as const, sourceRef: "module/run.ts#config:API_ENDPOINT@1", label: "API_ENDPOINT", evidenceIDs: [byRef("module/run.ts#config:API_ENDPOINT@1")] },
        { id: "dependency", kind: "dependency" as const, sourceRef: "仅用于展示、不是证据身份", label: "UI 可合并多条依赖", evidenceIDs: [pack.evidence.find((item) => item.kind === "dependency")!.id] },
      ],
    }
    const result = validateOverview({ candidate, pack, attempt: 1, currentSourceSnapshotHash: pack.sourceSnapshotHash })
    expect(hasSufficientOverviewEvidence(pack)).toBe(true)
    expect(result.report.passed).toBe(true)
    expect(result.ir?.responsibilities.map((item) => item.text)).toContain("提供执行入口 run")
    expect(result.ir?.boundaries.map((item) => item.text)).toContain("源码边界包含 module/run.ts")
    expect(JSON.stringify(result.ir)).not.toContain("火星")
    expect(JSON.stringify(result.ir)).not.toContain("仓库外部系统")
    expect(result.ir?.title).toBe("订单处理 模块概览")
    expect(result.ir?.items.find((item) => item.kind === "file")?.label).toBe("run.ts")
    expect(result.ir?.items.find((item) => item.kind === "symbol")?.label).toBe("function run")
    expect(result.ir?.items.find((item) => item.kind === "dependency")?.sourceRef).toBe("module/run.ts->./helper")
    expect(result.ir?.relations?.map((item) => item.label)).toEqual(
      expect.arrayContaining(["声明", "提供入口", "依赖", "读取配置"]),
    )
    const mermaid = overviewMermaid(result.ir!).replaceAll("\u2060", "")
    expect(mermaid).toContain("flowchart LR")
    expect(mermaid).toContain('M["订单处理 模块概览"]')
    expect(mermaid).not.toContain("MOD-overview")
    expect(mermaid.match(/M -->/g)?.length).toBe(5)
    expect(mermaid).toContain("源码文件（1）")
    expect(mermaid).toContain("run.ts")
    expect(mermaid).toContain("外部依赖（1）")
    expect(mermaid).toContain('-->|"依赖"|')
    expect(overviewOutputFormat().retryCount).toBe(0)
  })

  test("旧证据包也会从源码路径推导人类可读模块名", () => {
    const pack = buildOverviewEvidencePack({ extraction: extraction(), workItemID: "WI-legacy-overview", maxItems: 64, maxPromptBytes: 48 * 1024, maxSnippetCharacters: 800 })
    const candidate = {
      schemaVersion: 1 as const,
      moduleID: pack.moduleID,
      viewType: "overview" as const,
      title: "任意候选标题",
      summary: "概览",
      assumptions: [],
      unknowns: [],
      responsibilities: [{ text: "职责", evidenceIDs: [pack.evidence.find((item) => item.kind === "flow-node")!.id] }],
      boundaries: [{ text: "边界", evidenceIDs: [pack.evidence.find((item) => item.kind === "source-file")!.id] }],
      items: pack.evidence.map((item) => ({
        id: item.id,
        kind: item.kind === "source-file" ? "file" as const : item.kind === "code-symbol" ? "symbol" as const : item.kind === "flow-node" ? "entry" as const : item.kind === "configuration" ? "configuration" as const : "dependency" as const,
        sourceRef: String(item.attributes.ref ?? `${String(item.attributes.from)}->${String(item.attributes.to)}`),
        label: item.fact,
        evidenceIDs: [item.id],
      })),
    }
    const result = validateOverview({ candidate, pack, attempt: 1, currentSourceSnapshotHash: pack.sourceSnapshotHash })
    expect(result.report.passed).toBe(true)
    expect(result.ir?.title).toBe("run 模块概览")
    expect(result.ir?.title).not.toContain("MOD-")
  })
})
