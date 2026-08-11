import { type Component } from "solid-js"
import { AlertDialog } from "@kobalte/core/alert-dialog"
import { Button } from "@chipmate/chipmate-ui/button"
import { useLanguage } from "../../context/language"

interface Props {
  open: boolean
  onConfirm: () => void
}

export const DocumentModeDialog: Component<Props> = (props) => {
  const language = useLanguage()
  const button = { current: undefined as HTMLButtonElement | undefined }
  const block = (event: Event) => event.preventDefault()

  return (
    <AlertDialog open={props.open} modal preventScroll onOpenChange={() => undefined}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay data-component="dialog-overlay" class="document-mode-dialog-overlay" />
        <div data-component="dialog" data-fit class="document-mode-dialog">
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
              <div data-slot="dialog-header" class="document-mode-dialog-header">
                <span class="document-mode-dialog-mark" aria-hidden="true">
                  <span class="codicon codicon-book" />
                  <span class="codicon codicon-sparkle" />
                </span>
                <AlertDialog.Title data-slot="dialog-title">
                  {language.t("prompt.document.confirm.title")}
                </AlertDialog.Title>
              </div>
              <AlertDialog.Description data-slot="dialog-description">
                {language.t("prompt.document.confirm.description")}
              </AlertDialog.Description>
              <div data-slot="dialog-body">
                <div class="document-mode-dialog-body">
                  <div
                    class="document-mode-dialog-flow"
                    role="img"
                    aria-label={language.t("prompt.document.confirm.flow.label")}
                  >
                    <div class="document-mode-dialog-state" data-state="documents">
                      <span class="document-mode-dialog-state-icon" aria-hidden="true">
                        <span class="codicon codicon-book" />
                      </span>
                      <strong>{language.t("documentAgent.scope.documentsOnly")}</strong>
                      <small>{language.t("prompt.document.confirm.documents.note")}</small>
                    </div>
                    <div class="document-mode-dialog-transition">
                      <span>{language.t("prompt.document.confirm.transition")}</span>
                      <span class="codicon codicon-arrow-right" aria-hidden="true" />
                    </div>
                    <div class="document-mode-dialog-state" data-state="documents_and_code">
                      <span class="document-mode-dialog-state-icons" aria-hidden="true">
                        <span class="codicon codicon-book" />
                        <span class="codicon codicon-code" />
                      </span>
                      <strong>{language.t("documentAgent.scope.documentsAndCode")}</strong>
                      <small>{language.t("prompt.document.confirm.code.note")}</small>
                    </div>
                  </div>
                  <p class="document-mode-dialog-note">
                    <span class="codicon codicon-shield" aria-hidden="true" />
                    <span>{language.t("prompt.document.confirm.note")}</span>
                  </p>
                  <Button
                    ref={(element: HTMLButtonElement) => {
                      button.current = element
                    }}
                    variant="primary"
                    size="large"
                    data-full-width="true"
                    onClick={props.onConfirm}
                  >
                    {language.t("prompt.document.confirm.action")}
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
