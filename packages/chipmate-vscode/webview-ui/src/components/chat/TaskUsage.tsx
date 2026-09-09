import type { Component } from "solid-js"
import { For, Show, createMemo } from "solid-js"
import { Collapsible } from "@chipmate/chipmate-ui/collapsible"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import type { SessionModelUsage } from "../../types/messages"
import {
  formatCNY,
  formatUSD,
  groupModelUsage,
  modelUsageName,
  type TokenSummary,
  usageBilling,
} from "../../context/model-usage"
import { formatCompactCount } from "../../utils/format"

interface TaskUsageProps {
  tokens: TokenSummary
  usage?: SessionModelUsage
  defaultOpen?: boolean
}

export const TaskUsage: Component<TaskUsageProps> = (props) => {
  const language = useLanguage()
  const provider = useProvider()
  const groups = createMemo(() => groupModelUsage(props.usage?.models ?? [], provider.providers()))
  const number = formatCompactCount
  const count = (value: number) => value.toLocaleString(language.locale())
  const cny = (input: number) => formatCNY(input, language.locale())
  const usd = (input: number) => formatUSD(input, language.locale())
  const rate = (model: SessionModelUsage["models"][number]) => {
    const total = model.tokens.input + model.tokens.cache.read
    if (total === 0) return "-"
    return `${((model.tokens.cache.read / total) * 100).toFixed(1)}%`
  }

  const Summary = () => (
    <>
      <span class="task-header-tokens-label">Tokens</span>
      <Show when={props.tokens.input > 0}>
        <span class="task-header-tokens-value">
          <Icon name="arrow-up" size="small" />
          {number(props.tokens.input)}
        </span>
      </Show>
      <Show when={props.tokens.cached > 0}>
        <span class="task-header-tokens-value">
          <Icon name="arrow-up" size="small" />
          cache {number(props.tokens.cached)}
        </span>
      </Show>
      <Show when={props.tokens.output > 0}>
        <span class="task-header-tokens-value">
          <Icon name="arrow-down-to-line" size="small" />
          {number(props.tokens.output)}
        </span>
      </Show>
      <Show when={props.usage}>
        {(usage) => (
          <span class="task-header-billing" aria-live="polite">
            <Show when={usageBilling(usage().totals).settledSteps > 0}>
              <span class="task-header-billing-amount">{cny(usageBilling(usage().totals).amountCNY)}</span>
            </Show>
            <Show when={usageBilling(usage().totals).otherCostUSD > 0}>
              <span>{usd(usageBilling(usage().totals).otherCostUSD)}</span>
            </Show>
            <Show when={usageBilling(usage().totals).pendingSteps > 0}>
              <span>{language.t("context.usage.billing.pending")}</span>
            </Show>
            <Show when={usageBilling(usage().totals).unavailableSteps > 0}>
              <span>{language.t("context.usage.billing.unavailable")}</span>
            </Show>
          </span>
        )}
      </Show>
    </>
  )

  return (
    <Show
      when={props.usage?.models.length}
      fallback={
        <div class="task-header-tokens">
          <Summary />
        </div>
      }
    >
      <Collapsible variant="ghost" class="task-header-usage tool-collapsible" defaultOpen={props.defaultOpen}>
        <Collapsible.Trigger class="task-header-usage-trigger">
          <span class="task-header-tokens">
            <Summary />
          </span>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="task-header-usage-detail">
            <For each={groups()}>
              {(group) => (
                <section class="task-header-usage-provider">
                  <h4>{group.providerName}</h4>
                  <For each={group.models}>
                    {(model) => {
                      const billing = () => usageBilling(model)
                      return (
                        <div class="task-header-usage-model">
                          <div class="task-header-usage-model-name" title={`${model.providerID}/${model.modelID}`}>
                            {modelUsageName(model, provider.providers())}
                          </div>
                          <div class="task-header-usage-meta">
                            {language.t("context.usage.billing.steps", { count: String(model.steps) })}
                            <Show when={billing().settledSteps > 0}> · {cny(billing().amountCNY)}</Show>
                            <Show when={billing().otherCostUSD > 0}> · {usd(billing().otherCostUSD)}</Show>
                            <Show when={billing().pendingSteps > 0}>
                              {" "}· {language.t("context.usage.billing.pending")} {" "}
                              {language.t("context.usage.billing.steps", { count: String(billing().pendingSteps) })}
                            </Show>
                            <Show when={billing().unavailableSteps > 0}>
                              {" "}· {language.t("context.usage.billing.unavailable")} {" "}
                              {language.t("context.usage.billing.steps", { count: String(billing().unavailableSteps) })}
                            </Show>
                          </div>
                          <For each={billing().groups}>
                            {(billingGroup) => (
                              <div class="task-header-usage-meta task-header-usage-billing-group">
                                {language.t("context.usage.billing.group")}: {billingGroup.name} ·{" "}
                                {cny(billingGroup.amountCNY)} ·{" "}
                                {language.t("context.usage.billing.steps", { count: String(billingGroup.steps) })}
                              </div>
                            )}
                          </For>
                          <div class="task-header-usage-meta">
                            In {count(model.tokens.input)} · Out {count(model.tokens.output)} · Reason{" "}
                            {count(model.tokens.reasoning)}
                          </div>
                          <div class="task-header-usage-meta">
                            Cache R {count(model.tokens.cache.read)} · W {count(model.tokens.cache.write)} · Hit Rate{" "}
                            {rate(model)}
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </section>
              )}
            </For>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  )
}
