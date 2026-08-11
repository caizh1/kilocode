import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import type {
  CodeStructureExtractionResult,
  LifecycleExtractionResult,
  StructureExtractionResult,
} from "@kilocode/kilo-indexing/design-doc"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import {
  buildEvidencePack,
  buildCodeStructureEvidencePack,
  buildStructureEvidencePack,
  EvidenceBudgetError,
  hasSufficientStructureEvidence,
  hasSufficientCodeStructureEvidence,
} from "../../../src/kilocode/design-doc/evidence"
import {
  consumedAttempts,
  type CodeStructureIR,
  type DesignDocJob,
  type LifecycleIR,
  type StructureIR,
} from "../../../src/kilocode/design-doc/domain"
import { codeStructureMermaid, lifecycleMermaid, structureMermaid } from "../../../src/kilocode/design-doc/renderer"
import { DesignDocStore, JobStoreError } from "../../../src/kilocode/design-doc/store"
import { validateLifecycle } from "../../../src/kilocode/design-doc/validator"
import { validateStructure } from "../../../src/kilocode/design-doc/structure-validator"
import { validateCodeStructure } from "../../../src/kilocode/design-doc/code-structure-validator"
import {
  designDocModelVariant,
  DesignDocSessionInterruptedError,
  designDocWorkerResponseError,
  designDocWorkerTools,
  codeStructureOutputFormat,
  lifecycleOutputFormat,
  structureOutputFormat,
} from "../../../src/kilocode/design-doc/session-runner"
import { DESIGN_DOC_STRUCTURED_OUTPUT_TOOL, DESIGN_DOC_WORKER, hardenSystemAgents } from "../../../src/kilocode/agent"
import { KiloSessionPrompt } from "../../../src/kilocode/session/prompt"
import type { Info as AgentInfo } from "../../../src/agent/agent"
import { Permission } from "../../../src/permission"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function extraction(): LifecycleExtractionResult {
  const source = {
    path: "module/runner.ts",
    contentHash: "a".repeat(64),
    startLine: 1,
    endLine: 3,
    symbol: "Runner.start",
    sourceKind: "production" as const,
  }
  return {
    moduleID: "MOD-test",
    sourceSnapshotHash: "b".repeat(64),
    unknowns: [],
    evidence: [
      {
        kind: "state-definition",
        fact: "RunnerState 定义 idle",
        source,
        attributes: { state: "idle" },
        confidence: "explicit",
        snippet: "type RunnerState = 'idle' | 'running'",
      },
      {
        kind: "state-definition",
        fact: "RunnerState 定义 running",
        source,
        attributes: { state: "running" },
        confidence: "explicit",
        snippet: "type RunnerState = 'idle' | 'running'",
      },
      {
        kind: "initial-state",
        fact: "state 初始化为 idle",
        source,
        attributes: { state: "idle", field: "state" },
        confidence: "explicit",
        snippet: "state = 'idle'",
      },
      {
        kind: "state-transition",
        fact: "state 从 idle 迁移到 running",
        source,
        attributes: {
          from: "idle",
          to: "running",
          field: "state",
          guard: "canStart",
          action: "state = 'running'",
        },
        confidence: "explicit",
        snippet: "if (state === 'idle') state = 'running'",
      },
    ],
  }
}

function pack() {
  return buildEvidencePack({
    extraction: extraction(),
    workItemID: "WI-test",
    maxItems: 64,
    maxPromptBytes: 48 * 1024,
    maxSnippetCharacters: 800,
  })
}

function validIR(): LifecycleIR {
  const evidence = pack().evidence
  const idle = evidence.filter((item) => item.attributes.state === "idle").map((item) => item.id)
  const running = evidence.filter((item) => item.attributes.state === "running").map((item) => item.id)
  const transition = evidence.find((item) => item.kind === "state-transition")!.id
  return {
    schemaVersion: 1,
    moduleID: "MOD-test",
    viewType: "lifecycle",
    title: "Runner 生命周期",
    summary: "Runner 从空闲进入运行态。",
    assumptions: [],
    unknowns: [],
    states: [
      { id: "idle", label: "idle", sourceValue: "idle", role: "initial", evidenceIDs: idle },
      { id: "running", label: "running", sourceValue: "running", role: "intermediate", evidenceIDs: running },
    ],
    transitions: [
      {
        id: "start",
        from: "idle",
        to: "running",
        guard: "canStart",
        action: "state = 'running'",
        evidenceIDs: [transition],
      },
    ],
    initialStateID: "idle",
    terminalStateIDs: [],
  }
}

function structureExtraction(): StructureExtractionResult {
  const source = (file: string) => ({
    path: file,
    contentHash: file === "module/runner.ts" ? "c".repeat(64) : "d".repeat(64),
    startLine: 1,
    endLine: 1,
    sourceKind: "production" as const,
  })
  return {
    moduleID: "MOD-structure",
    sourceSnapshotHash: "e".repeat(64),
    unknowns: [],
    evidence: [
      {
        kind: "source-file",
        fact: "模块包含源码文件 module/helper.ts",
        source: source("module/helper.ts"),
        attributes: { ref: "module/helper.ts", language: "typescript" },
        confidence: "explicit",
        snippet: "export const helper = true",
      },
      {
        kind: "source-file",
        fact: "模块包含源码文件 module/runner.ts",
        source: source("module/runner.ts"),
        attributes: { ref: "module/runner.ts", language: "typescript" },
        confidence: "explicit",
        snippet: 'import { helper } from "./helper"',
      },
      {
        kind: "dependency",
        fact: "module/runner.ts 依赖 module/helper.ts",
        source: source("module/runner.ts"),
        attributes: { from: "module/runner.ts", to: "module/helper.ts", dependencyKind: "import", internal: true },
        confidence: "explicit",
        snippet: 'import { helper } from "./helper"',
      },
      {
        kind: "dependency",
        fact: "module/runner.ts 依赖 effect",
        source: source("module/runner.ts"),
        attributes: { from: "module/runner.ts", to: "effect", dependencyKind: "import", internal: false },
        confidence: "explicit",
        snippet: 'import { Effect } from "effect"',
      },
    ],
  }
}

function structurePack() {
  return buildStructureEvidencePack({
    extraction: structureExtraction(),
    workItemID: "WI-structure",
    maxItems: 64,
    maxPromptBytes: 48 * 1024,
    maxSnippetCharacters: 800,
  })
}

function validStructureIR(): StructureIR {
  const evidence = structurePack().evidence
  const byRef = (ref: string, kind: "source-file" | "dependency") =>
    evidence.filter((item) => item.kind === kind && (item.attributes.ref === ref || item.attributes.to === ref))
  const helper = byRef("module/helper.ts", "source-file").map((item) => item.id)
  const runner = byRef("module/runner.ts", "source-file").map((item) => item.id)
  const helperDependency = byRef("module/helper.ts", "dependency").map((item) => item.id)
  const effectDependency = byRef("effect", "dependency").map((item) => item.id)
  return {
    schemaVersion: 1,
    moduleID: "MOD-structure",
    viewType: "structure",
    title: "模块结构",
    summary: "文件依赖。",
    assumptions: [],
    unknowns: [],
    nodes: [
      { id: "helper", kind: "source-file", sourceRef: "module/helper.ts", evidenceIDs: helper },
      { id: "runner", kind: "source-file", sourceRef: "module/runner.ts", evidenceIDs: runner },
      { id: "effect", kind: "external-dependency", sourceRef: "effect", evidenceIDs: effectDependency },
    ],
    edges: [
      { id: "helper-import", from: "runner", to: "helper", kind: "depends-on", evidenceIDs: helperDependency },
      { id: "effect-import", from: "runner", to: "effect", kind: "depends-on", evidenceIDs: effectDependency },
    ],
  }
}

function codeStructureExtraction(): CodeStructureExtractionResult {
  const source = {
    path: "module/api.ts",
    contentHash: "f".repeat(64),
    startLine: 1,
    endLine: 1,
    sourceKind: "production" as const,
  }
  return {
    moduleID: "MOD-code-structure",
    sourceSnapshotHash: "1".repeat(64),
    unknowns: [],
    evidence: [
      {
        kind: "source-file",
        fact: "模块包含源码文件 module/api.ts",
        source,
        attributes: { ref: "module/api.ts", language: "typescript" },
        confidence: "explicit",
        snippet: "export class Job",
      },
      {
        kind: "code-symbol",
        fact: "module/api.ts 声明 class Job",
        source: { ...source, symbol: "Job" },
        attributes: {
          ref: "module/api.ts#Job@1",
          name: "Job",
          qualifiedName: "Job",
          symbolKind: "class",
          parentRef: "module/api.ts",
        },
        confidence: "explicit",
        snippet: "export class Job",
      },
      {
        kind: "code-symbol",
        fact: "module/api.ts 声明 method Job.start",
        source: { ...source, startLine: 2, endLine: 2, symbol: "Job.start" },
        attributes: {
          ref: "module/api.ts#Job.start@2",
          name: "start",
          qualifiedName: "Job.start",
          symbolKind: "method",
          parentRef: "module/api.ts#Job@1",
        },
        confidence: "explicit",
        snippet: "start() {}",
      },
      {
        kind: "code-symbol",
        fact: "module/api.ts 声明 function make",
        source: { ...source, startLine: 4, endLine: 4, symbol: "make" },
        attributes: {
          ref: "module/api.ts#make@4",
          name: "make",
          qualifiedName: "make",
          symbolKind: "function",
          parentRef: "module/api.ts",
        },
        confidence: "explicit",
        snippet: "export function make() {}",
      },
    ],
  }
}

function codeStructurePack() {
  return buildCodeStructureEvidencePack({
    extraction: codeStructureExtraction(),
    workItemID: "WI-code-structure",
    maxItems: 64,
    maxPromptBytes: 48 * 1024,
    maxSnippetCharacters: 800,
  })
}

function validCodeStructureIR(): CodeStructureIR {
  const evidence = codeStructurePack().evidence
  const id = (ref: string) => evidence.find((item) => item.attributes.ref === ref)!.id
  return {
    schemaVersion: 1,
    moduleID: "MOD-code-structure",
    viewType: "code-structure",
    title: "代码结构",
    summary: "源码声明结构。",
    assumptions: [],
    unknowns: [],
    nodes: [
      {
        id: "file",
        kind: "source-file",
        sourceRef: "module/api.ts",
        label: "module/api.ts",
        evidenceIDs: [id("module/api.ts")],
      },
      {
        id: "job",
        kind: "class",
        sourceRef: "module/api.ts#Job@1",
        label: "Job",
        evidenceIDs: [id("module/api.ts#Job@1")],
      },
      {
        id: "start",
        kind: "method",
        sourceRef: "module/api.ts#Job.start@2",
        label: "start",
        evidenceIDs: [id("module/api.ts#Job.start@2")],
      },
      {
        id: "make",
        kind: "function",
        sourceRef: "module/api.ts#make@4",
        label: "make",
        evidenceIDs: [id("module/api.ts#make@4")],
      },
    ],
    edges: [
      { id: "file-job", from: "file", to: "job", kind: "contains", evidenceIDs: [id("module/api.ts#Job@1")] },
      {
        id: "job-start",
        from: "job",
        to: "start",
        kind: "contains",
        evidenceIDs: [id("module/api.ts#Job.start@2")],
      },
      { id: "file-make", from: "file", to: "make", kind: "contains", evidenceIDs: [id("module/api.ts#make@4")] },
    ],
  }
}

describe("DesignDoc Evidence Pack", () => {
  test("为相同源码事实生成稳定 ID 和必需 obligation", () => {
    expect(pack()).toEqual(pack())
    expect(pack().evidence.every((item) => /^EV-[a-f0-9]{20}$/.test(item.id))).toBe(true)
    expect(pack().obligations.every((item) => item.required)).toBe(true)
  })

  test("必需证据超预算时明确失败而不是截断", () => {
    expect(() =>
      buildEvidencePack({
        extraction: extraction(),
        workItemID: "WI-test",
        maxItems: 1,
        maxPromptBytes: 48 * 1024,
        maxSnippetCharacters: 800,
      }),
    ).toThrow(EvidenceBudgetError)
  })
})

describe("LifecycleIR 校验和渲染", () => {
  test("结构化输出禁用 Session 内重试", () => {
    const format = lifecycleOutputFormat()

    expect(format.type).toBe("json_schema")
    expect(format.retryCount).toBe(0)
    expect(format).toBeInstanceOf(SessionV1.OutputFormatJsonSchema)
    expect(format.schema).not.toBe(lifecycleOutputFormat().schema)
  })

  test("通过有完整源码证据的状态和迁移", () => {
    const evidence = pack()
    const result = validateLifecycle({
      candidate: validIR(),
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(true)
    expect(result.ir?.title).toBe("runner 生命周期")
    expect(result.ir?.title).not.toContain("MOD-")
    expect(result.ir?.summary).toContain("2 个状态、1 条迁移")
    expect(lifecycleMermaid(result.ir!)).toContain("stateDiagram-v2")
    expect(lifecycleMermaid(result.ir!)).toContain("S0 --> S1")
  })

  test("拒绝无 from/to 对应证据的迁移", () => {
    const evidence = pack()
    const candidate = validIR()
    candidate.transitions[0].evidenceIDs = candidate.states[0].evidenceIDs
    const result = validateLifecycle({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("UNSUPPORTED_TRANSITION")
  })

  test("拒绝把必需迁移证据挂到另一条有效迁移上冒充覆盖", () => {
    const evidence = pack()
    const candidate = validIR()
    const transitionEvidence = evidence.evidence.find((item) => item.kind === "state-transition")!
    candidate.transitions.push({
      ...candidate.transitions[0],
      id: "wrong-direction",
      from: candidate.transitions[0].to,
      to: candidate.transitions[0].from,
      evidenceIDs: [transitionEvidence.id],
    })
    candidate.transitions[0].evidenceIDs = candidate.states[0].evidenceIDs
    const result = validateLifecycle({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("MISSING_REQUIRED_EVIDENCE")
  })

  test("拒绝用无关证据为虚构状态换标签", () => {
    const evidence = pack()
    const candidate = validIR()
    candidate.states[0].sourceValue = "fabricated"
    const result = validateLifecycle({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("UNSUPPORTED_STATE")
  })

  test("拒绝无证据的展示标签和迁移细节", () => {
    const evidence = pack()
    const candidate = validIR()
    candidate.states[0].label = "已批准"
    candidate.transitions[0].guard = "user.isAdmin"
    const result = validateLifecycle({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.errors.map((item) => item.code)).toContain("STATE_LABEL_MISMATCH")
    expect(result.report.errors.map((item) => item.code)).toContain("UNSUPPORTED_TRANSITION_GUARD")
  })

  test("拒绝省略源码已经提取的状态切换条件和动作", () => {
    const evidence = pack()
    const candidate = validIR()
    delete candidate.transitions[0].guard
    delete candidate.transitions[0].action

    const result = validateLifecycle({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.errors.map((item) => item.code)).toContain("MISSING_TRANSITION_GUARD")
    expect(result.report.errors.map((item) => item.code)).toContain("MISSING_TRANSITION_ACTION")
  })

  test("把模型生成的任意当前状态伪节点归一化为生命周期哨兵", () => {
    const evidence = structuredClone(pack())
    const transitionEvidence = {
      ...evidence.evidence.find((item) => item.kind === "state-transition")!,
      id: "EV-any-current-state00",
      fact: "外部停止事件可从任意当前状态进入 running",
      attributes: {
        from: "__ANY_CURRENT_STATE__",
        to: "running",
        trigger: "stop",
        action: "state = 'running'",
      },
    }
    evidence.evidence.push(transitionEvidence)
    evidence.obligations.push({
      id: "OB-any-current-state",
      kind: "transition",
      evidenceIDs: [transitionEvidence.id],
      required: true,
    })
    const candidate = validIR()
    candidate.states.push({
      id: "state_any_current",
      label: "__ANY_CURRENT_STATE__",
      sourceValue: "__ANY_CURRENT_STATE__",
      role: "intermediate",
      evidenceIDs: [transitionEvidence.id],
    })
    candidate.transitions.push({
      id: "stop",
      from: "state_any_current",
      to: "running",
      trigger: "stop",
      action: "state = 'running'",
      evidenceIDs: [transitionEvidence.id],
    })

    const result = validateLifecycle({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(true)
    expect(result.ir?.states.some((state) => state.sourceValue === "__ANY_CURRENT_STATE__")).toBe(false)
    expect(result.ir?.transitions.find((transition) => transition.id === "stop")?.from).toBe("__ANY_CURRENT_STATE__")
  })
})

describe("StructureIR 校验和渲染", () => {
  test("结构 Evidence Pack 建立文件和关系 obligations", () => {
    const evidence = structurePack()

    expect(evidence.artifactType).toBe("structure")
    expect(evidence.obligations.map((item) => item.kind).sort()).toEqual([
      "file",
      "file",
      "relationship",
      "relationship",
    ])
    expect(hasSufficientStructureEvidence(evidence)).toBe(true)
  })

  test("StructureIR 使用独立 JSON Schema 且禁用 Session 内重试", () => {
    const format = structureOutputFormat()

    expect(format.type).toBe("json_schema")
    expect(format.retryCount).toBe(0)
    expect(format.schema.properties.viewType.const).toBe("structure")
    expect(format.schema).not.toBe(structureOutputFormat().schema)
  })

  test("通过完全覆盖源码文件和依赖的结构图", () => {
    const evidence = structurePack()
    const result = validateStructure({
      candidate: validStructureIR(),
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(true)
    expect(result.ir?.title).toBe("module 模块结构")
    expect(result.ir?.title).not.toContain("MOD-")
    expect(result.ir?.summary).toContain("3 个节点、2 条依赖")
    expect(structureMermaid(result.ir!)).toContain("flowchart LR")
    expect(structureMermaid(result.ir!)).toContain("N1 --> N0")
  })

  test("拒绝用无关证据伪造依赖关系", () => {
    const evidence = structurePack()
    const candidate = validStructureIR()
    candidate.edges[0].evidenceIDs = candidate.nodes[0].evidenceIDs
    const result = validateStructure({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("UNSUPPORTED_DEPENDENCY")
    expect(result.report.errors.map((item) => item.code)).toContain("MISSING_REQUIRED_EVIDENCE")
  })

  test("拒绝遗漏必需源码文件节点", () => {
    const evidence = structurePack()
    const candidate = validStructureIR()
    candidate.nodes = candidate.nodes.filter((item) => item.id !== "helper")
    candidate.edges = candidate.edges.filter((item) => item.to !== "helper")
    const result = validateStructure({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("MISSING_REQUIRED_EVIDENCE")
  })

  test("拒绝把被遗漏文件的证据附加到其他文件节点冒充覆盖", () => {
    const evidence = structurePack()
    const candidate = validStructureIR()
    const omitted = candidate.nodes.find((item) => item.id === "helper")!
    candidate.nodes = candidate.nodes.filter((item) => item.id !== omitted.id)
    candidate.edges = candidate.edges.filter((item) => item.to !== omitted.id)
    candidate.nodes[0].evidenceIDs.push(...omitted.evidenceIDs)
    const result = validateStructure({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("MISSING_REQUIRED_EVIDENCE")
  })
})

describe("CodeStructureIR 校验和渲染", () => {
  test("代码结构 Evidence Pack 建立文件和符号 obligations", () => {
    const evidence = codeStructurePack()

    expect(evidence.artifactType).toBe("code-structure")
    expect(evidence.obligations.map((item) => item.kind).sort()).toEqual(["file", "symbol", "symbol", "symbol"])
    expect(hasSufficientCodeStructureEvidence(evidence)).toBe(true)
  })

  test("CodeStructureIR 使用独立 JSON Schema 且禁用 Session 内重试", () => {
    const format = codeStructureOutputFormat()

    expect(format.type).toBe("json_schema")
    expect(format.retryCount).toBe(0)
    expect(format.schema.properties.viewType.const).toBe("code-structure")
    expect(format.schema).not.toBe(codeStructureOutputFormat().schema)
  })

  test("通过完整覆盖文件、符号和包含关系的代码结构图", () => {
    const evidence = codeStructurePack()
    const candidate = validCodeStructureIR()
    candidate.nodes[0].label = "便于阅读的文件标签"
    candidate.nodes[1].label = "便于阅读的符号标签"
    const result = validateCodeStructure({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(true)
    expect(result.ir?.title).toBe("api 代码结构")
    expect(result.ir?.title).not.toContain("MOD-")
    expect(result.ir?.summary).toContain("4 个节点、3 条包含关系")
    expect(result.ir?.nodes[0].label).toBe("api.ts")
    expect(result.ir?.nodes[1].label).toBe("Job")
    expect(codeStructureMermaid(result.ir!)).toContain("flowchart TD")
    expect(codeStructureMermaid(result.ir!)).toContain("C1 --> C2")
  })

  test("拒绝父子引用不匹配的伪造包含关系", () => {
    const evidence = codeStructurePack()
    const candidate = validCodeStructureIR()
    candidate.edges[1].from = "file"
    const result = validateCodeStructure({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("UNSUPPORTED_CONTAINMENT")
  })

  test("拒绝遗漏必需代码符号", () => {
    const evidence = codeStructurePack()
    const candidate = validCodeStructureIR()
    candidate.nodes = candidate.nodes.filter((item) => item.id !== "make")
    candidate.edges = candidate.edges.filter((item) => item.to !== "make")
    const result = validateCodeStructure({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("MISSING_REQUIRED_EVIDENCE")
  })

  test("拒绝把遗漏符号的证据挂到无关合法节点和边上绕过覆盖门禁", () => {
    const evidence = codeStructurePack()
    const candidate = validCodeStructureIR()
    const missing = candidate.nodes.find((item) => item.id === "make")!.evidenceIDs[0]
    candidate.nodes = candidate.nodes.filter((item) => item.id !== "make")
    candidate.edges = candidate.edges.filter((item) => item.to !== "make")
    candidate.nodes.find((item) => item.id === "job")!.evidenceIDs.push(missing)
    candidate.edges.find((item) => item.id === "file-job")!.evidenceIDs.push(missing)
    const result = validateCodeStructure({
      candidate,
      pack: evidence,
      attempt: 1,
      currentSourceSnapshotHash: evidence.sourceSnapshotHash,
    })

    expect(result.report.passed).toBe(false)
    expect(result.report.errors.map((item) => item.code)).toContain("MISSING_REQUIRED_EVIDENCE")
  })
})

describe("DesignDoc JobStore", () => {
  test("使用 revision CAS 原子更新 Job", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "kilo-design-doc-store-"))
    roots.push(workspace)
    const now = Date.now()
    const job: DesignDocJob = {
      schemaVersion: 1,
      id: "job-test",
      revision: 0,
      status: "created",
      workspace,
      config: {
        targetPath: "module",
        artifactTypes: ["lifecycle"],
        languages: ["typescript", "tsx"],
        concurrency: 1,
        recursive: false,
        evidenceBudget: { maxItems: 64, maxPromptBytes: 49_152, maxSnippetCharacters: 800 },
        retryPolicy: { maxAttempts: 3, timeoutMs: 120_000, backoffMs: [0], retryableCodes: [] },
        modelPolicy: {
          primary: { providerID: "test", modelID: "test" },
          fallbacks: [],
          structuredOutput: "tool-json-schema",
        },
        renderer: "mermaid",
      },
      workItems: [],
      artifacts: [],
      progress: { total: 0, pending: 0, running: 0, passed: 0, failed: 0, blocked: 0, cancelled: 0 },
      createdAt: now,
      updatedAt: now,
    }
    await DesignDocStore.create(job)
    const release = await DesignDocStore.acquireRunLease(workspace, job.id)
    expect(release).toBeFunction()
    expect(await DesignDocStore.acquireRunLease(workspace, job.id)).toBeUndefined()
    await release?.()
    const reacquired = await DesignDocStore.acquireRunLease(workspace, job.id)
    expect(reacquired).toBeFunction()
    await reacquired?.()
    await Bun.write(path.join(DesignDocStore.directory(workspace, job.id), ".runner.lock"), "")
    expect(await DesignDocStore.acquireRunLease(workspace, job.id)).toBeUndefined()
    await rm(path.join(DesignDocStore.directory(workspace, job.id), ".runner.lock"), { force: true })
    await Bun.write(path.join(DesignDocStore.directory(workspace, job.id), ".runner.lock"), "2147483647 stale\n")
    const afterCrash = await DesignDocStore.acquireRunLease(workspace, job.id)
    expect(afterCrash).toBeFunction()
    await afterCrash?.()
    const updated = await DesignDocStore.update(workspace, job.id, 0, (value) => ({
      ...value,
      status: "discovering",
    }))

    expect(updated.revision).toBe(1)
    expect((await DesignDocStore.get(workspace, job.id)).status).toBe("discovering")
    const conflict = await DesignDocStore.update(workspace, job.id, 0, (value) => value).catch((error) => error)
    expect(conflict).toBeInstanceOf(JobStoreError)

    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const binary = await DesignDocStore.writeBytes(workspace, job.id, "render/lifecycle.png", png, "image/png")
    expect(binary.path).toBe("render/lifecycle.png")
    expect(await readFile(path.join(DesignDocStore.directory(workspace, job.id), binary.path))).toEqual(
      Buffer.from(png),
    )
    const parallel = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        DesignDocStore.writeText(workspace, job.id, `parallel/${index}.txt`, `并发产物 ${index}`, "text/plain"),
      ),
    )
    expect(parallel).toHaveLength(32)
    expect(new Set(parallel.map((item) => item.path)).size).toBe(32)
    const report = { passed: false, errors: [{ code: "SCHEMA_INVALID" }] }
    const reportMeta = await DesignDocStore.writeJSON(workspace, job.id, "attempts/1/validation.json", report)
    const declared = await DesignDocStore.update(workspace, job.id, updated.revision, (value) => ({
      ...value,
      artifacts: [
        {
          ...reportMeta,
          id: "ART-VALIDATION-1",
          workItemID: "WI-test",
          kind: "validation-report",
          status: "failed",
          createdAt: Date.now(),
        },
      ],
    }))
    expect(
      JSON.parse((await DesignDocStore.readDeclaredArtifact(declared, "ART-VALIDATION-1")).content.toString()),
    ).toEqual(report)
    await Bun.write(
      path.join(DesignDocStore.directory(workspace, job.id), reportMeta.path),
      JSON.stringify({ passed: true }),
    )
    const mismatch = await DesignDocStore.readDeclaredArtifact(declared, "ART-VALIDATION-1").catch((error) => error)
    expect(mismatch).toBeInstanceOf(JobStoreError)

    const outside = path.join(workspace, "outside")
    await mkdir(outside)
    await symlink(outside, path.join(DesignDocStore.directory(workspace, job.id), "evidence"), "dir")
    const escape = await DesignDocStore.writeJSON(workspace, job.id, "evidence/lifecycle.json", {}).catch(
      (error) => error,
    )
    expect(escape).toBeInstanceOf(JobStoreError)
    expect(await readdir(outside)).toEqual([])

    await DesignDocStore.update(workspace, job.id, declared.revision, (value) => ({ ...value, status: "cancelled" }))
    const afterCancel = await DesignDocStore.writeText(workspace, job.id, "late.txt", "late", "text/plain").catch(
      (error) => error,
    )
    expect(afterCancel).toBeInstanceOf(JobStoreError)
    expect(
      await readFile(path.join(DesignDocStore.directory(workspace, job.id), "late.txt")).catch(() => undefined),
    ).toBe(undefined)
  })
})

describe("DesignDoc Worker 权限", () => {
  test("内置 Worker 只允许内部 StructuredOutput", () => {
    const agents: Record<string, AgentInfo> = {}
    hardenSystemAgents(agents)
    const worker = agents[DESIGN_DOC_WORKER]

    expect(worker.hidden).toBe(true)
    expect(worker.mode).toBe("subagent")
    for (const tool of ["read", "grep", "glob", "bash", "edit", "write", "task", "mcp"]) {
      expect(Permission.evaluate(tool, "*", worker.permission).action).toBe("deny")
    }
    expect(Permission.evaluate(DESIGN_DOC_STRUCTURED_OUTPUT_TOOL, "*", worker.permission).action).toBe("allow")
  })

  test("Prompt 工具开关不会把 StructuredOutput 从最终请求中移除", () => {
    const agents: Record<string, AgentInfo> = {}
    hardenSystemAgents(agents)
    const worker = agents[DESIGN_DOC_WORKER]
    const toggles = Permission.fromConfig(
      Object.fromEntries(
        Object.entries(designDocWorkerTools()).map(([permission, enabled]) => [permission, enabled ? "allow" : "deny"]),
      ),
    )
    const session = KiloSessionPrompt.mergeToolPermissions({ existing: worker.permission, toggles })
    const disabled = Permission.disabled(
      [DESIGN_DOC_STRUCTURED_OUTPUT_TOOL, "read", "bash", "task"],
      Permission.merge(worker.permission, session),
    )

    expect(disabled.has(DESIGN_DOC_STRUCTURED_OUTPUT_TOOL)).toBe(false)
    expect([...disabled].sort()).toEqual(["bash", "read", "task"])
  })

  test("DeepSeek thinking 使用 auto，其他结构化模型保持 required", () => {
    expect(
      KiloSessionPrompt.structuredOutputToolChoice({
        format: "json_schema",
        model: { id: "deepseek-reasoner", npm: "@ai-sdk/openai-compatible" },
      }),
    ).toBe("auto")
    expect(
      KiloSessionPrompt.structuredOutputToolChoice({
        format: "json_schema",
        model: { id: "deepseek-v4-flash", npm: "@ai-sdk/openai-compatible" },
      }),
    ).toBe("auto")
    expect(
      KiloSessionPrompt.structuredOutputToolChoice({
        format: "json_schema",
        model: { id: "deepseek-v4-flash", npm: "@ai-sdk/openai-compatible" },
        variant: "none",
      }),
    ).toBe("required")
    expect(
      KiloSessionPrompt.structuredOutputToolChoice({
        format: "json_schema",
        model: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
      }),
    ).toBe("required")
  })

  test("DesignDoc 默认显式开启 DeepSeek V4 thinking", () => {
    expect(designDocModelVariant({ providerID: "deepseek", modelID: "deepseek-v4-flash" })).toBe("thinking")
    expect(designDocModelVariant({ providerID: "deepseek", modelID: "deepseek-v4-flash", variant: "none" })).toBe(
      "none",
    )
    expect(designDocModelVariant({ providerID: "test", modelID: "test-model" })).toBeUndefined()
  })
})

describe("DesignDoc 重试计数", () => {
  test("暂停造成的 interrupted Attempt 不消耗模型质量配额", () => {
    expect(
      consumedAttempts([
        {
          number: 1,
          kind: "generate",
          sessionID: "ses-interrupted",
          model: { providerID: "test", modelID: "test" },
          status: "interrupted",
          startedAt: 1,
          completedAt: 2,
        },
        {
          number: 2,
          kind: "generate",
          sessionID: "ses-completed",
          model: { providerID: "test", modelID: "test" },
          status: "completed",
          startedAt: 3,
          completedAt: 4,
        },
      ]),
    ).toBe(1)
  })
})

describe("DesignDoc 模型错误分类", () => {
  test("Session abort 记录为中断而不是模型质量失败", () => {
    const error = new SessionV1.AbortedError({ message: "User aborted" }).toObject()

    expect(designDocWorkerResponseError(error)).toBeInstanceOf(DesignDocSessionInterruptedError)
  })

  test("鉴权错误不可重试且保留真实错误", () => {
    const error = new SessionV1.APIError({
      message: "Authentication Fails",
      statusCode: 401,
      isRetryable: false,
    }).toObject()

    expect(designDocWorkerResponseError(error)).toMatchObject({
      code: "MODEL_AUTHENTICATION",
      message: "Authentication Fails",
      retryable: false,
    })
  })

  test("可重试 provider 错误保留重试语义", () => {
    const error = new SessionV1.APIError({
      message: "Provider unavailable",
      statusCode: 503,
      isRetryable: true,
    }).toObject()

    expect(designDocWorkerResponseError(error)).toMatchObject({
      code: "MODEL_API_ERROR",
      message: "Provider unavailable",
      retryable: true,
    })
  })
})
