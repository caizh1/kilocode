import { type Component } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { Toast } from "@kilocode/kilo-ui/toast"
import { MarketplaceView } from "../src/components/marketplace"
import { MarketplaceSessionProvider } from "../src/context/marketplace-session"
import { LanguageBridge } from "../src/context/language-bridge"
import { ServerProvider } from "../src/context/server"
import { VSCodeProvider } from "../src/context/vscode"
import "../src/styles/chat.css"

export const MarketplaceApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
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
