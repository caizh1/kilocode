// ChipMateClaw upgrade view — shown when instance needs upgrade for chat

import { Button } from "@chipmate/chipmate-ui/button"
import { Card, CardTitle, CardDescription, CardActions } from "@chipmate/chipmate-ui/card"
import { useClaw } from "../context/claw"
import { useChipMateClawLanguage } from "../context/language"

export function UpgradeView() {
  const claw = useClaw()
  const { t } = useChipMateClawLanguage()

  return (
    <div class="chipmateclaw-center">
      <Card class="chipmateclaw-card">
        <CardTitle icon={false}>{t("chipmateClaw.upgrade.title")}</CardTitle>
        <CardDescription>
          <p class="chipmateclaw-card-text">{t("chipmateClaw.upgrade.description1")}</p>
          <p class="chipmateclaw-card-text">
            {t("chipmateClaw.upgrade.description2.before")}
            <strong>{t("chipmateClaw.upgrade.description2.bold")}</strong>
            {t("chipmateClaw.upgrade.description2.after")}
          </p>
        </CardDescription>
        <CardActions>
          <div />
          <Button variant="primary" onClick={() => claw.openExternal("https://app.chipmate.ai/claw")}>
            {t("chipmateClaw.upgrade.openDashboard")}
          </Button>
        </CardActions>
      </Card>
    </div>
  )
}
