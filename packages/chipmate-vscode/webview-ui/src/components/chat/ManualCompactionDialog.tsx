import type { Component } from "solid-js"
import { AlertDialog } from "@kobalte/core/alert-dialog"
import { Button } from "@chipmate/chipmate-ui/button"
import { Checkbox } from "@chipmate/chipmate-ui/checkbox"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { useLanguage } from "../../context/language"

interface ManualCompactionDialogProps {
  open: boolean
  acknowledged: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

export const ManualCompactionDialog: Component<ManualCompactionDialogProps> = (props) => {
  const language = useLanguage()
  let cancel: HTMLButtonElement | undefined

  const cancelOnEscape = (event: Event) => {
    event.preventDefault()
    props.onCancel()
  }
  const blockOutsideInteraction = (event: Event) => event.preventDefault()

  return (
    <AlertDialog open={props.open} modal preventScroll onOpenChange={() => undefined}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          data-component="dialog-overlay"
          class="manual-compaction-dialog-overlay"
          data-testid="manual-compaction-overlay"
        />
        <div data-component="dialog" data-fit class="manual-compaction-dialog">
          <div data-slot="dialog-container">
            <AlertDialog.Content
              data-slot="dialog-content"
              data-testid="manual-compaction-dialog"
              onEscapeKeyDown={cancelOnEscape}
              onPointerDownOutside={blockOutsideInteraction}
              onInteractOutside={blockOutsideInteraction}
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                cancel?.focus()
              }}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div data-slot="dialog-header" class="manual-compaction-dialog-header">
                <AlertDialog.Title data-slot="dialog-title">
                  {language.t("session.compaction.confirm.title")}
                </AlertDialog.Title>
                <AlertDialog.Description data-slot="dialog-description">
                  {language.t("session.compaction.confirm.description")}
                </AlertDialog.Description>
              </div>

              <div data-slot="dialog-body" class="manual-compaction-dialog-body">
                <div
                  class="manual-compaction-flow"
                  role="group"
                  aria-label={language.t("session.compaction.confirm.flowLabel")}
                >
                  <section class="manual-compaction-flow-side">
                    <span class="manual-compaction-flow-label">{language.t("session.compaction.confirm.before")}</span>
                    <strong>{language.t("session.compaction.confirm.beforeDescription")}</strong>
                    <div class="manual-compaction-flow-icons" aria-hidden="true">
                      <Icon name="prompt" size="large" />
                      <Icon name="dot-grid" size="small" />
                      <Icon name="prompt" size="large" />
                    </div>
                  </section>

                  <span class="manual-compaction-flow-arrow" aria-hidden="true">
                    <Icon name="arrow-right" size="large" />
                  </span>

                  <section class="manual-compaction-flow-side">
                    <span class="manual-compaction-flow-label">{language.t("session.compaction.confirm.after")}</span>
                    <strong>{language.t("session.compaction.confirm.afterDescription")}</strong>
                    <div class="manual-compaction-flow-icons" aria-hidden="true">
                      <Icon name="file-tree" size="large" />
                      <Icon name="plus" size="small" />
                      <Icon name="prompt" size="large" />
                    </div>
                  </section>
                </div>

                <div class="manual-compaction-risks">
                  <span class="manual-compaction-risk-icon" aria-hidden="true">
                    <Icon name="warning" size="large" />
                  </span>
                  <ul>
                    <li>{language.t("session.compaction.confirm.riskDetails")}</li>
                    <li>{language.t("session.compaction.confirm.riskToolsAndUsage")}</li>
                  </ul>
                </div>

                <div class="manual-compaction-acknowledgement">
                  <Checkbox checked={props.acknowledged} onChange={props.onAcknowledgedChange}>
                    {language.t("session.compaction.confirm.acknowledge")}
                  </Checkbox>
                </div>

                <div class="manual-compaction-actions">
                  <Button
                    ref={(element: HTMLButtonElement) => {
                      cancel = element
                    }}
                    variant="secondary"
                    size="large"
                    onClick={props.onCancel}
                  >
                    {language.t("common.cancel")}
                  </Button>
                  <Button variant="primary" size="large" disabled={!props.acknowledged} onClick={props.onConfirm}>
                    {language.t("session.compaction.confirm.confirm")}
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
