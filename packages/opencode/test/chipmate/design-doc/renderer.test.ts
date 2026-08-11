import { describe, expect, test } from "bun:test"
import { mermaidWordFit } from "@/chipmate/documents/mermaid"
import {
  businessFlowMermaid,
  codeStructureMermaid,
  dataFlowMermaid,
  errorFlowMermaid,
  executionFlowMermaid,
  graphFacetPlans,
  lifecycleMermaid,
  lifecycleFacetMermaid,
  lifecycleFitFingerprint,
  overviewMermaid,
  sequenceMermaid,
  structureMermaid,
} from "@/chipmate/design-doc/renderer"
import type { LifecycleIR } from "@/chipmate/design-doc/domain"

function withoutVisualWrap(source: string) {
  return source.replaceAll("<br/>", "").replaceAll("\u2060", "")
}

function expectComplete(source: string, values: string[]) {
  const unwrapped = withoutVisualWrap(source)
  expect(source).not.toContain("…")
  for (const value of values) expect(unwrapped).toContain(value)
}

function denseLifecycle(): LifecycleIR {
  const states = Array.from({ length: 6 }, (_, index) => ({
    id: `S${index}`,
    label: `状态 S${index}`,
    sourceValue: `状态 S${index}：包含较长的业务语义和资源约束说明`,
    role: index === 0 ? ("initial" as const) : index === 5 ? ("terminal" as const) : ("intermediate" as const),
    evidenceIDs: [`EV-state-${index}`],
  }))
  const pairs = [
    [0, 2],
    [0, 4],
    [1, 3],
    [1, 5],
    [2, 0],
    [2, 4],
    [3, 1],
    [3, 5],
    [4, 0],
    [4, 2],
    [5, 1],
    [5, 3],
  ]
  return {
    schemaVersion: 1,
    moduleID: "MOD-dense-state",
    viewType: "lifecycle",
    title: "密集状态机",
    summary: "",
    assumptions: [],
    unknowns: [],
    states,
    transitions: pairs.map(([from, to], index) => ({
      id: `T${index}`,
      from: `S${from}`,
      to: `S${to}`,
      trigger: `收到第 ${index + 1} 类业务事件并完成消息序号与命令槽位校验`,
      guard: "控制器已就绪且队列头尾指针、资源标志和中断掩码全部满足执行条件",
      action: "更新上下文状态、队列指针和命令完成标志，然后通知下游组件继续处理",
      evidenceIDs: [`EV-transition-${index}`],
    })),
    initialStateID: "S0",
    terminalStateIDs: ["S5"],
  }
}

describe("详细设计图标签完整性", () => {
  test("确定性图分面覆盖全部节点且每条边只出现一次", () => {
    const nodes = Array.from({ length: 8 }, (_, index) => ({ id: `N${index}` }))
    const edges = Array.from({ length: 6 }, (_, index) => ({
      id: `E${index}`,
      from: `N${index}`,
      to: `N${index + 1}`,
    }))
    const plans = graphFacetPlans(nodes, edges, 2)

    expect(plans.length).toBeGreaterThan(1)
    expect(plans.flatMap((plan) => plan.edgeIDs).toSorted()).toEqual(edges.map((edge) => edge.id).toSorted())
    expect(new Set(plans.flatMap((plan) => plan.nodeIDs))).toEqual(new Set(nodes.map((node) => node.id)))
  })

  test("密集长标签状态机不再仅凭宽高误判为可读", () => {
    const ir = denseLifecycle()
    const oldResult = mermaidWordFit({ width: 784, height: 340, status: "valid" })
    const result = mermaidWordFit({
      width: 784,
      height: 340,
      status: "valid",
      fingerprint: lifecycleFitFingerprint(ir),
    })

    expect(oldResult.wordFitStatus).toBe("readable")
    expect(result.wordFitStatus).toBe("split-required")
    expect(result.wordFitReasons?.some((reason) => reason.includes("Visual complexity"))).toBe(true)

    const normal = structuredClone(ir)
    normal.states = normal.states.slice(0, 2)
    normal.transitions = [
      {
        id: "normal",
        from: "S0",
        to: "S1",
        trigger: "收到启动事件",
        guard: "初始化已完成",
        action: "进入运行态",
        evidenceIDs: ["EV-normal"],
      },
    ]
    normal.terminalStateIDs = ["S1"]
    expect(
      mermaidWordFit({
        width: 420,
        height: 300,
        status: "valid",
        fingerprint: lifecycleFitFingerprint(normal),
      }).wordFitStatus,
    ).toBe("readable")
  })

  test("执行流保留长源码节点和分支条件，只通过换行控制宽度", () => {
    const decision =
      "检查控制器是否已经完成队列初始化并满足所有直接内存访问前置条件，再根据队列头尾指针、命令槽位、控制器状态和中断掩码选择唯一可执行分支"
    const condition = "controllerReady && adminQueueReady && ioQueueReady && directMemoryAccessEnabled"
    const source = executionFlowMermaid({
      schemaVersion: 1,
      moduleID: "MOD-renderer",
      viewType: "execution-flow",
      title: "执行流程",
      summary: "",
      assumptions: [],
      unknowns: [],
      nodes: [
        { id: "decision", kind: "decision", sourceRef: "run::decision", label: decision, evidenceIDs: ["EV-1"] },
        { id: "action", kind: "action", sourceRef: "run::action", label: "开始处理请求", evidenceIDs: ["EV-2"] },
      ],
      edges: [
        {
          id: "branch",
          from: "decision",
          to: "action",
          kind: "branch-true",
          label: condition,
          evidenceIDs: ["EV-3"],
        },
      ],
    })

    expect(source).toContain("<br/>")
    expectComplete(source, [decision, `条件成立：${condition}`])
  })

  test("状态机保留长状态、触发器、守卫条件和动作", () => {
    const state = "waiting-for-controller-and-all-queue-resources-to-become-ready"
    const trigger = "收到主机提交的初始化完成通知"
    const guard = "controllerReady && submissionQueueReady && completionQueueReady"
    const action = "context.status = NVME_CONTEXT_STATUS_RUNNING"
    const source = lifecycleMermaid({
      schemaVersion: 1,
      moduleID: "MOD-renderer",
      viewType: "lifecycle",
      title: "生命周期",
      summary: "",
      assumptions: [],
      unknowns: [],
      states: [
        { id: "waiting", label: state, sourceValue: state, role: "initial", evidenceIDs: ["EV-1"] },
        { id: "running", label: "running", sourceValue: "running", role: "terminal", evidenceIDs: ["EV-2"] },
      ],
      transitions: [
        {
          id: "start",
          from: "waiting",
          to: "running",
          trigger,
          guard,
          action,
          evidenceIDs: ["EV-3"],
        },
      ],
      initialStateID: "waiting",
      terminalStateIDs: ["running"],
    })

    expectComplete(source, [state, trigger, guard, action])
  })

  test("生命周期分面换行不拆散源码标识符和成员访问", () => {
    const ir: LifecycleIR = {
      schemaVersion: 1,
      moduleID: "MOD-lifecycle-wrap",
      viewType: "lifecycle",
      title: "生命周期",
      summary: "",
      assumptions: [],
      unknowns: [],
      states: [
        {
          id: "idle",
          label: "空闲",
          sourceValue: "NVME_TASK_IDLE",
          role: "initial",
          evidenceIDs: ["EV-idle"],
        },
        {
          id: "waiting",
          label: "等待使能",
          sourceValue: "NVME_TASK_WAIT_CC_EN",
          role: "intermediate",
          evidenceIDs: ["EV-waiting"],
        },
      ],
      transitions: [
        {
          id: "enable",
          from: "idle",
          to: "waiting",
          trigger: "dev_irq_handler",
          guard: "devReg.nvmeCcEn == 1 && nvmeReg.ccEn == 1",
          action: "g_nvmeTask.status = NVME_TASK_WAIT_CC_EN",
          evidenceIDs: ["EV-enable"],
        },
      ],
      initialStateID: "idle",
      terminalStateIDs: [],
    }
    const source = lifecycleFacetMermaid(
      ir,
      { transitions: ir.transitions, stateIDs: ir.states.map((state) => state.id) },
      "TD",
    )

    expect(source).toContain("g_nvmeTask.status")
    expect(source).toContain("NVME_TASK_WAIT_CC_EN")
    expect(source).toContain("devReg.nvmeCcEn")
    expect(source).toContain("nvmeReg.ccEn")
    expect(source).not.toMatch(/g_nvme(?:<br\/>)+Task|NVME_TASK_(?:<br\/>)+WAIT/u)
    expectComplete(source, ["g_nvmeTask.status = NVME_TASK_WAIT_CC_EN"])
  })

  test("数据关系展开后仍保留完整传递描述", () => {
    const relation =
      "通过 set_direct_rx_dma 传递包含地址、长度、命令槽位、自动完成标志、队列编号、命令序号、起始偏移和目标设备地址的完整数据搬运请求与执行结果"
    const source = dataFlowMermaid({
      schemaVersion: 1,
      moduleID: "MOD-renderer",
      viewType: "data-flow",
      title: "数据流",
      summary: "",
      assumptions: [],
      unknowns: [],
      entities: [
        { id: "input", kind: "input", sourceRef: "input", label: relation, evidenceIDs: ["EV-1"] },
        { id: "device", kind: "store", sourceRef: "device", label: "设备侧直接内存访问缓冲区", evidenceIDs: ["EV-2"] },
      ],
      flows: [
        { id: "first", from: "input", to: "device", kind: "transfer", label: relation, evidenceIDs: ["EV-3"] },
        { id: "second", from: "input", to: "device", kind: "transfer", label: relation, evidenceIDs: ["EV-4"] },
      ],
    })

    expectComplete(source, [`${relation}（第 1/2 次）`, `${relation}（第 2/2 次）`])
  })

  test("单面板行不生成重复的阶段组容器标题", () => {
    const activities = Array.from({ length: 8 }, (_, index) => ({
      id: `A${index}`,
      kind: "activity" as const,
      sourceRef: `step-${index}`,
      label: `步骤 ${index}`,
      businessMeaning: `步骤 ${index}`,
      evidenceIDs: [`EV-${index}`],
    }))
    const source = businessFlowMermaid(
      {
        schemaVersion: 1,
        moduleID: "MOD-renderer",
        viewType: "business-flow",
        title: "业务流程",
        summary: "",
        assumptions: [],
        unknowns: [],
        activities,
        flows: activities.slice(1).map((activity, index) => ({
          id: `F${index}`,
          from: activities[index]!.id,
          to: activity.id,
          kind: "next" as const,
          label: "顺序执行",
          evidenceIDs: [`EV-F${index}`],
        })),
      },
      "TD",
      { panelSize: 3, panelsPerRow: 1, panelDirection: "LR" },
    )

    expect(source).toContain('subgraph PANEL_1["业务阶段 1"]')
    expect(source).not.toContain("业务阶段组")
  })

  test("中文换行不拆开函数、状态和寄存器等完整词语", () => {
    const source = businessFlowMermaid({
      schemaVersion: 1,
      moduleID: "MOD-renderer",
      viewType: "business-flow",
      title: "业务流程",
      summary: "",
      assumptions: [],
      unknowns: [],
      activities: [
        {
          id: "step",
          kind: "activity",
          sourceRef: "step",
          label: "设置状态",
          businessMeaning: "进入 set_nvme_csts_rdy 函数，准备设置 NVMe 状态寄存器中的就绪位。",
          evidenceIDs: ["EV-step"],
        },
      ],
      flows: [],
    })

    expect(source).not.toMatch(/函<br\/>数|状<br\/>态|寄存<br\/>器/u)
    expect(source).toContain("函\u2060数")
    expectComplete(source, ["进入 set_nvme_csts_rdy 函数，准备设置 NVMe 状态寄存器中的就绪位。"])
  })

  test("各类流程图和结构图不截断长标签或源码路径", () => {
    const longLabel =
      "完成输入解析、权限检查、资源分配、硬件命令提交、完成状态轮询、异常状态识别、可恢复错误重试、不可恢复错误上报以及执行结果回收的完整处理步骤"
    const longPath = "source/components/controller/queue/very-long-controller-queue-implementation-file.ts"
    const edge = "处理成功后把完整结果交给下一个业务阶段"
    const sources = [
      businessFlowMermaid({
        schemaVersion: 1,
        moduleID: "MOD-renderer",
        viewType: "business-flow",
        title: "业务流程",
        summary: "",
        assumptions: [],
        unknowns: [],
        activities: [
          {
            id: "first",
            kind: "activity",
            sourceRef: "first",
            label: longLabel,
            businessMeaning: longLabel,
            evidenceIDs: ["EV-1"],
          },
          {
            id: "second",
            kind: "outcome",
            sourceRef: "second",
            label: "返回结果",
            businessMeaning: "返回结果",
            evidenceIDs: ["EV-2"],
          },
        ],
        flows: [{ id: "flow", from: "first", to: "second", kind: "success", label: edge, evidenceIDs: ["EV-3"] }],
      }),
      errorFlowMermaid({
        schemaVersion: 1,
        moduleID: "MOD-renderer",
        viewType: "error-flow",
        title: "异常流程",
        summary: "",
        assumptions: [],
        unknowns: [],
        nodes: [
          { id: "entry", kind: "entry", sourceRef: "entry", label: longLabel, evidenceIDs: ["EV-1"] },
          { id: "terminal", kind: "terminal", sourceRef: "terminal", label: "终止处理", evidenceIDs: ["EV-2"] },
        ],
        edges: [{ id: "edge", from: "entry", to: "terminal", kind: "terminate", label: edge, evidenceIDs: ["EV-3"] }],
      }),
      overviewMermaid({
        schemaVersion: 1,
        moduleID: "MOD-renderer",
        viewType: "overview",
        title: "模块总体架构",
        summary: "",
        assumptions: [],
        unknowns: [],
        responsibilities: [],
        boundaries: [],
        items: [{ id: "file", kind: "file", sourceRef: longPath, label: longLabel, evidenceIDs: ["EV-1"] }],
        relations: [],
      }),
      structureMermaid({
        schemaVersion: 1,
        moduleID: "MOD-renderer",
        viewType: "structure",
        title: "模块结构",
        summary: "",
        assumptions: [],
        unknowns: [],
        nodes: [{ id: "file", kind: "source-file", sourceRef: longPath, evidenceIDs: ["EV-1"] }],
        edges: [],
      }),
      codeStructureMermaid({
        schemaVersion: 1,
        moduleID: "MOD-renderer",
        viewType: "code-structure",
        title: "代码结构",
        summary: "",
        assumptions: [],
        unknowns: [],
        nodes: [
          { id: "file", kind: "source-file", sourceRef: longPath, label: longPath, evidenceIDs: ["EV-1"] },
          { id: "symbol", kind: "function", sourceRef: "symbol", label: longLabel, evidenceIDs: ["EV-2"] },
        ],
        edges: [{ id: "contains", from: "file", to: "symbol", kind: "contains", evidenceIDs: ["EV-3"] }],
      }),
      sequenceMermaid({
        schemaVersion: 1,
        moduleID: "MOD-renderer",
        viewType: "sequence",
        title: "调用时序",
        summary: "",
        assumptions: [],
        unknowns: [],
        participants: [
          { id: "caller", kind: "internal", sourceRef: "caller", label: longLabel, evidenceIDs: ["EV-1"] },
          { id: "callee", kind: "internal", sourceRef: "callee", label: "被调用组件", evidenceIDs: ["EV-2"] },
        ],
        messages: [{ id: "call", from: "caller", to: "callee", kind: "call", label: edge, evidenceIDs: ["EV-3"] }],
      }),
    ]

    expectComplete(sources[0]!, [longLabel, edge])
    expectComplete(sources[1]!, [longLabel, edge])
    expectComplete(sources[2]!, [longLabel])
    expectComplete(sources[3]!, [longPath])
    expectComplete(sources[4]!, [longPath, longLabel])
    expectComplete(sources[5]!, [longLabel, edge])
  })
})
