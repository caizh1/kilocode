import type * as vscode from "vscode"
import { CodeCommentCancelledError } from "./session-runner"
import type {
  BatchCommentItemResult,
  BatchCommentProgress,
  BatchCommentTarget,
  CodeCommentProgressEvent,
  CommentGenerationResult,
} from "./types"

export const MAX_BATCH_COMMENT_TARGETS = 10
export const BATCH_COMMENT_CONCURRENCY = 4

type ItemStage = "queued" | "running" | "recovering" | "ready" | "failed"

export async function generateCommentBatch(input: {
  targets: BatchCommentTarget[]
  token: vscode.CancellationToken
  generate: (
    target: BatchCommentTarget,
    report: (event: CodeCommentProgressEvent) => void,
  ) => Promise<CommentGenerationResult>
  report: (progress: BatchCommentProgress) => void
  concurrency?: number
}): Promise<BatchCommentItemResult[]> {
  if (input.targets.length === 0) return []
  if (input.targets.length > MAX_BATCH_COMMENT_TARGETS) {
    throw new Error(`一次最多处理 ${MAX_BATCH_COMMENT_TARGETS} 个函数`)
  }
  const stages = input.targets.map<ItemStage>(() => "queued")
  const results = new Array<BatchCommentItemResult>(input.targets.length)
  const concurrency = Math.max(1, Math.min(input.concurrency ?? BATCH_COMMENT_CONCURRENCY, input.targets.length))
  let cursor = 0
  const emit = () => input.report(progressFromStages(stages))
  const worker = async () => {
    while (cursor < input.targets.length) {
      if (input.token.isCancellationRequested) throw new CodeCommentCancelledError()
      const index = cursor
      cursor += 1
      const target = input.targets[index]!
      stages[index] = "running"
      emit()
      const result = await generateItem(input, target, index, stages, emit)
      results[index] = { ...target, result }
      stages[index] = result.status === "ready" ? "ready" : "failed"
      emit()
    }
  }
  emit()
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

async function generateItem(
  input: Parameters<typeof generateCommentBatch>[0],
  target: BatchCommentTarget,
  index: number,
  stages: ItemStage[],
  emit: () => void,
): Promise<CommentGenerationResult> {
  try {
    return await input.generate(target, (event) => {
      stages[index] = event.stage === "recovery" ? "recovering" : "running"
      emit()
    })
  } catch (error) {
    if (error instanceof CodeCommentCancelledError) throw error
    return {
      status: "unresolved",
      target: target.target,
      reasons: [error instanceof Error ? error.message : String(error)],
      strategy: "single-self-check",
      rounds: 0,
    }
  }
}

function progressFromStages(stages: ItemStage[]): BatchCommentProgress {
  const count = (stage: ItemStage) => stages.filter((item) => item === stage).length
  const ready = count("ready")
  const failed = count("failed")
  return {
    total: stages.length,
    queued: count("queued"),
    running: count("running") + count("recovering"),
    recovering: count("recovering"),
    completed: ready + failed,
    ready,
    failed,
  }
}
