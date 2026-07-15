/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { Toast } from "@kilocode/kilo-ui/toast"
import { VSCodeProvider } from "../src/context/vscode"
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { ConfigProvider } from "../src/context/config"
import { DisplayProvider } from "../src/context/display"
import { KiloEmbeddingModelsProvider } from "../src/context/kilo-embedding-models"
import { NotificationsProvider } from "../src/context/notifications"
import { FeedbackProvider } from "../src/context/feedback"
import { SessionProvider } from "../src/context/session"
import { WorktreeModeProvider } from "../src/context/worktree-mode"
import { IndexingProvider } from "../src/context/indexing"
import { DataBridge, MermaidDownloadBridge } from "../src/App"
import { LanguageBridge } from "../src/context/language-bridge"
import { AgentManagerContent } from "./AgentManagerApp"

export const AgentManagerApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <MermaidDownloadBridge />
          <ServerProvider>
            <LanguageBridge>
              <MarkedProvider>
                <DiffComponentProvider component={Diff}>
                  <CodeComponentProvider component={Code}>
                    <FileComponentProvider component={File}>
                      <ProviderProvider>
                        <ConfigProvider>
                          <DisplayProvider>
                            <IndexingProvider>
                              <KiloEmbeddingModelsProvider>
                                <NotificationsProvider>
                                  <SessionProvider>
                                    <FeedbackProvider>
                                      <WorktreeModeProvider>
                                        <DataBridge>
                                          <AgentManagerContent />
                                        </DataBridge>
                                      </WorktreeModeProvider>
                                    </FeedbackProvider>
                                  </SessionProvider>
                                </NotificationsProvider>
                              </KiloEmbeddingModelsProvider>
                            </IndexingProvider>
                          </DisplayProvider>
                        </ConfigProvider>
                      </ProviderProvider>
                    </FileComponentProvider>
                  </CodeComponentProvider>
                </DiffComponentProvider>
              </MarkedProvider>
            </LanguageBridge>
          </ServerProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
