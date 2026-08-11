import { describe, expect, test } from "bun:test"
import type { BehaviorExtractionResult } from "@kilocode/kilo-indexing/design-doc"
import {
  dataFlowMermaid,
  businessFlowMermaid,
  errorFlowMermaid,
  executionFlowMermaid,
  selectFlowchartCandidate,
  sequenceMermaid,
} from "@/kilocode/design-doc/renderer"
import { buildBehaviorEvidencePack, hasSufficientBehaviorEvidence } from "@/kilocode/design-doc/evidence"
import {
  validateDataFlow,
  validateErrorFlow,
  validateExecutionFlow,
  validateSequence,
} from "@/kilocode/design-doc/behavior-validator"
import { behaviorOutputFormat } from "@/kilocode/design-doc/session-runner"
import { validateBusinessFlow } from "@/kilocode/design-doc/business-flow-validator"

const source = {
  path: "module/run.ts",
  contentHash: "a".repeat(64),
  startLine: 1,
  endLine: 1,
  symbol: "module/run.ts#run@1",
  sourceKind: "production" as const,
}

function readableMermaid(value: string) {
  return value.replaceAll("\u2060", "")
}

function extraction(): BehaviorExtractionResult {
  return {
    moduleID: "MOD-behavior",
    sourceSnapshotHash: "b".repeat(64),
    unknowns: [],
    evidence: [
      raw("flow-node", "入口", 1, { ref: "run::entry", ownerRef: "run", nodeKind: "entry", label: "run" }),
      raw("flow-node", "动作", 2, { ref: "run::action", ownerRef: "run", nodeKind: "action", label: "save()" }),
      raw("flow-edge", "控制流", 2, {
        ref: "edge",
        fromRef: "run::entry",
        toRef: "run::action",
        edgeKind: "next",
        label: "顺序执行",
      }),
      raw("flow-node", "被调入口", 4, { ref: "save::entry", ownerRef: "save", nodeKind: "entry", label: "save" }),
      raw("call-message", "调用", 2, {
        ref: "call",
        fromRef: "run",
        toRef: "save",
        label: "save",
        callKind: "internal",
      }),
      raw("data-entity", "输入", 1, { ref: "run::data:input", label: "input", entityKind: "input" }),
      raw("data-entity", "输出", 3, { ref: "run::data:return", label: "return", entityKind: "output" }),
      raw("data-flow", "返回", 3, {
        ref: "data-edge",
        fromRef: "run::data:input",
        toRef: "run::data:return",
        flowKind: "return",
        label: "返回结果",
      }),
      raw("error-node", "抛错", 5, { ref: "run::error", ownerRef: "run", nodeKind: "raise", label: "throw Error" }),
      raw("error-edge", "异常边", 5, {
        ref: "error-edge",
        fromRef: "run::entry",
        toRef: "run::error",
        edgeKind: "error",
        label: "触发异常",
      }),
    ],
  }
}

function raw(
  kind: BehaviorExtractionResult["evidence"][number]["kind"],
  fact: string,
  line: number,
  attributes: Record<string, string>,
) {
  return {
    kind,
    fact,
    source: { ...source, startLine: line, endLine: line },
    attributes,
    confidence: "explicit" as const,
    snippet: fact,
  }
}

function pack(type: "business-flow" | "execution-flow" | "sequence" | "data-flow" | "error-flow") {
  return buildBehaviorEvidencePack({
    artifactType: type,
    extraction: extraction(),
    workItemID: `WI-${type}`,
    maxItems: 64,
    maxPromptBytes: 48 * 1024,
    maxSnippetCharacters: 800,
  })
}

function id(type: Parameters<typeof pack>[0], ref: string) {
  return pack(type).evidence.find((item) => item.attributes.ref === ref)!.id
}

describe("行为视角 Evidence Pack", () => {
  test.each(["business-flow", "execution-flow", "sequence", "data-flow", "error-flow"] as const)(
    "%s 只保留本视角证据且满足门禁",
    (type) => {
      const evidence = pack(type)
      expect(evidence.artifactType).toBe(type)
      expect(hasSufficientBehaviorEvidence(evidence)).toBe(true)
      expect(evidence.obligations.every((item) => item.required)).toBe(true)
    },
  )
})

describe("BusinessFlowIR", () => {
  test("把源码控制流转换为独立的业务活动语义并精确覆盖证据", () => {
    const evidence = pack("business-flow")
    const candidate = {
      schemaVersion: 1 as const,
      moduleID: "MOD-behavior",
      viewType: "business-flow" as const,
      title: "业务流程",
      summary: "业务流程",
      assumptions: [],
      unknowns: [],
      activities: [
        {
          id: "entry",
          kind: "activity" as const,
          sourceRef: "模型虚构入口",
          label: "模型虚构入口",
          businessMeaning: "接收处理请求",
          evidenceIDs: [id("business-flow", "run::entry")],
        },
        {
          id: "action",
          kind: "decision" as const,
          sourceRef: "模型虚构动作",
          label: "模型虚构动作",
          businessMeaning: "保存结果",
          evidenceIDs: [id("business-flow", "run::action")],
        },
      ],
      flows: [
        {
          id: "edge",
          from: "action",
          to: "entry",
          kind: "failure" as const,
          label: "PCIe 链接已建立 (devReg.pcieLink == 1)",
          evidenceIDs: [id("business-flow", "edge")],
        },
      ],
    }
    const result = validateBusinessFlow({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })
    expect(result.report.passed).toBeTrue()
    expect(result.ir?.activities[0]?.businessMeaning).toBe("接收处理请求")
    expect(result.ir?.activities.map(({ sourceRef, kind }) => ({ sourceRef, kind }))).toEqual([
      { sourceRef: "run::entry", kind: "trigger" },
      { sourceRef: "run::action", kind: "activity" },
    ])
    expect(result.ir?.flows[0]).toMatchObject({ from: "entry", to: "action", kind: "next" })
    expect(readableMermaid(businessFlowMermaid(result.ir!))).toContain('-->|"顺序执行"|')
    expect(businessFlowMermaid(result.ir!)).not.toContain("PCIe")
  })
})

describe("ExecutionFlowIR", () => {
  test("精确覆盖执行节点和控制流", () => {
    const evidence = pack("execution-flow")
    const candidate = {
      schemaVersion: 1 as const,
      moduleID: "MOD-behavior",
      viewType: "execution-flow" as const,
      title: "执行流",
      summary: "执行流",
      assumptions: [],
      unknowns: [],
      nodes: [
        {
          id: "entry",
          kind: "error" as const,
          sourceRef: "模型附加了错误的入口位置",
          label: "任意入口展示名",
          evidenceIDs: [id("execution-flow", "run::entry")],
        },
        {
          id: "action",
          kind: "decision" as const,
          sourceRef: "模型附加了错误的动作位置",
          label: "任意动作展示名",
          evidenceIDs: [id("execution-flow", "run::action")],
        },
      ],
      edges: [
        {
          id: "edge",
          from: "action",
          to: "entry",
          kind: "error" as const,
          evidenceIDs: [id("execution-flow", "edge")],
        },
      ],
    }
    const result = validateExecutionFlow({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })
    expect(result.report.passed).toBe(true)
    expect(result.ir!.nodes.map(({ sourceRef, kind }) => ({ sourceRef, kind }))).toEqual([
      { sourceRef: "run::entry", kind: "entry" },
      { sourceRef: "run::action", kind: "action" },
    ])
    expect(result.ir!.edges[0]).toMatchObject({ from: "entry", to: "action", kind: "next" })
    expect(result.ir!.nodes.map((item) => item.label)).toEqual(["run", "save()"])
    expect(readableMermaid(executionFlowMermaid(result.ir!))).toContain('-->|"顺序执行"|')
  })
})

describe("SequenceIR", () => {
  test("精确覆盖调用双方和消息", () => {
    const evidence = pack("sequence")
    const candidate = {
      schemaVersion: 1 as const,
      moduleID: "MOD-behavior",
      viewType: "sequence" as const,
      title: "时序",
      summary: "时序",
      assumptions: [],
      unknowns: [],
      participants: [
        {
          id: "run",
          kind: "internal" as const,
          sourceRef: "run",
          label: "任意入口展示名",
          evidenceIDs: [id("sequence", "run::entry")],
        },
        {
          id: "save",
          kind: "internal" as const,
          sourceRef: "save",
          label: "任意被调用展示名",
          evidenceIDs: [id("sequence", "save::entry")],
        },
      ],
      messages: [
        {
          id: "call",
          from: "run",
          to: "save",
          label: "save(input)",
          kind: "call" as const,
          evidenceIDs: [id("sequence", "call")],
        },
      ],
    }
    const result = validateSequence({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })
    expect(result.report.passed).toBe(true)
    expect(result.ir!.participants.map((item) => item.label)).toEqual(["run", "save"])
    expect(result.ir!.messages[0].label).toBe("save")
    expect(sequenceMermaid(result.ir!)).toContain("sequenceDiagram")
  })
})

describe("DataFlowIR", () => {
  test("精确覆盖实体和数据流", () => {
    const evidence = pack("data-flow")
    const candidate = {
      schemaVersion: 1 as const,
      moduleID: "MOD-behavior",
      viewType: "data-flow" as const,
      title: "数据流",
      summary: "数据流",
      assumptions: [],
      unknowns: [{ text: "证据包缺少运行时信息", evidenceIDs: [] }],
      entities: [
        {
          id: "input",
          kind: "external" as const,
          sourceRef: "模型附加了错误的输入位置",
          label: "任意输入展示名",
          evidenceIDs: [id("data-flow", "run::data:input")],
        },
        {
          id: "output",
          kind: "store" as const,
          sourceRef: "模型附加了错误的输出位置",
          label: "任意输出展示名",
          evidenceIDs: [id("data-flow", "run::data:return")],
        },
      ],
      flows: [
        {
          id: "return",
          from: "output",
          to: "input",
          kind: "write" as const,
          evidenceIDs: [id("data-flow", "data-edge")],
        },
      ],
    }
    const result = validateDataFlow({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })
    expect(result.report.passed).toBe(true)
    expect(result.ir!.entities.map(({ sourceRef, kind }) => ({ sourceRef, kind }))).toEqual([
      { sourceRef: "run::data:input", kind: "input" },
      { sourceRef: "run::data:return", kind: "output" },
    ])
    expect(result.ir!.flows[0]).toMatchObject({ from: "input", to: "output", kind: "return" })
    expect(result.ir!.unknowns).toEqual([])
    expect(result.ir!.entities.map((item) => item.label)).toEqual(["input", "return"])
    expect(readableMermaid(dataFlowMermaid(result.ir!))).toContain('-->|"返回结果"|')
  })

  test("证据重提取后按稳定 sourceRef 重绑定实体和数据流，不沿用过期 Evidence ID", () => {
    const evidence = pack("data-flow")
    const candidate = {
      schemaVersion: 1 as const,
      moduleID: "MOD-behavior",
      viewType: "data-flow" as const,
      title: "数据流",
      summary: "数据流",
      assumptions: [],
      unknowns: [],
      entities: [
        {
          id: "input",
          kind: "input" as const,
          sourceRef: "run::data:input",
          label: "输入",
          evidenceIDs: ["EV-OLD-INPUT"],
        },
        {
          id: "output",
          kind: "output" as const,
          sourceRef: "run::data:return",
          label: "输出",
          evidenceIDs: ["EV-OLD-OUTPUT"],
        },
      ],
      flows: [
        {
          id: "return",
          from: "input",
          to: "output",
          kind: "return" as const,
          label: "返回结果",
          evidenceIDs: ["EV-OLD-FLOW"],
        },
      ],
    }

    const result = validateDataFlow({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(true)
    expect(result.ir!.entities.map((item) => item.evidenceIDs)).toEqual([
      [id("data-flow", "run::data:input")],
      [id("data-flow", "run::data:return")],
    ])
    expect(result.ir!.flows[0].evidenceIDs).toEqual([id("data-flow", "data-edge")])
  })

  test("同一节点对的多条数据流逐条展开为可读步骤，不再压成通道清单", () => {
    const flows = [
      "通过 set_io_sq 传递请求与结果",
      "通过 set_io_sq 传递请求与结果",
      "通过 set_io_cq 传递请求与结果",
      "通过 identify_controller 传递请求与结果",
    ].map((label, index) => ({
      id: `flow-${index}`,
      from: "admin",
      to: "host",
      kind: "transfer" as const,
      label,
      evidenceIDs: [`EV-${index}`],
    }))
    const source = dataFlowMermaid(
      {
        schemaVersion: 1,
        moduleID: "MOD-data-flow",
        viewType: "data-flow",
        title: "数据流",
        summary: "数据流",
        assumptions: [],
        unknowns: [],
        entities: [
          { id: "admin", kind: "variable", sourceRef: "admin", label: "nvme_admin_cmd", evidenceIDs: ["EV-admin"] },
          { id: "host", kind: "variable", sourceRef: "host", label: "host_lld", evidenceIDs: ["EV-host"] },
        ],
        flows,
      },
      "LR",
    )
    const unwrapped = source.replaceAll("<br/>", "").replaceAll("\u2060", "")

    expect(source).toContain("逐条数据读写与传递（4 条）")
    expect(unwrapped).toContain("通过 set_io_sq 传递请求与结果（第 1/2 次）")
    expect(unwrapped).toContain("通过 set_io_sq 传递请求与结果（第 2/2 次）")
    expect(unwrapped).toContain("通过 set_io_cq 传递请求与结果")
    expect(unwrapped).toContain("通过 identify_controller 传递请求与结果")
    expect(source).not.toContain('-->|"通过 set_io_sq 传递请求与结果"|')
    expect(source.match(/D0 --> DREL/g)?.length).toBe(4)
    expect(source.match(/DREL\d+_\d+ --> D1/g)?.length).toBe(4)
  })
})

describe("ErrorFlowIR", () => {
  test("精确覆盖异常入口、抛出和异常边", () => {
    const evidence = pack("error-flow")
    const candidate = {
      schemaVersion: 1 as const,
      moduleID: "MOD-behavior",
      viewType: "error-flow" as const,
      title: "异常流",
      summary: "异常流",
      assumptions: [],
      unknowns: [],
      nodes: [
        {
          id: "entry",
          kind: "entry" as const,
          sourceRef: "run::entry",
          label: "任意入口展示名",
          evidenceIDs: [id("error-flow", "run::entry")],
        },
        {
          id: "raise",
          kind: "raise" as const,
          sourceRef: "run::error",
          label: "任意异常展示名",
          evidenceIDs: [id("error-flow", "run::error")],
        },
      ],
      edges: [
        {
          id: "error",
          from: "entry",
          to: "raise",
          kind: "error" as const,
          evidenceIDs: [id("error-flow", "error-edge")],
        },
      ],
    }
    const result = validateErrorFlow({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })
    expect(result.report.passed).toBe(true)
    expect(result.ir!.nodes.map((item) => item.label)).toEqual(["run", "throw Error"])
    expect(readableMermaid(errorFlowMermaid(result.ir!))).toContain('-->|"触发异常"|')
  })
})

describe("行为视角 Structured Output", () => {
  test.each(["business-flow", "execution-flow", "sequence", "data-flow", "error-flow"] as const)(
    "%s 使用独立 Schema 且禁用 Session 内重试",
    (type) => {
      const format = behaviorOutputFormat(type)
      expect(format.type).toBe("json_schema")
      expect(format.retryCount).toBe(0)
      expect(format.schema.properties.viewType.const).toBe(type)
    },
  )
})

describe("Word 图方向确定性选优", () => {
  test("复杂流程在同一图内拆成多分区并保留全部源码关系", () => {
    const nodes = Array.from({ length: 11 }, (_, index) => ({
      id: `N${index}`,
      kind: index === 0 ? ("entry" as const) : index === 10 ? ("exit" as const) : ("action" as const),
      sourceRef: `source:${index}`,
      label: `源码处理步骤 ${index}`,
      evidenceIDs: [`EV-${index}`],
    }))
    const edges = Array.from({ length: 10 }, (_, index) => ({
      id: `E${index}`,
      from: `N${index}`,
      to: `N${index + 1}`,
      kind: "next" as const,
      label: `顺序执行第 ${index + 1} 步`,
      evidenceIDs: [`EE-${index}`],
    }))

    const mermaid = executionFlowMermaid({
      schemaVersion: 1,
      moduleID: "MOD-panel",
      viewType: "execution-flow",
      title: "复杂流程",
      summary: "",
      assumptions: [],
      unknowns: [],
      nodes,
      edges,
    })

    expect(mermaid).toStartWith("flowchart TD")
    expect(mermaid).toContain('subgraph PANEL_1["流程分区 1"]')
    expect(mermaid).not.toContain("流程分区组")
    expect(mermaid.match(/subgraph PANEL_/g)).toHaveLength(3)
    expect(mermaid.match(/-->/g)).toHaveLength(10)
    expect(readableMermaid(mermaid)).toContain("顺序执行第 10 步")
  })

  test("优先选择通过可读性门禁的候选，而不是固定使用首选方向", () => {
    const selected = selectFlowchartCandidate([
      {
        direction: "TD",
        wordFit: {
          wordFitStatus: "split-required" as const,
          wordFitReasons: ["宽高比超限"],
          wordFitScale: 1,
          wordFitAspectRatio: 4.33,
          wordFitDensity: 2,
        },
      },
      {
        direction: "LR",
        wordFit: {
          wordFitStatus: "readable" as const,
          wordFitReasons: [],
          wordFitScale: 0.8,
          wordFitAspectRatio: 2.4,
          wordFitDensity: 3,
        },
      },
    ])
    expect(selected?.direction).toBe("LR")
  })

  test("候选都不通过时选择失败原因更少且更接近 Word 门限的布局", () => {
    const selected = selectFlowchartCandidate([
      {
        direction: "TD",
        wordFit: {
          wordFitStatus: "split-required" as const,
          wordFitReasons: ["缩放超限", "宽高比超限"],
          wordFitScale: 0.5,
          wordFitAspectRatio: 5,
          wordFitDensity: 4,
        },
      },
      {
        direction: "LR",
        wordFit: {
          wordFitStatus: "split-required" as const,
          wordFitReasons: ["宽高比超限"],
          wordFitScale: 0.9,
          wordFitAspectRatio: 4.1,
          wordFitDensity: 3,
        },
      },
    ])
    expect(selected?.direction).toBe("LR")
  })
})
