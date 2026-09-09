import type { SessionSummary } from "@deepseek-ai/dsh-client-runtime/client"

export interface DeepSeekHarnessHeaderState {
  sessionId?: string
  title?: string
  loading: boolean
}

export function projectDeepSeekHarnessHeader(
  sessionId: string | undefined,
  summary: SessionSummary | undefined,
  previous?: DeepSeekHarnessHeaderState,
): DeepSeekHarnessHeaderState {
  if (!sessionId) return { loading: true }
  if (!summary || summary.id !== sessionId) {
    if (previous?.sessionId === sessionId && !previous.loading) return previous
    return { sessionId, loading: true }
  }
  const title = nonBlank(summary.title) ?? nonBlank(summary.displayTitle)
  return {
    sessionId,
    ...(title ? { title } : {}),
    loading: false,
  }
}

function nonBlank(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined
}
