// chipmate_change - new file
// Wire shape mirrors the SDK schema (packages/sdk/js/src/v2/gen/types.gen.ts
// StepFinishPart.metrics). `source` stays on the wire for backward
// compatibility with downstream consumers — see packages/chipmate-vscode/
// webview-ui/src/context/session-utils.ts and AssistantMessage.tsx —
// but only the "computed" literal is reachable here because llama.cpp's
// `prompt_per_second` / `predicted_per_second` are dropped upstream by
// `@ai-sdk/openai-compatible` before the raw usage reaches our adapter.
// Follow-up: wire `metadataExtractor` into the shared
// `createOpenAICompatible` call so the provider source is reachable again.
export type TokenRates = {
  prompt?: number
  generation?: number
  ttftMs?: number
  source: "computed"
}

export type ComputeInput = {
  providerMetadata?: unknown
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  elapsedMs: number
  ttftMs?: number
  toolElapsedMs?: number
}

export type StepPerformanceTimer = {
  startedAt?: number
  firstTokenAt?: number
  ttftMs?: number
  activeTools?: number
  toolStartedAt?: number
  toolElapsedMs?: number
}

/** Start a fresh monotonic timer for one model step. */
export function startStepPerformance(startedAt: number): StepPerformanceTimer {
  if (!Number.isFinite(startedAt) || startedAt < 0) return {}
  return { startedAt }
}

/** Capture the first non-empty text or reasoning delta exactly once. */
export function observeFirstToken(
  timer: StepPerformanceTimer,
  delta: string,
  observedAt: number,
): StepPerformanceTimer {
  if (timer.ttftMs !== undefined || delta.length === 0 || timer.startedAt === undefined) return timer
  const ttftMs = observedAt - timer.startedAt
  if (!Number.isFinite(ttftMs) || ttftMs < 0) return timer
  return {
    ...timer,
    firstTokenAt: observedAt,
    ttftMs,
    ...(timer.activeTools ? { toolStartedAt: observedAt } : {}),
  }
}

/** Start excluding an overlapping tool-execution interval from decode time. */
export function observeToolStart(timer: StepPerformanceTimer, observedAt: number): StepPerformanceTimer {
  if (timer.startedAt === undefined || !Number.isFinite(observedAt)) return timer
  const activeTools = (timer.activeTools ?? 0) + 1
  if (activeTools > 1) return { ...timer, activeTools }
  return { ...timer, activeTools, toolStartedAt: observedAt }
}

/** Close a tool interval; concurrent tools are counted as one wall-clock span. */
export function observeToolFinish(timer: StepPerformanceTimer, observedAt: number): StepPerformanceTimer {
  const activeTools = timer.activeTools ?? 0
  if (activeTools <= 0 || !Number.isFinite(observedAt)) return timer
  if (activeTools > 1) return { ...timer, activeTools: activeTools - 1 }
  const startedAt = timer.toolStartedAt
  const firstTokenAt = timer.firstTokenAt
  const elapsed =
    startedAt !== undefined && firstTokenAt !== undefined ? observedAt - Math.max(startedAt, firstTokenAt) : 0
  return {
    ...timer,
    activeTools: 0,
    toolStartedAt: undefined,
    toolElapsedMs: (timer.toolElapsedMs ?? 0) + (Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0),
  }
}

/** Settle an unfinished tool interval at step-finish. */
export function finishStepPerformance(timer: StepPerformanceTimer, observedAt: number): StepPerformanceTimer {
  if (!timer.activeTools) return timer
  return observeToolFinish({ ...timer, activeTools: 1 }, observedAt)
}

// chipmate_change start - response performance metrics for #6579.
export function computeMetrics(input: ComputeInput): TokenRates | undefined {
  const ttftMs =
    input.ttftMs !== undefined && Number.isFinite(input.ttftMs) && input.ttftMs >= 0 ? input.ttftMs : undefined
  const toolElapsedMs =
    input.toolElapsedMs !== undefined && Number.isFinite(input.toolElapsedMs) && input.toolElapsedMs >= 0
      ? input.toolElapsedMs
      : 0
  const metrics: TokenRates = { ...(ttftMs === undefined ? {} : { ttftMs }), source: "computed" }

  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs <= 0) return ttftMs === undefined ? undefined : metrics

  const generated = input.tokens.output + input.tokens.reasoning
  if (!Number.isFinite(generated) || generated <= 0) return ttftMs === undefined ? undefined : metrics

  const generationMs = ttftMs === undefined ? undefined : input.elapsedMs - ttftMs - toolElapsedMs
  if (generationMs === undefined || !Number.isFinite(generationMs) || generationMs <= 0) {
    return ttftMs === undefined ? undefined : metrics
  }
  const generation = (generated * 1000) / generationMs
  if (!Number.isFinite(generation) || generation <= 0) return ttftMs === undefined ? undefined : metrics

  return { ...metrics, generation }
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 t/s"
  return `${numberFormat.format(value)} t/s`
}
// chipmate_change end
