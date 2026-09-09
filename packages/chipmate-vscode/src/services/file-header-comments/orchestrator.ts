import type * as vscode from "vscode"
import type { CodeCommentSessionOutput, CodeCommentSessionRunner } from "../code-comments/session-runner"
import { CodeCommentCancelledError, CodeCommentSessionError } from "../code-comments/session-runner"
import {
  buildFileHeaderCommentPrompt,
  FILE_HEADER_COMMENT_SYSTEM_PROMPT,
  parseFileHeaderCommentResponse,
} from "./protocol"
import type { FileHeaderGenerationResult, FileHeaderTarget, ValidatedFileHeaderComment } from "./types"
import { buildValidatedFileHeaderCandidate } from "./validator"

const SESSION_TIMEOUT_MS = 120_000

type Model = { providerID: string; modelID: string }
type RoundResult =
  | { ok: true; output: CodeCommentSessionOutput; summary: string; comment: { anchorId: "file"; commentText: string } }
  | { ok: false; reason: string; kind: "parse" | "session" }

export class FileHeaderCommentOrchestrator {
  constructor(
    private readonly runner: Pick<CodeCommentSessionRunner, "run">,
    private readonly log: (message: string) => void,
  ) {}

  async generate(input: {
    target: FileHeaderTarget
    model?: Model
    token: vscode.CancellationToken
    report?: (stage: "primary" | "recovery") => void
  }): Promise<FileHeaderGenerationResult> {
    input.report?.("primary")
    const primary = await this.run(input, "primary")
    if (!primary.ok) {
      if (primary.kind === "session") return unresolved(input.target, [`primary: ${primary.reason}`], 1)
      return this.recover(input, [`primary: ${primary.reason}`])
    }
    const candidate = await buildValidatedFileHeaderCandidate({
      target: input.target,
      summary: primary.summary,
      comment: primary.comment,
    })
    if (candidate.ok) return ready(input.target, candidate.value, primary.output, 1, false)
    return this.recover(
      input,
      candidate.reasons.map((reason) => `primary: ${reason}`),
    )
  }

  private async recover(
    input: {
      target: FileHeaderTarget
      model?: Model
      token: vscode.CancellationToken
      report?: (stage: "primary" | "recovery") => void
    },
    initialReasons: readonly string[],
  ): Promise<FileHeaderGenerationResult> {
    input.report?.("recovery")
    const recovery = await this.run(input, "recovery", undefined, initialReasons)
    if (!recovery.ok) return unresolved(input.target, [...initialReasons, `recovery: ${recovery.reason}`], 2)
    const revised = await buildValidatedFileHeaderCandidate({
      target: input.target,
      summary: recovery.summary,
      comment: recovery.comment,
    })
    if (!revised.ok)
      return unresolved(input.target, [...initialReasons, ...revised.reasons.map((reason) => `recovery: ${reason}`)], 2)
    return ready(input.target, revised.value, recovery.output, 2, true)
  }

  private async run(
    input: { target: FileHeaderTarget; model?: Model; token: vscode.CancellationToken },
    stage: "primary" | "recovery",
    candidate?: ValidatedFileHeaderComment,
    validationFeedback?: readonly string[],
  ): Promise<RoundResult> {
    try {
      const output = await this.runner.run({
        directory: input.target.workspacePath,
        activeFile: input.target.filePath,
        prompt: buildFileHeaderCommentPrompt({ target: input.target, round: stage, candidate, validationFeedback }),
        stage: `file-header-${stage}`,
        functionHash: input.target.documentHash,
        model: input.model,
        timeoutMs: SESSION_TIMEOUT_MS,
        token: input.token,
        systemPrompt: FILE_HEADER_COMMENT_SYSTEM_PROMPT,
        feature: "high-confidence-file-header-comments",
        sessionTitle: `文件模块注释 · ${stage}`,
      })
      const parsed = parseFileHeaderCommentResponse(output.output)
      if (!parsed.ok) {
        this.log(`file-header stage=${stage} parse=failed reason=${parsed.reason}`)
        return { ok: false, reason: parsed.reason, kind: "parse" }
      }
      return { ok: true, output, summary: parsed.summary, comment: parsed.comment }
    } catch (error) {
      if (error instanceof CodeCommentCancelledError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      this.log(`file-header stage=${stage} failed=${reason}`)
      return {
        ok: false,
        reason: error instanceof CodeCommentSessionError && error.nonRecoverable ? `不可恢复错误：${reason}` : reason,
        kind: "session",
      }
    }
  }
}

function ready(
  target: FileHeaderTarget,
  result: ValidatedFileHeaderComment,
  output: CodeCommentSessionOutput,
  rounds: number,
  recovered: boolean,
): FileHeaderGenerationResult {
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

function unresolved(target: FileHeaderTarget, reasons: readonly string[], rounds: number): FileHeaderGenerationResult {
  return { status: "unresolved", target, reasons: [...new Set(reasons)], rounds }
}
