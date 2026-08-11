// ChipMateClaw setup view — shown when no instance is provisioned

import { Button } from "@chipmate/chipmate-ui/button"
import { Card, CardTitle, CardDescription, CardActions } from "@chipmate/chipmate-ui/card"
import { useClaw } from "../context/claw"
import { useChipMateClawLanguage } from "../context/language"

export function SetupView() {
  const claw = useClaw()
  const { t } = useChipMateClawLanguage()

  return (
    <div class="chipmateclaw-center">
      <Card class="chipmateclaw-card">
        <CardTitle icon={false}>{t("chipmateClaw.setup.title")}</CardTitle>
        <CardDescription>
          <h3 class="chipmateclaw-card-subtitle">{t("chipmateClaw.setup.subtitle")}</h3>
          <p class="chipmateclaw-card-text">{t("chipmateClaw.setup.description1")}</p>
          <p class="chipmateclaw-card-text">{t("chipmateClaw.setup.description2")}</p>
        </CardDescription>
        <CardActions>
          <Button variant="ghost" onClick={() => claw.openExternal("https://chipmate.ai/chipmateclaw")}>
            {t("chipmateClaw.setup.learnMore")}
          </Button>
          <Button variant="primary" onClick={() => claw.openExternal("https://app.chipmate.ai/claw")}>
            {t("chipmateClaw.setup.tryChipMateClaw")}
          </Button>
        </CardActions>
      </Card>
    </div>
  )
}
