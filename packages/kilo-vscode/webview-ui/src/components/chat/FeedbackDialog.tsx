import { Component, JSX } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../context/language"

const ChipMateLogo = (): JSX.Element => {
  const iconsBaseUri = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""
  const isLight =
    document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light")
  const iconFile = isLight ? "kilo-light.svg" : "kilo-dark.svg"

  return (
    <div class="feedback-dialog-logo">
      <img src={`${iconsBaseUri}/${iconFile}`} alt="ChipMate" />
    </div>
  )
}

export const FeedbackDialog: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()

  return (
    <Dialog title="" fit>
      <div class="feedback-dialog">
        <ChipMateLogo />
        <p class="feedback-dialog-message">{language.t("feedback.dialog.message")}</p>
        <div class="feedback-dialog-actions">
          <Button variant="primary" size="large" data-full-width="true" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
