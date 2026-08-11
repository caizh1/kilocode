import { Component } from "solid-js"
import { Dialog } from "@chipmate/chipmate-ui/dialog"
import { Button } from "@chipmate/chipmate-ui/button"
import { useDialog } from "@chipmate/chipmate-ui/context/dialog"
import { useLanguage } from "../../context/language"
import { ChipMateLogo } from "../shared/ChipMateLogo"

export const FeedbackDialog: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()

  return (
    <Dialog title="" fit>
      <div class="feedback-dialog">
        <ChipMateLogo class="feedback-dialog-logo" />
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
