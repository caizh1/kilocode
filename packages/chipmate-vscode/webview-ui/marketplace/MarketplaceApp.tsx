import { type Component } from "solid-js"
import { ThemeProvider } from "@chipmate/chipmate-ui/theme"
import { DialogProvider } from "@chipmate/chipmate-ui/context/dialog"
import { MarkedProvider } from "@chipmate/chipmate-ui/context/marked"
import { Toast } from "@chipmate/chipmate-ui/toast"
import { MarketplaceView } from "../src/components/marketplace"
import { MarketplaceSessionProvider } from "../src/context/marketplace-session"
import { LanguageBridge } from "../src/context/language-bridge"
import { ServerProvider } from "../src/context/server"
import { VSCodeProvider } from "../src/context/vscode"
import "../src/styles/chat.css"

export const MarketplaceApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="chipmate-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <MarketplaceSessionProvider>
                  <MarketplaceView />
                </MarketplaceSessionProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
