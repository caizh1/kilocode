import { createMemo, type Component } from "solid-js"
import { useDeepSeekHarness } from "../../context/deepseek-harness"
import type { DeepSeekHarnessHeaderState } from "../../context/deepseek-harness-header"
import { useLanguage } from "../../context/language"

export const DeepSeekHarnessTaskHeader: Component = () => {
  const harness = useDeepSeekHarness()
  const language = useLanguage()
  const state = createMemo<DeepSeekHarnessHeaderState>(() => {
    const sessionId = harness.snapshot().sessionId
    const header = harness.conversation()?.header
    if (!sessionId || header?.sessionId !== sessionId) return { sessionId, loading: true }
    return header
  })
  const title = createMemo(() => {
    const current = state()
    if (current.loading) return language.t("chat.deepseekHarness.session.opening")
    return current.title ?? language.t("chat.deepseekHarness.session.untitled")
  })

  return (
    <div
      data-component="task-header"
      data-deepseek-harness-header=""
      aria-busy={state().loading ? "true" : undefined}
    >
      <div data-slot="task-header-title">
        <span data-slot="task-header-title-trigger" title={title()}>
          <span data-slot="task-header-title-label" dir="auto">
            {title()}
          </span>
        </span>
      </div>
    </div>
  )
}
