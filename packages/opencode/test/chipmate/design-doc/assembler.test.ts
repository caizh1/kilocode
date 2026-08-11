import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { assembleDesignDocument, buildQualityReport } from "../../../src/chipmate/design-doc/assembler"
import type { Artifact, DesignDocJob, EvidencePack, WorkItem } from "../../../src/chipmate/design-doc/domain"
import { artifact, DesignDocStore } from "../../../src/chipmate/design-doc/store"

const roots: AsyncDisposable[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => root[Symbol.asyncDispose]()))
})

describe("DesignDoc 确定性组装", () => {
  test("只有全部产物通过后生成十四个固定章节和质量报告", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    const job = await storedJob(workspace.path, [workItem("WI-overview", "overview")])
    const completed = await attach(
      job,
      "WI-overview",
      "overview",
      {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "overview",
        title: "模块概览",
        summary: "负责接收输入并返回结果。",
        assumptions: [],
        unknowns: [],
        responsibilities: [],
        boundaries: [],
        items: [],
      },
      "flowchart LR\n  A --> B\n",
    )

    const result = await assembleDesignDocument(workspace.path, completed)
    const markdown = await readFile(
      path.join(DesignDocStore.directory(workspace.path, completed.id), result.document.path),
      "utf8",
    )

    expect(result.quality.passed).toBe(true)
    for (let section = 1; section <= 14; section++) expect(markdown).toContain(`## ${section}.`)
    expect(markdown).toContain("最终完成状态由程序计算")
    expect(markdown).toContain("负责接收输入并返回结果")
    expect(markdown).toContain("#### 组件概览")
    expect(markdown.match(/^```mermaid$/gm)).toHaveLength(1)
    expect(markdown).toContain("flowchart LR\n  A --> B")
  })

  test("跨视角节点和关系完全换皮时质量报告拒绝通过", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    let job = await storedJob(workspace.path, [
      workItem("WI-structure", "structure"),
      workItem("WI-execution", "execution-flow"),
    ])
    job = await attach(job, "WI-structure", "structure", validIR("structure"), "flowchart LR\nA-->B\n")
    job = await attach(job, "WI-execution", "execution-flow", validIR("execution-flow"), "flowchart LR\nA-->B\n")

    const report = await buildQualityReport(job)

    expect(report.passed).toBe(false)
    expect(report.issues.map((item) => item.code)).toContain("DUPLICATE_VIEW_SEMANTICS")
  })

  test("同一视角端点相同但调用语义不同的分图不被误判为换皮图", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    let job = await storedJob(workspace.path, [
      workItem("WI-execution-a", "execution-flow"),
      workItem("WI-execution-b", "execution-flow"),
    ])
    job = await attach(job, "WI-execution-a", "execution-flow", validIR("execution-flow"), "flowchart LR\nA-->|调用一|B\n")
    job = await attach(
      job,
      "WI-execution-b",
      "execution-flow",
      {
        ...validIR("execution-flow"),
        edges: [{ id: "AB", from: "A", to: "B", kind: "next", label: "调用二", evidenceIDs: [] }],
      },
      "flowchart LR\nA-->|调用二|B\n",
    )

    const report = await buildQualityReport(job)

    expect(report.issues.map((item) => item.code)).not.toContain("DUPLICATE_VIEW_SEMANTICS")
    expect(report.passed, JSON.stringify(report.issues)).toBeTrue()
  })

  test("主题声称不适用但对应图已有完整关系时质量报告拒绝发布", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    const topic: WorkItem = {
      ...workItem("WI-topic", "topic"),
      purpose: { kind: "topic", topic: "business-process" },
    }
    const diagram: WorkItem = {
      ...workItem("WI-business", "business-flow"),
      purpose: { kind: "diagram", view: "business-flow", role: "base", topic: "business-process" },
      dependencies: [topic.id],
    }
    let job = await storedJob(workspace.path, [topic, diagram])
    job = await attach(
      job,
      topic.id,
      "topic",
      {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "topic",
        topic: "business-process",
        applicability: "not-applicable",
        title: "业务流程",
        summary: "没有适用流程。",
        conclusions: [],
        mechanisms: [],
        flows: [],
        exceptions: [],
        constraints: [],
        assumptions: [],
        unknowns: [],
      },
      "flowchart TD\n  N[不适用]\n",
    )
    job = await attach(
      job,
      diagram.id,
      "business-flow",
      {
        schemaVersion: 1,
        moduleID: "MOD-root",
        viewType: "business-flow",
        title: "业务流程",
        summary: "从接收请求到返回结果。",
        assumptions: [],
        unknowns: [],
        activities: [
          {
            id: "A",
            kind: "trigger",
            sourceRef: "function:run",
            label: "接收请求",
            businessMeaning: "接收请求",
            evidenceIDs: [],
          },
          {
            id: "B",
            kind: "outcome",
            sourceRef: "return:run",
            label: "返回结果",
            businessMeaning: "返回结果",
            evidenceIDs: [],
          },
        ],
        flows: [{ id: "AB", from: "A", to: "B", kind: "success", label: "处理完成", evidenceIDs: [] }],
      },
      "flowchart TD\n  A --> B\n",
    )

    const report = await buildQualityReport(job)

    expect(report.passed).toBeFalse()
    expect(report.issues.map((item) => item.code)).toContain("TOPIC_APPLICABILITY_CONTRADICTION")
  })

  test("主题拆成多个原子分片时对应图必须覆盖第二片的可图示证据", async () => {
    const missingWorkspace = await tmpdir()
    roots.push(missingWorkspace)
    const missing = await topicDiagramJob(missingWorkspace.path, false)

    const missingReport = await buildQualityReport(missing)

    expect(missingReport.passed).toBeFalse()
    expect(missingReport.issues).toContainEqual({
      code: "TOPIC_DIAGRAM_EVIDENCE_INCOMPLETE",
      message: expect.stringContaining("1 条可图示源码证据"),
      workItemIDs: ["WI-topic-2", "WI-business", "WI-business-focus"],
    })

    const completeWorkspace = await tmpdir()
    roots.push(completeWorkspace)
    const complete = await topicDiagramJob(completeWorkspace.path, true)

    const completeReport = await buildQualityReport(complete)

    expect(completeReport.issues.map((item) => item.code)).not.toContain("TOPIC_DIAGRAM_EVIDENCE_INCOMPLETE")
    expect(completeReport.passed, JSON.stringify(completeReport.issues)).toBeTrue()
  })

  test("读者正文或 Mermaid 含有人为省略号时质量报告拒绝发布", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    const job = await storedJob(workspace.path, [workItem("WI-overview", "overview")])
    const completed = await attach(
      job,
      "WI-overview",
      "overview",
      {
        ...validIR("overview"),
        summary: "执行完整流程并返回尚未展示的结果……",
      },
      "flowchart TD\n  A[处理完整流程…] --> B[返回结果]\n",
    )

    const report = await buildQualityReport(completed)

    expect(report.passed).toBeFalse()
    expect(report.issues.map((item) => item.code)).toContain("TRUNCATED_READER_TEXT")
    expect(report.issues.map((item) => item.code)).toContain("TRUNCATED_DIAGRAM_TEXT")
  })

  test("质量报告汇总真实 Session Attempt 的 Token、成本和重试", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    let job = await storedJob(workspace.path, [workItem("WI-overview", "overview")])
    job = await DesignDocStore.update(workspace.path, job.id, job.revision, (current) => {
      current.workItems[0]!.attempts = [
        {
          number: 1,
          kind: "generate",
          sessionID: "ses_1",
          model: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
          status: "error",
          startedAt: current.createdAt,
          completedAt: current.createdAt + 10,
          cost: 0.1,
          tokens: { total: 100, input: 40, output: 50, reasoning: 10, cache: { read: 0, write: 0 } },
        },
        {
          number: 2,
          kind: "repair",
          sessionID: "ses_2",
          model: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
          status: "completed",
          startedAt: current.createdAt + 11,
          completedAt: current.createdAt + 20,
          cost: 0.2,
          tokens: { total: 200, input: 80, output: 100, reasoning: 20, cache: { read: 0, write: 0 } },
        },
      ]
      return current
    })
    job = await attach(job, "WI-overview", "overview", validIR("overview"), "flowchart LR\nA-->B\n")

    const report = await buildQualityReport(job)

    expect(report.metrics.modelAttempts).toBe(2)
    expect(report.metrics.retryAttempts).toBe(1)
    expect(report.metrics.totalTokens).toBe(300)
    expect(report.metrics.totalCost).toBeCloseTo(0.3)
  })

  test("已通过 WorkItem 忽略晚到的失败报告并保留成功校验结果", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    let job = await storedJob(workspace.path, [workItem("WI-overview", "overview")])
    job = await attach(job, "WI-overview", "overview", validIR("overview"), "flowchart LR\nA-->B\n")
    const late = await DesignDocStore.writeJSON(
      workspace.path,
      job.id,
      "work-items/WI-overview/attempts/2/validation.json",
      {
        schemaVersion: 1,
        workItemID: "WI-overview",
        attempt: 2,
        passed: false,
        sourceSnapshotHash: "snapshot",
        validatorVersions: { schema: "1" },
        errors: [
          {
            severity: "error",
            code: "MODEL_RESPONSE_ERROR",
            message: "晚到的中断回调",
            evidenceIDs: [],
            sourcePaths: [],
            retryable: false,
          },
        ],
        warnings: [],
        metrics: {},
        createdAt: Date.now(),
      },
    )
    job = await DesignDocStore.update(workspace.path, job.id, job.revision, (current) => ({
      ...current,
      artifacts: [
        ...current.artifacts,
        artifact({
          ...late,
          id: "ART-WI-overview-LATE-FAILURE",
          workItemID: "WI-overview",
          kind: "validation-report",
          status: "failed",
        }),
      ],
    }))

    const report = await buildQualityReport(job)

    expect(report.passed).toBe(true)
    expect(report.metrics.schemaPassRate).toBe(1)
    expect(report.workItems[0]?.validationPassed).toBe(true)
    expect(report.workItems[0]?.errorCount).toBe(0)
  })

  test("模块与必需视角覆盖矩阵缺项时禁止组装", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    let job = await storedJob(
      workspace.path,
      [workItem("WI-overview", "overview")],
      ["module/index.ts", "module/missing.ts"],
    )
    job = await DesignDocStore.update(workspace.path, job.id, job.revision, (current) => {
      current.config.artifactTypes = ["overview", "sequence"]
      return current
    })
    job = await attach(job, "WI-overview", "overview", validIR("overview"), "flowchart LR\nA-->B\n")

    const report = await buildQualityReport(job)

    expect(report.passed).toBe(false)
    expect(report.issues.map((item) => item.code)).toContain("MISSING_REQUIRED_ARTIFACT")
    expect(report.issues.map((item) => item.code)).toContain("MISSING_SOURCE_FILE_COVERAGE")
    await expect(assembleDesignDocument(workspace.path, job)).rejects.toThrow("质量报告未通过")
  })
})

function workItem(id: string, artifactType: WorkItem["artifactType"]): WorkItem {
  const now = Date.now()
  return {
    id,
    moduleID: "MOD-root",
    artifactType,
    status: "passed",
    dependencies: [],
    attempts: [],
    artifactIDs: [],
    createdAt: now,
    updatedAt: now,
  }
}

async function storedJob(workspace: string, workItems: WorkItem[], sourceFiles = ["module/index.ts"]) {
  const now = Date.now()
  const job: DesignDocJob = {
    schemaVersion: 1,
    id: `assemble-${now}-${Math.random().toString(16).slice(2)}`,
    revision: 0,
    status: "assembling",
    workspace,
    config: {
      targetPath: "module",
      artifactTypes: workItems.map((item) => item.artifactType),
      languages: ["typescript", "tsx"],
      concurrency: 1,
      recursive: false,
      evidenceBudget: { maxItems: 64, maxPromptBytes: 49_152, maxSnippetCharacters: 800 },
      retryPolicy: { maxAttempts: 3, timeoutMs: 120_000, backoffMs: [0, 500, 1_000], retryableCodes: [] },
      modelPolicy: {
        primary: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
        fallbacks: [],
        structuredOutput: "tool-json-schema",
      },
      renderer: "mermaid",
    },
    moduleManifestPath: "module-manifest.json",
    workItems,
    artifacts: [],
    progress: {
      total: workItems.length,
      pending: 0,
      running: 0,
      passed: workItems.length,
      failed: 0,
      blocked: 0,
      cancelled: 0,
    },
    createdAt: now,
    updatedAt: now,
  }
  await DesignDocStore.create(job)
  const manifest = await DesignDocStore.writeJSON(workspace, job.id, "module-manifest.json", {
    schemaVersion: 1,
    sourceSnapshotHash: "snapshot",
    rootModuleID: "MOD-root",
    modules: [
      {
        id: "MOD-root",
        name: "module",
        path: "module",
        languages: ["typescript"],
        sourceFiles,
        testFiles: [],
      },
    ],
    workItemIDs: workItems.map((item) => item.id),
    createdAt: now,
  })
  return DesignDocStore.update(workspace, job.id, 0, (current) => ({
    ...current,
    artifacts: [
      artifact({
        ...manifest,
        id: "ART-MANIFEST",
        workItemID: workItems[0]!.id,
        kind: "manifest",
        status: "passed",
      }),
    ],
  }))
}

async function attach(
  job: DesignDocJob,
  workItemID: string,
  view: string,
  ir: unknown,
  mermaid: string,
  evidence = pack(workItemID, view),
) {
  const [packMeta, irMeta, mermaidMeta, reportMeta] = await Promise.all([
    DesignDocStore.writeJSON(job.workspace, job.id, `work-items/${workItemID}/evidence.json`, evidence),
    DesignDocStore.writeJSON(job.workspace, job.id, `work-items/${workItemID}/${view}.ir.json`, ir),
    DesignDocStore.writeText(
      job.workspace,
      job.id,
      `work-items/${workItemID}/${view}.mmd`,
      mermaid,
      "text/vnd.mermaid",
    ),
    DesignDocStore.writeJSON(job.workspace, job.id, `work-items/${workItemID}/validation.json`, {
      schemaVersion: 1,
      workItemID,
      attempt: 1,
      passed: true,
      sourceSnapshotHash: "snapshot",
      validatorVersions: { schema: "1" },
      errors: [],
      warnings: [],
      metrics: {},
      createdAt: Date.now(),
    }),
  ])
  const values: Artifact[] = [
    artifact({ ...packMeta, id: `ART-${workItemID}-PACK`, workItemID, kind: "evidence-pack", status: "passed" }),
    artifact({ ...irMeta, id: `ART-${workItemID}-IR`, workItemID, kind: "ir", status: "passed" }),
    artifact({ ...mermaidMeta, id: `ART-${workItemID}-MERMAID`, workItemID, kind: "mermaid", status: "passed" }),
    artifact({
      ...reportMeta,
      id: `ART-${workItemID}-REPORT`,
      workItemID,
      kind: "validation-report",
      status: "passed",
    }),
  ]
  return DesignDocStore.update(job.workspace, job.id, job.revision, (current) => ({
    ...current,
    artifacts: [...current.artifacts, ...values],
  }))
}

async function topicDiagramJob(workspace: string, includeSecondFragment: boolean) {
  const first: WorkItem = {
    ...workItem("WI-topic-1", "topic"),
    purpose: { kind: "topic", topic: "business-process" },
  }
  const second: WorkItem = {
    ...workItem("WI-topic-2", "topic"),
    purpose: { kind: "topic", topic: "business-process" },
  }
  const diagram: WorkItem = {
    ...workItem("WI-business", "business-flow"),
    purpose: { kind: "diagram", view: "business-flow", role: "base", topic: "business-process" },
    dependencies: [first.id, second.id],
  }
  const focused: WorkItem = {
    ...workItem("WI-business-focus", "business-flow"),
    purpose: { kind: "diagram", view: "business-flow", role: "focused", focusID: "flow-run" },
    dependencies: [first.id, second.id],
  }
  let job = await storedJob(workspace, [first, second, diagram, focused])
  job = await attach(
    job,
    first.id,
    "topic",
    topicIR("第一步接收请求。", "EV-flow-node"),
    "flowchart TD\n  A[接收请求]\n",
    evidencePack(first, "EV-flow-node", "flow-node"),
  )
  job = await attach(
    job,
    second.id,
    "topic",
    topicIR("第二步返回结果。", "EV-flow-edge"),
    "flowchart TD\n  B[返回结果]\n",
    evidencePack(second, "EV-flow-edge", "flow-edge"),
  )
  job = await attach(
    job,
    diagram.id,
    "business-flow",
    {
      schemaVersion: 1,
      moduleID: "MOD-root",
      viewType: "business-flow",
      title: "业务处理流程",
      summary: "接收请求后分派处理。",
      assumptions: [],
      unknowns: [],
      activities: [
        {
          id: "receive",
          kind: "trigger",
          sourceRef: "function:run:entry",
          label: "接收请求",
          businessMeaning: "接收请求",
          evidenceIDs: ["EV-flow-node"],
        },
        {
          id: "dispatch",
          kind: "activity",
          sourceRef: "function:run:dispatch",
          label: "分派处理",
          businessMeaning: "分派处理",
          evidenceIDs: ["EV-flow-node"],
        },
      ],
      flows: [
        {
          id: "receive-dispatch",
          from: "receive",
          to: "dispatch",
          kind: "next",
          label: "进入处理",
          evidenceIDs: ["EV-flow-node"],
        },
      ],
    },
    "flowchart TD\n  receive[接收请求] --> dispatch[分派处理]\n",
    evidencePack(diagram, "EV-flow-node", "flow-node"),
  )
  return attach(
    job,
    focused.id,
    "business-flow",
    {
      schemaVersion: 1,
      moduleID: "MOD-root",
      viewType: "business-flow",
      title: "业务处理流程分图",
      summary: "处理完成后返回结果。",
      assumptions: [],
      unknowns: includeSecondFragment ? [] : [{ text: "第二片证据仅被列为待确认。", evidenceIDs: ["EV-flow-edge"] }],
      activities: [
        {
          id: "dispatch",
          kind: "activity",
          sourceRef: "function:run:dispatch",
          label: "执行处理",
          businessMeaning: "执行处理",
          evidenceIDs: [],
        },
        {
          id: "return",
          kind: "outcome",
          sourceRef: "function:run:return",
          label: "返回结果",
          businessMeaning: "返回结果",
          evidenceIDs: [],
        },
      ],
      flows: [
        {
          id: "dispatch-return",
          from: "dispatch",
          to: "return",
          kind: "success",
          label: "处理完成",
          evidenceIDs: includeSecondFragment ? ["EV-flow-edge"] : [],
        },
      ],
    },
    "flowchart TD\n  dispatch[执行处理] --> return[返回结果]\n",
    evidencePack(focused, "EV-flow-edge", "flow-edge"),
  )
}

function topicIR(text: string, evidenceID: string) {
  return {
    schemaVersion: 1 as const,
    moduleID: "MOD-root",
    viewType: "topic" as const,
    topic: "business-process" as const,
    applicability: "applicable" as const,
    title: "业务处理过程",
    summary: text,
    conclusions: [{ text, evidenceIDs: [evidenceID] }],
    mechanisms: [],
    flows: [],
    exceptions: [],
    constraints: [],
    assumptions: [],
    unknowns: [],
  }
}

function evidencePack(item: WorkItem, evidenceID: string, kind: "flow-node" | "flow-edge"): EvidencePack {
  return {
    schemaVersion: 1,
    id: `PACK-${item.id}`,
    moduleID: item.moduleID,
    workItemID: item.id,
    artifactType: item.artifactType,
    purpose: item.purpose,
    sourceSnapshotHash: "snapshot",
    evidence: [
      {
        id: evidenceID,
        kind,
        fact: kind === "flow-node" ? "run 接收请求" : "run 从接收请求进入返回结果",
        source: {
          path: "module/index.ts",
          contentHash: "a".repeat(64),
          startLine: kind === "flow-node" ? 1 : 2,
          endLine: kind === "flow-node" ? 1 : 2,
          symbol: "run",
          sourceKind: "production",
        },
        attributes:
          kind === "flow-node"
            ? { ref: "function:run:entry", ownerRef: "function:run", nodeKind: "entry", label: "接收请求" }
            : {
                ref: "function:run:entry->function:run:return",
                ownerRef: "function:run",
                fromRef: "function:run:entry",
                toRef: "function:run:return",
                edgeKind: "return",
                label: "返回结果",
              },
        confidence: "explicit",
        snippet: kind === "flow-node" ? "function run() {" : "return result",
      },
    ],
    obligations: [
      {
        id: `OB-${evidenceID}`,
        kind,
        evidenceIDs: [evidenceID],
        required: true,
      },
    ],
    unknowns: [],
    budget: { items: 1, promptBytes: 9, truncated: false },
  }
}

function pack(workItemID: string, artifactType: string): EvidencePack {
  return {
    schemaVersion: 1,
    id: `PACK-${workItemID}`,
    moduleID: "MOD-root",
    workItemID,
    artifactType: artifactType as EvidencePack["artifactType"],
    sourceSnapshotHash: "snapshot",
    evidence: [
      {
        id: `EV-${workItemID}-source`,
        kind: "source-file",
        fact: "模块包含生产源码文件 module/index.ts",
        source: {
          path: "module/index.ts",
          contentHash: "a".repeat(64),
          startLine: 1,
          endLine: 1,
          sourceKind: "production",
        },
        attributes: { ref: "module/index.ts", language: "typescript" },
        confidence: "explicit",
        snippet: "export {}",
      },
    ],
    obligations: [
      {
        id: `OB-${workItemID}-source`,
        kind: "file",
        evidenceIDs: [`EV-${workItemID}-source`],
        required: true,
      },
    ],
    unknowns: [],
    budget: { items: 1, promptBytes: 9, truncated: false },
  }
}

function validIR(view: "overview" | "structure" | "execution-flow") {
  const base = {
    schemaVersion: 1 as const,
    moduleID: "MOD-root",
    title: `${view} 测试图`,
    summary: "用于验证确定性质量门禁。",
    assumptions: [],
    unknowns: [],
  }
  if (view === "overview") {
    return { ...base, viewType: view, responsibilities: [], boundaries: [], items: [] }
  }
  if (view === "structure") {
    return {
      ...base,
      viewType: view,
      nodes: [
        { id: "A", kind: "source-file", sourceRef: "source:a", evidenceIDs: [] },
        { id: "B", kind: "external-dependency", sourceRef: "source:b", evidenceIDs: [] },
      ],
      edges: [{ id: "AB", from: "A", to: "B", kind: "depends-on", evidenceIDs: [] }],
    }
  }
  return {
    ...base,
    viewType: view,
    nodes: [
      { id: "A", kind: "entry", sourceRef: "source:a", label: "A", evidenceIDs: [] },
      { id: "B", kind: "exit", sourceRef: "source:b", label: "B", evidenceIDs: [] },
    ],
    edges: [{ id: "AB", from: "A", to: "B", kind: "next", label: "顺序执行", evidenceIDs: [] }],
  }
}
