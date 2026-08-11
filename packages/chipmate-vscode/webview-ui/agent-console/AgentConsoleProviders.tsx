/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { Code } from "@chipmate/chipmate-ui/code"
import { DialogProvider } from "@chipmate/chipmate-ui/context/dialog"
import { CodeComponentProvider } from "@chipmate/chipmate-ui/context/code"
import { DiffComponentProvider } from "@chipmate/chipmate-ui/context/diff"
import { FileComponentProvider } from "@chipmate/chipmate-ui/context/file"
import { Diff } from "@chipmate/chipmate-ui/diff"
import { File } from "@chipmate/chipmate-ui/file"
import { MarkedProvider } from "@chipmate/chipmate-ui/context/marked"
import { ThemeProvider } from "@chipmate/chipmate-ui/theme"
import { Toast } from "@chipmate/chipmate-ui/toast"
import { DataBridge, MermaidDownloadBridge, PlantUmlBridge } from "../src/App"
import { AgentRequirementsProvider } from "../src/context/agent-requirements"
import { ConfigProvider } from "../src/context/config"
import { DisplayProvider } from "../src/context/display"
import { FeedbackProvider } from "../src/context/feedback"
import { ImageModelsProvider } from "../src/context/image-models"
import { IndexingProvider } from "../src/context/indexing"
import { ChipMateEmbeddingModelsProvider } from "../src/context/chipmate-embedding-models"
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
  <ThemeProvider defaultTheme="chipmate-vscode">
    <DialogProvider>
      <VSCodeProvider>
        <MermaidDownloadBridge />
        <PlantUmlBridge />
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
                            <ChipMateEmbeddingModelsProvider>
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
                            </ChipMateEmbeddingModelsProvider>
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
