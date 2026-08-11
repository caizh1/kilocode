import { describe, expect, test } from "bun:test"
import type { EvidencePack } from "@/chipmate/design-doc/domain"
import { validateTopic } from "@/chipmate/design-doc/topic-validator"

const pack: EvidencePack = {
  schemaVersion: 1,
  id: "PACK-topic",
  moduleID: "MOD-root",
  workItemID: "WI-topic",
  artifactType: "topic",
  purpose: { kind: "topic", topic: "responsibilities" },
  sourceSnapshotHash: "snapshot",
  evidence: [
    {
      id: "EV-entry",
      kind: "flow-node",
      fact: "入口函数负责启动处理",
      source: {
        path: "module/main.c",
        contentHash: "hash",
        startLine: 10,
        endLine: 12,
        symbol: "main",
        sourceKind: "production",
      },
      attributes: { ref: "module/main.c#main@10", nodeKind: "entry", label: "main" },
      confidence: "explicit",
      snippet: "void main(void)",
    },
  ],
  obligations: [{ id: "OB-entry", kind: "flow-node", evidenceIDs: ["EV-entry"], required: true }],
  unknowns: [],
  budget: { items: 1, promptBytes: 100, truncated: false },
}

describe("DesignTopicIR 校验", () => {
  test("接受主题匹配且所有事实都有显式源码证据的候选", () => {
    const result = validateTopic({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "入口职责",
        conclusions: [{ text: "main 提供处理入口", evidenceIDs: ["EV-entry"] }],
        mechanisms: [{ text: "由 main 函数启动", evidenceIDs: ["EV-entry"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
  })

  test("runtime 覆盖模型回显的任务身份并丢弃不存在的 evidenceId", () => {
    const result = validateTopic({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "not-a-topic",
        applicability: "applicable",
        title: "算法",
        summary: "错误主题",
        conclusions: [{ text: "虚构结论", evidenceIDs: ["EV-missing"] }],
        mechanisms: [{ text: "虚构机制", evidenceIDs: ["EV-missing"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.report.errors.map((item) => item.code)).not.toContain("TOPIC_MISMATCH")
    expect(result.report.warnings.map((item) => item.code)).toContain("MODEL_EVIDENCE_HINT_IGNORED")
    expect(JSON.stringify(result.ir)).not.toContain("EV-missing")
    expect(JSON.stringify(result.ir)).toContain("EV-entry")
  })

  test("模型回显错误 moduleID 和 topic 时由 runtime 恢复为 Evidence Pack 身份", () => {
    const result = validateTopic({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-wrong",
        viewType: "topic",
        topic: "algorithms",
        applicability: "applicable",
        title: "错误身份",
        summary: "错误身份",
        conclusions: [{ text: "入口", evidenceIDs: ["EV-entry"] }],
        mechanisms: [{ text: "入口", evidenceIDs: ["EV-entry"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.ir?.moduleID).toBe("MOD-root")
    expect(result.ir?.topic).toBe("responsibilities")
    expect(result.ir?.title).toBe("职责")
  })

  test("模型遗漏当前主题分片中的必需证据时由 runtime 确定性补齐", () => {
    const completePack: EvidencePack = {
      ...pack,
      evidence: [
        ...pack.evidence,
        {
          ...pack.evidence[0]!,
          id: "EV-handler",
          fact: "命令处理函数负责分发请求",
          source: { ...pack.evidence[0]!.source, startLine: 20, endLine: 24, symbol: "handle" },
          attributes: { ref: "module/main.c#handle@20", nodeKind: "entry", label: "handle" },
          snippet: "void handle(void)",
        },
      ],
      obligations: [
        ...pack.obligations,
        { id: "OB-handler", kind: "flow-node", evidenceIDs: ["EV-handler"], required: true },
      ],
      budget: { items: 2, promptBytes: 200, truncated: false },
    }
    const result = validateTopic({
      pack: completePack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "入口职责",
        conclusions: [{ text: "main 提供主入口", evidenceIDs: ["EV-entry"] }],
        mechanisms: [{ text: "由 main 函数启动", evidenceIDs: ["EV-entry"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.report.warnings.find((item) => item.code === "MODEL_EVIDENCE_HINT_COMPLETED")?.evidenceIDs).toEqual([
      "EV-handler",
    ])
    expect(JSON.stringify(result.ir)).toContain("EV-handler")
  })

  test("只有完整扫描给出 absence 标记时才接受程序化不适用", () => {
    const absencePack: EvidencePack = {
      ...pack,
      evidence: [],
      purpose: { kind: "topic", topic: "concurrency" },
      unknowns: ["topic-absence:concurrency:完整源码快照中未发现专用生产源码证据"],
      budget: { items: 0, promptBytes: 100, truncated: false },
    }
    const result = validateTopic({
      pack: absencePack,
      attempt: 0,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "concurrency",
        applicability: "not-applicable",
        title: "并发与同步",
        summary: "未发现专用并发机制。",
        conclusions: [],
        mechanisms: [],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [{ text: "需确认目录外实现。", evidenceIDs: [] }],
      },
    })

    expect(result.report.passed).toBeTrue()
  })

  test("模型不能把已有显式源码证据降级为未知或不适用", () => {
    const result = validateTopic({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "not-applicable",
        title: "职责",
        summary: "模型试图跳过当前主题。",
        conclusions: [{ text: "main 提供处理入口", evidenceIDs: ["EV-entry"] }],
        mechanisms: [{ text: "由 main 函数启动", evidenceIDs: ["EV-entry"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.ir?.applicability).toBe("applicable")
    expect(JSON.stringify(result.ir)).toContain("入口函数负责启动处理")
  })

  test("模型借用合法证据编造任意动作时，发布 IR 只保留源码确定事实", () => {
    const semanticPack: EvidencePack = {
      ...pack,
      evidence: [
        {
          ...pack.evidence[0]!,
          id: "EV-safe-read",
          fact: "safe_read 从缓冲区读取数据",
          source: { ...pack.evidence[0]!.source, symbol: "safe_read" },
          attributes: { ref: "module/main.c#safe_read@10", nodeKind: "entry", label: "safe_read" },
          snippet: "int safe_read(void *buffer);",
        },
      ],
      obligations: [{ id: "OB-safe-read", kind: "flow-node", evidenceIDs: ["EV-safe-read"], required: true }],
    }
    const result = validateTopic({
      pack: semanticPack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "读取职责",
        conclusions: [{ text: "safe_read 使用 AES-256 加密缓冲区并上传到云端", evidenceIDs: ["EV-safe-read"] }],
        mechanisms: [{ text: "safe_read 验证用户身份并授予管理员权限", evidenceIDs: ["EV-safe-read"] }],
        flows: [{ text: "safe_read 压缩图像后通过网络发送", evidenceIDs: ["EV-safe-read"] }],
        exceptions: [{ text: "safe_read 删除全部持久化数据", evidenceIDs: ["EV-safe-read"] }],
        constraints: [{ text: "safe_read 删除后关闭硬件电源", evidenceIDs: ["EV-safe-read"] }],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    const published = JSON.stringify(result.ir)
    expect(published).toContain("main.c 的 safe_read：从缓冲区读取数据")
    expect(published).not.toMatch(/AES|云端|管理员|压缩图像|网络发送|删除|持久化|关闭硬件电源/u)
    expect(result.ir?.mechanisms).toHaveLength(1)
    expect(result.ir?.conclusions).toHaveLength(0)
  })

  test("候选标题、摘要和事实文字不会绕过规范化发布正文", () => {
    const result = validateTopic({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "Responsibilities",
        summary: "Provides the main entry point.",
        conclusions: [{ text: "Handles requests", evidenceIDs: ["EV-entry"] }],
        mechanisms: [{ text: "由 main 函数启动", evidenceIDs: ["EV-entry"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.ir?.title).toBe("职责")
    expect(result.ir?.summary).toBe("目标模块 的“职责”由以下源码事实构成。")
    expect(JSON.stringify(result.ir)).not.toContain("Responsibilities")
    expect(JSON.stringify(result.ir)).not.toContain("Handles requests")
  })

  test("候选 assumptions 和 unknowns 中的内部术语不会触发无效修复 Session", () => {
    const result = validateTopic({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "Evidence Pack 标注 topic-evidence-sampled:responsibilities:1/2。",
        conclusions: [{ text: "main 提供处理入口", evidenceIDs: ["EV-entry"] }],
        mechanisms: [{ text: "由 main 函数启动", evidenceIDs: ["EV-entry"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [{ text: "WorkItem 采用 runtime Schema。", evidenceIDs: [] }],
        unknowns: [{ text: "模块 MOD-root 的 flow-node 与证据包仍需确认。", evidenceIDs: ["EV-missing"] }],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.ir?.assumptions).toEqual([])
    expect(result.ir?.unknowns).toEqual([])
    expect(JSON.stringify(result.ir)).not.toMatch(/Evidence Pack|WorkItem|runtime|Schema|flow-node|证据包/u)
  })

  test("候选中的流水线话术、局限声明和省略号由规范化正文消除", () => {
    const result = validateTopic({
      pack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "证据包采用代表性采样，当前源码仅能确认入口……",
        conclusions: [{ text: "已采样证据未覆盖函数体，因此无法证明具体调用关系。", evidenceIDs: ["EV-entry"] }],
        mechanisms: [{ text: "由 main 函数启动", evidenceIDs: ["EV-entry"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(JSON.stringify(result.ir)).not.toMatch(/证据包|代表性采样|已采样|无法证明|……/u)
  })

  test("相同源码事实由多个位置共同证明时合并正文并保留全部 evidenceId", () => {
    const duplicatePack: EvidencePack = {
      ...pack,
      evidence: [
        {
          ...pack.evidence[0]!,
          id: "EV-call-1",
          fact: "set_auto_tx_dma 调用 IO_READ32",
          source: {
            ...pack.evidence[0]!.source,
            path: "module/host_lld.c",
            startLine: 120,
            endLine: 120,
            symbol: "set_auto_tx_dma",
          },
          attributes: {
            ref: "module/host_lld.c#set_auto_tx_dma@120",
            nodeKind: "action",
            label: "set_auto_tx_dma 调用 IO_READ32",
          },
        },
        {
          ...pack.evidence[0]!,
          id: "EV-call-2",
          fact: "set_auto_tx_dma 调用 IO_READ32",
          source: {
            ...pack.evidence[0]!.source,
            path: "module/host_lld.c",
            startLine: 124,
            endLine: 124,
            symbol: "set_auto_tx_dma",
          },
          attributes: {
            ref: "module/host_lld.c#set_auto_tx_dma@124",
            nodeKind: "action",
            label: "set_auto_tx_dma 调用 IO_READ32",
          },
        },
      ],
      obligations: [
        { id: "OB-call-1", kind: "flow-node", evidenceIDs: ["EV-call-1"], required: true },
        { id: "OB-call-2", kind: "flow-node", evidenceIDs: ["EV-call-2"], required: true },
      ],
      budget: { items: 2, promptBytes: 200, truncated: false },
    }
    const result = validateTopic({
      pack: duplicatePack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "DMA 寄存器调用",
        conclusions: [{ text: "DMA 调用", evidenceIDs: ["EV-call-1"] }],
        mechanisms: [
          { text: "第一次调用", evidenceIDs: ["EV-call-1"] },
          { text: "第二次调用", evidenceIDs: ["EV-call-2"] },
        ],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.ir?.mechanisms).toHaveLength(1)
    expect(result.ir?.mechanisms[0]?.text).toBe("host_lld.c 的 set_auto_tx_dma：调用 IO_READ32。")
    expect(result.ir?.mechanisms[0]?.evidenceIDs).toEqual(["EV-call-1", "EV-call-2"])
  })

  test("同类事实被模型分散到不同章节时仍归入证据类型对应章节并合并", () => {
    const duplicatePack: EvidencePack = {
      ...pack,
      evidence: [
        {
          ...pack.evidence[0]!,
          id: "EV-call-1",
          kind: "flow-node",
          fact: "dev_irq_handler 调用 xil_printf",
          source: { ...pack.evidence[0]!.source, path: "module/host_lld.c", symbol: "dev_irq_handler" },
          attributes: { ref: "module/host_lld.c#dev_irq_handler@10", label: "dev_irq_handler 调用 xil_printf" },
        },
        {
          ...pack.evidence[0]!,
          id: "EV-call-2",
          kind: "flow-node",
          fact: "dev_irq_handler 调用 xil_printf",
          source: {
            ...pack.evidence[0]!.source,
            path: "module/host_lld.c",
            startLine: 20,
            endLine: 20,
            symbol: "dev_irq_handler",
          },
          attributes: { ref: "module/host_lld.c#dev_irq_handler@20", label: "dev_irq_handler 调用 xil_printf" },
        },
      ],
      obligations: [
        { id: "OB-call-1", kind: "flow-node", evidenceIDs: ["EV-call-1"], required: true },
        { id: "OB-call-2", kind: "flow-node", evidenceIDs: ["EV-call-2"], required: true },
      ],
    }
    const result = validateTopic({
      pack: duplicatePack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "中断日志",
        conclusions: [{ text: "中断日志", evidenceIDs: ["EV-call-1"] }],
        mechanisms: [{ text: "中断日志", evidenceIDs: ["EV-call-2"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.ir?.conclusions).toEqual([])
    expect(result.ir?.mechanisms).toHaveLength(1)
    expect(result.ir?.mechanisms[0]?.evidenceIDs).toEqual(["EV-call-1", "EV-call-2"])
  })

  test("静态分析术语被翻译，详细调用语句吸收重复的泛化调用事实", () => {
    const readablePack: EvidencePack = {
      ...pack,
      evidence: [
        {
          ...pack.evidence[0]!,
          id: "EV-action",
          kind: "flow-node",
          fact: "dev_irq_handler 包含 action 步骤",
          source: { ...pack.evidence[0]!.source, path: "module/host_lld.c", symbol: "dev_irq_handler" },
          attributes: {
            ref: "module/host_lld.c#dev_irq_handler@10",
            nodeKind: "action",
            label: 'xil_printf("IRQ error");',
          },
        },
        {
          ...pack.evidence[0]!,
          id: "EV-call",
          kind: "call-message",
          fact: "dev_irq_handler 调用 xil_printf",
          source: {
            ...pack.evidence[0]!.source,
            path: "module/host_lld.c",
            startLine: 11,
            endLine: 11,
            symbol: "dev_irq_handler",
          },
          attributes: { ref: "module/host_lld.c#dev_irq_handler@11", label: "xil_printf" },
        },
        {
          ...pack.evidence[0]!,
          id: "EV-action-2",
          kind: "flow-node",
          fact: "dev_irq_handler 包含 action 步骤",
          source: {
            ...pack.evidence[0]!.source,
            path: "module/host_lld.c",
            startLine: 12,
            endLine: 12,
            symbol: "dev_irq_handler",
          },
          attributes: {
            ref: "module/host_lld.c#dev_irq_handler@12",
            nodeKind: "action",
            label: 'xil_printf("IRQ status");',
          },
        },
      ],
      obligations: [
        { id: "OB-action", kind: "flow-node", evidenceIDs: ["EV-action"], required: true },
        { id: "OB-call", kind: "message", evidenceIDs: ["EV-call"], required: true },
        { id: "OB-action-2", kind: "flow-node", evidenceIDs: ["EV-action-2"], required: true },
      ],
    }
    const result = validateTopic({
      pack: readablePack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "中断日志",
        conclusions: [{ text: "中断日志", evidenceIDs: ["EV-action"] }],
        mechanisms: [
          { text: "输出日志", evidenceIDs: ["EV-action"] },
          { text: "调用输出", evidenceIDs: ["EV-call"] },
          { text: "输出状态", evidenceIDs: ["EV-action-2"] },
        ],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeTrue()
    expect(result.ir?.mechanisms).toHaveLength(1)
    expect(result.ir?.mechanisms[0]?.text).toContain('执行以下操作：xil_printf("IRQ error")；xil_printf("IRQ status")')
    expect(result.ir?.mechanisms[0]?.text).not.toContain("action 步骤")
    expect(result.ir?.mechanisms[0]?.text).not.toContain("调用 xil_printf")
    expect(result.ir?.mechanisms[0]?.evidenceIDs.toSorted()).toEqual(["EV-action", "EV-action-2", "EV-call"])
  })

  test("规范化后才校验读者正文且确定性错误不可由模型重试", () => {
    const invalidPack: EvidencePack = {
      ...pack,
      evidence: [
        {
          ...pack.evidence[0]!,
          fact: "Evidence Pack runtime…",
          source: {
            path: pack.evidence[0]!.source.path,
            contentHash: pack.evidence[0]!.source.contentHash,
            startLine: pack.evidence[0]!.source.startLine,
            endLine: pack.evidence[0]!.source.endLine,
            sourceKind: pack.evidence[0]!.source.sourceKind,
          },
          attributes: { nodeKind: "entry", label: "main" },
        },
      ],
    }
    const result = validateTopic({
      pack: invalidPack,
      attempt: 1,
      currentSourceSnapshotHash: "snapshot",
      candidate: {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "responsibilities",
        applicability: "applicable",
        title: "职责",
        summary: "入口职责",
        conclusions: [{ text: "main 提供处理入口", evidenceIDs: ["EV-entry"] }],
        mechanisms: [{ text: "由 main 函数启动", evidenceIDs: ["EV-entry"] }],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
    })

    expect(result.report.passed).toBeFalse()
    expect(result.report.errors.map((item) => item.code)).toContain("NON_CHINESE_READER_TEXT")
    expect(result.report.errors.map((item) => item.code)).toContain("INTERNAL_PIPELINE_TERM")
    expect(result.report.errors.map((item) => item.code)).toContain("TRUNCATED_READER_TEXT")
    expect(result.report.errors.every((item) => item.retryable === false)).toBeTrue()
  })
})
