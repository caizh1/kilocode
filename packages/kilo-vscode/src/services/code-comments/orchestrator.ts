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
  CommentGenerationResult,
  CommentStrategy,
  FunctionTarget,
  ValidatedCommentResult,
} from "./types"
import { buildValidatedCommentCandidate, parseCommentQaResponse, type CommentQaResponse } from "./validator"

const SESSION_TIMEOUT_MS = 120_000

type CompletedRound = {
  response: CommentQaResponse
  output: CodeCommentSessionOutput
}

type FailedRound = {
  reason: string
}

export class CodeCommentOrchestrator {
  constructor(
    private readonly runner: Pick<CodeCommentSessionRunner, "run">,
    private readonly log: (message: string) => void,
  ) {}

  async generate(request: CodeCommentRequest, token: vscode.CancellationToken): Promise<CommentGenerationResult> {
    if (request.targets.length !== 1) throw new Error("V1 只支持一个函数目标")
    const target = request.targets[0]!
    const primary = await this.run({ request, target, round: "primary", token })
    if ("reason" in primary) return unresolved(target, request.strategy, 1, [`primary: ${primary.reason}`])
    const candidate = await validateCandidate(target, primary.response)
    if (!candidate.ok)
      return unresolved(
        target,
        request.strategy,
        1,
        candidate.reasons.map((reason) => `primary: ${reason}`),
      )
    if (request.strategy === "single-self-check") {
      return completed(target, request.strategy, candidate.value, primary.output, 1, false)
    }

    const review = await this.run({ request, target, round: "review", candidate: candidate.value, token })
    if ("reason" in review) return unresolved(target, request.strategy, 2, [`review: ${review.reason}`])
    if (review.response.decision === "conflict") {
      return unresolved(target, request.strategy, 2, [`review: ${review.response.summary}`])
    }
    if (review.response.decision === "approve") {
      this.log(`stage=review decision=approve status=${candidate.value.status}`)
      return completed(target, request.strategy, candidate.value, review.output, 2, false)
    }
    const reviewed = await validateCandidate(target, review.response)
    if (!reviewed.ok)
      return unresolved(
        target,
        request.strategy,
        2,
        reviewed.reasons.map((reason) => `review: ${reason}`),
      )
    this.log(`stage=review decision=${review.response.decision} status=${reviewed.value.status}`)
    return completed(target, request.strategy, reviewed.value, review.output, 2, true)
  }

  private async run(input: {
    request: CodeCommentRequest
    target: FunctionTarget
    round: "primary" | "review"
    candidate?: ValidatedCommentResult
    token: vscode.CancellationToken
  }): Promise<CompletedRound | FailedRound> {
    try {
      const output = await this.runner.run({
        directory: input.target.workspacePath,
        activeFile: input.target.filePath,
        prompt: buildCommentPrompt({ target: input.target, round: input.round, candidate: input.candidate }),
        stage: input.round,
        functionHash: input.target.functionHash,
        model: input.request.model,
        timeoutMs: SESSION_TIMEOUT_MS,
        token: input.token,
      })
      const parsed = parseCommentQaResponse(output.output, input.round)
      if (!parsed.ok) {
        this.log(`stage=${input.round} parse=failed reason=${parsed.reason}`)
        return { reason: parsed.reason }
      }
      this.log(`stage=${input.round} parse=passed decision=${parsed.value.decision}`)
      return { response: parsed.value, output }
    } catch (error) {
      if (error instanceof CodeCommentCancelledError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      this.log(`stage=${input.round} failed=${reason}`)
      return {
        reason: error instanceof CodeCommentSessionError && error.nonRecoverable ? `不可恢复错误：${reason}` : reason,
      }
    }
  }
}

async function validateCandidate(
  target: FunctionTarget,
  response: CommentQaResponse,
): Promise<ReturnType<typeof buildValidatedCommentCandidate>> {
  const result = buildValidatedCommentCandidate(target, response)
  if (!result.ok || result.value.status === "skip") return result
  const candidate = buildCommentedDocument(target, result.value.proposals)
  if (!(await validateOnlyCommentInsertions(target, result.value.proposals, candidate))) {
    return { ok: false, reasons: ["候选未通过非注释 token 完全一致校验"] }
  }
  return result
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
  if (value.status === "skip") return { status: "skip", ...common, summary: value.summary }
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
