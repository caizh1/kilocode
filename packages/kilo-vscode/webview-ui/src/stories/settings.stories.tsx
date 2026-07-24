/** @jsxImportSource solid-js */
/**
 * Stories for Settings and ProvidersTab components.
 */

import { onMount, createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"
import { KiloEmbeddingModelsContext } from "../context/kilo-embedding-models"
import Settings from "../components/settings/Settings"
import ProvidersTab from "../components/settings/ProvidersTab"
import ModelsTab from "../components/settings/ModelsTab"
import AgentBehaviourTab from "../components/settings/AgentBehaviourTab"
import AutoApproveTab from "../components/settings/AutoApproveTab"
import ModeEditView from "../components/settings/ModeEditView"
import McpEditView from "../components/settings/McpEditView"
import type { AgentConfig, CommandConfig, Config } from "../types/messages"
import IndexingTab from "../components/settings/IndexingTab"
import ChipmateServerTab, { type ChipmateServerTabProps } from "../components/settings/ChipmateServerTab"
import { CHIPMATE_SERVER_KEY } from "../../../src/shared/chipmate-server"
import { ChatView } from "../components/chat/ChatView"
import { SidebarEmptyState } from "../components/chat/SidebarEmptyState"
import { WorkStyleContext, type WorkStyleContextValue } from "../context/work-style"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import CustomProviderDialog from "../components/settings/CustomProviderDialog"
import type { InternalOfflineProviderDefaults } from "../../../src/shared/internal-offline"
import { QWEN_FIM_MODEL_ID } from "../../../src/shared/qwen-autocomplete"

const meta: Meta = {
  title: "Settings",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

function noop() {}

const customDefaults: InternalOfflineProviderDefaults = {
  providerID: "chipmate",
  name: "ChipMate",
  npm: "@ai-sdk/openai-compatible",
  baseURL: "https://api.example.com/v1",
  modelID: "deepseek-v4-flash",
  autocompleteModelID: QWEN_FIM_MODEL_ID,
  variant: "low",
}

function OpenCustomProviderDialog(props: { defaults?: InternalOfflineProviderDefaults }) {
  const dialog = useDialog()
  onMount(() => dialog.show(() => <CustomProviderDialog defaults={props.defaults} />))
  return <div style={{ width: "100%", height: "100%" }} />
}

function CustomProviderStory(props: { width: string; quick?: boolean }) {
  return (
    <div style={{ width: props.width, height: "760px", "max-width": "100vw", overflow: "hidden" }}>
      <StoryProviders noPadding locale="zh">
        <OpenCustomProviderDialog defaults={props.quick ? customDefaults : undefined} />
      </StoryProviders>
    </div>
  )
}

export const CustomProviderQuick420: Story = {
  name: "Custom provider — key-only 420px",
  render: () => <CustomProviderStory width="420px" quick />,
}

export const CustomProviderQuick300: Story = {
  name: "Custom provider — key-only 300px",
  render: () => <CustomProviderStory width="300px" quick />,
}

export const CustomProviderPublic: Story = {
  name: "Custom provider — public full form",
  render: () => <CustomProviderStory width="420px" />,
}

const MOCK_AGENTS = [
  { name: "code", description: "General-purpose coding agent", mode: "primary" as const, native: true },
  { name: "debug", description: "Diagnose and fix bugs", mode: "primary" as const, native: true },
  { name: "architect", description: "Design systems and plan features", mode: "all" as const, native: true },
  {
    name: "reviewer",
    description: "Review code for quality and best practices",
    mode: "primary" as const,
    native: false,
  },
]

export const SettingsPanel: Story = {
  name: "Settings — full panel",
  render: () => (
    <StoryProviders>
      <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
        <Settings />
      </div>
    </StoryProviders>
  ),
}

function ChipmateServerStory(props: ChipmateServerTabProps & { width?: string }) {
  return (
    <StoryProviders config={{} as Config}>
      <div style={{ width: props.width ?? "760px", "max-width": "100%", padding: "20px" }}>
        <h3 style={{ margin: "0 0 14px" }}>ChipMate Server</h3>
        <ChipmateServerTab preview={props.preview} />
      </div>
    </StoryProviders>
  )
}

export const ChipmateServerDefault: Story = {
  name: "ChipMate Server — default",
  render: () => <ChipmateServerStory />,
}

export const ChipmateServerSettingsPanel: Story = {
  name: "ChipMate Server — settings panel",
  render: () => (
    <StoryProviders>
      <div style={{ height: "820px", display: "flex", "flex-direction": "column" }}>
        <Settings tab="chipmateServer" />
      </div>
    </StoryProviders>
  ),
}

export const ChipmateServerEditing: Story = {
  name: "ChipMate Server — editing",
  render: () => <ChipmateServerStory preview={{ value: "https://chipmate.internal:7443" }} />,
}

export const ChipmateServerTesting: Story = {
  name: "ChipMate Server — testing",
  render: () => <ChipmateServerStory preview={{ testing: true }} />,
}

export const ChipmateServerSuccess: Story = {
  name: "ChipMate Server — success",
  render: () => <ChipmateServerStory preview={{ result: { status: "success", code: "ok", skillsCount: 12 } }} />,
}

export const ChipmateServerWarning: Story = {
  name: "ChipMate Server — warning",
  render: () => (
    <ChipmateServerStory
      preview={{ result: { status: "warning", code: "degraded", missing: ["soffice"], warnings: [] } }}
    />
  ),
}

export const ChipmateServerFailure: Story = {
  name: "ChipMate Server — failure",
  render: () => (
    <ChipmateServerStory preview={{ result: { status: "error", code: "network", message: "unreachable" } }} />
  ),
}

export const ChipmateUpdateLatest: Story = {
  name: "ChipMate 更新 — 当前最新",
  render: () => (
    <ChipmateServerStory
      preview={{
        result: { status: "success", code: "ok", skillsCount: 12 },
        update: {
          status: "latest",
          currentVersion: "1.0.9",
          checkedAt: Date.now(),
          target: "darwin-arm64",
        },
      }}
    />
  ),
}

const availableUpdate = {
  status: "available" as const,
  candidateId: "storybook-update",
  currentVersion: "1.0.9",
  version: "1.0.10",
  target: "darwin-arm64" as const,
  publishedAt: "2026-07-24T08:00:00.000Z",
  releaseNotes:
    "- 新增手动检查更新与版本状态提示\n- 优化离线环境中的更新包校验与安装流程\n- 修复更新完成后未及时提示重载的问题",
}

export const ChipmateUpdateAvailable: Story = {
  name: "ChipMate 更新 — 发现新版本",
  render: () => (
    <ChipmateServerStory
      preview={{ result: { status: "success", code: "ok", skillsCount: 12 }, update: availableUpdate }}
    />
  ),
}

export const ChipmateUpdateNotes: Story = {
  name: "ChipMate 更新 — 展开更新说明",
  render: () => (
    <ChipmateServerStory
      preview={{
        result: { status: "success", code: "ok", skillsCount: 12 },
        update: availableUpdate,
        notesExpanded: true,
      }}
    />
  ),
}

export const ChipmateUpdateChecking: Story = {
  name: "ChipMate 更新 — 正在检查",
  render: () => <ChipmateServerStory preview={{ updatePhase: "checking" }} />,
}

export const ChipmateUpdateInstalling: Story = {
  name: "ChipMate 更新 — 正在安装",
  render: () => <ChipmateServerStory preview={{ update: availableUpdate, updatePhase: "installing" }} />,
}

export const ChipmateUpdateInstalled: Story = {
  name: "ChipMate 更新 — 等待重载",
  render: () => <ChipmateServerStory preview={{ update: { status: "installed", version: "1.0.10" } }} />,
}

export const ChipmateUpdateError: Story = {
  name: "ChipMate 更新 — 检查失败",
  render: () => (
    <ChipmateServerStory
      preview={{
        update: {
          status: "error",
          code: "availability",
          message: "暂时无法连接 ChipMate Server，请检查网络后重试。",
          retryable: true,
        },
      }}
    />
  ),
}

export const ChipmateServerNarrow: Story = {
  name: "ChipMate Server — narrow",
  render: () => <ChipmateServerStory width="360px" />,
}

const aligned = {
  plugin: ["@kilocode/kilo-indexing"],
} as Config

function AlignedSettings(props: {
  tab?: string
  preview?: ChipmateServerTabProps["preview"]
  dirty?: boolean
  saving?: boolean
  canSave?: boolean
  error?: { message: string; details?: string }
  focus?: boolean
  hover?: boolean
  width?: string
  height?: string
  server?: string
  onClose?: () => void
}) {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    if (!props.focus) return
    requestAnimationFrame(() => {
      ref
        ?.querySelector<HTMLButtonElement>(
          `[data-ui="settings-nav-item"][data-value="${props.tab ?? "chipmateServer"}"]`,
        )
        ?.focus()
    })
  })
  return (
    <div ref={ref} style={{ width: props.width ?? "100vw", height: props.height ?? "100vh", overflow: "hidden" }}>
      <StoryProviders
        noPadding
        locale="zh"
        config={aligned}
        settings={{ [CHIPMATE_SERVER_KEY]: props.server ?? "http://127.0.0.1:6001" }}
        dirty={props.dirty}
        saving={props.saving}
        canSave={props.canSave}
        saveError={props.error ?? null}
      >
        <Settings
          tab={props.tab ?? "chipmateServer"}
          onClose={props.onClose ?? noop}
          chipmatePreview={props.preview}
          navPreview={props.hover ? "providers" : undefined}
        />
      </StoryProviders>
    </div>
  )
}

export const SettingsChipmateUpdateLatest: Story = {
  name: "设置更新 — 最新版本设计基准",
  render: () => (
    <AlignedSettings
      width="1440px"
      height="1024px"
      server="https://chipmate.internal:7443"
      preview={{
        result: { status: "success", code: "ok", skillsCount: 12 },
        update: {
          status: "latest",
          currentVersion: "1.0.9",
          checkedAt: Date.now(),
          target: "darwin-arm64",
        },
      }}
    />
  ),
}

export const SettingsChipmateUpdateAvailable: Story = {
  name: "设置更新 — 发现新版本设计基准",
  render: () => (
    <AlignedSettings
      width="1440px"
      height="1024px"
      server="https://chipmate.internal:7443"
      preview={{ result: { status: "success", code: "ok", skillsCount: 12 }, update: availableUpdate }}
    />
  ),
}

export const SettingsChipmateUpdateNotes: Story = {
  name: "设置更新 — 更新说明设计基准",
  render: () => (
    <AlignedSettings
      width="1440px"
      height="1024px"
      server="https://chipmate.internal:7443"
      preview={{
        result: { status: "success", code: "ok", skillsCount: 12 },
        update: availableUpdate,
        notesExpanded: true,
      }}
    />
  ),
}

export const SettingsChipmateUpdateMid: Story = {
  name: "设置更新 — 900 × 800",
  render: () => (
    <AlignedSettings
      width="900px"
      height="800px"
      server="https://chipmate.internal:7443"
      preview={{ result: { status: "success", code: "ok", skillsCount: 12 }, update: availableUpdate }}
    />
  ),
}

export const SettingsChipmateUpdateNarrow: Story = {
  name: "设置更新 — 480 × 900",
  render: () => (
    <AlignedSettings
      width="480px"
      height="900px"
      server="https://chipmate.internal:7443"
      preview={{ result: { status: "success", code: "ok", skillsCount: 12 }, update: availableUpdate }}
    />
  ),
}

export const SettingsChipmateUpdateLight: Story = {
  name: "设置更新 — 浅色",
  globals: { vscodeTheme: "light-modern" },
  render: () => (
    <AlignedSettings
      width="1440px"
      height="1024px"
      server="https://chipmate.internal:7443"
      preview={{ result: { status: "success", code: "ok", skillsCount: 12 }, update: availableUpdate }}
    />
  ),
}

export const SettingsChipmateUpdateContrast: Story = {
  name: "设置更新 — 高对比度",
  globals: { vscodeTheme: "hc-black" },
  render: () => (
    <AlignedSettings
      width="1440px"
      height="1024px"
      server="https://chipmate.internal:7443"
      preview={{ result: { status: "success", code: "ok", skillsCount: 12 }, update: availableUpdate }}
    />
  ),
}

export const SettingsAlignedDesktop: Story = {
  name: "Settings 对齐 — 桌面深色成功并待保存",
  render: () => (
    <AlignedSettings
      width="1450px"
      height="1086px"
      dirty
      preview={{ result: { status: "success", code: "ok", skillsCount: 12 } }}
    />
  ),
}

export const SettingsTitaniumModels: Story = {
  name: "Titanium Studio — 模型设置基准",
  render: () => <AlignedSettings tab="models" width="1200px" height="900px" />,
}

export const SettingsTitaniumResponsive: Story = {
  name: "Titanium Studio — 设置响应式基准",
  render: () => <AlignedSettings tab="models" width="100vw" height="100vh" />,
}

function SettingsCloseStory() {
  const [count, setCount] = createSignal(0)
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <AlignedSettings tab="models" onClose={() => setCount((value) => value + 1)} />
      <output data-ui="settings-close-result" hidden>
        {count()}
      </output>
    </div>
  )
}

export const SettingsCloseInteraction: Story = {
  name: "Titanium Studio — 设置关闭交互",
  render: () => <SettingsCloseStory />,
}

export const TitaniumStudioReview: Story = {
  name: "Titanium Studio — QA 与设置并排审查",
  render: () => (
    <StoryProviders noPadding locale="zh" config={aligned}>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "minmax(360px, 0.84fr) minmax(720px, 1.6fr)",
          width: "1450px",
          height: "900px",
          overflow: "hidden",
          background: "#0d141b",
        }}
      >
        <div style={{ display: "flex", "min-width": "0", "border-right": "1px solid #344754" }}>
          <ChatView />
        </div>
        <Settings tab="models" onClose={noop} />
      </div>
    </StoryProviders>
  ),
}

export const TitaniumStudioLightReview: Story = {
  name: "Titanium Studio — 浅色 QA 与索引设置并排审查",
  globals: { vscodeTheme: "light-modern" },
  render: () => (
    <StoryProviders noPadding locale="zh" config={aligned}>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "minmax(360px, 0.84fr) minmax(720px, 1.6fr)",
          width: "1450px",
          height: "900px",
          overflow: "hidden",
          background: "var(--vscode-editor-background)",
        }}
      >
        <div
          style={{
            display: "flex",
            "min-width": "0",
            "border-right": "1px solid var(--vscode-panel-border, var(--vscode-widget-border))",
          }}
        >
          <ChatView />
        </div>
        <Settings tab="indexing" onClose={noop} />
      </div>
    </StoryProviders>
  ),
}

export const SettingsAlignedHover: Story = {
  name: "Settings 对齐 — 导航 Hover",
  render: () => <AlignedSettings dirty hover />,
}

export const SettingsAlignedFocus: Story = {
  name: "Settings 对齐 — 导航 Focus",
  render: () => <AlignedSettings dirty focus />,
}

export const SettingsAlignedTesting: Story = {
  name: "Settings 对齐 — 连接测试中",
  render: () => <AlignedSettings dirty preview={{ testing: true }} />,
}

export const SettingsAlignedWarning: Story = {
  name: "Settings 对齐 — 能力警告",
  render: () => (
    <AlignedSettings
      dirty
      preview={{ result: { status: "warning", code: "degraded", missing: ["soffice"], warnings: [] } }}
    />
  ),
}

export const SettingsAlignedError: Story = {
  name: "Settings 对齐 — 连接失败",
  render: () => (
    <AlignedSettings dirty preview={{ result: { status: "error", code: "network", message: "unreachable" } }} />
  ),
}

export const SettingsAlignedSaveFailed: Story = {
  name: "Settings 对齐 — 保存失败",
  render: () => (
    <AlignedSettings dirty error={{ message: "无法保存设置", details: "当前配置文件不可写，请检查文件权限后重试。" }} />
  ),
}

export const SettingsAlignedSaving: Story = {
  name: "Settings 对齐 — 保存中",
  render: () => <AlignedSettings dirty saving preview={{ result: { status: "success", code: "ok" } }} />,
}

export const SettingsAlignedMid: Story = {
  name: "Settings 对齐 — 900 × 800",
  render: () => (
    <AlignedSettings width="900px" height="800px" dirty preview={{ result: { status: "success", code: "ok" } }} />
  ),
}

export const SettingsAlignedNarrow: Story = {
  name: "Settings 对齐 — 480 × 900",
  render: () => (
    <AlignedSettings width="480px" height="900px" dirty preview={{ result: { status: "success", code: "ok" } }} />
  ),
}

export const SettingsAlignedLight: Story = {
  name: "Settings 对齐 — 浅色",
  globals: { vscodeTheme: "light-modern" },
  render: () => (
    <AlignedSettings width="1450px" height="1086px" dirty preview={{ result: { status: "success", code: "ok" } }} />
  ),
}

export const SettingsAlignedContrast: Story = {
  name: "Settings 对齐 — 高对比度",
  globals: { vscodeTheme: "hc-black" },
  render: () => (
    <AlignedSettings width="1450px" height="1086px" dirty preview={{ result: { status: "success", code: "ok" } }} />
  ),
}

export const SettingsAlignedZoom80: Story = {
  name: "Settings 对齐 — 缩放 80%",
  render: () => <AlignedSettings width="1813px" height="1358px" dirty />,
}

export const SettingsAlignedZoom125: Story = {
  name: "Settings 对齐 — 缩放 125%",
  render: () => <AlignedSettings width="1160px" height="869px" dirty />,
}

export const SettingsAlignedZoom150: Story = {
  name: "Settings 对齐 — 缩放 150%",
  render: () => <AlignedSettings width="967px" height="724px" dirty />,
}

export const AutoApproveBashOnly: Story = {
  name: "AutoApproveTab — Bash-only config defaults",
  render: () => (
    <StoryProviders config={{ permission: { bash: { "*": "ask", "git status *": "allow" } } } as any}>
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <AutoApproveTab />
      </div>
    </StoryProviders>
  ),
}

export const SandboxingPanel: Story = {
  name: "Settings — sandboxing controls",
  render: () => (
    <StoryProviders config={{ sandbox: { network: "deny" } }} features={{ sandboxControls: true }}>
      <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
        <Settings tab="sandboxing" />
      </div>
    </StoryProviders>
  ),
}

export const SandboxingAllowlist: Story = {
  name: "Settings — sandboxing with network destinations",
  render: () => (
    <StoryProviders
      config={{
        sandbox: {
          enabled: true,
          network: "deny",
          allowed_hosts: ["github.com:443", "api.github.com:443"],
          writable_paths: ["~/shared-output"],
        },
      }}
      features={{ sandboxControls: true }}
    >
      <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
        <Settings tab="sandboxing" />
      </div>
    </StoryProviders>
  ),
}

export const ProvidersConfigure: Story = {
  name: "ProvidersTab — no providers configured",
  render: () => (
    <StoryProviders>
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <ProvidersTab />
      </div>
    </StoryProviders>
  ),
}

/** Opens the Disabled Providers collapsible on mount so the expanded list has coverage. */
function OpenDisabledProviders() {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      ref?.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')?.click()
    })
  })
  return (
    <div ref={ref} style={{ "max-height": "700px", overflow: "auto" }}>
      <ProvidersTab />
    </div>
  )
}

export const ProvidersDisabledExpanded: Story = {
  name: "ProvidersTab — disabled providers expanded",
  render: () => (
    <StoryProviders config={{ disabled_providers: ["openai", "anthropic"] } as any}>
      <OpenDisabledProviders />
    </StoryProviders>
  ),
}

export const ModelsAutocompleteOpen: Story = {
  name: "ModelsTab — autocomplete model picker open",
  render: () => (
    <StoryProviders config={{} as any}>
      <OpenModelPicker>
        <ModelsTab />
      </OpenModelPicker>
    </StoryProviders>
  ),
}

export const ModelsAccessibleLabels: Story = {
  name: "ModelsTab — accessible model labels",
  render: () => (
    <StoryProviders config={{} as any}>
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <ModelsTab />
      </div>
    </StoryProviders>
  ),
}

export const ModelsSpeechToText: Story = {
  name: "ModelsTab — speech-to-text model",
  render: () => (
    <StoryProviders kiloAuth config={{ experimental: { speech_to_text_model: "google/chirp-3" } } as any}>
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <ModelsTab />
      </div>
    </StoryProviders>
  ),
}

function OpenModelPicker(props: { children: any }) {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      ref?.querySelector<HTMLButtonElement>('button[title="mistralai/codestral-2508"]')?.click()
    })
  })
  return (
    <div ref={ref} style={{ "max-height": "700px", overflow: "auto" }}>
      {props.children}
    </div>
  )
}

const work: WorkStyleContextValue = {
  style: () => "unset",
  loading: () => false,
  applying: () => false,
  shouldShowOnboarding: () => true,
  apply: noop,
}

function WorkStyleOnboarding() {
  return (
    <StoryProviders noPadding>
      <WorkStyleContext.Provider value={work}>
        <div style={{ height: "700px", overflow: "auto" }}>
          <SidebarEmptyState />
        </div>
      </WorkStyleContext.Provider>
    </StoryProviders>
  )
}

export const WorkStyleOnboardingDefault: Story = {
  name: "Work style onboarding — default width",
  render: () => <WorkStyleOnboarding />,
}

export const WorkStyleOnboarding200: Story = {
  name: "Work style onboarding — narrow width",
  render: () => <WorkStyleOnboarding />,
}

export const AgentBehaviourAgents: Story = {
  name: "AgentBehaviourTab — available agents list",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "agents-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeAgent: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="agents-story" status="idle">
        <SessionContext.Provider value={session as any}>
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <AgentBehaviourTab />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const AgentBehaviourEditCustomMode: Story = {
  name: "AgentBehaviourTab — edit custom mode",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "edit-mode-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeAgent: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    const cfg: Record<string, AgentConfig> = {
      reviewer: {
        description: "Review code for quality and best practices",
        prompt: "You are a code reviewer. Focus on code quality, best practices, and potential bugs.",
        model: "kilo/anthropic/claude-sonnet-4-6",
        variant: "high",
        temperature: 0.3,
        permission: {
          read: "allow",
          grep: "allow",
          glob: "allow",
          edit: "deny",
          bash: "deny",
          task: "ask",
        },
      },
    }
    return (
      <StoryProviders sessionID="edit-mode-story" status="idle" config={{ agent: cfg } as any}>
        <SessionContext.Provider value={session as any}>
          <EditModeWrapper />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

/**
 * Renders AgentBehaviourTab and clicks into the "reviewer" custom mode's
 * edit view on mount. Uses requestAnimationFrame to ensure the DOM is
 * fully rendered before querying for the list item.
 */
function EditModeWrapper() {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      if (!ref) return
      const items = Array.from(ref.querySelectorAll<HTMLDivElement>("[style*='cursor: pointer']"))
      for (const item of items) {
        if (item.textContent?.includes("reviewer")) {
          item.click()
          return
        }
      }
    })
  })
  return (
    <div ref={ref} style={{ height: "700px", overflow: "auto" }}>
      <AgentBehaviourTab />
    </div>
  )
}

/** Clicks the given subtab button on mount. */
function SubtabWrapper(props: { tab: string }) {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    requestAnimationFrame(() => {
      if (!ref) return
      const buttons = Array.from(ref.querySelectorAll<HTMLButtonElement>("button"))
      for (const btn of buttons) {
        if (btn.textContent?.toLowerCase().includes(props.tab.toLowerCase())) {
          btn.click()
          return
        }
      }
    })
  })
  return (
    <div ref={ref} style={{ height: "700px", overflow: "auto" }}>
      <AgentBehaviourTab />
    </div>
  )
}

const MOCK_COMMANDS: Record<string, CommandConfig> = {
  review: {
    template: "Review the changes in the current branch and provide feedback on code quality.",
    description: "Run a code review on the current branch",
  },
  deploy: {
    template: "Build and deploy the application to the staging environment.",
    description: "Deploy to staging",
  },
  test: {
    template: "Run the full test suite and report any failures.",
  },
}

export const AgentBehaviourWorkflows: Story = {
  name: "AgentBehaviourTab — workflows with commands",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "workflows-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeAgent: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="workflows-story" status="idle" config={{ command: MOCK_COMMANDS } as any}>
        <SessionContext.Provider value={session as any}>
          <SubtabWrapper tab="workflows" />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const AgentBehaviourWorkflowsEmpty: Story = {
  name: "AgentBehaviourTab — workflows empty state",
  render: () => {
    const session = {
      ...mockSessionValue({ id: "workflows-empty-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeAgent: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="workflows-empty-story" status="idle">
        <SessionContext.Provider value={session as any}>
          <SubtabWrapper tab="workflows" />
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const McpEditViewLocal: Story = {
  name: "McpEditView — local server (stdio)",
  render: () => (
    <StoryProviders
      config={
        {
          mcp: {
            filesystem: {
              type: "local",
              command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
            },
          },
        } as any
      }
    >
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <McpEditView name="filesystem" onBack={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

export const McpEditViewLocalWithEnv: Story = {
  name: "McpEditView — local server with env vars",
  render: () => (
    <StoryProviders
      config={
        {
          mcp: {
            "my-mcp": {
              type: "local",
              command: ["node", "dist/index.js"],
              environment: { API_KEY: "sk-abc123", NODE_ENV: "production" },
            },
          },
        } as any
      }
    >
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <McpEditView name="my-mcp" onBack={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

export const McpEditViewRemote: Story = {
  name: "McpEditView — remote server (SSE)",
  render: () => (
    <StoryProviders
      config={
        {
          mcp: {
            "remote-mcp": {
              type: "remote",
              url: "https://mcp.example.com/sse",
            },
          },
        } as any
      }
    >
      <div style={{ "max-height": "700px", overflow: "auto" }}>
        <McpEditView name="remote-mcp" onBack={noop} onRemove={noop} />
      </div>
    </StoryProviders>
  ),
}

export const ModeEditExport: Story = {
  name: "ModeEditView — export button",
  render: () => {
    const cfg: Record<string, AgentConfig> = {
      reviewer: {
        description: "Review code for quality and best practices",
        prompt: "You are a code reviewer. Focus on code quality, best practices, and potential bugs.",
        model: "anthropic/claude-sonnet-4-20250514",
        temperature: 0.3,
      },
    }
    const session = {
      ...mockSessionValue({ id: "export-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeAgent: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders sessionID="export-story" status="idle" config={{ agent: cfg } as any}>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "420px", height: "700px", overflow: "auto" }}>
            <ModeEditView name="reviewer" onBack={noop} onRemove={noop} />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const ModeEditPermissions: Story = {
  name: "ModeEditView — per-agent permissions",
  render: () => {
    const cfg: Record<string, AgentConfig> = {
      reviewer: {
        description: "Review code without editing it",
        prompt: "Find bugs, regressions, and missing tests.",
        permission: {
          "*": "deny",
          read: "allow",
          grep: "allow",
          glob: "allow",
          edit: { "*": "deny", "**/*.md": "allow" },
          bash: "deny",
          task: "ask",
          skill: "deny",
        },
      },
    }
    const session = {
      ...mockSessionValue({ id: "permissions-story", status: "idle" }),
      agents: () => MOCK_AGENTS,
      allAgents: () => MOCK_AGENTS,
      removeAgent: noop,
      removeMcp: noop,
      skills: () => [],
      refreshSkills: noop,
      removeSkill: noop,
    }
    return (
      <StoryProviders
        sessionID="permissions-story"
        status="idle"
        config={{ permission: { bash: "ask", external_directory: "ask" }, agent: cfg } as any}
      >
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "460px", height: "760px", overflow: "auto" }}>
            <ModeEditView name="reviewer" onBack={noop} onRemove={noop} />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const IndexingProviderBlurRace: Story = {
  name: "IndexingTab",
  render: () => {
    const [saved, setSaved] = createSignal<Record<string, unknown>>({})
    const cfg: Config = {
      indexing: {
        provider: "openai-compatible",
        model: "qwen3-embedding-8b",
        dimension: 2048,
        "openai-compatible": { apiKey: "" },
        gemini: { apiKey: "" },
      },
    }
    return (
      <>
        <StoryProviders
          config={cfg}
          onConfigChange={(next: Config) => setSaved((next.indexing ?? {}) as Record<string, unknown>)}
        >
          <div style={{ width: "420px", "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </StoryProviders>
        <pre data-testid="indexing-provider-save">{JSON.stringify(saved(), null, 2)}</pre>
      </>
    )
  },
}

export const IndexingSimplifiedChinese: Story = {
  name: "IndexingTab - Simplified Chinese",
  render: () => {
    const cfg: Config = {
      indexing: {
        enabled: true,
        provider: "openai-compatible",
        model: "qwen3-embedding-8b",
        dimension: 2048,
        vectorStore: "lancedb",
        documents: {
          enabled: true,
          paths: ["docs"],
          include: ["**/*.pdf", "**/*.md"],
        },
      },
    }
    return (
      <StoryProviders config={cfg} locale="zh">
        <div style={{ width: "460px", "max-height": "900px", overflow: "auto" }}>
          <IndexingTab />
        </div>
      </StoryProviders>
    )
  },
}

export const IndexingScopeSwitch: Story = {
  name: "IndexingTab - global and local scopes",
  render: () => {
    const [global, setGlobal] = createSignal<Record<string, unknown>>({})
    const [project, setProject] = createSignal<Record<string, unknown>>({})
    const globalConfig: Config = {
      indexing: {
        enabled: true,
        provider: "openai",
        model: "text-embedding-3-large",
        dimension: 3072,
        vectorStore: "qdrant",
        openai: { apiKey: "global-secret" },
        qdrant: { url: "http://global:6333", apiKey: "global-qdrant" },
        searchMinScore: 0.4,
      },
    }
    const projectConfig: Config = {
      indexing: {
        model: null,
        qdrant: { apiKey: "project-qdrant" },
      },
    }
    return (
      <>
        <StoryProviders
          config={globalConfig}
          globalConfig={globalConfig}
          projectConfig={projectConfig}
          onGlobalConfigChange={(next) => setGlobal((next.indexing ?? {}) as Record<string, unknown>)}
          onProjectConfigChange={(next) => setProject((next.indexing ?? {}) as Record<string, unknown>)}
        >
          <div style={{ width: "420px", "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </StoryProviders>
        <pre data-testid="indexing-global-save">{JSON.stringify(global(), null, 2)}</pre>
        <pre data-testid="indexing-project-save">{JSON.stringify(project(), null, 2)}</pre>
      </>
    )
  },
}

export const IndexingKiloModelPreset: Story = {
  name: "IndexingTab - Kilo stale custom model fallback",
  render: () => {
    const cfg: Config = {
      indexing: {
        provider: "kilo",
        model: "custom/model",
        dimension: 2048,
      },
    }
    const catalog = {
      defaultModel: "provider/model",
      models: [
        { id: "provider/model", name: "Provider Model", dimension: 1024, scoreThreshold: 0.4 },
        { id: "provider/compact", name: "Provider Compact", dimension: 512, scoreThreshold: 0.35 },
      ],
      aliases: {},
    }
    return (
      <StoryProviders config={cfg}>
        <KiloEmbeddingModelsContext.Provider value={{ catalog: () => catalog }}>
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </KiloEmbeddingModelsContext.Provider>
      </StoryProviders>
    )
  },
}

export const IndexingKiloCatalogLoading: Story = {
  name: "IndexingTab - Kilo catalog loading",
  render: () => {
    const [saved, setSaved] = createSignal<Record<string, unknown>>({})
    const cfg: Config = {
      indexing: {},
    }
    return (
      <>
        <StoryProviders
          config={cfg}
          kiloAuth
          onConfigChange={(next: Config) => setSaved((next.indexing ?? {}) as Record<string, unknown>)}
        >
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </StoryProviders>
        <pre data-testid="indexing-kilo-loading-save">{JSON.stringify(saved(), null, 2)}</pre>
      </>
    )
  },
}
