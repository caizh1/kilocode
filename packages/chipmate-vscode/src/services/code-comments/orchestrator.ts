import type * as vscode from "vscode"
import { buildCommentedDocument, validateOnlyCommentInsertions } from "./apply"
import { buildCommentPrompt } from "./protocol"
import {
  CodeCommentCancelledError,
  CodeCommentSessionError,
  CodeCommentSessionRunner,
  type CodeCommentSessionOutput,
} from "./session-runner"
import type {
  CodeCommentRequest,
  CodeCommentProgressEvent,
  CommentMode,
  CommentGenerationResult,
  CommentStrategy,
  FunctionTarget,
  ValidatedCommentResult,
} from "./types"
import {
  buildValidatedCommentCandidate,
  parseCommentQaResponse,
  type CommentCandidateResult,
  type CommentQaResponse,
} from "./validator"

const SESSION_TIMEOUT_MS = 120_000

type CompletedRound = {
  response: CommentQaResponse
  output: CodeCommentSessionOutput
}

type FailedRound = {
  reason: string
  kind: "parse" | "session"
}

type SafePartial = {
  value: ValidatedCommentResult
  output: CodeCommentSessionOutput
}

export class CodeCommentOrchestrator {
  constructor(
    private readonly runner: Pick<CodeCommentSessionRunner, "run">,
    private readonly log: (message: string) => void,
  ) {}

  async generate(
    request: CodeCommentRequest,
    token: vscode.CancellationToken,
    report?: (event: CodeCommentProgressEvent) => void,
  ): Promise<CommentGenerationResult> {
    if (request.targets.length !== 1) throw new Error("单次代码注释生成只支持一个函数目标")
    const target = request.targets[0]!
    report?.({ stage: "primary" })
    const primary = await this.run({ request, target, round: "primary", token })
    if ("reason" in primary) {
      if (request.strategy === "single-self-check" && primary.kind === "parse") {
        return this.recoverSinglePass(request, target, token, [`primary: ${primary.reason}`], report)
      }
      return unresolved(target, request.strategy, 1, [`primary: ${primary.reason}`])
    }
    const candidate = await validateCandidate(target, primary.response, request.mode)
    if (!candidate.ok) {
      if (request.strategy === "single-self-check") {
        return this.recoverSinglePass(
          request,
          target,
          token,
          candidate.reasons.map((reason) => `primary: ${reason}`),
          report,
          candidate.kind === "coverage-incomplete" ? { value: candidate.partial, output: primary.output } : undefined,
        )
      }
      return unresolved(
        target,
        request.strategy,
        1,
        candidate.reasons.map((reason) => `primary: ${reason}`),
      )
    }
    if (request.strategy === "single-self-check") {
      return this.complete(target, request.strategy, candidate.value, primary.output, 1, false)
    }

    report?.({ stage: "review" })
    const review = await this.run({ request, target, round: "review", candidate: candidate.value, token })
    if ("reason" in review) return unresolved(target, request.strategy, 2, [`review: ${review.reason}`])
    if (review.response.decision === "conflict") {
      return unresolved(target, request.strategy, 2, [`review: ${review.response.summary}`])
    }
    if (review.response.decision === "approve") {
      this.log(`stage=review decision=approve status=${candidate.value.status}`)
      return this.complete(target, request.strategy, candidate.value, review.output, 2, false)
    }
    const reviewed = await validateCandidate(target, review.response, request.mode)
    if (!reviewed.ok)
      return unresolved(
        target,
        request.strategy,
        2,
        reviewed.reasons.map((reason) => `review: ${reason}`),
      )
    this.log(`stage=review decision=${review.response.decision} status=${reviewed.value.status}`)
    return this.complete(target, request.strategy, reviewed.value, review.output, 2, true)
  }

  private async recoverSinglePass(
    request: CodeCommentRequest,
    target: FunctionTarget,
    token: vscode.CancellationToken,
    initialReasons: string[],
    report?: (event: CodeCommentProgressEvent) => void,
    primaryPartial?: SafePartial,
  ): Promise<CommentGenerationResult> {
    report?.({ stage: "recovery" })
    const recovery = await this.run({
      request,
      target,
      round: "primary",
      stage: "recovery",
      candidate: primaryPartial?.value,
      validationFeedback: initialReasons,
      token,
    })
    if ("reason" in recovery) {
      if (primaryPartial) {
        this.log(`stage=recovery fallback=primary-partial reason=${recovery.reason}`)
        return this.complete(target, request.strategy, primaryPartial.value, primaryPartial.output, 2, false)
      }
      return unresolved(target, request.strategy, 2, [...initialReasons, `recovery: ${recovery.reason}`])
    }
    const candidate = await validateCandidate(target, recovery.response, request.mode)
    if (!candidate.ok) {
      if (candidate.kind === "coverage-incomplete") {
        const recoveryPartial = { value: candidate.partial, output: recovery.output }
        const selected = betterCoverage(primaryPartial, recoveryPartial)
        return this.complete(target, request.strategy, selected.value, selected.output, 2, selected === recoveryPartial)
      }
      if (primaryPartial) {
        this.log(`stage=recovery fallback=primary-partial reason=${candidate.reasons.join("；")}`)
        return this.complete(target, request.strategy, primaryPartial.value, primaryPartial.output, 2, false)
      }
      return unresolved(
        target,
        request.strategy,
        2,
        [...initialReasons, ...candidate.reasons.map((reason) => `recovery: ${reason}`)],
      )
    }
    return this.complete(target, request.strategy, candidate.value, recovery.output, 2, true)
  }

  private complete(
    target: FunctionTarget,
    strategy: CommentStrategy,
    value: ValidatedCommentResult,
    output: CodeCommentSessionOutput,
    rounds: number,
    recovered: boolean,
  ): CommentGenerationResult {
    this.log(
      `quality=${value.quality} required=${value.coverage.required} covered=${value.coverage.covered} missing=${value.coverage.missing} eligibleLines=${value.coverage.eligibleAnchors.map((anchor) => anchor.line + 1).join(",") || "none"}`,
    )
    return completed(target, strategy, value, output, rounds, recovered)
  }

  private async run(input: {
    request: CodeCommentRequest
    target: FunctionTarget
    round: "primary" | "review"
    stage?: string
    candidate?: ValidatedCommentResult
    validationFeedback?: string[]
    token: vscode.CancellationToken
  }): Promise<CompletedRound | FailedRound> {
    try {
      const output = await this.runner.run({
        directory: input.target.workspacePath,
        activeFile: input.target.filePath,
        prompt: buildCommentPrompt({
          target: input.target,
          mode: input.request.mode,
          round: input.round,
          candidate: input.candidate,
          validationFeedback: input.validationFeedback,
        }),
        stage: input.stage ?? input.round,
        functionHash: input.target.functionHash,
        model: input.request.model,
        timeoutMs: SESSION_TIMEOUT_MS,
        token: input.token,
      })
      const parsed = parseCommentQaResponse(output.output, input.round)
      const stage = input.stage ?? input.round
      if (!parsed.ok) {
        this.log(`stage=${stage} parse=failed reason=${parsed.reason}`)
        return { reason: parsed.reason, kind: "parse" }
      }
      this.log(`stage=${stage} parse=passed decision=${parsed.value.decision}`)
      return { response: parsed.value, output }
    } catch (error) {
      if (error instanceof CodeCommentCancelledError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      this.log(`stage=${input.stage ?? input.round} failed=${reason}`)
      return {
        reason: error instanceof CodeCommentSessionError && error.nonRecoverable ? `不可恢复错误：${reason}` : reason,
        kind: "session",
      }
    }
  }
}

async function validateCandidate(
  target: FunctionTarget,
  response: CommentQaResponse,
  mode: CommentMode = "insert",
): Promise<CommentCandidateResult> {
  const result = buildValidatedCommentCandidate(target, response, mode)
  if (!result.ok && result.kind === "invalid") return result
  const value = result.ok ? result.value : result.partial
  const candidate = buildCommentedDocument(target, value.proposals)
  if (!(await validateOnlyCommentInsertions(target, value.proposals, candidate))) {
    return { ok: false, kind: "invalid", reasons: ["候选未通过非注释 token 完全一致校验"] }
  }
  return result
}

function betterCoverage(primary: SafePartial | undefined, recovery: SafePartial): SafePartial {
  if (!primary) return recovery
  return recovery.value.coverage.covered > primary.value.coverage.covered ? recovery : primary
}

function completed(
  target: FunctionTarget,
  strategy: CommentStrategy,
  value: ValidatedCommentResult,
  output: CodeCommentSessionOutput,
  rounds: number,
  recovered: boolean,
): CommentGenerationResult {
  const common = {
    target,
    providerID: output.providerID,
    modelID: output.modelID,
    strategy,
    rounds,
    recovered,
  }
  return { status: "ready", ...common, result: value }
}

function unresolved(
  target: FunctionTarget,
  strategy: CommentStrategy,
  rounds: number,
  reasons: string[],
): CommentGenerationResult {
  return { status: "unresolved", target, reasons: [...new Set(reasons)], strategy, rounds }
}
