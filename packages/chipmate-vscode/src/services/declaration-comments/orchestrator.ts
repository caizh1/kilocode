import type * as vscode from "vscode"
import type { CodeCommentSessionRunner, CodeCommentSessionOutput } from "../code-comments/session-runner"
import { CodeCommentCancelledError, CodeCommentSessionError } from "../code-comments/session-runner"
import {
  buildDeclarationCommentPrompt,
  DECLARATION_COMMENT_SYSTEM_PROMPT,
  parseDeclarationCommentResponse,
} from "./protocol"
import type {
  DeclarationCommentBlock,
  DeclarationGenerationResult,
  DeclarationTarget,
  ValidatedDeclarationComments,
} from "./types"
import { buildValidatedDeclarationCandidate } from "./validator"

const SESSION_TIMEOUT_MS = 120_000

type Model = { providerID: string; modelID: string }
type RoundResult =
  | { ok: true; output: CodeCommentSessionOutput; summary: string; comments: DeclarationCommentBlock[] }
  | { ok: false; reason: string }

export class DeclarationCommentOrchestrator {
  constructor(
    private readonly runner: Pick<CodeCommentSessionRunner, "run">,
    private readonly log: (message: string) => void,
  ) {}

  async generate(input: {
    target: DeclarationTarget
    model?: Model
    token: vscode.CancellationToken
    report?: (stage: "primary" | "recovery") => void
  }): Promise<DeclarationGenerationResult> {
    input.report?.("primary")
    const primary = await this.run(input, "primary")
    if (!primary.ok) return this.recover(input, [`primary: ${primary.reason}`])
    const candidate = await buildValidatedDeclarationCandidate({
      target: input.target,
      summary: primary.summary,
      comments: primary.comments,
    })
    if (candidate.ok) return ready(input.target, candidate.value, primary.output, 1, false)
    return this.recover(
      input,
      candidate.reasons.map((reason) => `primary: ${reason}`),
      usablePartial(candidate.safePartial),
      primary.output,
    )
  }

  private async recover(
    input: {
      target: DeclarationTarget
      model?: Model
      token: vscode.CancellationToken
      report?: (stage: "primary" | "recovery") => void
    },
    initialReasons: readonly string[],
    primaryPartial?: ValidatedDeclarationComments,
    primaryOutput?: CodeCommentSessionOutput,
  ): Promise<DeclarationGenerationResult> {
    input.report?.("recovery")
    const recovery = await this.run(input, "recovery", primaryPartial, initialReasons)
    if (!recovery.ok) {
      if (primaryPartial && primaryOutput) {
        this.log(`declaration stage=recovery fallback=primary-safe reason=${recovery.reason}`)
        return ready(input.target, primaryPartial, primaryOutput, 2, false)
      }
      return unresolved(input.target, [...initialReasons, `recovery: ${recovery.reason}`], 2)
    }
    const candidate = await buildValidatedDeclarationCandidate({
      target: input.target,
      summary: recovery.summary,
      comments: recovery.comments,
    })
    if (candidate.ok) return ready(input.target, candidate.value, recovery.output, 2, true)
    const recoveryPartial = usablePartial(candidate.safePartial)
    if (recoveryPartial) return ready(input.target, recoveryPartial, recovery.output, 2, true)
    if (primaryPartial && primaryOutput) {
      this.log(`declaration stage=recovery fallback=primary-safe reasons=${candidate.reasons.join("；")}`)
      return ready(input.target, primaryPartial, primaryOutput, 2, false)
    }
    return unresolved(input.target, [...initialReasons, ...candidate.reasons.map((reason) => `recovery: ${reason}`)], 2)
  }

  private async run(
    input: { target: DeclarationTarget; model?: Model; token: vscode.CancellationToken },
    stage: "primary" | "recovery",
    candidate?: ValidatedDeclarationComments,
    validationFeedback?: readonly string[],
  ): Promise<RoundResult> {
    try {
      const output = await this.runner.run({
        directory: input.target.workspacePath,
        activeFile: input.target.filePath,
        prompt: buildDeclarationCommentPrompt({
          target: input.target,
          round: stage,
          candidate,
          validationFeedback,
        }),
        stage: `declaration-${stage}`,
        functionHash: input.target.declarationHash,
        model: input.model,
        timeoutMs: SESSION_TIMEOUT_MS,
        token: input.token,
        systemPrompt: DECLARATION_COMMENT_SYSTEM_PROMPT,
        feature: "high-confidence-declaration-comments",
        sessionTitle: `声明注释 · ${stage}`,
      })
      const parsed = parseDeclarationCommentResponse(output.output)
      if (!parsed.ok) {
        this.log(`declaration stage=${stage} parse=failed reason=${parsed.reason}`)
        return { ok: false, reason: parsed.reason }
      }
      this.log(`declaration stage=${stage} parse=passed comments=${parsed.comments.length}`)
      return { ok: true, output, summary: parsed.summary, comments: parsed.comments }
    } catch (error) {
      if (error instanceof CodeCommentCancelledError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      this.log(`declaration stage=${stage} failed=${reason}`)
      return {
        ok: false,
        reason: error instanceof CodeCommentSessionError && error.nonRecoverable ? `不可恢复错误：${reason}` : reason,
      }
    }
  }
}

function usablePartial(value: ValidatedDeclarationComments | undefined): ValidatedDeclarationComments | undefined {
  return value?.proposals.some((proposal) => proposal.kind === "declarationHeader") ? value : undefined
}

function ready(
  target: DeclarationTarget,
  result: ValidatedDeclarationComments,
  output: CodeCommentSessionOutput,
  rounds: number,
  recovered: boolean,
): DeclarationGenerationResult {
  return {
    status: "ready",
    target,
    result,
    providerID: output.providerID,
    modelID: output.modelID,
    rounds,
    recovered,
  }
}

function unresolved(
  target: DeclarationTarget,
  reasons: readonly string[],
  rounds: number,
): DeclarationGenerationResult {
  return { status: "unresolved", target, reasons: [...new Set(reasons)], rounds }
}
