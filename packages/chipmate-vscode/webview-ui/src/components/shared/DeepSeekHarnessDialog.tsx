import { type Component } from "solid-js"
import { AlertDialog } from "@kobalte/core/alert-dialog"
import { Button } from "@chipmate/chipmate-ui/button"
import { useLanguage } from "../../context/language"

interface Props {
  open: boolean
  onConfirm: () => void
}

export const DeepSeekHarnessDialog: Component<Props> = (props) => {
  const language = useLanguage()
  const button = { current: undefined as HTMLButtonElement | undefined }
  const block = (event: Event) => event.preventDefault()

  return (
    <AlertDialog open={props.open} modal preventScroll onOpenChange={() => undefined}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay data-component="dialog-overlay" class="dsh-mode-dialog-overlay" />
        <div data-component="dialog" data-fit class="dsh-mode-dialog">
          <div data-slot="dialog-container">
            <AlertDialog.Content
              data-slot="dialog-content"
              onEscapeKeyDown={block}
              onPointerDownOutside={block}
              onInteractOutside={block}
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                button.current?.focus()
              }}
            >
              <div data-slot="dialog-header" class="dsh-mode-dialog-header">
                <span class="dsh-mode-dialog-mark" aria-hidden="true">
                  <span class="codicon codicon-hubot" />
                  <span class="codicon codicon-shield" />
                </span>
                <AlertDialog.Title data-slot="dialog-title">
                  {language.t("prompt.deepseekHarness.confirm.title")}
                </AlertDialog.Title>
              </div>
              <AlertDialog.Description data-slot="dialog-description">
                {language.t("prompt.deepseekHarness.confirm.description")}
              </AlertDialog.Description>
              <div data-slot="dialog-body">
                <div class="dsh-mode-dialog-body">
                  <div
                    class="dsh-mode-dialog-flow"
                    role="img"
                    aria-label={language.t("prompt.deepseekHarness.confirm.flow.label")}
                  >
                    <FlowNode icon="comment-discussion" label={language.t("prompt.deepseekHarness.confirm.flow.qa")} />
                    <FlowArrow />
                    <FlowNode icon="radio-tower" label={language.t("prompt.deepseekHarness.confirm.flow.bridge")} />
                    <FlowArrow />
                    <FlowNode
                      icon="server-process"
                      label={language.t("prompt.deepseekHarness.confirm.flow.dsh")}
                      accent
                    />
                    <FlowArrow />
                    <FlowNode icon="tools" label={language.t("prompt.deepseekHarness.confirm.flow.runtime")} />
                  </div>
                  <div class="dsh-mode-dialog-boundaries">
                    <p>
                      <span class="codicon codicon-check" aria-hidden="true" />
                      <span>{language.t("prompt.deepseekHarness.confirm.native")}</span>
                    </p>
                    <p>
                      <span class="codicon codicon-lock" aria-hidden="true" />
                      <span>{language.t("prompt.deepseekHarness.confirm.home")}</span>
                    </p>
                    <p>
                      <span class="codicon codicon-debug-start" aria-hidden="true" />
                      <span>{language.t("prompt.deepseekHarness.confirm.start")}</span>
                    </p>
                  </div>
                  <Button
                    ref={(element: HTMLButtonElement) => {
                      button.current = element
                    }}
                    variant="primary"
                    size="large"
                    data-full-width="true"
                    onClick={props.onConfirm}
                  >
                    {language.t("prompt.deepseekHarness.confirm.action")}
                  </Button>
                </div>
              </div>
            </AlertDialog.Content>
          </div>
        </div>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}

const FlowNode: Component<{ icon: string; label: string; accent?: boolean }> = (props) => (
  <div class="dsh-mode-dialog-node" data-accent={props.accent ? "true" : undefined}>
    <span class={`codicon codicon-${props.icon}`} aria-hidden="true" />
    <strong>{props.label}</strong>
  </div>
)

const FlowArrow: Component = () => <span class="dsh-mode-dialog-arrow codicon codicon-arrow-right" aria-hidden="true" />
