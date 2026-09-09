import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assess, corpusGate } from "../../src/chipmate/patent-radar/evaluator"
import { PatentServerClient } from "../../src/chipmate/patent-radar/client"
import {
  ANALYSIS_TIMEOUT_MS,
  assertModelEndpoint,
  isContextLengthError,
  isNoOutputError,
  isTimeoutError,
} from "../../src/chipmate/patent-radar/model"
import { batchHash } from "../../src/chipmate/patent-radar/model"
import {
  bridgeUnits,
  normalizeEngineeringEvaluation,
  parseCandidateOutput,
  parseMechanismOutput,
} from "../../src/chipmate/patent-radar/model"
import { consumeLongRunningTaskHeader } from "../../src/chipmate/provider/long-running-request"
import { scanWorkspace } from "../../src/chipmate/patent-radar/scanner"
import { candidateAnchoredToScope, resolveScanScope } from "../../src/chipmate/patent-radar/scope"
import { migrate } from "../../src/chipmate/patent-radar/store"
import { evaluateGoldSet } from "../../src/chipmate/patent-radar/quality"
import { PatentRadarService } from "../../src/chipmate/patent-radar/service"
import { blindCandidateIds, PatentRadar } from "../../src/chipmate/patent-radar/types"

const candidate: PatentRadar.Candidate = {
  id: "candidate",
  title: "自适应中断采样控制",
  technicalProblem: "在资源受限设备中降低采样延迟和功耗。",
  implementation: "依据环形缓冲区水位切换中断采样状态。",
  technicalEffect: "减少空闲唤醒并保持采样数据连续。",
  features: [
    { id: "F1", text: "依据环形缓冲区水位选择采样状态", necessary: true, evidenceIds: ["E1"], relationIds: [] },
    { id: "F2", text: "在中断入口原子切换采样状态", necessary: true, evidenceIds: ["E1"], relationIds: [] },
  ],
  keywords: ["环形缓冲区", "中断采样"],
  ipcHints: [],
  evidenceIds: ["E1"],
  extractionWarnings: [],
  discoveryTier: "technical-candidate",
  origin: "local",
  mechanismIds: [],
  relationIds: [],
  coreSourceFiles: ["controller.c"],
  supportingSourceFiles: [],
  abstractMechanism: "依据缓冲区水位自适应切换中断采样状态",
  effectEvidenceLevel: "implemented",
  groundingStatus: "verified",
  engineeringEvaluation: null,
}

const hit: PatentRadar.PatentHit = {
  publicationNumber: "CN100000001A",
  title: "采样控制方法",
  priorityDate: "2020-01-01",
  publicationDate: "2021-01-01",
  familyId: "FAMILY-1",
  legalStatus: "有效",
  jurisdiction: "CN",
  classifications: [],
  score: 1,
  scores: { lexical: 1, vector: 1, fused: 1 },
  passages: [
    { field: "claim", locator: "claim:1", text: "依据环形缓冲区水位选择采样状态" },
    { field: "claim", locator: "claim:2", text: "在中断入口原子切换采样状态" },
  ],
  sourceBatch: "CN-1",
}

describe("Patent Radar 确定性门禁", () => {
  test("模型工程评分越界时忽略辅助评分而不终止扫描", () => {
    const invalid = normalizeEngineeringEvaluation({
      technicalProblemSpecificity: 6,
      implementationDepth: 4,
      crossComponentCoordination: 4,
      causalEffectCompleteness: 4,
      conventionalDifference: 4,
      mechanismReusability: 4,
      productCentrality: 4,
      designAroundDifficulty: 4,
      reasons: {},
    })
    expect(invalid.value).toBeNull()
    expect(invalid.warning).toContain("已忽略该辅助评分")

    const valid = normalizeEngineeringEvaluation({
      technicalProblemSpecificity: 5,
      implementationDepth: 4,
      crossComponentCoordination: 4,
      causalEffectCompleteness: 4,
      conventionalDifference: 4,
      mechanismReusability: 4,
      productCentrality: 4,
      designAroundDifficulty: 4,
      reasons: {},
    })
    expect(valid.value?.technicalProblemSpecificity).toBe(5)
    expect(valid.warning).toBeUndefined()
  })

  test("单个候选缺少必填字段时忽略该候选并保留同批有效结果", () => {
    const valid = {
      title: "中断采样功耗联动机制",
      technicalProblem: "在实时采样过程中降低设备空闲功耗。",
      implementation: "根据环形缓冲区水位切换设备低功耗状态。",
      technicalEffect: "在保持数据连续的同时减少无效唤醒。",
      features: [
        { text: "在中断入口写入环形缓冲区", necessary: true, evidenceIds: ["E1"] },
        { text: "根据写指针水位切换功耗状态", necessary: true, evidenceIds: ["E2"] },
      ],
      keywords: ["环形缓冲区", "低功耗"],
      ipcHints: [],
      evidenceIds: ["E1", "E2"],
    }
    const result = parseCandidateOutput({ candidates: [{ ...valid, technicalEffect: undefined }, valid] }, "候选批次")
    expect(result.candidates).toHaveLength(1)
    expect(result.warnings[0]).toContain("candidates.0.technicalEffect")
  })

  test("候选响应整体不是对象时明确拒绝而不是静默当成空结果", () => {
    expect(() => parseCandidateOutput(undefined, "候选批次")).toThrow(
      /候选批次返回不合规 JSON.*expected object, received undefined/,
    )
  })

  test("机制响应中的单条坏记录不会丢掉同批有效机制", () => {
    const result = parseMechanismOutput({
      mechanisms: [
        {
          abstractMechanism: "根据缓冲水位切换采样状态",
          implementation: "中断入口读取水位并切换状态",
          technicalProblem: "减少空闲唤醒",
          input: ["缓冲水位"],
          processing: ["阈值判断"],
          output: ["采样状态"],
          stateChanges: ["空闲到采样"],
          constraints: ["中断上下文"],
          technicalEffect: "降低功耗",
          effectEvidenceLevel: "implemented",
          evidenceIds: ["E1"],
          bridgeHooks: ["采样状态"],
        },
        undefined,
      ],
    })
    expect(result.mechanisms).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
  })

  test("扫描启动在后台任务完成前返回已持久化的初始 Run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patent-background-"))
    try {
      await writeFile(path.join(root, "controller.c"), "void controller_init(void) {}\n")
      const run = await PatentRadarService.scan({ directory: root })
      expect(run.status).toBe("SCANNING")
      expect(run.progress?.phase).toBe("workspace-scan")
      expect(run.progress?.events[0]?.message).toContain("正在扫描工作区")

      const persisted = await PatentRadarService.get(root, run.id)
      expect(persisted.id).toBe(run.id)
      expect(persisted.progress?.events.length).toBeGreaterThan(0)
      await PatentRadarService.cancel(root, run.id)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("同一工作区的并发重复启动原子复用同一个 Run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patent-idempotent-start-"))
    try {
      await writeFile(path.join(root, "controller.c"), "void controller_init(void) {}\n")
      const input = {
        directory: root,
        analysisModel: { providerID: "test", modelID: "delayed-model" },
        scope: { kind: "workspace" as const },
      }
      const [first, second] = await Promise.all([PatentRadarService.scan(input), PatentRadarService.scan(input)])
      expect(second.id).toBe(first.id)
      expect(await PatentRadarService.list(root)).toHaveLength(1)
      await PatentRadarService.cancel(root, first.id)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("取消完成后相同请求创建独立的新 Run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patent-cancel-restart-"))
    try {
      await writeFile(path.join(root, "controller.c"), "void controller_init(void) {}\n")
      const input = { directory: root, scope: { kind: "workspace" as const } }
      const first = await PatentRadarService.scan(input)
      expect((await PatentRadarService.cancel(root, first.id)).status).toBe("CANCELLED")

      const second = await PatentRadarService.scan(input)
      expect(second.id).not.toBe(first.id)
      expect(await PatentRadarService.list(root)).toHaveLength(2)
      await PatentRadarService.cancel(root, second.id)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("活动扫描的范围或模型任一不一致时明确拒绝而不是恢复错误任务", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patent-scope-conflict-"))
    try {
      await mkdir(path.join(root, "module"))
      await writeFile(path.join(root, "module", "controller.c"), "void controller_init(void) {}\n")
      const first = PatentRadarService.scan({
        directory: root,
        analysisModel: { providerID: "test", modelID: "workspace-model" },
        scope: { kind: "workspace" },
      })
      await expect(
        PatentRadarService.scan({
          directory: root,
          analysisModel: { providerID: "test", modelID: "other-model" },
          scope: { kind: "workspace" },
        }),
      ).rejects.toThrow(/已有全项目扫描.*workspace-model.*等待完成或取消/)
      await expect(
        PatentRadarService.scan({
          directory: root,
          analysisModel: { providerID: "test", modelID: "workspace-model" },
          scope: {
            kind: "module",
            name: "控制模块",
            corePaths: ["module"],
            expansionPolicy: "quality-first",
          },
        }),
      ).rejects.toThrow(/已有全项目扫描.*workspace-model.*等待完成或取消/)
      const run = await first
      expect(await PatentRadarService.list(root)).toHaveLength(1)
      await PatentRadarService.cancel(root, run.id)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("模块核心 B 通过强关系闭包纳入跨目录 A 和 C，但不纳入弱关系 D", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "patent-scope-"))
    try {
      await Promise.all(["a", "b", "c", "d"].map((name) => mkdir(path.join(root, name))))
      await Promise.all(
        ["a/a.c", "b/b.c", "c/c.c", "d/d.c"].map((file) => writeFile(path.join(root, file), "void f(void) {}\n")),
      )
      const evidence = ["a/a.c", "b/b.c", "c/c.c", "d/d.c"].map((file, index) => ({
        id: `E${index + 1}`,
        kind: "code" as const,
        location: { file, lineStart: 1, lineEnd: 1, sha256: `hash-${index}` },
        excerpt: "void f(void) {}",
        signals: [],
        symbols: [],
        variantIds: ["default"],
        condition: null,
      }))
      const relation = (id: string, from: string, to: string, strength: "strong" | "weak") => ({
        relationId: id,
        kind: "call" as const,
        fromEvidenceId: from,
        toEvidenceId: to,
        evidenceIds: [from, to],
        resolution: "exact" as const,
        strength,
        variantIds: ["default"],
        condition: null,
        locations: [
          evidence.find((item) => item.id === from)!.location,
          evidence.find((item) => item.id === to)!.location,
        ],
      })
      const source = {
        fingerprint: "workspace",
        fileFingerprints: Object.fromEntries(evidence.map((item) => [item.location.file, item.location.sha256])),
        evidence,
        warnings: [],
        files: 4,
        coverage: {
          supportedFiles: 4,
          analyzedFiles: 4,
          skippedFiles: 0,
          parseFailures: [],
          skipped: [],
          codeEvidence: 4,
          documentEvidence: 0,
          relations: 3,
          compileCommands: "available" as const,
          variants: [],
          conditionalCoverageComplete: true,
          completeWorkspaceScan: true,
        },
        relations: [
          relation("R1", "E1", "E2", "strong"),
          relation("R2", "E2", "E3", "strong"),
          relation("R3", "E2", "E4", "weak"),
        ],
      }
      const resolved = await resolveScanScope(root, source, {
        kind: "module",
        corePaths: ["b"],
        expansionPolicy: "quality-first",
      })
      expect(resolved.source.evidence.map((item) => item.id).sort()).toEqual(["E1", "E2", "E3"])
      expect(resolved.preview.coverage.supportingFiles).toEqual(["a/a.c", "c/c.c"])
      expect(resolved.preview.coverage.requiresConfirmation).toBe(true)
      expect(resolved.source.evidence.some((item) => item.id === "E4")).toBe(false)

      const anchored = {
        ...candidate,
        evidenceIds: ["E2", "E3"],
        features: candidate.features.map((feature, index) => ({ ...feature, evidenceIds: [index ? "E3" : "E2"] })),
      }
      expect(candidateAnchoredToScope(anchored, resolved.coreEvidenceIds, resolved.source.relations)).toBe(true)
      expect(
        candidateAnchoredToScope(
          { ...anchored, evidenceIds: ["E1", "E3"] },
          resolved.coreEvidenceIds,
          resolved.source.relations,
        ),
      ).toBe(false)

      const balanced = await resolveScanScope(root, source, {
        kind: "module",
        corePaths: ["a"],
        expansionPolicy: "balanced",
      })
      expect(balanced.preview.coverage.closureComplete).toBe(false)
      expect(balanced.preview.coverage.excludedBoundaries.map((item) => item.relationId)).toEqual(["R2"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("Patent Server 客户端允许 HTTP 和 HTTPS 但拒绝其他协议", () => {
    expect(() => new PatentServerClient("http://10.1.2.3:6020")).not.toThrow()
    expect(() => new PatentServerClient("https://patent.corp.example:6020")).not.toThrow()
    expect(() => new PatentServerClient("ftp://10.1.2.3:6020")).toThrow(/只允许使用 HTTP 或 HTTPS/)
  })

  test("Patent Radar 始终使用 fused 分数，忽略反向 Rerank 分数", async () => {
    const original = globalThis.fetch
    const requests: Array<{ queries: string[] }> = []
    const mock = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (typeof init?.body !== "string") throw new Error("测试搜索请求缺少 JSON 请求体")
      const body: unknown = JSON.parse(init.body)
      if (
        !body ||
        typeof body !== "object" ||
        !("queries" in body) ||
        !Array.isArray(body.queries) ||
        !body.queries.every((item) => typeof item === "string")
      ) {
        throw new Error("测试搜索请求缺少 queries")
      }
      requests.push({ queries: body.queries })
      return new Response(
        JSON.stringify({
          hits: [
            {
              publicationNumber: "CN1A",
              jurisdiction: "CN",
              title: null,
              familyId: null,
              priorityDate: null,
              publicationDate: "2020-01-01",
              legalStatus: null,
              classifications: [],
              passages: [],
              scores: { lexical: 0.4, vector: 0.8, citation: 0.2, fused: 0.9, rerank: -99 },
              sourceBatch: "B1",
            },
          ],
          warnings: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    globalThis.fetch = Object.assign(mock, { preconnect: original.preconnect })
    try {
      const result = await new PatentServerClient("http://127.0.0.1:6020").search(candidate, "2026-01-01")
      expect(result.hits[0]?.score).toBeGreaterThan(0)
      expect(result.hits[0]?.scores.rerank).toBeNull()
      expect(requests.length).toBeGreaterThan(1)
      expect(requests.every((request) => request.queries.length === 1)).toBe(true)
    } finally {
      globalThis.fetch = original
    }
  })

  test("语料缺失时强制 insufficient-evidence", () => {
    const gate = corpusGate({ status: "READY", generation: "g1", indexedAt: "2026-01-01", jurisdictions: [] }, 1)
    const result = assess(candidate, [], [], gate, [])
    expect(result.verdict).toBe("insufficient-evidence")
    expect(result.warnings).toContain("CN 语料缺失。")
  })

  test("只有样例记录但没有历史基线时关闭正面结论", () => {
    const jurisdictions = ["CN", "JP", "KR", "US", "EP", "RU"].map((jurisdiction) => ({
      jurisdiction,
      records: 1,
      dataThrough: "2026-01-01",
      legalStatusThrough: "2026-01-01",
      claimsCoverage: 1,
      fullTextCoverage: 1,
      historicalBaseline: false,
      coverageThrough: "2026-01-01",
    }))
    const gate = corpusGate({ status: "READY", generation: "g1", indexedAt: "2026-01-01", jurisdictions }, 1)
    expect(gate.ready).toBe(false)
    expect(gate.warnings).toContain("CN 尚未导入并声明完整历史基线。")
  })

  test("不完整语料试运行保留命中文献但不允许正面结论", () => {
    const result = assess(candidate, [hit], [], { ready: false, warnings: ["历史基线不完整。"] }, [])
    expect(result.verdict).toBe("insufficient-evidence")
    expect(result.references.map((item) => item.publicationNumber)).toEqual(["CN100000001A"])
    expect(result.reason).toContain("关闭正面结论")
  })

  test("单篇文献只有在逐项矩阵完整覆盖时才判冲突", () => {
    const gate = { ready: true, warnings: [] }
    const matrix: PatentRadar.MatrixCell[] = [
      {
        featureId: "F1",
        publicationNumber: hit.publicationNumber,
        covered: true,
        locator: "claim:1",
        quote: "依据环形缓冲区水位选择采样状态",
        rationale: "明确公开",
      },
      {
        featureId: "F2",
        publicationNumber: hit.publicationNumber,
        covered: true,
        locator: "claim:2",
        quote: "在中断入口原子切换采样状态",
        rationale: "明确公开",
      },
    ]
    expect(assess(candidate, [hit], matrix, gate, []).verdict).toBe("single-reference-conflict")
    expect(assess(candidate, [hit], matrix.slice(0, 1), gate, []).verdict).toBe("insufficient-evidence")
  })

  test("只有完整语料门禁通过后才允许 review-ready", () => {
    const gate = corpusGate(
      {
        status: "READY",
        generation: "g1",
        indexedAt: "2026-01-01",
        requiredJurisdictions: ["CN"],
        jurisdictions: [
          {
            jurisdiction: "CN",
            records: 1_000_000,
            dataThrough: "2026-01-01",
            legalStatusThrough: "2026-01-01",
            claimsCoverage: 1,
            fullTextCoverage: 1,
            historicalBaseline: true,
            coverageThrough: "2026-01-01",
          },
        ],
      },
      1,
    )
    expect(gate.ready).toBe(true)
    expect(assess(candidate, [], [], gate, []).verdict).toBe("review-ready")
  })

  test("代码与设计文档证据均带可定位行号和文件哈希", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chipmate-patent-radar-"))
    try {
      await writeFile(
        path.join(root, "controller.c"),
        "typedef enum { IDLE, SAMPLE } State;\nvoid sample_irq(void) {\n  // 根据环形缓冲区水位降低功耗和延迟\n  switch (state) { case IDLE: state = SAMPLE; break; default: break; }\n}\n",
      )
      await writeFile(
        path.join(root, "设计.md"),
        "# 技术方案\n系统依据环形缓冲区水位自适应切换采样状态，通过中断入口的原子状态迁移减少空闲唤醒，在资源受限控制器中降低采样延迟和功耗，同时保持连续数据流。\n",
      )
      const result = await scanWorkspace(root)
      expect(result.files).toBe(2)
      expect(result.evidence.some((item) => item.kind === "code")).toBe(true)
      expect(result.evidence.some((item) => item.kind === "document")).toBe(true)
      expect(result.evidence.every((item) => item.location.lineStart > 0 && item.location.sha256.length === 64)).toBe(
        true,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("盲审样本按候选哈希稳定抽取约 20% 且小样本至少一条", () => {
    const candidates = Array.from({ length: 100 }, (_value, index) => index.toString(16).padStart(16, "0"))
    const first = blindCandidateIds(candidates)
    const second = blindCandidateIds([...candidates].reverse())
    expect(first.size).toBe(20)
    expect([...first].sort()).toEqual([...second].sort())
    expect(blindCandidateIds(["one"]).size).toBe(1)
  })

  test("已选 Provider 的模型端点允许内网 HTTP 和 HTTPS", () => {
    expect(() => assertModelEndpoint("https://10.1.2.3/v1")).not.toThrow()
    expect(() => assertModelEndpoint("http://[::1]/v1")).not.toThrow()
    expect(() => assertModelEndpoint("http://10.1.2.3:8000/v1")).not.toThrow()
    expect(() => assertModelEndpoint("https://api.public.example/v1")).not.toThrow()
    expect(() => assertModelEndpoint("ftp://10.1.2.3/v1")).toThrow(/只允许使用 HTTP 或 HTTPS/)
  })

  test("识别模型请求的直接和嵌套超时", () => {
    expect(ANALYSIS_TIMEOUT_MS).toBeUndefined()
    expect(isTimeoutError(new DOMException("The operation timed out.", "TimeoutError"))).toBe(true)
    expect(isTimeoutError(new Error("模型请求失败", { cause: new Error("request timeout") }))).toBe(true)
    expect(isTimeoutError(new Error("模型返回 HTTP 500"))).toBe(false)
  })

  test("识别 context-length 和 HTTP 413，避免原请求重试", () => {
    expect(isContextLengthError({ status: 413, message: "payload too large" })).toBe(true)
    expect(isContextLengthError(new Error("maximum context length exceeded"))).toBe(true)
    expect(isContextLengthError(new Error("HTTP 500"))).toBe(false)
  })

  test("识别模型无输出错误以便隔离问题批次", () => {
    expect(isNoOutputError(new Error("No output generated."))).toBe(true)
    expect(isNoOutputError(new Error("invalid api key"))).toBe(false)
  })

  test("长任务标记只作用于本次请求且不会发送给模型服务", () => {
    const result = consumeLongRunningTaskHeader({
      headers: { "x-chipmate-long-running-task": "patent-radar", accept: "application/json" },
    })
    expect(result.longRunning).toBe(true)
    const headers = new Headers(result.init?.headers as HeadersInit)
    expect(headers.get("x-chipmate-long-running-task")).toBeNull()
    expect(headers.get("accept")).toBe("application/json")
  })

  test("超过旧上限的证据仍形成全部确定性批次", () => {
    const evidence = Array.from({ length: 264 }, (_value, index) => ({
      id: `E${index}`,
      kind: "code" as const,
      location: { file: `src/${index}.c`, lineStart: 1, lineEnd: 1, sha256: index.toString(16).padStart(64, "0") },
      excerpt: "测试证据",
      signals: ["测试"],
      symbols: [],
      variantIds: [],
      condition: null,
    }))
    const hashes = Array.from({ length: Math.ceil(evidence.length / 8) }, (_value, index) =>
      batchHash(evidence.slice(index * 8, index * 8 + 8)),
    )
    expect(hashes).toHaveLength(33)
    expect(new Set(hashes).size).toBe(33)
  })

  test("A、B、C 跨文件调用链形成 exact 强关系并进入同一 bridge 单元", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chipmate-patent-bridge-"))
    try {
      await writeFile(
        path.join(root, "compile_commands.json"),
        `${JSON.stringify(["irq.c", "ring.c", "power.c"].map((file) => ({ directory: root, file, arguments: ["cc", "-DHW_VARIANT=1", "-c", file] })))}\n`,
      )
      await writeFile(
        path.join(root, "irq.c"),
        "void ring_push(void);\nvoid sample_irq(void) { ring_push(); /* interrupt queue */ }\n",
      )
      await writeFile(
        path.join(root, "ring.c"),
        "void power_adjust(void);\nvoid ring_push(void) { power_adjust(); /* ring buffer watermark */ }\n",
      )
      await writeFile(path.join(root, "power.c"), "void power_adjust(void) { /* low power state transition */ }\n")
      const result = await scanWorkspace(root)
      expect(result.evidence.every((item) => item.variantIds.length === 1)).toBe(true)
      const calls = result.relations.filter((item) => item.kind === "call")
      expect(calls).toHaveLength(2)
      expect(calls.every((item) => item.resolution === "exact" && item.strength === "strong")).toBe(true)
      const mechanisms = result.evidence.map((item, index) =>
        PatentRadar.MechanismAtom.parse({
          id: `M${index}`,
          abstractMechanism: `机制 ${index}`,
          implementation: "通过确定性调用传递状态",
          technicalProblem: "降低中断数据链的功耗与延迟",
          input: [],
          processing: ["状态处理"],
          output: [],
          stateChanges: [],
          constraints: ["嵌入式资源约束"],
          technicalEffect: "减少空闲唤醒",
          effectEvidenceLevel: "implemented",
          evidenceIds: [item.id],
          sourceFiles: [item.location.file],
          bridgeHooks: [],
        }),
      )
      const units = bridgeUnits(mechanisms, result.relations)
      expect(units).toHaveLength(1)
      expect(new Set(units[0]!.flatMap((item) => item.sourceFiles))).toEqual(new Set(["irq.c", "ring.c", "power.c"]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("compile_commands 分离参数不会把不同硬件配置误合并为同一 Variant", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chipmate-patent-variant-"))
    try {
      await writeFile(
        path.join(root, "compile_commands.json"),
        `${JSON.stringify([
          { directory: root, file: "caller.c", command: 'cc -D "BOARD=A" -I "boards/a include" -c caller.c' },
          {
            directory: root,
            file: "target.c",
            arguments: ["cc", "-D", "BOARD=B", "-I", "boards/b include", "-c", "target.c"],
          },
        ])}\n`,
      )
      await writeFile(
        path.join(root, "caller.c"),
        "void target(void);\nvoid irq(void) { target(); /* interrupt queue */ }\n",
      )
      await writeFile(path.join(root, "target.c"), "void target(void) { /* low power buffer */ }\n")
      const result = await scanWorkspace(root)
      const variants = new Set(result.evidence.flatMap((item) => item.variantIds))
      expect(variants.size).toBe(2)
      expect(result.relations.find((item) => item.kind === "call")?.resolution).toBe("conditional")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("超长函数分片后仍保留后部调用的精确证据位置", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chipmate-patent-long-function-"))
    try {
      await writeFile(
        path.join(root, "compile_commands.json"),
        `${JSON.stringify(["caller.c", "target.c"].map((file) => ({ directory: root, file, arguments: ["cc", "-DHW=1", "-c", file] })))}\n`,
      )
      const filler = Array.from({ length: 360 }, (_value, index) => `  state += ${index};`).join("\n")
      await writeFile(
        path.join(root, "caller.c"),
        `void target(void);\nvoid irq(void) {\n${filler}\n  target(); /* interrupt queue */\n}\n`,
      )
      await writeFile(path.join(root, "target.c"), "void target(void) { /* ring buffer low power */ }\n")
      const result = await scanWorkspace(root)
      const caller = result.evidence.filter((item) => item.location.file === "caller.c")
      const relation = result.relations.find((item) => item.kind === "call")
      expect(caller.length).toBeGreaterThan(1)
      expect(relation?.locations[0]?.lineStart).toBeGreaterThan(300)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("缺少 compile_commands 时关系不能成为技术候选强边", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chipmate-patent-conditional-"))
    try {
      await writeFile(
        path.join(root, "a.c"),
        "void target(void);\nvoid irq(void) { target(); /* interrupt queue */ }\n",
      )
      await writeFile(path.join(root, "b.c"), "void target(void) { /* low power buffer */ }\n")
      const result = await scanWorkspace(root)
      expect(result.coverage.compileCommands).toBe("missing")
      expect(result.coverage.completeWorkspaceScan).toBe(false)
      expect(
        result.relations
          .filter((item) => item.kind === "call")
          .every((item) => item.strength === "weak" && item.resolution === "conditional"),
      ).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("函数指针回调注册形成强边，条件编译关系保持弱边", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chipmate-patent-callback-"))
    try {
      await writeFile(
        path.join(root, "compile_commands.json"),
        `${JSON.stringify(["setup.c", "callback.c"].map((file) => ({ directory: root, file, arguments: ["cc", "-DHW=1", "-c", file] })))}\n`,
      )
      await writeFile(
        path.join(root, "setup.c"),
        "void register_cb(void (*cb)(void));\nvoid setup_irq(void) { register_cb(sample_callback); /* interrupt callback */ }\n",
      )
      await writeFile(
        path.join(root, "callback.c"),
        "#if ENABLE_SAMPLE\nvoid sample_callback(void) { /* queue low power */ }\n#endif\n",
      )
      const result = await scanWorkspace(root)
      const callback = result.relations.find((item) => item.kind === "callback-registration")
      expect(callback?.resolution).toBe("conditional")
      expect(callback?.strength).toBe("weak")
      expect(callback?.condition).toContain("ENABLE_SAMPLE")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("v1 运行记录迁移为实验性 v2 并标记 STALE", () => {
    const legacy = {
      schemaVersion: 1,
      id: "legacy",
      workspace: "/tmp/project",
      workspaceFingerprint: "w",
      sourceFingerprint: "s",
      fileFingerprints: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "EXTRACTED",
      cutoffDate: "2026-01-01",
      serverBaseUrl: null,
      analysisModel: null,
      corpus: null,
      sources: [],
      candidates: [],
      assessments: [],
      reviews: {},
      warnings: [],
      failure: null,
      extractionBatches: {},
      extractionEvidenceIds: [],
    }
    const run = migrate(legacy)
    expect(run.schemaVersion).toBe(2)
    expect(run.status).toBe("STALE")
    expect(run.qualityGate.goldSetValidated).toBe(false)
  })

  test("未达到真实样本规模时质量门禁保持关闭", () => {
    const result = evaluateGoldSet({
      projects: [{ id: "P1", humanMinutes: 100, radarReviewMinutes: 10 }],
      technicalPoints: [{ id: "T1", crossFile: true }],
      discoveries: [
        {
          candidateId: "C1",
          tier: "technical-candidate",
          matchedPointIds: ["T1"],
          worthy: true,
          citationsResolved: true,
        },
      ],
      conflicts: [{ id: "X1", rank: 1, enteredReviewReady: false }],
    })
    expect(result.metrics.recall).toBe(1)
    expect(result.metrics.sampleReady).toBe(false)
    expect(result.passed).toBe(false)
  })
})
