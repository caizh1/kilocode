import type * as vscode from "vscode"
import type { CodeCommentSessionOutput, CodeCommentSessionRunner } from "../code-comments/session-runner"
import { CodeCommentCancelledError, CodeCommentSessionError } from "../code-comments/session-runner"
import {
  buildLogicBlockCommentPrompt,
  LOGIC_BLOCK_COMMENT_SYSTEM_PROMPT,
  parseLogicBlockCommentResponse,
} from "./protocol"
import type { LogicBlockGenerationResult, LogicBlockTarget, ValidatedLogicBlockComments } from "./types"
import { buildValidatedLogicBlockCandidate } from "./validator"

const SESSION_TIMEOUT_MS = 120_000
type Model = { providerID: string; modelID: string }
type RoundResult =
  | {
      ok: true
      output: CodeCommentSessionOutput
      decision: "generate" | "skip"
      summary: string
      comments: { anchorId: string; commentText: string }[]
    }
  | { ok: false; reason: string; kind: "parse" | "session" }

export class LogicBlockCommentOrchestrator {
  constructor(
    private readonly runner: Pick<CodeCommentSessionRunner, "run">,
    private readonly log: (message: string) => void,
  ) {}

  async generate(input: {
    target: LogicBlockTarget
    model?: Model
    token: vscode.CancellationToken
    report?: (stage: "primary" | "recovery") => void
  }): Promise<LogicBlockGenerationResult> {
    input.report?.("primary")
    const primary = await this.run(input, "primary")
    if (!primary.ok) {
      if (primary.kind === "session") return unresolved(input.target, [`primary: ${primary.reason}`], 1)
      return this.recover(input, [`primary: ${primary.reason}`])
    }
    if (primary.decision === "skip") return notNeeded(input.target, primary.summary, primary.output, 1)
    const candidate = await buildValidatedLogicBlockCandidate({
      target: input.target,
      summary: primary.summary,
      comments: primary.comments,
    })
    if (candidate.ok) return ready(input.target, candidate.value, primary.output, 1, false)
    return this.recover(
      input,
      candidate.reasons.map((reason) => `primary: ${reason}`),
      candidate.safePartial,
    )
  }

  private async recover(
    input: {
      target: LogicBlockTarget
      model?: Model
      token: vscode.CancellationToken
      report?: (stage: "primary" | "recovery") => void
    },
    initialReasons: readonly string[],
    primaryPartial?: ValidatedLogicBlockComments,
  ): Promise<LogicBlockGenerationResult> {
    input.report?.("recovery")
    const recovery = await this.run(input, "recovery", primaryPartial, initialReasons)
    if (!recovery.ok) return unresolved(input.target, [...initialReasons, `recovery: ${recovery.reason}`], 2)
    if (recovery.decision === "skip") return notNeeded(input.target, recovery.summary, recovery.output, 2)
    const revised = await buildValidatedLogicBlockCandidate({
      target: input.target,
      summary: recovery.summary,
      comments: recovery.comments,
    })
    if (revised.ok) return ready(input.target, revised.value, recovery.output, 2, true)
    return unresolved(input.target, [...initialReasons, ...revised.reasons.map((reason) => `recovery: ${reason}`)], 2)
  }

  private async run(
    input: { target: LogicBlockTarget; model?: Model; token: vscode.CancellationToken },
    stage: "primary" | "recovery",
    candidate?: ValidatedLogicBlockComments,
    validationFeedback?: readonly string[],
  ): Promise<RoundResult> {
    try {
      const output = await this.runner.run({
        directory: input.target.workspacePath,
        activeFile: input.target.filePath,
        prompt: buildLogicBlockCommentPrompt({ target: input.target, round: stage, candidate, validationFeedback }),
        stage: `logic-block-${stage}`,
        functionHash: input.target.targetHash,
        model: input.model,
        timeoutMs: SESSION_TIMEOUT_MS,
        token: input.token,
        systemPrompt: LOGIC_BLOCK_COMMENT_SYSTEM_PROMPT,
        feature: "high-confidence-logic-block-comments",
        sessionTitle: `逻辑块注释 · ${stage}`,
      })
      const parsed = parseLogicBlockCommentResponse(output.output)
      if (!parsed.ok) {
        this.log(`logic-block stage=${stage} parse=failed reason=${parsed.reason}`)
        return { ok: false, reason: parsed.reason, kind: "parse" }
      }
      return {
        ok: true,
        output,
        decision: parsed.decision,
        summary: parsed.summary,
        comments: parsed.comments,
      }
    } catch (error) {
      if (error instanceof CodeCommentCancelledError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      this.log(`logic-block stage=${stage} failed=${reason}`)
      return {
        ok: false,
        reason: error instanceof CodeCommentSessionError && error.nonRecoverable ? `不可恢复错误：${reason}` : reason,
        kind: "session",
      }
    }
  }
}

function ready(
  target: LogicBlockTarget,
  result: ValidatedLogicBlockComments,
  output: CodeCommentSessionOutput,
  rounds: number,
  recovered: boolean,
): LogicBlockGenerationResult {
  return { status: "ready", target, result, providerID: output.providerID, modelID: output.modelID, rounds, recovered }
}

function notNeeded(
  target: LogicBlockTarget,
  summary: string,
  output: CodeCommentSessionOutput,
  rounds: number,
): LogicBlockGenerationResult {
  return { status: "not-needed", target, summary, providerID: output.providerID, modelID: output.modelID, rounds }
}

function unresolved(target: LogicBlockTarget, reasons: readonly string[], rounds: number): LogicBlockGenerationResult {
  return { status: "unresolved", target, reasons: [...new Set(reasons)], rounds }
}
