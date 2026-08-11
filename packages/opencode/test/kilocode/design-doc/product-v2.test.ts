import { describe, expect, test } from "bun:test"
import {
  buildProductDesignWorkItems,
  productSections,
  productViews,
  validateProductDesignMatrix,
} from "@/kilocode/design-doc/product-contract"
import { productJSONSchema, validateProductSection } from "@/kilocode/design-doc/product-validator"
import { assertProductDocumentReaderSafe } from "@/kilocode/design-doc/product-document"
import type { WordSection } from "@/kilocode/documents/word"
import type { EvidencePack } from "@/kilocode/design-doc/domain"

describe("产品级详细设计 V2", () => {
  test("程序为每个逻辑模块创建专用章节和五类视图", () => {
    let sequence = 0
    const modules = ["MOD-root", "MOD-dma"]
    const workItems = buildProductDesignWorkItems(modules, 1, () => `WI-${++sequence}`)

    expect(productSections).toHaveLength(13)
    expect(productViews).toHaveLength(5)
    expect(workItems).toHaveLength(modules.length * 18 + 1)
    expect(validateProductDesignMatrix(modules, workItems)).toEqual({ passed: true, errors: [] })
    expect(workItems.at(-1)?.purpose).toEqual({ kind: "review" })
  })

  test("缺少产品章节或五视图时矩阵拒绝发布", () => {
    let sequence = 0
    const workItems = buildProductDesignWorkItems(["MOD-root"], 1, () => `WI-${++sequence}`)
    const incomplete = workItems.filter(
      (item) => !(item.purpose?.kind === "product-section" && item.purpose.section === "sfmea"),
    )

    const result = validateProductDesignMatrix(["MOD-root"], incomplete)

    expect(result.passed).toBeFalse()
    expect(result.errors).toContain("MOD-root / section:sfmea 至少需要 1 个原子工作项，实际为 0")
  })

  test("产品章节要求正文、主张和必需证据形成闭环", () => {
    const pack = evidencePack("module-overview")
    const validation = validateProductSection({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: pack.sourceSnapshotHash,
      candidate: {
        schemaVersion: 2,
        moduleID: pack.moduleID,
        viewType: "product-section",
        section: "module-overview",
        title: "模块概述",
        summary: "模块接收命令并完成分派。",
        claims: [
          {
            id: "CLAIM-1",
            subject: "命令分派",
            statement: "模块入口将命令分派给处理函数。",
            confidence: "confirmed",
            evidenceIDs: ["EV-1"],
          },
        ],
        paragraphs: [{ text: "模块以统一入口接收命令，并按命令类型交给对应处理路径。", claimIDs: ["CLAIM-1"] }],
        assumptions: [],
        unknowns: [],
        responsibilities: [{ id: "R-1", name: "命令分派", description: "选择处理路径", claimIDs: ["CLAIM-1"] }],
        boundaries: [{ id: "B-1", name: "边界", description: "不承担介质写入", claimIDs: ["CLAIM-1"] }],
      },
    })

    expect(validation.report.passed).toBeTrue()
    expect(validation.report.errors).toHaveLength(0)
  })

  test("runtime 删除正文文件枚举但允许内部主张保留完整追溯", () => {
    const pack = evidencePack("module-overview")
    const validation = validateProductSection({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: pack.sourceSnapshotHash,
      candidate: {
        schemaVersion: 2,
        moduleID: pack.moduleID,
        viewType: "product-section",
        section: "module-overview",
        title: "模块概述",
        summary: "模块按业务组件组织。",
        claims: [
          {
            id: "CLAIM-1",
            subject: "内部追溯",
            statement: "a.c、b.c、c.h 与 d.h 共同提供该设计事实。",
            confidence: "confirmed",
            evidenceIDs: ["EV-1"],
          },
        ],
        paragraphs: [
          { text: "实现分散在 a.c、b.c、c.h 与 d.h。", claimIDs: ["CLAIM-1"] },
          { text: "模块按入口、处理和支撑三个业务组件协作。", claimIDs: ["CLAIM-1"] },
        ],
        assumptions: [],
        unknowns: [],
        responsibilities: [{ id: "R-1", name: "业务协作", description: "按职责协作", claimIDs: ["CLAIM-1"] }],
        boundaries: [],
      },
    })

    expect(validation.report.passed).toBeTrue()
    expect(validation.ir?.paragraphs.map((item) => item.text)).toEqual(["模块按入口、处理和支撑三个业务组件协作。"])
    expect(validation.report.warnings.map((item) => item.code)).toContain("FILE_LIST_NARRATIVE_REMOVED")
  })

  test("正文泄漏内部编号或遗漏证据时不能通过", () => {
    const pack = evidencePack("module-overview")
    const validation = validateProductSection({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: pack.sourceSnapshotHash,
      candidate: {
        schemaVersion: 2,
        moduleID: pack.moduleID,
        viewType: "product-section",
        section: "module-overview",
        title: "模块概述",
        summary: "参见 EV-1。",
        claims: [],
        paragraphs: [{ text: "参见 WorkItem。", claimIDs: [] }],
        assumptions: [],
        unknowns: [],
        responsibilities: [],
        boundaries: [],
      },
    })

    expect(validation.report.passed).toBeFalse()
    expect(validation.report.errors.map((item) => item.code)).toContain("INTERNAL_TERM_LEAK")
    expect(validation.report.errors.map((item) => item.code)).toContain("MISSING_REQUIRED_EVIDENCE")
  })

  test("声明或依赖证据不能被扩写为已确认行为", () => {
    const pack = evidencePack("module-overview")
    pack.evidence[0]!.kind = "dependency"
    pack.evidence[0]!.fact = "command.c 引用 request_transform.h"
    pack.obligations[0]!.kind = "relationship"
    const validation = validateProductSection({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: pack.sourceSnapshotHash,
      candidate: {
        schemaVersion: 2,
        moduleID: pack.moduleID,
        viewType: "product-section",
        section: "module-overview",
        title: "模块概述",
        summary: "模块存在跨组件依赖。",
        claims: [{ id: "CLAIM-1", subject: "请求变换", statement: "request_transform.h 用于完成请求语义变换。", confidence: "confirmed", evidenceIDs: ["EV-1"] }],
        paragraphs: [{ text: "模块通过请求变换组件衔接后端。", claimIDs: ["CLAIM-1"] }],
        assumptions: [],
        unknowns: [],
        responsibilities: [{ id: "R-1", name: "请求衔接", description: "衔接后端", claimIDs: ["CLAIM-1"] }],
        boundaries: [],
      },
    })

    expect(validation.report.passed).toBeFalse()
    expect(validation.report.errors.map((item) => item.code)).toContain("CONFIDENCE_OVERSTATED")
  })

  test("每个章节只向模型暴露自己的专用 JSON Schema", () => {
    const overview = productJSONSchema("module-overview") as { properties?: Record<string, unknown> }
    const sfmea = productJSONSchema("sfmea") as { properties?: Record<string, unknown> }

    expect(overview.properties).toHaveProperty("responsibilities")
    expect(overview.properties).not.toHaveProperty("failureModes")
    expect(sfmea.properties).toHaveProperty("failureModes")
    expect(sfmea.properties).not.toHaveProperty("responsibilities")
  })

  test("发布检查忽略不可见的内部图片路径但拒绝可见机器字段", () => {
    const sections = productSectionsForReaderTest()
    sections[2]!.blocks = [
      {
        type: "image",
        path: ".kilo/artifacts/design-doc/work-items/WI-internal/render.png",
        altText: "总体结构图",
        caption: "总体结构图",
      },
    ]

    expect(() => assertProductDocumentReaderSafe(sections)).not.toThrow()
    sections[2]!.blocks = [{ type: "paragraph", text: "请查看 EV-internal" }]
    expect(() => assertProductDocumentReaderSafe(sections)).toThrow("公开产品文档包含内部字段")
  })
})

function productSectionsForReaderTest(): WordSection[] {
  return [
    ["模块概述", 1],
    ["需求设计", 2],
    ["总体结构", 2],
    ["数据实体结构", 1],
    ["关键算法设计", 1],
    ["对外提供接口", 1],
    ["对外依赖接口", 1],
    ["内部接口定义", 1],
    ["关键流程设计", 1],
    ["资源开销和性能设计", 1],
    ["DFX 设计", 1],
    ["SFMEA 设计", 1],
    ["自验证用例设计", 1],
  ].map(([title, level]) => ({ title: String(title), level: level as 1 | 2, blocks: [] }))
}

function evidencePack(section: "module-overview"): EvidencePack {
  return {
    schemaVersion: 1,
    id: "PACK-1",
    moduleID: "MOD-root",
    moduleName: "命令模块",
    workItemID: "WI-1",
    artifactType: "product-section",
    purpose: { kind: "product-section", section },
    sourceSnapshotHash: "snapshot",
    evidence: [
      {
        id: "EV-1",
        kind: "flow-node",
        fact: "入口 dispatch_cmd 分派命令。",
        source: {
          path: "src/command.c",
          contentHash: "hash",
          startLine: 10,
          endLine: 20,
          symbol: "dispatch_cmd",
          sourceKind: "production",
        },
        attributes: { ref: "src/command.c#dispatch_cmd@10" },
        confidence: "explicit",
        snippet: "void dispatch_cmd(void) {}",
      },
    ],
    obligations: [{ id: "OB-1", kind: "flow-node", evidenceIDs: ["EV-1"], required: true }],
    unknowns: [],
    budget: { items: 1, promptBytes: 128, truncated: false },
  }
}
