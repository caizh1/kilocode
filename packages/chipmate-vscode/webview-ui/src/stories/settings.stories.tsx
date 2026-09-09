/** @jsxImportSource solid-js */
/**
 * Stories for Settings and ProvidersTab components.
 */

import { onMount, createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { SessionContext } from "../context/session"
import { ChipMateEmbeddingModelsContext } from "../context/chipmate-embedding-models"
import Settings from "../components/settings/Settings"
import ProvidersTab from "../components/settings/ProvidersTab"
import ModelsTab from "../components/settings/ModelsTab"
import AgentBehaviourTab from "../components/settings/AgentBehaviourTab"
import AutoApproveTab from "../components/settings/AutoApproveTab"
import ModeEditView from "../components/settings/ModeEditView"
import McpEditView from "../components/settings/McpEditView"
import type { AgentConfig, CommandConfig, Config, Provider } from "../types/messages"
import IndexingTab from "../components/settings/IndexingTab"
import ChipmateServerTab, { type ChipmateServerTabProps } from "../components/settings/ChipmateServerTab"
import { CHIPMATE_SERVER_KEY } from "../../../src/shared/chipmate-server"
import { ChatView } from "../components/chat/ChatView"
import { SidebarEmptyState } from "../components/chat/SidebarEmptyState"
import { WorkStyleContext, type WorkStyleContextValue } from "../context/work-style"
import { useDialog } from "@chipmate/chipmate-ui/context/dialog"
import CustomProviderDialog from "../components/settings/CustomProviderDialog"
import type { InternalOfflineProviderDefaults } from "../../../src/shared/internal-offline"
import { QWEN_FIM_MODEL_ID } from "../../../src/shared/qwen-autocomplete"
import PatentRadarProgressDialog from "../components/settings/PatentRadarProgressDialog"
import { PatentRadarTaskStrip } from "../components/settings/PatentCenterTab"
import type { PatentRadarRun } from "../../../src/patent-radar/types"

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

function OpenCustomProviderDialog(props: {
  defaults?: InternalOfflineProviderDefaults
  setupMode?: "primary" | "additional"
}) {
  const dialog = useDialog()
  onMount(() =>
    dialog.show(() => <CustomProviderDialog defaults={props.defaults} setupMode={props.setupMode ?? "primary"} />),
  )
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

function ChipmateServerStory(props: ChipmateServerTabProps & { width?: string; locale?: "en" | "zh" }) {
  return (
    <StoryProviders config={{} as Config} locale={props.locale}>
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

const failedUpdate = {
  status: "error" as const,
  code: "availability",
  message: "暂时无法连接 ChipMate Server，请检查网络后重试。Bearer sk-provider-secret token=private",
  retryable: true,
}

export const ChipmateUpdateError: Story = {
  name: "ChipMate 更新 — 检查失败",
  render: () => (
    <ChipmateServerStory
      locale="zh"
      preview={{
        update: failedUpdate,
      }}
    />
  ),
}

export const ChipmateServerNarrow: Story = {
  name: "ChipMate Server — narrow",
  render: () => <ChipmateServerStory width="360px" />,
}

const aligned = {
  plugin: ["@chipmate/chipmate-indexing"],
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
  settings?: Record<string, unknown>
  providers?: Record<string, Provider>
  connected?: string[]
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
        settings={{ [CHIPMATE_SERVER_KEY]: props.server ?? "http://127.0.0.1:6001", ...props.settings }}
        providers={props.providers}
        connected={props.connected}
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

const patentProviders = {
  chipmate: {
    id: "chipmate",
    name: "ChipMate",
    env: [],
    models: {
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "deepseek-v4-flash",
        limit: { context: 128000, output: 8192 },
      },
    },
  },
} as unknown as Record<string, Provider>

export const SettingsPatentCenter: Story = {
  name: "设置 — 专利中心",
  render: () => (
    <AlignedSettings
      tab="patentCenter"
      width="1440px"
      height="1024px"
      settings={{
        "patentRadar.serverBaseUrl": "https://patent.internal:6020",
        "patentRadar.enabled": true,
        "patentRadar.scheduleDays": 7,
        "patentRadar.analysisModel": { providerID: "chipmate", modelID: "deepseek-v4-flash" },
        "patentRadar.uploadFullSnapshot": false,
      }}
      providers={patentProviders}
      connected={["chipmate"]}
    />
  ),
}

export const SettingsPatentCenterNarrow: Story = {
  name: "设置 — 专利中心窄屏",
  render: () => (
    <AlignedSettings
      tab="patentCenter"
      width="480px"
      height="900px"
      settings={{
        "patentRadar.serverBaseUrl": "https://patent.internal:6020",
        "patentRadar.enabled": true,
        "patentRadar.scheduleDays": 7,
        "patentRadar.analysisModel": { providerID: "chipmate", modelID: "deepseek-v4-flash" },
      }}
      providers={patentProviders}
      connected={["chipmate"]}
    />
  ),
}

const patentRun: PatentRadarRun = {
  schemaVersion: 2,
  methodVersion: "2.1.0",
  id: "patent-story-run",
  workspace: "/workspace/embedded-controller",
  scope: { kind: "workspace" },
  scopeFingerprint: "workspace-fingerprint",
  scopeCoverage: null,
  sourceFingerprint: "source-fingerprint",
  createdAt: "2026-09-01T01:30:00.000Z",
  updatedAt: "2026-09-01T01:48:42.000Z",
  status: "SCANNING",
  cutoffDate: "2026-09-01",
  corpus: null,
  coverage: {
    supportedFiles: 214,
    analyzedFiles: 208,
    skippedFiles: 6,
    codeEvidence: 936,
    documentEvidence: 42,
    relations: 381,
    compileCommands: "available",
    completeWorkspaceScan: false,
  },
  relations: [],
  candidates: [
    {
      id: "candidate-37",
      title: "基于环形缓冲区水位的自适应中断采样控制",
      technicalProblem: "根据中断采集负载与缓冲区水位，动态调整采样与功耗控制策略。",
      implementation: "根据缓冲区水位切换中断采样状态。",
      technicalEffect: "减少空闲唤醒并保持数据连续。",
      features: [
        { id: "F1", text: "依据缓冲区水位选择采样状态", necessary: true },
        { id: "F2", text: "在中断入口原子切换状态", necessary: true },
        { id: "F3", text: "联动功耗控制策略调整采样频率", necessary: true },
      ],
      evidenceIds: ["E1", "E2", "E3", "E4", "E5", "E6"],
      discoveryTier: "technical-candidate",
      origin: "cross-file",
      relationIds: ["R1", "R2"],
      coreSourceFiles: ["src/irq.c", "src/ring_buffer.c", "src/power_control.c"],
      supportingSourceFiles: [],
      effectEvidenceLevel: "implemented",
      groundingStatus: "verified",
    },
  ],
  sources: [],
  assessments: [],
  reviews: {},
  warnings: [],
  failure: null,
  progress: {
    phase: "bridge-discovery",
    completedUnits: 110,
    totalUnits: 128,
    failedUnits: 0,
    startedAt: new Date(Date.now() - (60 * 60 + 46 * 60 + 51) * 1000).toISOString(),
    lastActivityAt: new Date().toISOString(),
    events: [
      {
        id: "1",
        at: new Date(Date.now() - 18 * 60_000).toISOString(),
        phase: "workspace-scan",
        message: "工作区证据提取完成，开始分批分析候选。",
      },
      {
        id: "2",
        at: new Date(Date.now() - 12 * 60_000).toISOString(),
        phase: "relation-building",
        message: "确定性关系图已建立，共 381 条关系。",
        batchIndex: 24,
        totalBatches: 128,
      },
      {
        id: "3",
        at: new Date().toISOString(),
        phase: "bridge-discovery",
        message: "正在发现跨文件组合",
        batchIndex: 110,
        totalBatches: 128,
      },
    ],
  },
}

function OpenPatentRadarProgress() {
  const dialog = useDialog()
  onMount(() =>
    dialog.show(() => (
      <PatentRadarProgressDialog
        run={() => patentRun}
        loading={() => false}
        cancelling={() => false}
        error={() => undefined}
        model={() => "chipmate / deepseek-v4-flash"}
        onCancel={noop}
        onRestart={noop}
        onRetry={noop}
        onOpenCandidates={noop}
      />
    )),
  )
  return <div style={{ width: "100%", height: "100%" }} />
}

export const PatentRadarProgress: Story = {
  name: "专利中心 — 扫描进度弹窗",
  render: () => (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <StoryProviders noPadding locale="zh">
        <OpenPatentRadarProgress />
      </StoryProviders>
    </div>
  ),
}

export const PatentRadarCollapsed: Story = {
  name: "专利中心 — 后台任务条",
  render: () => (
    <StoryProviders locale="zh">
      <div class="settings-shell" style={{ width: "900px", padding: "32px" }}>
        <PatentRadarTaskStrip run={patentRun} onOpen={noop} />
      </div>
    </StoryProviders>
  ),
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

export const SettingsChipmateUpdateError: Story = {
  name: "设置更新 — 失败详情响应式基准",
  render: () => <AlignedSettings server="https://chipmate.internal:7443" preview={{ update: failedUpdate }} />,
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

const internalPrimaryConfig = {
  chipmate: {
    name: "ChipMate",
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: customDefaults.baseURL },
    models: { [customDefaults.modelID]: { name: customDefaults.modelID, reasoning: true } },
  },
} as const

const internalProviderConfig = {
  ...internalPrimaryConfig,
  lab: {
    name: "Internal Lab",
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: "https://lab.example.com/v1" },
    models: { "lab-chat": { name: "Lab Chat" } },
  },
} as const

const internalPrimaryProviders: Record<string, Provider> = {
  chipmate: {
    id: "chipmate",
    name: "ChipMate",
    source: "config",
    env: [],
    models: { [customDefaults.modelID]: { id: customDefaults.modelID, name: customDefaults.modelID } },
  },
}

const internalProviders: Record<string, Provider> = {
  ...internalPrimaryProviders,
  lab: {
    id: "lab",
    name: "Internal Lab",
    source: "config",
    env: [],
    models: { "lab-chat": { id: "lab-chat", name: "Lab Chat" } },
  },
}

export const ProvidersInternalMultiple: Story = {
  name: "ProvidersTab — internal multiple custom providers",
  render: () => (
    <StoryProviders
      locale="zh"
      config={{ provider: internalProviderConfig } as Config}
      providers={internalProviders}
      connected={["chipmate", "lab"]}
    >
      <div style={{ "max-height": "760px", overflow: "auto" }}>
        <ProvidersTab internal internalDefaults={customDefaults} />
      </div>
    </StoryProviders>
  ),
}

export const ProvidersInternalPrimaryOnly: Story = {
  name: "ProvidersTab — internal connected ChipMate only",
  render: () => (
    <StoryProviders
      locale="zh"
      chipmateAuth
      config={{ provider: internalPrimaryConfig } as Config}
      providers={internalPrimaryProviders}
      connected={["chipmate"]}
    >
      <div style={{ "max-height": "760px", overflow: "auto" }}>
        <ProvidersTab internal internalDefaults={customDefaults} />
      </div>
    </StoryProviders>
  ),
}

export const ProvidersInternalPrimaryUnconnected: Story = {
  name: "ProvidersTab — internal unconnected ChipMate configuration",
  render: () => (
    <StoryProviders
      locale="zh"
      config={{ provider: internalPrimaryConfig } as Config}
      providers={internalPrimaryProviders}
      connected={[]}
    >
      <div style={{ "max-height": "760px", overflow: "auto" }}>
        <ProvidersTab internal internalDefaults={customDefaults} />
      </div>
    </StoryProviders>
  ),
}

export const ProvidersGatewayConnected: Story = {
  name: "ProvidersTab — public ChipMate Gateway connected",
  render: () => (
    <StoryProviders locale="zh" chipmateAuth connected={["chipmate"]}>
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
    <StoryProviders chipmateAuth config={{ experimental: { speech_to_text_model: "google/chirp-3" } } as any}>
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
        model: "chipmate/anthropic/claude-sonnet-4-6",
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
        dimension: 4096,
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
        dimension: 4096,
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

export const IndexingChipMateModelPreset: Story = {
  name: "IndexingTab - ChipMate stale custom model fallback",
  render: () => {
    const cfg: Config = {
      indexing: {
        provider: "chipmate",
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
        <ChipMateEmbeddingModelsContext.Provider value={{ catalog: () => catalog }}>
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </ChipMateEmbeddingModelsContext.Provider>
      </StoryProviders>
    )
  },
}

export const IndexingChipMateCatalogLoading: Story = {
  name: "IndexingTab - ChipMate catalog loading",
  render: () => {
    const [saved, setSaved] = createSignal<Record<string, unknown>>({})
    const cfg: Config = {
      indexing: {},
    }
    return (
      <>
        <StoryProviders
          config={cfg}
          chipmateAuth
          onConfigChange={(next: Config) => setSaved((next.indexing ?? {}) as Record<string, unknown>)}
        >
          <div style={{ "max-height": "700px", overflow: "auto" }}>
            <IndexingTab />
          </div>
        </StoryProviders>
        <pre data-testid="indexing-chipmate-loading-save">{JSON.stringify(saved(), null, 2)}</pre>
      </>
    )
  },
}
