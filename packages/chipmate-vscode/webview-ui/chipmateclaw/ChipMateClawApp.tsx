// ChipMateClaw root component

import { Switch, Match } from "solid-js"
import { ThemeProvider } from "@chipmate/chipmate-ui/theme"
import { MarkedProvider } from "@chipmate/chipmate-ui/context/marked"
import { Button } from "@chipmate/chipmate-ui/button"
import { Spinner } from "@chipmate/chipmate-ui/dynamic-spinner"
import { Toast } from "@chipmate/chipmate-ui/toast"
import { ClawProvider, useClaw } from "./context/claw"
import { ChipMateClawLanguageProvider, useChipMateClawLanguage } from "./context/language"
import { ConversationList } from "./components/ConversationList"
import { MessageArea } from "./components/MessageArea"
import { StatusSidebar } from "./components/StatusSidebar"
import { SetupView } from "./components/SetupView"
import { UpgradeView } from "./components/UpgradeView"

function Content() {
  const claw = useClaw()
  const { t } = useChipMateClawLanguage()

  return (
    <div class="chipmateclaw-root">
      <Switch>
        <Match when={claw.phase() === "loading"}>
          <div class="chipmateclaw-center">
            <div class="chipmateclaw-loading">
              <Spinner />
              <span>{t("chipmateClaw.loading")}</span>
            </div>
          </div>
        </Match>
        <Match when={claw.phase() === "noInstance"}>
          <SetupView />
        </Match>
        <Match when={claw.phase() === "needsUpgrade"}>
          <UpgradeView />
        </Match>
        <Match when={claw.phase() === "error"}>
          <div class="chipmateclaw-center">
            <div class="chipmateclaw-error-view">
              <span class="chipmateclaw-error-text">{claw.error()}</span>
              <Button variant="primary" onClick={() => claw.retry()}>
                {t("chipmateClaw.error.retry")}
              </Button>
            </div>
          </div>
        </Match>
        <Match when={claw.phase() === "ready"}>
          <div class="chipmateclaw-layout">
            <ConversationList />
            <MessageArea />
            <StatusSidebar />
          </div>
        </Match>
      </Switch>
      <Toast.Region />
    </div>
  )
}

export function ChipMateClawApp() {
  return (
    <ThemeProvider defaultTheme="chipmate-vscode">
      <ClawProvider>
        <LanguageBridge>
          <MarkedProvider>
            <Content />
          </MarkedProvider>
        </LanguageBridge>
      </ClawProvider>
    </ThemeProvider>
  )
}

/** Bridges the claw context locale into the language provider. Must be below ClawProvider. */
function LanguageBridge(props: { children: any }) {
  const claw = useClaw()
  return <ChipMateClawLanguageProvider locale={claw.locale}>{props.children}</ChipMateClawLanguageProvider>
}
