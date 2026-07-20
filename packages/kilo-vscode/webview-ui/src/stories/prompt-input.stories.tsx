/** @jsxImportSource solid-js */
/**
 * Stories for the PromptInput component.
 *
 * Covers the main prompt bar including the mode switcher, model dropdown,
 * and the thinking-effort (variant) dropdown that appears for models that
 * support reasoning variants.
 *
 * Two viewport widths are captured for each scenario:
 *   - 420 px  — typical sidebar width
 *   - 200 px  — narrow / collapsed sidebar
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, onMount, type ParentComponent } from "solid-js"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"
import { ServerContext } from "../context/server"
import { PromptInput } from "../components/chat/PromptInput"
import type { Config, IndexingStatus } from "../types/messages"
import { SandboxTooltipContent } from "../components/shared/SandboxButton"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"

const agents = [
  { name: "code", description: "Write, edit and review code", mode: "primary" as const },
  { name: "ask", description: "Answer questions without making changes", mode: "primary" as const },
  { name: "architect", description: "Plan and design before implementation", mode: "primary" as const },
]

const noop = () => {}

type Pipeline = NonNullable<IndexingStatus["pipelines"]>["rag"]

const pipeline = (state: Pipeline["state"], percent: number, opts: Partial<Pipeline> = {}): Pipeline => ({
  state,
  message: `${state} fixture`,
  processedFiles: Math.round(percent),
  totalFiles: 100,
  percent,
  errorCount: 0,
  staleCount: 0,
  skippedCount: 0,
  ...opts,
})

const mixed: IndexingStatus = {
  state: "In Progress",
  message: "Mixed pipeline states",
  processedFiles: 63,
  totalFiles: 100,
  percent: 63,
  pipelines: {
    codeGraph: pipeline("Complete", 100, { processedFiles: 384, totalFiles: 384 }),
    rag: pipeline("In Progress", 63, { processedFiles: 630, totalFiles: 1000 }),
    documents: pipeline("Error", 28, { errorCount: 2, detail: "Document indexing failed." }),
  },
}

const warning: IndexingStatus = {
  state: "Complete",
  message: "Completed with pipeline issues",
  processedFiles: 100,
  totalFiles: 100,
  percent: 100,
  pipelines: {
    codeGraph: pipeline("Complete", 94, { staleCount: 2 }),
    rag: pipeline("Complete", 100, { errorCount: 1 }),
    documents: pipeline("Complete", 100),
  },
}

const standby: IndexingStatus = {
  state: "Standby",
  message: "Waiting to index",
  processedFiles: 0,
  totalFiles: 0,
  percent: 0,
  pipelines: {
    codeGraph: pipeline("Standby", 0, { totalFiles: 0 }),
    rag: pipeline("Standby", 0, { totalFiles: 0 }),
    documents: pipeline("Disabled", 0, { totalFiles: 0 }),
  },
}

const IndexFixture: ParentComponent<{ status?: IndexingStatus }> = (props) => {
  onMount(() => {
    if (!props.status) return
    window.dispatchEvent(new MessageEvent("message", { data: { type: "indexingStatusLoaded", status: props.status } }))
  })
  return props.children
}

const indexingConfig = {
  plugin: ["@kilocode/kilo-indexing"],
  indexing: {
    enabled: true,
    provider: "kilo",
    vectorStore: "lancedb",
  },
} as Config

const denseConfig = {
  ...indexingConfig,
  sandbox: {
    enabled: true,
  },
} as Config

const longSelection = {
  providerID: "openai-compatible-lab-provider",
  modelID: "deepseek/deepseek-v4-flash-preview-ultra-long-model-name",
}

const speechServer = {
  connectionState: () => "connected" as const,
  serverInfo: () => undefined,
  extensionVersion: () => "1.0.0",
  errorMessage: () => undefined,
  errorDetails: () => undefined,
  isConnected: () => true,
  profileData: () => ({ profile: { email: "qa@chipmate.local" } }),
  deviceAuth: () => ({ status: "idle" as const }),
  startLogin: noop,
  goToLogin: noop,
  vscodeLanguage: () => "en",
  languageOverride: () => undefined,
  workspaceDirectory: () => "/project",
  gitInstalled: () => true,
}

const PromptProviders: ParentComponent<{
  variants?: boolean
  modelOverride?: boolean
  indexing?: boolean
  longModel?: boolean
  speech?: boolean
  sandbox?: boolean
  busy?: boolean
  none?: boolean
  autoFree?: boolean
  locale?: "en" | "zh" | "zht"
  index?: IndexingStatus
  variant?: string
}> = (props) => {
  const base = mockSessionValue({ status: props.busy ? "busy" : "idle" })
  const [variant, setVariant] = createSignal(props.variant ?? "medium")
  const selected = () => {
    if (props.none) return null
    if (props.autoFree) return { providerID: "kilo", modelID: "kilo-auto/free" }
    return props.longModel ? longSelection : { providerID: "kilo", modelID: "anthropic/claude-sonnet-4-6" }
  }
  const session = {
    ...base,
    agents: () => agents,
    selectedAgent: () => "code",
    selected,
    getSessionModel: selected,
    variantList: () => (props.variants ? ["low", "medium", "high"] : []),
    currentVariant: () => (props.variants ? variant() : undefined),
    selectVariant: (value: string) => setVariant(value),
    hasModelOverride: () => props.modelOverride ?? false,
    clearModelOverride: noop,
  }
  return (
    <StoryProviders
      noPadding
      locale={props.locale}
      config={props.sandbox ? denseConfig : props.indexing ? indexingConfig : undefined}
      features={props.sandbox ? { sandboxControls: true } : undefined}
      kiloAuth={props.speech}
    >
      <IndexFixture status={props.index}>
        {/* overflow:hidden prevents margin-collapse so top/bottom borders are captured in screenshots */}
        <div class="chat-view" data-ui="qa-shell" style={{ overflow: "hidden" }}>
          <div class="chat-input" data-ui="qa-dock">
            {props.speech ? (
              <ServerContext.Provider value={speechServer as any}>
                <SessionContext.Provider value={session as any}>{props.children}</SessionContext.Provider>
              </ServerContext.Provider>
            ) : (
              <SessionContext.Provider value={session as any}>{props.children}</SessionContext.Provider>
            )}
          </div>
        </div>
      </IndexFixture>
    </StoryProviders>
  )
}

const OpenVariant: ParentComponent = (props) => {
  onMount(() => {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("openVariantPicker")))
  })
  return props.children
}

// ---------------------------------------------------------------------------
// Meta — fullscreen so the screenshot is exactly the component width
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "Prompt Input",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// Stories — standard model (no thinking variants)
// ---------------------------------------------------------------------------

export const Default420: Story = {
  name: "Default — 420px",
  render: () => (
    <PromptProviders>
      <PromptInput />
    </PromptProviders>
  ),
}

export const Default200: Story = {
  name: "Default — 200px",
  render: () => (
    <PromptProviders>
      <PromptInput />
    </PromptProviders>
  ),
}

export const NoModel420: Story = {
  name: "No model selected — 420px",
  render: () => (
    <PromptProviders none>
      <PromptInput />
    </PromptProviders>
  ),
}

export const NoModel300: Story = {
  name: "No model selected — 300px",
  render: () => (
    <PromptProviders none>
      <PromptInput />
    </PromptProviders>
  ),
}

export const NoModel200: Story = {
  name: "No model selected — 200px",
  render: () => (
    <PromptProviders none>
      <PromptInput />
    </PromptProviders>
  ),
}

export const LegacyAutoFree420: Story = {
  name: "ChipMate Auto Free compatibility — 420px",
  render: () => (
    <PromptProviders autoFree>
      <PromptInput />
    </PromptProviders>
  ),
}

export const NoModelZh420: Story = {
  name: "No model selected — Simplified Chinese — 420px",
  render: () => (
    <PromptProviders none locale="zh">
      <PromptInput />
    </PromptProviders>
  ),
}

export const NoModelZht420: Story = {
  name: "No model selected — Traditional Chinese — 420px",
  render: () => (
    <PromptProviders none locale="zht">
      <PromptInput />
    </PromptProviders>
  ),
}

export const SandboxTooltipEnabled: Story = {
  name: "Sandbox tooltip — enabled",
  render: () => (
    <StoryProviders>
      <div style={{ padding: "120px 0 0 180px" }}>
        <Tooltip
          forceOpen
          value={<SandboxTooltipContent enabled network />}
          contentClass="prompt-sandbox-tooltip-content"
          placement="top"
        >
          <Button variant="ghost" size="small" class="prompt-status-button prompt-status-button--active">
            <Icon name="lock" size="small" />
          </Button>
        </Tooltip>
      </div>
    </StoryProviders>
  ),
}

export const SandboxTooltipDisabled: Story = {
  name: "Sandbox tooltip — disabled",
  render: () => (
    <StoryProviders>
      <div style={{ padding: "120px 0 0 180px" }}>
        <Tooltip
          forceOpen
          value={<SandboxTooltipContent enabled={false} network />}
          contentClass="prompt-sandbox-tooltip-content"
          placement="top"
        >
          <Button variant="ghost" size="small" class="prompt-status-button">
            <Icon name="lock" size="small" />
          </Button>
        </Tooltip>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Stories — model with thinking-effort variants (ThinkingSelector visible)
// ---------------------------------------------------------------------------

export const WithThinking420: Story = {
  name: "With thinking selector — 420px",
  render: () => (
    <PromptProviders variants>
      <PromptInput />
    </PromptProviders>
  ),
}

export const WithThinking200: Story = {
  name: "With thinking selector — 200px",
  render: () => (
    <PromptProviders variants>
      <PromptInput />
    </PromptProviders>
  ),
}

// ---------------------------------------------------------------------------
// Stories — model override active (reset button visible)
// ---------------------------------------------------------------------------

export const WithModelOverride420: Story = {
  name: "With model override — 420px",
  render: () => (
    <PromptProviders modelOverride>
      <PromptInput />
    </PromptProviders>
  ),
}

export const WithModelOverride200: Story = {
  name: "With model override — 200px",
  render: () => (
    <PromptProviders modelOverride>
      <PromptInput />
    </PromptProviders>
  ),
}

// ---------------------------------------------------------------------------
// Stories — indexing controls visible (CG/RAG toolbar icons)
// ---------------------------------------------------------------------------

export const WithIndexing420: Story = {
  name: "With indexing controls — 420px",
  render: () => (
    <PromptProviders indexing>
      <PromptInput />
    </PromptProviders>
  ),
}

export const WithIndexing200: Story = {
  name: "With indexing controls — 200px",
  render: () => (
    <PromptProviders indexing>
      <PromptInput />
    </PromptProviders>
  ),
}

// ---------------------------------------------------------------------------
// Stories — long selector text plus dense toolbar controls
// ---------------------------------------------------------------------------

export const DenseLongModel420: Story = {
  name: "Dense long model — 420px",
  render: () => (
    <PromptProviders variants modelOverride indexing longModel>
      <PromptInput />
    </PromptProviders>
  ),
}

export const DenseLongModel200: Story = {
  name: "Dense long model — 200px",
  render: () => (
    <PromptProviders variants modelOverride indexing longModel>
      <PromptInput />
    </PromptProviders>
  ),
}

export const QAAllControlsSend: Story = {
  name: "QA all controls — send",
  render: () => (
    <PromptProviders variants modelOverride indexing longModel speech sandbox index={mixed}>
      <PromptInput />
    </PromptProviders>
  ),
}

export const QAAllControlsStop: Story = {
  name: "QA all controls — busy stop",
  render: () => (
    <PromptProviders variants modelOverride indexing longModel speech sandbox busy index={mixed}>
      <PromptInput />
    </PromptProviders>
  ),
}

export const QASparseControls: Story = {
  name: "QA sparse controls — mode model actions",
  render: () => (
    <PromptProviders>
      <PromptInput />
    </PromptProviders>
  ),
}

export const QAThinkingOpen: Story = {
  name: "QA thinking — selected menu open",
  render: () => (
    <PromptProviders variants variant="low">
      <div style={{ display: "grid", height: "360px", "align-items": "end" }}>
        <OpenVariant>
          <PromptInput />
        </OpenVariant>
      </div>
    </PromptProviders>
  ),
}

export const QAIndexingStandby: Story = {
  name: "QA indexing — standby",
  render: () => (
    <PromptProviders indexing index={standby}>
      <PromptInput />
    </PromptProviders>
  ),
}

export const QAIndexingWarning: Story = {
  name: "QA indexing — completed with issues",
  render: () => (
    <PromptProviders indexing index={warning}>
      <PromptInput />
    </PromptProviders>
  ),
}
