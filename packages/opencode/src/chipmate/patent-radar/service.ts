import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import * as Log from "@opencode-ai/core/util/log"
import { Token } from "@/util/token"
import { PatentServerClient } from "./client"
import { assess, corpusGate } from "./evaluator"
import { compareFeatures, discoverAcrossWorkspace, extractCandidates, verifyCandidates } from "./model"
import { exportEvidencePackage } from "./report"
import { scanWorkspace } from "./scanner"
import { candidateAnchoredToScope, resolveScanScope } from "./scope"
import {
  deleteModule as removeModule,
  listModules as readModules,
  listRuns,
  loadEvidence,
  loadRun,
  saveModule as writeModule,
  saveRun,
  workspaceFingerprint,
} from "./store"
import { blindCandidateIds, PATENT_RADAR_METHOD_VERSION, PatentRadar } from "./types"

const log = Log.create({ service: "patent-radar" })

export namespace PatentRadarService {
  export interface ScanInput {
    directory: string
    cutoffDate?: string
    serverBaseUrl?: string
    analysisModel?: PatentRadar.AnalysisModel
    scope?: PatentRadar.ScanScope
    confirmLargeClosure?: boolean
    abort?: AbortSignal
  }

  export function scan(input: ScanInput) {
    const workspace = path.resolve(input.directory)
    const now = new Date().toISOString()
    const prepared = {
      workspace,
      cutoffDate: input.cutoffDate ?? now.slice(0, 10),
      serverBaseUrl: input.serverBaseUrl?.trim() || null,
      analysisModel: input.analysisModel ?? null,
      scope: PatentRadar.ScanScope.parse(input.scope ?? { kind: "workspace" }),
      confirmLargeClosure: input.confirmLargeClosure ?? false,
      abort: input.abort,
    }
    const identity = scanRequestIdentity(prepared)
    const pending = scanStarts.get(workspace)
    if (pending) {
      if (pending.identity === identity) return pending.promise
      return Promise.reject(new Error(scanConflictMessage(pending.description)))
    }
    const promise = startScan(prepared, identity, now).finally(() => {
      if (scanStarts.get(workspace)?.promise === promise) scanStarts.delete(workspace)
    })
    scanStarts.set(workspace, { identity, description: scanDescription(prepared.scope, prepared.analysisModel), promise })
    return promise
  }

  async function startScan(input: PreparedScanInput, identity: string, now: string) {
    const running = (await listRuns(input.workspace)).filter((run) => run.status === "SCANNING")
    const matching = running.find((run) => scanRunIdentity(run) === identity)
    if (matching) return resume(input.workspace, matching.id)
    if (running.length) throw new Error(scanConflictMessage(scanDescription(running[0]!.scope, running[0]!.analysisModel)))

    const id = randomUUID()
    const initial: PatentRadar.Run = {
      schemaVersion: 2,
      methodVersion: PATENT_RADAR_METHOD_VERSION,
      id,
      workspace: input.workspace,
      workspaceFingerprint: workspaceFingerprint(input.workspace),
      sourceFingerprint: "pending",
      fileFingerprints: {},
      createdAt: now,
      updatedAt: now,
      status: "SCANNING",
      cutoffDate: input.cutoffDate,
      serverBaseUrl: input.serverBaseUrl,
      analysisModel: input.analysisModel,
      scope: input.scope,
      scopeFingerprint: "pending",
      scopeCoverage: null,
      scopeLargeClosureConfirmed: input.confirmLargeClosure,
      corpus: null,
      coverage: null,
      sources: [],
      mechanisms: [],
      relations: [],
      bridgeCandidates: [],
      candidates: [],
      assessments: [],
      reviews: {},
      warnings: [],
      failure: null,
      rankingPolicy: { mode: "fused-rrf", rerank: "off" },
      tokenUsage: { input: 0, output: 0, calls: 0, estimated: true },
      discoveryCheckpoints: {},
      evidenceStore: null,
      qualityGate: {
        mode: "experimental",
        goldSetValidated: false,
        reasons: ["尚未完成至少 10 个真实嵌入式项目的 gold set 验收。"],
      },
      progress: progress(now),
      extractionBatches: {},
      bridgeBatches: {},
      verificationBatches: {},
      researchBatches: {},
      extractionEvidenceIds: [],
    }
    await saveRun(initial)
    launch(initial, input.abort)
    return initial
  }

  async function execute(initial: PatentRadar.Run, externalAbort?: AbortSignal) {
    const controller = new AbortController()
    const signal = externalAbort ? AbortSignal.any([externalAbort, controller.signal]) : controller.signal
    const key = activeKey(initial.workspace, initial.id)
    const existing = active.get(key)
    if (existing) return existing.promise
    const promise = runScan(initial, signal).finally(() => active.delete(key))
    active.set(key, { controller, promise })
    return promise
  }

  async function runScan(initial: PatentRadar.Run, abort: AbortSignal) {
    const workspace = initial.workspace
    const id = initial.id
    let current = initial
    let writes = Promise.resolve()
    const persist = () => {
      current.updatedAt = new Date().toISOString()
      const snapshot = structuredClone(current)
      writes = writes.then(() => saveRun(snapshot))
      return writes
    }
    try {
      const workspaceSource = await scanWorkspace(workspace)
      abort.throwIfAborted()
      current = {
        ...current,
        coverage: workspaceSource.coverage,
        progress: {
          ...current.progress!,
          phase: "scope-resolution",
          lastActivityAt: new Date().toISOString(),
          events: appendEvent(
            current.progress!,
            "scope-resolution",
            initial.scope.kind === "module" ? "全仓关系图已更新，正在计算模块智能闭包。" : "正在确认全仓扫描范围。",
          ),
        },
      }
      await persist()
      const resolved = await resolveScanScope(workspace, workspaceSource, initial.scope)
      if (resolved.preview.coverage.requiresConfirmation && !initial.scopeLargeClosureConfirmed) {
        throw new Error(
          `模块完整闭包占全仓 ${(resolved.preview.coverage.workspacePercent * 100).toFixed(1)}%，必须先在范围预览中选择“继续完整模块闭包”、改用均衡范围或切换全仓扫描。`,
        )
      }
      const source = resolved.source
      const previous = (await listRuns(workspace)).find(
        (run) => run.id !== id && run.status !== "FAILED" && scopeIdentity(run.scope) === scopeIdentity(initial.scope),
      )
      const evidenceById = new Map(source.evidence.map((item) => [item.id, item]))
      const savedEvidence = initial.extractionEvidenceIds.length
        ? initial.extractionEvidenceIds.flatMap((evidenceId) => {
            const evidence = evidenceById.get(evidenceId)
            return evidence ? [evidence] : []
          })
        : []
      const canResume = savedEvidence.length === initial.extractionEvidenceIds.length && savedEvidence.length > 0
      if (initial.extractionEvidenceIds.length && !canResume) current.extractionBatches = {}
      const incremental = canResume
        ? { evidence: savedEvidence, reused: [], mechanisms: current.mechanisms }
        : extractionInput(previous, source, initial.analysisModel)
      current = {
        ...current,
        sourceFingerprint: source.fingerprint,
        scopeFingerprint: resolved.preview.scopeFingerprint,
        scopeCoverage: resolved.preview.coverage,
        fileFingerprints: source.fileFingerprints,
        sources: source.evidence,
        coverage: source.coverage,
        relations: source.relations,
        discoveryCheckpoints: {
          ...current.discoveryCheckpoints,
          "workspace-scan": checkpoint(workspaceSource.fingerprint, current, "workspace-scan"),
          "scope-resolution": checkpoint(source.fingerprint, current, "scope-resolution"),
        },
        extractionEvidenceIds: incremental.evidence.map((item) => item.id),
        progress: {
          ...current.progress!,
          phase: "mechanism-distillation",
          totalUnits: 0,
          lastActivityAt: new Date().toISOString(),
          events: appendEvent(
            current.progress!,
            "mechanism-distillation",
            initial.scope.kind === "module"
              ? `模块闭包计算完成，纳入 ${resolved.preview.coverage.selectedEvidence} / ${resolved.preview.coverage.workspaceEvidence} 条证据，开始分批提炼局部机制。`
              : "工作区证据提取完成，开始分批提炼局部机制。",
          ),
        },
      }
      await persist()
      const extraction = incremental.evidence.length
        ? await extractCandidates(incremental.evidence, initial.analysisModel, {
            abort,
            completed: current.extractionBatches,
            onBatch: async (event) => {
              if (event.status === "started") {
                current.progress = {
                  ...current.progress!,
                  totalUnits: event.total,
                  lastActivityAt: new Date().toISOString(),
                  events: appendEvent(
                    current.progress!,
                    "mechanism-distillation",
                    `正在分析证据批次 ${event.index} / ${event.total}`,
                    event.index,
                    event.total,
                  ),
                }
                await persist()
                return
              }
              current.extractionBatches = { ...current.extractionBatches, [event.hash]: event.candidates ?? [] }
              current.candidates = mergeCandidates(incremental.reused, Object.values(current.extractionBatches).flat())
              current.progress = {
                ...current.progress!,
                completedUnits: Object.keys(current.extractionBatches).length,
                lastActivityAt: new Date().toISOString(),
                events: appendEvent(
                  current.progress!,
                  "mechanism-distillation",
                  event.candidates?.length
                    ? `证据批次 ${event.index} 分析完成，发现 ${event.candidates.length} 个候选。`
                    : `证据批次 ${event.index} 分析完成，未发现可靠候选。`,
                  event.index,
                  event.total,
                  event.candidates?.[0]?.title,
                ),
              }
              await persist()
            },
          })
        : { candidates: [], warnings: [] }
      const candidates = mergeCandidates(incremental.reused, extraction.candidates)
      current = {
        ...current,
        candidates,
        discoveryCheckpoints: {
          ...current.discoveryCheckpoints,
          "mechanism-distillation": checkpoint(source.fingerprint, current, "mechanism-distillation"),
        },
        progress: {
          ...current.progress!,
          phase: "relation-building",
          completedUnits: source.relations.length,
          totalUnits: source.relations.length,
          lastActivityAt: new Date().toISOString(),
          events: appendEvent(
            current.progress!,
            "relation-building",
            `确定性关系图已建立，共 ${source.relations.length} 条关系。`,
          ),
        },
      }
      await persist()
      current = {
        ...current,
        progress: {
          ...current.progress!,
          phase: "bridge-discovery",
          completedUnits: 0,
          totalUnits: source.evidence.length,
          lastActivityAt: new Date().toISOString(),
          events: appendEvent(current.progress!, "bridge-discovery", "开始全仓机制卡归并和跨文件 bridge 发现。"),
        },
      }
      await persist()
      const unchanged =
        previous?.sourceFingerprint === source.fingerprint &&
        previous.methodVersion === PATENT_RADAR_METHOD_VERSION &&
        JSON.stringify(previous.analysisModel) === JSON.stringify(initial.analysisModel)
      const discovery = unchanged
        ? {
            mechanisms: previous.mechanisms,
            candidates: clearReviewReady(previous.candidates),
            bridgeCandidateIds: previous.bridgeCandidates,
            relations: previous.relations,
            warnings: [],
          }
        : await discoverAcrossWorkspace(
            source.evidence,
            source.relations,
            initial.analysisModel,
            abort,
            incremental.mechanisms,
            async (mechanisms, completedEvidence, totalEvidence) => {
              current.mechanisms = mechanisms
              current.progress = {
                ...current.progress!,
                completedUnits: completedEvidence,
                totalUnits: totalEvidence,
                lastActivityAt: new Date().toISOString(),
                events: appendEvent(
                  current.progress!,
                  "bridge-discovery",
                  `机制卡归并进度 ${completedEvidence} / ${totalEvidence} 条证据。`,
                ),
              }
              current.discoveryCheckpoints = {
                ...current.discoveryCheckpoints,
                "mechanism-distillation": pendingCheckpoint(source.fingerprint, current, "mechanism-distillation"),
              }
              await persist()
            },
            current.bridgeBatches,
            async (hash, bridgeCandidates) => {
              current.bridgeBatches = { ...current.bridgeBatches, [hash]: bridgeCandidates }
              current.candidates = mergeCandidates(candidates, Object.values(current.bridgeBatches).flat())
              current.discoveryCheckpoints = {
                ...current.discoveryCheckpoints,
                "bridge-discovery": pendingCheckpoint(source.fingerprint, current, "bridge-discovery"),
              }
              await persist()
            },
          )
      const verified = unchanged
        ? clearReviewReady(previous.candidates)
        : await verifyCandidates(
            mergeCandidates(candidates, discovery.candidates),
            source.evidence,
            discovery.relations,
            initial.analysisModel,
            abort,
            current.verificationBatches,
            async (candidate) => {
              current.verificationBatches = { ...current.verificationBatches, [candidate.id]: candidate }
              current.discoveryCheckpoints = {
                ...current.discoveryCheckpoints,
                "bridge-verification": pendingCheckpoint(source.fingerprint, current, "bridge-verification"),
              }
              await persist()
            },
          )
      const grounded =
        initial.scope.kind === "module"
          ? verified.filter((candidate) =>
              candidateAnchoredToScope(candidate, resolved.coreEvidenceIds, discovery.relations),
            )
          : verified
      current = {
        ...current,
        mechanisms: discovery.mechanisms,
        relations: discovery.relations,
        bridgeCandidates: discovery.bridgeCandidateIds,
        candidates: grounded,
        discoveryCheckpoints: {
          ...current.discoveryCheckpoints,
          "mechanism-distillation": checkpoint(source.fingerprint, current, "mechanism-distillation"),
          "relation-building": checkpoint(source.fingerprint, current, "relation-building"),
          "bridge-discovery": checkpoint(source.fingerprint, current, "bridge-discovery"),
          "bridge-verification": checkpoint(source.fingerprint, current, "bridge-verification"),
        },
        progress: {
          ...current.progress!,
          phase: "bridge-verification",
          completedUnits: grounded.length,
          totalUnits: grounded.length,
          lastActivityAt: new Date().toISOString(),
          events: appendEvent(
            current.progress!,
            "bridge-verification",
            `原文与强关系回查完成，共保留 ${grounded.length} 个结果。`,
          ),
        },
      }
      await persist()
      const warnings = [...source.warnings, ...(source.files === 0 ? ["未发现首版支持的 C/C++ 或设计文档文件。"] : [])]
      const run: PatentRadar.Run = {
        ...current,
        sourceFingerprint: source.fingerprint,
        scopeFingerprint: resolved.preview.scopeFingerprint,
        scopeCoverage: resolved.preview.coverage,
        fileFingerprints: source.fileFingerprints,
        updatedAt: new Date().toISOString(),
        status: "EXTRACTED",
        sources: source.evidence,
        mechanisms: discovery.mechanisms,
        relations: discovery.relations,
        bridgeCandidates: discovery.bridgeCandidateIds,
        candidates: grounded,
        coverage: { ...workspaceSource.coverage, relations: workspaceSource.relations.length },
        tokenUsage: {
          input:
            Token.estimate(JSON.stringify(source.evidence)) * 2 + Token.estimate(JSON.stringify(discovery.mechanisms)),
          output: Token.estimate(JSON.stringify({ mechanisms: discovery.mechanisms, candidates: grounded })),
          calls:
            Object.keys(current.extractionBatches).length +
            Math.max(1, discovery.mechanisms.length) +
            discovery.bridgeCandidateIds.length +
            grounded.length,
          estimated: true,
        },
        warnings: [...warnings, ...extraction.warnings, ...discovery.warnings],
        progress: {
          ...current.progress!,
          phase: "complete",
          completedUnits: current.progress!.totalUnits,
          lastActivityAt: new Date().toISOString(),
          events: appendEvent(
            current.progress!,
            "complete",
            `扫描完成，共形成 ${grounded.filter((item) => item.discoveryTier === "technical-candidate").length} 个技术候选和 ${grounded.filter((item) => item.discoveryTier === "observation").length} 个观察项。`,
          ),
        },
      }
      await stalePrevious(workspace, run)
      await saveRun(run)
      return run
    } catch (error) {
      const cancelled = abort.aborted
      if (!cancelled) log.error("scan failed", { runId: id, phase: current.progress?.phase, error })
      const failed: PatentRadar.Run = {
        ...current,
        updatedAt: new Date().toISOString(),
        status: cancelled ? "CANCELLED" : "FAILED",
        failure: cancelled ? null : error instanceof Error ? error.message : String(error),
        discoveryCheckpoints:
          cancelled || !current.progress
            ? current.discoveryCheckpoints
            : {
                ...current.discoveryCheckpoints,
                [current.progress.phase]: {
                  status: "failed",
                  hash: createHash("sha256")
                    .update(`${current.methodVersion}:${current.sourceFingerprint}:${current.progress.phase}`)
                    .digest("hex"),
                  updatedAt: new Date().toISOString(),
                  error: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
                },
              },
        progress: current.progress
          ? {
              ...current.progress,
              failedUnits: cancelled ? current.progress.failedUnits : current.progress.failedUnits + 1,
              lastActivityAt: new Date().toISOString(),
              events: appendEvent(
                current.progress,
                current.progress.phase,
                cancelled ? "扫描已取消，已保留完成的批次检查点。" : "扫描失败，已保留完成的批次检查点。",
              ),
            }
          : undefined,
      }
      await saveRun(failed)
      return failed
    }
  }

  export async function cancel(directory: string, id: string) {
    const run = await loadRun(directory, id)
    active.get(activeKey(run.workspace, id))?.controller.abort(new Error("用户取消扫描"))
    if (run.status !== "SCANNING") return run
    const updated: PatentRadar.Run = {
      ...run,
      status: "CANCELLED",
      updatedAt: new Date().toISOString(),
      failure: null,
      progress: run.progress
        ? {
            ...run.progress,
            lastActivityAt: new Date().toISOString(),
            events: appendEvent(run.progress, run.progress.phase, "正在取消扫描…"),
          }
        : undefined,
    }
    await saveRun(updated)
    return updated
  }

  export async function resume(directory: string, id: string) {
    const run = await loadRun(directory, id)
    if (run.status !== "SCANNING" && run.status !== "CANCELLED" && run.status !== "FAILED") return run
    if (active.has(activeKey(run.workspace, id))) return run
    const resumed: PatentRadar.Run = {
      ...run,
      status: "SCANNING",
      failure: null,
      updatedAt: new Date().toISOString(),
      progress: run.progress
        ? {
            ...run.progress,
            lastActivityAt: new Date().toISOString(),
            events: appendEvent(run.progress, run.progress.phase, "从已保存的批次检查点继续扫描。"),
          }
        : progress(new Date().toISOString()),
    }
    await saveRun(resumed)
    launch(resumed)
    return resumed
  }

  export async function research(
    directory: string,
    id: string,
    serverBaseUrl?: string,
    abort?: AbortSignal,
    candidateId?: string,
  ) {
    const loaded = await loadRun(directory, id)
    const run: PatentRadar.Run = {
      ...loaded,
      progress: loaded.progress
        ? {
            ...loaded.progress,
            phase: "patent-research",
            completedUnits: 0,
            totalUnits: candidateId
              ? 1
              : loaded.candidates.filter((item) => item.discoveryTier !== "observation").length,
            lastActivityAt: new Date().toISOString(),
            events: appendEvent(loaded.progress, "patent-research", "开始执行混合召回和逐项专利证据矩阵。"),
          }
        : undefined,
    }
    await saveRun(run)
    const baseUrl = serverBaseUrl?.trim() || run.serverBaseUrl
    if (!baseUrl) return failResearch(run, "未配置独立 Patent Server 地址。")
    const client = new PatentServerClient(baseUrl)
    const state = await client.status(abort).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }))
    if ("error" in state) return failResearch(run, `Patent Server 不可用：${state.error}`)
    await staleCorpus(directory, id, state.watermark.generation)
    const gate = corpusGate(state.watermark, state.vectorCoverage)
    const assessments: PatentRadar.Assessment[] = []
    const researchBatches = { ...run.researchBatches }
    const researchable = run.candidates.filter((item) =>
      candidateId ? item.id === candidateId : item.discoveryTier !== "observation",
    )
    if (candidateId && !researchable.length) throw new Error("指定的 Patent Radar 候选不存在")
    for (const candidate of researchable) {
      const researchKey = `${state.watermark.generation ?? "none"}:${candidate.id}`
      const saved = researchBatches[researchKey]
      if (saved) {
        assessments.push(saved)
        continue
      }
      if (!state.watermark.generation) {
        assessments.push(assess(candidate, [], [], gate, state.warnings))
        researchBatches[researchKey] = assessments.at(-1)!
        await saveRun({ ...run, sources: [], assessments, researchBatches })
        continue
      }
      try {
        const result = await client.search(candidate, run.cutoffDate, abort)
        const warnings = [...state.warnings, ...result.warnings]
        let matrix: PatentRadar.MatrixCell[] = []
        let comparisonFailure: string | undefined
        try {
          matrix = await compareFeatures(candidate, result.hits, run.analysisModel, abort)
        } catch (error) {
          comparisonFailure = error instanceof Error ? error.message : String(error)
        }
        const failed = warnings.filter((warning) => /失败|未配置|未返回结果|不可用/.test(warning))
        const requestGate = {
          ready: gate.ready && failed.length === 0 && !comparisonFailure,
          warnings: [
            ...gate.warnings,
            ...failed.map((warning) => `检索链路未完整执行：${warning}`),
            ...(comparisonFailure ? [`逐项证据比对失败：${comparisonFailure}`] : []),
          ],
        }
        assessments.push(
          researchAssessment(run, candidate, assess(candidate, result.hits, matrix, requestGate, warnings)),
        )
      } catch (error) {
        assessments.push({
          candidateId: candidate.id,
          verdict: "insufficient-evidence",
          reason: "检索或逐项证据校验失败，已关闭正面结论。",
          references: [],
          matrix: [],
          warnings: [error instanceof Error ? error.message : String(error)],
        })
      }
      researchBatches[researchKey] = assessments.at(-1)!
      await saveRun({
        ...run,
        sources: [],
        assessments,
        researchBatches,
        progress: run.progress
          ? { ...run.progress, completedUnits: assessments.length, lastActivityAt: new Date().toISOString() }
          : undefined,
      })
    }
    const finalAssessments = candidateId
      ? [...run.assessments.filter((item) => item.candidateId !== candidateId), ...assessments]
      : assessments
    const updated: PatentRadar.Run = {
      ...run,
      updatedAt: new Date().toISOString(),
      status: "RESEARCHED",
      serverBaseUrl: baseUrl,
      corpus: state.watermark,
      assessments: finalAssessments,
      researchBatches,
      discoveryCheckpoints: {
        ...run.discoveryCheckpoints,
        "patent-research": checkpoint(run.sourceFingerprint, { ...run, corpus: state.watermark }, "patent-research"),
      },
      candidates: run.candidates.map((candidate) => ({
        ...candidate,
        discoveryTier:
          candidate.discoveryTier !== "observation" &&
          finalAssessments.some(
            (assessment) => assessment.candidateId === candidate.id && assessment.verdict === "review-ready",
          )
            ? ("review-ready" as const)
            : candidate.discoveryTier === "review-ready"
              ? ("technical-candidate" as const)
              : candidate.discoveryTier,
      })),
      progress: run.progress
        ? {
            ...run.progress,
            phase: "complete",
            completedUnits: run.progress.totalUnits,
            lastActivityAt: new Date().toISOString(),
            events: appendEvent(run.progress, "complete", "专利检索和逐项证据矩阵完成。"),
          }
        : undefined,
      failure: null,
    }
    await saveRun(updated)
    return updated
  }

  export async function review(
    directory: string,
    id: string,
    candidateId: string,
    value: Omit<PatentRadar.Review, "reviewedAt" | "blind">,
  ) {
    const run = await loadRun(directory, id)
    if (!run.candidates.some((candidate) => candidate.id === candidateId)) throw new Error("候选不存在")
    const parsed = PatentRadar.Review.parse({
      ...value,
      reviewedAt: new Date().toISOString(),
      blind: false,
    })
    const updated = {
      ...run,
      updatedAt: new Date().toISOString(),
      reviews: { ...run.reviews, [candidateId]: [...(run.reviews[candidateId] ?? []), parsed] },
    }
    await saveRun(updated)
    return updated
  }

  export async function importReviews(directory: string, id: string, value: unknown) {
    const run = await loadRun(directory, id)
    const input = PatentRadar.BlindReviewImport.parse(value)
    if (input.runId !== id) throw new Error(`盲审结果属于运行 ${input.runId}，当前运行是 ${id}`)
    if (input.sourceFingerprint !== run.sourceFingerprint || input.methodVersion !== run.methodVersion)
      throw new Error("盲审包的源码指纹或方法版本与当前运行不一致")
    const candidates = blindCandidateIds(run.candidates.map((item) => item.id))
    const reviews = { ...run.reviews }
    for (const item of input.reviews) {
      if (!candidates.has(item.candidateId)) throw new Error(`候选 ${item.candidateId} 不属于本运行的 20% 盲审样本`)
      const review = PatentRadar.Review.parse({ ...item, reviewedAt: new Date().toISOString(), blind: true })
      const existing = reviews[item.candidateId] ?? []
      const duplicate = existing.some(
        (current) =>
          current.blind &&
          current.reviewer === review.reviewer &&
          current.decision === review.decision &&
          current.note === review.note,
      )
      if (!duplicate) reviews[item.candidateId] = [...existing, review]
    }
    const updated = { ...run, reviews, updatedAt: new Date().toISOString() }
    await saveRun(updated)
    return updated
  }

  export async function get(directory: string, id: string) {
    const run = await loadRun(directory, id)
    return { ...run, sources: [] }
  }

  export async function evidence(directory: string, id: string, evidenceIds: string[]) {
    return loadEvidence(directory, id, evidenceIds)
  }

  export async function list(directory: string) {
    return listRuns(directory)
  }

  export async function previewScope(directory: string, scope: PatentRadar.ScanScope) {
    const workspace = await scanWorkspace(path.resolve(directory))
    return (await resolveScanScope(directory, workspace, scope)).preview
  }

  export async function listModules(directory: string) {
    return readModules(directory)
  }

  export async function saveModule(
    directory: string,
    input: {
      id?: string
      name: string
      corePaths: string[]
      expansionPolicy: "quality-first" | "balanced"
      autoScan?: boolean
    },
  ) {
    await previewScope(directory, {
      kind: "module",
      moduleId: input.id,
      name: input.name,
      corePaths: input.corePaths,
      expansionPolicy: input.expansionPolicy,
    })
    return writeModule(directory, input)
  }

  export async function deleteModule(directory: string, id: string) {
    return removeModule(directory, id)
  }

  export async function exportRun(directory: string, id: string) {
    return exportEvidencePackage(await loadRun(directory, id))
  }

  function launch(run: PatentRadar.Run, abort?: AbortSignal) {
    void execute(run, abort)
      .catch(async (error: unknown) => {
        log.error("background scan failed outside the normal run lifecycle", { runId: run.id, error })
        const current = await loadRun(run.workspace, run.id).catch(() => run)
        if (current.status !== "SCANNING") return
        const now = new Date().toISOString()
        await saveRun({
          ...current,
          status: "FAILED",
          updatedAt: now,
          failure: error instanceof Error ? error.message : String(error),
          progress: current.progress
            ? {
                ...current.progress,
                failedUnits: current.progress.failedUnits + 1,
                lastActivityAt: now,
                events: appendEvent(current.progress, current.progress.phase, "后台扫描异常终止，已保存失败状态。"),
              }
            : progress(now),
        })
      })
      .catch((error: unknown) => log.error("failed to persist background scan failure", { runId: run.id, error }))
  }
}

function checkpoint(
  sourceFingerprint: string,
  run: PatentRadar.Run,
  stage: string,
): PatentRadar.Run["discoveryCheckpoints"][string] {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        stage,
        methodVersion: run.methodVersion,
        analysisModel: run.analysisModel,
        sourceFingerprint,
        patentGeneration: run.corpus?.generation ?? null,
      }),
    )
    .digest("hex")
  return { status: "complete", hash, updatedAt: new Date().toISOString() }
}

function pendingCheckpoint(
  sourceFingerprint: string,
  run: PatentRadar.Run,
  stage: string,
): PatentRadar.Run["discoveryCheckpoints"][string] {
  return { ...checkpoint(sourceFingerprint, run, stage), status: "pending" }
}

const active = new Map<string, { controller: AbortController; promise: Promise<PatentRadar.Run> }>()
type PreparedScanInput = {
  workspace: string
  cutoffDate: string
  serverBaseUrl: string | null
  analysisModel: PatentRadar.AnalysisModel | null
  scope: PatentRadar.ScanScope
  confirmLargeClosure: boolean
  abort?: AbortSignal
}
const scanStarts = new Map<
  string,
  { identity: string; description: string; promise: Promise<PatentRadar.Run> }
>()

function scanRequestIdentity(input: Omit<PreparedScanInput, "workspace" | "abort">) {
  return JSON.stringify({
    methodVersion: PATENT_RADAR_METHOD_VERSION,
    cutoffDate: input.cutoffDate,
    serverBaseUrl: input.serverBaseUrl,
    analysisModel: input.analysisModel
      ? { providerID: input.analysisModel.providerID, modelID: input.analysisModel.modelID }
      : null,
    scope:
      input.scope.kind === "workspace"
        ? { kind: "workspace" }
        : {
            kind: "module",
            moduleId: input.scope.moduleId ?? null,
            corePaths: [...new Set(input.scope.corePaths)].sort(),
            expansionPolicy: input.scope.expansionPolicy,
          },
    confirmLargeClosure: input.confirmLargeClosure,
  })
}

function scanRunIdentity(run: PatentRadar.Run) {
  return scanRequestIdentity({
    cutoffDate: run.cutoffDate,
    serverBaseUrl: run.serverBaseUrl,
    analysisModel: run.analysisModel,
    scope: run.scope,
    confirmLargeClosure: run.scopeLargeClosureConfirmed,
  })
}

function scanDescription(scope: PatentRadar.ScanScope, model: PatentRadar.AnalysisModel | null) {
  const range = scope.kind === "workspace" ? "全项目扫描" : `模块扫描${scope.name ? `“${scope.name}”` : ""}`
  const analysis = model ? `${model.providerID}/${model.modelID}` : "未配置模型"
  return `${range}（${analysis}）`
}

function scanConflictMessage(description: string) {
  return `当前工作区已有${description}正在运行。请等待完成或取消后，再开始其他范围或模型的扫描。`
}

function activeKey(workspace: string, id: string) {
  return `${workspace}\0${id}`
}

function progress(now: string): NonNullable<PatentRadar.Run["progress"]> {
  return {
    phase: "workspace-scan",
    completedUnits: 0,
    totalUnits: 0,
    failedUnits: 0,
    startedAt: now,
    lastActivityAt: now,
    events: [{ id: randomUUID(), at: now, phase: "workspace-scan", message: "正在扫描工作区代码与设计文档。" }],
  }
}

function appendEvent(
  progress: NonNullable<PatentRadar.Run["progress"]>,
  phase: NonNullable<PatentRadar.Run["progress"]>["phase"],
  message: string,
  batchIndex?: number,
  totalBatches?: number,
  candidateTitle?: string,
) {
  return [
    ...progress.events,
    {
      id: randomUUID(),
      at: new Date().toISOString(),
      phase,
      message,
      ...(batchIndex ? { batchIndex } : {}),
      ...(totalBatches ? { totalBatches } : {}),
      ...(candidateTitle ? { candidateTitle } : {}),
    },
  ].slice(-200)
}

function extractionInput(
  previous: PatentRadar.Run | undefined,
  source: Awaited<ReturnType<typeof scanWorkspace>>,
  model: PatentRadar.AnalysisModel | null,
) {
  if (!previous) return { evidence: source.evidence, reused: [], mechanisms: [] }
  if (
    previous.methodVersion !== PATENT_RADAR_METHOD_VERSION ||
    JSON.stringify(previous.analysisModel) !== JSON.stringify(model)
  )
    return { evidence: source.evidence, reused: [], mechanisms: [] }
  const current = new Set(source.evidence.map((item) => item.id))
  const reused = previous.candidates.filter((candidate) => candidate.evidenceIds.every((id) => current.has(id)))
  if (previous.sourceFingerprint === source.fingerprint)
    return { evidence: [], reused, mechanisms: previous.mechanisms }
  const changed = new Set(
    Object.entries(source.fileFingerprints)
      .filter(([file, hash]) => previous.fileFingerprints[file] !== hash)
      .map(([file]) => file),
  )
  const primary = source.evidence.filter((item) => changed.has(item.location.file))
  const signals = new Set(primary.flatMap((item) => item.signals))
  const primaryIds = new Set(primary.map((item) => item.id))
  const connectedIds = new Set(
    source.relations.flatMap((relation) =>
      primaryIds.has(relation.fromEvidenceId) || primaryIds.has(relation.toEvidenceId) ? relation.evidenceIds : [],
    ),
  )
  const support = source.evidence.filter(
    (item) =>
      !changed.has(item.location.file) &&
      (connectedIds.has(item.id) || item.signals.some((signal) => signals.has(signal))),
  )
  const validEvidence = new Set(
    source.evidence.filter((item) => !changed.has(item.location.file)).map((item) => item.id),
  )
  const mechanisms = previous.mechanisms.filter((atom) => atom.evidenceIds.every((id) => validEvidence.has(id)))
  return { evidence: [...primary, ...support], reused, mechanisms }
}

function mergeCandidates(reused: PatentRadar.Candidate[], extracted: PatentRadar.Candidate[]) {
  const ids = new Set<string>()
  return [...reused, ...extracted].filter((candidate) => {
    if (ids.has(candidate.id)) return false
    ids.add(candidate.id)
    return true
  })
}

async function failResearch(run: PatentRadar.Run, message: string) {
  const updated: PatentRadar.Run = {
    ...run,
    updatedAt: new Date().toISOString(),
    status: "RESEARCHED",
    assessments: run.candidates.map((candidate) => ({
      candidateId: candidate.id,
      verdict: "insufficient-evidence",
      reason: "专利语料或检索服务不可用，已关闭正面结论。",
      references: [],
      matrix: [],
      warnings: [message],
    })),
    candidates: run.candidates.map((candidate) =>
      candidate.discoveryTier === "review-ready"
        ? { ...candidate, discoveryTier: "technical-candidate" as const }
        : candidate,
    ),
    failure: null,
  }
  await saveRun(updated)
  return updated
}

async function stalePrevious(directory: string, current: PatentRadar.Run) {
  const runs = await listRuns(directory)
  for (const run of runs) {
    if (run.id === current.id || run.status === "FAILED" || run.status === "STALE") continue
    if (scopeIdentity(run.scope) !== scopeIdentity(current.scope)) continue
    if (run.sourceFingerprint === current.sourceFingerprint && run.methodVersion === current.methodVersion) continue
    const reason =
      run.methodVersion !== current.methodVersion
        ? `Patent Radar 方法版本已从 ${run.methodVersion} 更新为 ${current.methodVersion}。`
        : "源码或文档指纹已变化。"
    await saveRun({
      ...run,
      status: "STALE",
      candidates: clearReviewReady(run.candidates),
      updatedAt: new Date().toISOString(),
      warnings: [...run.warnings, reason],
    })
  }
}

function scopeIdentity(scope: PatentRadar.ScanScope) {
  return scope.kind === "workspace"
    ? "workspace"
    : `module:${scope.moduleId ?? scope.corePaths.slice().sort().join("|")}`
}

async function staleCorpus(directory: string, currentId: string, generation: string | null) {
  if (!generation) return
  const runs = await listRuns(directory)
  for (const run of runs) {
    if (run.id === currentId || run.status === "FAILED" || run.status === "STALE") continue
    if (!run.corpus?.generation || run.corpus.generation === generation) continue
    await saveRun({
      ...run,
      status: "STALE",
      candidates: clearReviewReady(run.candidates),
      updatedAt: new Date().toISOString(),
      warnings: [...run.warnings, `专利语料 generation 已从 ${run.corpus.generation} 更新为 ${generation}。`],
    })
  }
}

function clearReviewReady(candidates: PatentRadar.Candidate[]) {
  return candidates.map((candidate) =>
    candidate.discoveryTier === "review-ready"
      ? { ...candidate, discoveryTier: "technical-candidate" as const }
      : candidate,
  )
}

function researchAssessment(
  run: PatentRadar.Run,
  candidate: PatentRadar.Candidate,
  assessment: PatentRadar.Assessment,
): PatentRadar.Assessment {
  if (run.scope.kind === "module" && !run.scopeCoverage?.closureComplete && assessment.verdict === "review-ready") {
    return {
      ...assessment,
      verdict: "insufficient-evidence",
      reason: "模块均衡范围存在未处理的强关系边界，不能输出模块范围内建议人工检索。",
      warnings: [...assessment.warnings, "请改用完整模块闭包或全仓扫描后重新检索。"],
    }
  }
  if (candidate.discoveryTier !== "observation" || assessment.verdict !== "review-ready") return assessment
  return {
    ...assessment,
    verdict: "observation",
    reason: "该结果的工程关系或原文证据尚未达到技术候选门禁；专利检索结果仅供观察，不能晋升为建议人工检索。",
    warnings: [...assessment.warnings, "Observation 只能在补齐确定性关系和原文证据后晋升。"],
  }
}
