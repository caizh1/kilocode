import { createUniqueId, For, Show, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"

const supported = [
  "prompt.embeddedReview.supported.integer",
  "prompt.embeddedReview.supported.condition",
  "prompt.embeddedReview.supported.resource",
  "prompt.embeddedReview.supported.error",
  "prompt.embeddedReview.supported.unit",
] as const

const unsupported = [
  "prompt.embeddedReview.unsupported.concurrent",
  "prompt.embeddedReview.unsupported.state",
  "prompt.embeddedReview.unsupported.power",
  "prompt.embeddedReview.unsupported.hardware",
  "prompt.embeddedReview.unsupported.toolchain",
  "prompt.embeddedReview.unsupported.requirements",
] as const

export const EmbeddedReviewBoundary: Component<{
  expanded: boolean
  onToggle: () => void
}> = (props) => {
  const language = useLanguage()
  const title = createUniqueId()
  const details = createUniqueId()
  const action = () =>
    language.t(props.expanded ? "prompt.embeddedReview.action.collapse" : "prompt.embeddedReview.action.expand")

  return (
    <section
      class="embedded-review-boundary"
      data-ui="embedded-review-boundary"
      data-state={props.expanded ? "expanded" : "collapsed"}
      aria-labelledby={title}
    >
      <header class="embedded-review-boundary__header">
        <div class="embedded-review-boundary__identity">
          <Icon name="shield" class="embedded-review-boundary__shield" />
          <h2 id={title}>{language.t("prompt.embeddedReview.title")}</h2>
          <span class="embedded-review-boundary__experimental">{language.t("prompt.embeddedReview.experimental")}</span>
        </div>
        <Tooltip value={action()} placement="top">
          <IconButton
            class="embedded-review-boundary__toggle"
            classList={{ "embedded-review-boundary__toggle--expanded": props.expanded }}
            variant="ghost"
            size="small"
            icon="chevron-down"
            aria-label={action()}
            aria-controls={details}
            aria-expanded={props.expanded}
            onClick={props.onToggle}
          />
        </Tooltip>
      </header>

      <p class="embedded-review-boundary__summary">{language.t("prompt.embeddedReview.summary")}</p>

      <div class="embedded-review-boundary__facts" aria-label={language.t("prompt.embeddedReview.scope")}>
        <span>
          <Icon name="shield" size="small" />
          {language.t("prompt.embeddedReview.fact.logic")}
        </span>
        <span>
          <Icon name="checklist" size="small" />
          {language.t("prompt.embeddedReview.fact.rules")}
        </span>
        <span>
          <Icon name="liquid-file" size="small" />
          {language.t("prompt.embeddedReview.fact.lines")}
        </span>
      </div>

      <Show when={props.expanded}>
        <div id={details} class="embedded-review-boundary__details">
          <section class="embedded-review-boundary__supported" aria-labelledby={`${details}-supported`}>
            <h3 id={`${details}-supported`}>{language.t("prompt.embeddedReview.supported.title")}</h3>
            <ul>
              <For each={supported}>{(key) => <li>{language.t(key)}</li>}</For>
            </ul>
          </section>

          <section class="embedded-review-boundary__unsupported" aria-labelledby={`${details}-unsupported`}>
            <div class="embedded-review-boundary__unsupported-header">
              <h3 id={`${details}-unsupported`}>
                <Icon name="warning" size="small" />
                {language.t("prompt.embeddedReview.unsupported.title")}
              </h3>
              <span>{language.t("prompt.embeddedReview.unsupported.badge")}</span>
            </div>
            <p>{language.t("prompt.embeddedReview.unsupported.description")}</p>
            <ul>
              <For each={unsupported}>{(key) => <li>{language.t(key)}</li>}</For>
            </ul>
          </section>
        </div>
      </Show>

      <div class="embedded-review-boundary__warning">
        <Icon name="warning" size="small" />
        <span>{language.t("prompt.embeddedReview.warning")}</span>
      </div>
    </section>
  )
}
