import { type Component, For } from "solid-js"
import { AlertDialog } from "@kobalte/core/alert-dialog"
import { Button } from "@chipmate/chipmate-ui/button"
import { useLanguage } from "../../context/language"

interface Props {
  open: boolean
  onConfirm: () => void
}

const explorers = ["①", "②", "③"] as const

export const UltraModeDialog: Component<Props> = (props) => {
  const language = useLanguage()
  const button = { current: undefined as HTMLButtonElement | undefined }
  const block = (event: Event) => event.preventDefault()

  return (
    <AlertDialog open={props.open} modal preventScroll onOpenChange={() => undefined}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay data-component="dialog-overlay" class="ultra-mode-dialog-overlay" />
        <div data-component="dialog" data-fit class="ultra-mode-dialog">
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
              <div data-slot="dialog-header" class="ultra-mode-dialog-header">
                <span class="codicon codicon-sparkle ultra-mode-dialog-sparkle" aria-hidden="true" />
                <AlertDialog.Title data-slot="dialog-title">
                  {language.t("prompt.ultra.confirm.title")}
                </AlertDialog.Title>
              </div>
              <AlertDialog.Description data-slot="dialog-description">
                {language.t("prompt.ultra.confirm.description")}
              </AlertDialog.Description>
              <div data-slot="dialog-body">
                <div class="ultra-mode-dialog-body">
                  <div
                    class="ultra-mode-dialog-flow"
                    role="img"
                    aria-label={language.t("prompt.ultra.confirm.flow.label")}
                  >
                    <div class="ultra-mode-dialog-node" data-node="question">
                      {language.t("prompt.ultra.confirm.flow.question")}
                    </div>
                    <div class="ultra-mode-dialog-line" data-line="solid" aria-hidden="true" />
                    <div class="ultra-mode-dialog-node" data-node="code">
                      {language.t("prompt.ultra.confirm.flow.code")}
                    </div>
                    <div class="ultra-mode-dialog-line" data-line="solid" aria-hidden="true" />
                    <div class="ultra-mode-dialog-node" data-node="frozen">
                      {language.t("prompt.ultra.confirm.flow.frozen")}
                    </div>
                    <div class="ultra-mode-dialog-line" data-line="solid" aria-hidden="true" />
                    <div class="ultra-mode-dialog-line" data-line="split" aria-hidden="true" />
                    <div class="ultra-mode-dialog-explorers" data-stage="verification">
                      <For each={explorers}>
                        {(index) => (
                          <div class="ultra-mode-dialog-explorer">
                            <div class="ultra-mode-dialog-line" data-line="solid" aria-hidden="true" />
                            <div class="ultra-mode-dialog-node" data-node="explore">
                              <span>Explore {index}</span>
                              <small>{language.t("prompt.ultra.confirm.flow.verify")}</small>
                            </div>
                            <div class="ultra-mode-dialog-line" data-line="solid" aria-hidden="true" />
                          </div>
                        )}
                      </For>
                    </div>
                    <div class="ultra-mode-dialog-line" data-line="merge" aria-hidden="true" />
                    <div class="ultra-mode-dialog-line" data-line="solid" aria-hidden="true" />
                    <div class="ultra-mode-dialog-node" data-node="ask">
                      {language.t("prompt.ultra.confirm.flow.ask")}
                    </div>
                    <div class="ultra-mode-dialog-line" data-line="solid" aria-hidden="true" />
                    <div class="ultra-mode-dialog-node" data-node="final">
                      <span>{language.t("prompt.ultra.confirm.flow.final")}</span>
                      <small>{language.t("prompt.ultra.confirm.flow.finalNote")}</small>
                    </div>
                  </div>
                  <p class="ultra-mode-dialog-note">{language.t("prompt.ultra.confirm.note")}</p>
                  <Button
                    ref={(element: HTMLButtonElement) => {
                      button.current = element
                    }}
                    variant="primary"
                    size="large"
                    data-full-width="true"
                    onClick={props.onConfirm}
                  >
                    {language.t("prompt.ultra.confirm.action")}
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
