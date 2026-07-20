/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { Code } from "@kilocode/kilo-ui/code"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Toast } from "@kilocode/kilo-ui/toast"
import { DataBridge, MermaidDownloadBridge } from "../src/App"
import { AgentRequirementsProvider } from "../src/context/agent-requirements"
import { ConfigProvider } from "../src/context/config"
import { DisplayProvider } from "../src/context/display"
import { FeedbackProvider } from "../src/context/feedback"
import { ImageModelsProvider } from "../src/context/image-models"
import { IndexingProvider } from "../src/context/indexing"
import { KiloEmbeddingModelsProvider } from "../src/context/kilo-embedding-models"
import { LanguageBridge } from "../src/context/language-bridge"
import { MemoryProvider } from "../src/context/memory"
import { NotificationsProvider } from "../src/context/notifications"
import { ProviderProvider } from "../src/context/provider"
import { ServerProvider } from "../src/context/server"
import { SessionProvider } from "../src/context/session"
import { VSCodeProvider } from "../src/context/vscode"
import { WorktreeModeProvider } from "../src/context/worktree-mode"
import { SpeechToTextPrewarm } from "../src/components/speech-to-text/SpeechToTextPrewarm"
import { AgentConsoleContent } from "./AgentConsoleApp"

export const AgentConsoleApp: Component = () => (
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
                        <SpeechToTextPrewarm />
                        <DisplayProvider>
                          <IndexingProvider>
                            <KiloEmbeddingModelsProvider>
                              <ImageModelsProvider>
                                <NotificationsProvider>
                                  <SessionProvider>
                                    <AgentRequirementsProvider>
                                      <MemoryProvider>
                                        <FeedbackProvider>
                                          <WorktreeModeProvider>
                                            <DataBridge>
                                              <AgentConsoleContent />
                                            </DataBridge>
                                          </WorktreeModeProvider>
                                        </FeedbackProvider>
                                      </MemoryProvider>
                                    </AgentRequirementsProvider>
                                  </SessionProvider>
                                </NotificationsProvider>
                              </ImageModelsProvider>
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
