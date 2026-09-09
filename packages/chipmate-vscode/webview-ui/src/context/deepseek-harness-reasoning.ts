import type { ModelProviderGroup, ModelSelection } from "@deepseek-ai/dsh-client-connection/client"
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-runtime/client"

export interface DeepSeekHarnessModelDirectoryState {
  current: ModelSelection | null
  groups: readonly ModelProviderGroup[]
}

export interface DeepSeekHarnessModelDirectory {
  store: ObservableSnapshot<DeepSeekHarnessModelDirectoryState>
  load: () => Promise<unknown>
  select: (selection: ModelSelection) => Promise<void>
}

export interface DeepSeekHarnessReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface DeepSeekHarnessReasoningState {
  efforts: readonly DeepSeekHarnessReasoningEffort[]
  value?: string
}

export function projectDeepSeekHarnessReasoning(
  state: DeepSeekHarnessModelDirectoryState,
): DeepSeekHarnessReasoningState | undefined {
  const resolved = resolveCurrentReasoning(state)
  if (!resolved) return
  const value = state.current?.reasoningEffort ?? resolved.defaultEffort
  return {
    efforts: resolved.efforts.map((effort) => ({ ...effort })),
    ...(value === undefined ? {} : { value }),
  }
}

export async function selectDeepSeekHarnessReasoningEffort(
  directory: DeepSeekHarnessModelDirectory,
  effort: string,
): Promise<void> {
  const state = directory.store.getSnapshot()
  const current = state.current
  const reasoning = resolveCurrentReasoning(state)
  if (!current || !reasoning) throw new Error("官方 DSH 当前模型没有可选推理强度")
  if (!reasoning.efforts.some((item) => item.id === effort))
    throw new Error(`官方 DSH 当前模型不支持推理强度 ${effort}`)
  await directory.select({
    provider: current.provider,
    model: current.model,
    reasoningEffort: effort,
  })
}

function resolveCurrentReasoning(state: DeepSeekHarnessModelDirectoryState) {
  const current = state.current
  if (!current) return
  const model = state.groups
    .find((group) => group.id === current.provider)
    ?.models.find((item) => item.id === current.model)
  if (!model?.reasoning?.efforts.length) return
  return model.reasoning
}
