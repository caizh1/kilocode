import type { MessageV2 } from "@/session/message-v2"

type ErrorInfo = {
  name?: unknown
  statusCode?: unknown
}

function error(input: unknown) {
  if (!input || typeof input !== "object") return {}
  const value = input as ErrorInfo
  return {
    errorName: typeof value.name === "string" ? value.name : undefined,
    errorStatusCode: typeof value.statusCode === "number" ? value.statusCode : undefined,
  }
}

function tokens(input: MessageV2.Assistant["tokens"]) {
  return {
    inputTokens: input.input,
    outputTokens: input.output,
    reasoningTokens: input.reasoning,
    cacheReadTokens: input.cache.read,
    cacheWriteTokens: input.cache.write,
    totalTokens: input.total,
  }
}

export namespace ChipMateCompactionDiagnostics {
  export function workerPreflight(input: {
    sessionID: string
    compactionMessageID: string
    providerID: string
    modelID: string
    stage: "chunk" | "reduce" | "replay"
    chunkIndex?: number
    chunkCount?: number
    depth?: number
    splitDepth: number
    attempt: 1 | 2
    attemptMode: "selected" | "none"
    estimatedInputTokens: number
    inputBudget: number
    requestedOutputTokenLimit: number
    effectiveOutputTokenLimit?: number
    capacityKnown: boolean
    requestDispatched: boolean
    splitReason?: "local_preflight" | "provider_context_overflow"
    rejectionReason?: "input_limit" | "unknown_capacity_cap" | "insufficient_headroom" | "minimal_unit"
  }) {
    return {
      "compaction.phase": "worker_preflight",
      sessionID: input.sessionID,
      compactionMessageID: input.compactionMessageID,
      providerID: input.providerID,
      modelID: input.modelID,
      workerStage: input.stage,
      chunkIndex: input.chunkIndex,
      chunkCount: input.chunkCount,
      reduceDepth: input.depth,
      splitDepth: input.splitDepth,
      attempt: input.attempt,
      attemptMode: input.attemptMode,
      estimatedInputTokens: input.estimatedInputTokens,
      inputBudget: input.inputBudget,
      requestedOutputTokenLimit: input.requestedOutputTokenLimit,
      effectiveOutputTokenLimit: input.effectiveOutputTokenLimit,
      capacityKnown: input.capacityKnown,
      requestDispatched: input.requestDispatched,
      splitReason: input.splitReason,
      rejectionReason: input.rejectionReason,
    }
  }

  export function reportedUsage(input: {
    sessionID: string
    messageID: string
    previousProviderID: string
    previousModelID: string
    currentProviderID: string
    currentModelID: string
    tokens: MessageV2.Assistant["tokens"]
    evaluatedTokens: number
    contextLimit: number
    inputLimit?: number
    outputLimit: number
    usableTokens: number
    thresholdTokens: number
    triggered: boolean
  }) {
    return {
      "compaction.phase": "reported_usage_check",
      sessionID: input.sessionID,
      messageID: input.messageID,
      previousProviderID: input.previousProviderID,
      previousModelID: input.previousModelID,
      currentProviderID: input.currentProviderID,
      currentModelID: input.currentModelID,
      crossModel:
        input.previousProviderID !== input.currentProviderID || input.previousModelID !== input.currentModelID,
      ...tokens(input.tokens),
      evaluatedTokens: input.evaluatedTokens,
      contextLimit: input.contextLimit,
      inputLimit: input.inputLimit,
      outputLimit: input.outputLimit,
      usableTokens: input.usableTokens,
      thresholdTokens: input.thresholdTokens,
      triggered: input.triggered,
    }
  }

  export function preflight(input: {
    sessionID: string
    providerID: string
    modelID: string
    messageCount: number
    toolCount: number
    normalizedTokens: number
    rawTokens: number
    continuation: boolean
    reportedContextTokens?: number
    contextLimit: number
    inputLimit?: number
    outputLimit: number
    usableTokens: number
    thresholdTokens: number
    triggered: boolean
  }) {
    return {
      "compaction.phase": "preflight_check",
      sessionID: input.sessionID,
      providerID: input.providerID,
      modelID: input.modelID,
      messageCount: input.messageCount,
      toolCount: input.toolCount,
      normalizedTokens: input.normalizedTokens,
      rawTokens: input.rawTokens,
      continuation: input.continuation,
      reportedContextTokens: input.reportedContextTokens,
      contextLimit: input.contextLimit,
      inputLimit: input.inputLimit,
      outputLimit: input.outputLimit,
      usableTokens: input.usableTokens,
      thresholdTokens: input.thresholdTokens,
      triggered: input.triggered,
    }
  }

  export function worker(input: {
    sessionID: string
    compactionMessageID: string
    workerMessageID: string
    providerID: string
    modelID: string
    stage: "full" | "chunk" | "reduce" | "replay"
    chunkIndex?: number
    chunkCount?: number
    depth?: number
    attempt: 1 | 2
    attemptMode: "selected" | "none"
    selectedVariant?: string
    effectiveVariant?: string
    estimatedInputTokens: number
    requestedOutputTokenLimit: number
    effectiveOutputTokenLimit: number
    capacityKnown: boolean
    fallbackReason?: "selected_attempt_failed"
    pipelineRestarted: boolean
    result: string
    finish?: string
    textChars: number
    reasoningChars: number
    tokens: MessageV2.Assistant["tokens"]
    error?: unknown
  }) {
    return {
      "compaction.phase": "worker_result",
      sessionID: input.sessionID,
      compactionMessageID: input.compactionMessageID,
      workerMessageID: input.workerMessageID,
      providerID: input.providerID,
      modelID: input.modelID,
      workerStage: input.stage,
      chunkIndex: input.chunkIndex,
      chunkCount: input.chunkCount,
      reduceDepth: input.depth,
      attempt: input.attempt,
      attemptMode: input.attemptMode,
      selectedVariant: input.selectedVariant,
      effectiveVariant: input.effectiveVariant,
      estimatedInputTokens: input.estimatedInputTokens,
      requestedOutputTokenLimit: input.requestedOutputTokenLimit,
      effectiveOutputTokenLimit: input.effectiveOutputTokenLimit,
      capacityKnown: input.capacityKnown,
      fallbackReason: input.fallbackReason,
      pipelineRestarted: input.pipelineRestarted,
      result: input.result,
      finish: input.finish,
      textChars: input.textChars,
      reasoningChars: input.reasoningChars,
      ...tokens(input.tokens),
      ...error(input.error),
    }
  }

  export function result(input: {
    sessionID: string
    compactionMessageID: string
    providerID: string
    modelID: string
    auto: boolean
    overflow?: boolean
    initialResult: string
    fallbackUsed: boolean
    finalResult: string
    finish?: string
    summaryTextChars: number
    error?: unknown
    boundaryEligible: boolean
    compactedEvent: boolean
    attempt: 1 | 2
    attemptMode: "selected" | "none"
    selectedVariant?: string
    effectiveVariant?: string
    fallbackReason?: "selected_attempt_failed"
    pipelineRestarted: boolean
    finalCommitted: boolean
    durationMs: number
  }) {
    return {
      "compaction.phase": "compaction_result",
      sessionID: input.sessionID,
      compactionMessageID: input.compactionMessageID,
      providerID: input.providerID,
      modelID: input.modelID,
      auto: input.auto,
      overflow: input.overflow,
      initialResult: input.initialResult,
      fallbackUsed: input.fallbackUsed,
      finalResult: input.finalResult,
      finish: input.finish,
      summaryTextChars: input.summaryTextChars,
      ...error(input.error),
      boundaryEligible: input.boundaryEligible,
      compactedEvent: input.compactedEvent,
      attempt: input.attempt,
      attemptMode: input.attemptMode,
      selectedVariant: input.selectedVariant,
      effectiveVariant: input.effectiveVariant,
      fallbackReason: input.fallbackReason,
      pipelineRestarted: input.pipelineRestarted,
      finalCommitted: input.finalCommitted,
      durationMs: input.durationMs,
    }
  }
}
