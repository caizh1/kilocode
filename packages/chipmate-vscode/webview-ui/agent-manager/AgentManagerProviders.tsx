/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { ThemeProvider } from "@chipmate/chipmate-ui/theme"
import { DialogProvider } from "@chipmate/chipmate-ui/context/dialog"
import { MarkedProvider } from "@chipmate/chipmate-ui/context/marked"
import { CodeComponentProvider } from "@chipmate/chipmate-ui/context/code"
import { DiffComponentProvider } from "@chipmate/chipmate-ui/context/diff"
import { FileComponentProvider } from "@chipmate/chipmate-ui/context/file"
import { Code } from "@chipmate/chipmate-ui/code"
import { Diff } from "@chipmate/chipmate-ui/diff"
import { File } from "@chipmate/chipmate-ui/file"
import { Toast } from "@chipmate/chipmate-ui/toast"
import { VSCodeProvider } from "../src/context/vscode"
import { SessionSurfaceProvider } from "../src/context/session-surface"
import { ServerProvider } from "../src/context/server"
import { ProviderProvider } from "../src/context/provider"
import { DeepSeekHarnessProvider } from "../src/context/deepseek-harness"
import { ConfigProvider } from "../src/context/config"
import { DisplayProvider } from "../src/context/display"
import { ChipMateEmbeddingModelsProvider } from "../src/context/chipmate-embedding-models"
import { ImageModelsProvider } from "../src/context/image-models"
import { NotificationsProvider } from "../src/context/notifications"
import { FeedbackProvider } from "../src/context/feedback"
import { MemoryProvider } from "../src/context/memory"
import { SessionProvider } from "../src/context/session"
import { AgentRequirementsProvider } from "../src/context/agent-requirements"
import { WorktreeModeProvider } from "../src/context/worktree-mode"
import { IndexingProvider } from "../src/context/indexing"
import { DataBridge, MermaidDownloadBridge, PlantUmlBridge } from "../src/App"
import { LanguageBridge } from "../src/context/language-bridge"
import { SpeechToTextPrewarm } from "../src/components/speech-to-text/SpeechToTextPrewarm"
import { AgentManagerContent } from "./AgentManagerApp"

export const AgentManagerApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="chipmate-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <SessionSurfaceProvider unmanaged>
            <MermaidDownloadBridge />
            <PlantUmlBridge />
            <ServerProvider>
              <LanguageBridge>
                <MarkedProvider>
                  <DiffComponentProvider component={Diff}>
                    <CodeComponentProvider component={Code}>
                      <FileComponentProvider component={File}>
                        <ProviderProvider>
                          <DeepSeekHarnessProvider>
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
                                                    <AgentManagerContent />
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
                          </DeepSeekHarnessProvider>
                        </ProviderProvider>
                      </FileComponentProvider>
                    </CodeComponentProvider>
                  </DiffComponentProvider>
                </MarkedProvider>
              </LanguageBridge>
            </ServerProvider>
          </SessionSurfaceProvider>
        </VSCodeProvider>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
