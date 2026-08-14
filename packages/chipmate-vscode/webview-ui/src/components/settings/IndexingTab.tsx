import { Component, For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@chipmate/chipmate-ui/button"
import { Card } from "@chipmate/chipmate-ui/card"
import { DEFAULT_VECTOR_STORE, isFileExtension, parseFileExtensions } from "@chipmate/chipmate-indexing/config"
import { formatChipMateEmbeddingModelLabel, getChipMateEmbeddingModel } from "@chipmate/chipmate-indexing/embedding-models"
import { Select } from "@chipmate/chipmate-ui/select"
import { Switch } from "@chipmate/chipmate-ui/switch"
import { TextField } from "@chipmate/chipmate-ui/text-field"
import { useConfig } from "../../context/config"
import {
  formatIndexingDiagnostic,
  formatIndexingDiagnostics,
  formatIndexingLabel,
  formatIndexingPipelineLabel,
  hasIndexingDiagnostics,
  indexingDiagnosticMessage,
  indexingPipelineDescription,
  indexingPipelineTone,
  localizeIndexingText,
  useIndexing,
} from "../../context/indexing"
import { useChipMateEmbeddingModels } from "../../context/chipmate-embedding-models"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import type { IndexingConfig, IndexingPipelineStatus, IndexingProvider as ProviderId } from "../../types/messages"
import { CHIPMATE_PROVIDER_ID } from "../../../../src/shared/provider-model"
import { INTERNAL_OFFLINE_INDEXING_DEFAULTS, isInternalOfflineBuild } from "../../../../src/shared/internal-offline"
import {
  applyInternalIndexingDefaults,
  materializeInternalIndexingDefaultsForSave,
} from "../../utils/indexing-defaults"
import SettingsRow from "./SettingsRow"
import {
  documentRoots,
  extraRoots,
  indexingConfig,
  indexingDescription,
  indexingEnabled,
  indexingEnabledInherited,
  indexingInheritance,
  mergeExternalRoots,
  indexingSource,
  indexingUpdate,
  type IndexingScope,
  type IndexingSource,
} from "./indexing-tab-state"

type Option = { value: string; label: string }
type TuningKey = "searchMinScore" | "searchMaxResults" | "embeddingBatchSize" | "scannerMaxBatchRetries"
type DocumentNumberKey = "maxFileBytes" | "chunkChars" | "chunkOverlapChars" | "searchMaxResults"
type Translate = ReturnType<typeof useLanguage>["t"]

const allProviders: { value: ProviderId; label: string }[] = [
  { value: "chipmate", label: "ChipMate" },
  { value: "openai", label: "OpenAI" },
  { value: "ollama", label: "Ollama" },
  { value: "openai-compatible", label: "OpenAI-Compatible" },
  { value: "gemini", label: "Gemini" },
  { value: "mistral", label: "Mistral" },
  { value: "vercel-ai-gateway", label: "Vercel AI Gateway" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "voyage", label: "Voyage" },
]

const tuning: Array<{ key: TuningKey; label: string; placeholder: string }> = [
  { key: "searchMinScore", label: "settings.indexing.tuning.searchMinScore", placeholder: "0.4" },
  { key: "searchMaxResults", label: "settings.indexing.tuning.searchMaxResults", placeholder: "50" },
  { key: "embeddingBatchSize", label: "settings.indexing.tuning.embeddingBatchSize", placeholder: "60" },
  { key: "scannerMaxBatchRetries", label: "settings.indexing.tuning.scannerMaxBatchRetries", placeholder: "3" },
]

const PipelineBadge: Component<{ label: string; status: IndexingPipelineStatus; t: Translate }> = (props) => (
  <div style={{ display: "flex", "align-items": "center", gap: "8px", "justify-content": "flex-end" }}>
    <span class={`indexing-status-badge indexing-status-badge--${indexingPipelineTone(props.status)}`}>
      {formatIndexingPipelineLabel(props.label, props.status, props.t)}
    </span>
    <span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "var(--chipmate-font-size-12)" }}>
      {props.t("settings.indexing.pipeline.issues", {
        errors: props.status.errorCount,
        stale: props.status.staleCount,
        skipped: props.status.skippedCount,
      })}
    </span>
  </div>
)

const PipelineDiagnostics: Component<{
  label: string
  diagnosticLabel: string
  status: IndexingPipelineStatus
  copied: boolean
  onCopy: (label: string, status: IndexingPipelineStatus) => void
  t: Translate
}> = (props) => (
  <Show when={hasIndexingDiagnostics(props.status)}>
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "10px 12px",
        "border-top": "1px solid var(--vscode-settings-rowBorder)",
        color: "var(--vscode-descriptionForeground)",
        "font-size": "var(--chipmate-font-size-12)",
        "min-width": 0,
      }}
    >
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}>
        <strong style={{ color: "var(--vscode-foreground)" }}>
          {props.t("settings.indexing.pipeline.diagnostics", { name: props.label })}
        </strong>
        <Button
          variant="ghost"
          size="small"
          icon={props.copied ? "check" : "copy"}
          onClick={() => props.onCopy(props.diagnosticLabel, props.status)}
        >
          {props.copied ? props.t("ui.message.copied") : props.t("ui.message.copy")}
        </Button>
      </div>
      <Show when={(props.status.issueSummary?.length ?? 0) > 0}>
        <div
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "6px",
            "min-width": 0,
          }}
        >
          <For each={props.status.issueSummary ?? []}>
            {(summary) => (
              <span
                style={{
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "4px",
                  padding: "3px 7px",
                  "border-radius": "999px",
                  border: "1px solid color-mix(in srgb, var(--vscode-settings-rowBorder) 78%, transparent)",
                  background: "color-mix(in srgb, var(--vscode-editor-background) 72%, transparent)",
                  color: "var(--vscode-foreground)",
                }}
                title={summary.samples.map((sample) => `${sample.file ?? ""} ${sample.message}`.trim()).join("\n")}
              >
                <span>{summary.category}</span>
                <strong>{summary.count}</strong>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show
        when={(props.status.recentErrors?.length ?? 0) > 0}
        fallback={
          <div style={{ color: "var(--vscode-foreground)", "overflow-wrap": "anywhere" }}>
            {indexingPipelineDescription(props.status, props.t)}
          </div>
        }
      >
        <For each={props.status.recentErrors ?? []}>
          {(error) => (
            <div style={{ display: "flex", "flex-direction": "column", gap: "2px", "min-width": 0 }}>
              <span style={{ color: "var(--vscode-foreground)", "overflow-wrap": "anywhere" }}>
                {indexingDiagnosticMessage(error, props.status)}
              </span>
              <span style={{ "overflow-wrap": "anywhere" }}>{formatIndexingDiagnostic(error, props.status)}</span>
            </div>
          )}
        </For>
      </Show>
    </div>
  </Show>
)

function sourceLabel(source: IndexingSource, t: Translate) {
  if (source === "global") return t("settings.indexing.source.global")
  if (source === "local") return t("settings.indexing.source.local")
  if (source === "mixed") return t("settings.indexing.source.mixed")
  if (source === "default") return t("settings.indexing.source.default")
  return ""
}

function providerFields(
  provider: ProviderId | undefined,
): Array<{ key: string; label: string; placeholder: string; optional?: boolean }> {
  if (provider === "chipmate") return []
  if (provider === "openai") return [{ key: "apiKey", label: "settings.indexing.field.apiKey", placeholder: "sk-..." }]
  if (provider === "ollama") {
    return [{ key: "baseUrl", label: "settings.indexing.field.baseUrl", placeholder: "http://localhost:11434" }]
  }
  if (provider === "openai-compatible") {
    return [
      { key: "baseUrl", label: "settings.indexing.field.baseUrl", placeholder: "https://api.example.com/v1" },
      { key: "apiKey", label: "settings.indexing.field.apiKey", placeholder: "sk-...", optional: true },
    ]
  }
  if (provider === "gemini") return [{ key: "apiKey", label: "settings.indexing.field.apiKey", placeholder: "AI..." }]
  if (provider === "mistral") return [{ key: "apiKey", label: "settings.indexing.field.apiKey", placeholder: "..." }]
  if (provider === "vercel-ai-gateway") {
    return [{ key: "apiKey", label: "settings.indexing.field.apiKey", placeholder: "..." }]
  }
  if (provider === "bedrock") {
    return [
      { key: "region", label: "settings.indexing.field.awsRegion", placeholder: "us-east-1" },
      { key: "profile", label: "settings.indexing.field.awsProfile", placeholder: "default" },
    ]
  }
  if (provider === "openrouter") {
    return [
      { key: "apiKey", label: "settings.indexing.field.apiKey", placeholder: "sk-or-..." },
      {
        key: "specificProvider",
        label: "settings.indexing.field.specificProvider",
        placeholder: "settings.indexing.field.optional",
      },
    ]
  }
  if (provider === "voyage") return [{ key: "apiKey", label: "settings.indexing.field.apiKey", placeholder: "pa-..." }]
  return []
}

const IndexingTab: Component = () => {
  const { globalConfig, projectConfig, settings, updateGlobalConfig, updateProjectConfig, updateSetting } = useConfig()
  const indexing = useIndexing()
  const embeds = useChipMateEmbeddingModels()
  const language = useLanguage()
  const provider = useProvider()
  const server = useServer()
  const vscode = useVSCode()
  const [fieldDrafts, setFieldDrafts] = createSignal<Record<string, string>>({})
  const [providerDrafts, setProviderDrafts] = createSignal<Record<string, string>>({})
  const [storeDrafts, setStoreDrafts] = createSignal<Record<string, string>>({})
  const [tuningDrafts, setTuningDrafts] = createSignal<Record<string, string>>({})
  const [documentDrafts, setDocumentDrafts] = createSignal<Record<string, string>>({})
  const [copied, setCopied] = createSignal<string>()
  const [scope, setScope] = createSignal<IndexingScope>("project")
  let timer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  const globalCfg = createMemo<IndexingConfig>(() => globalConfig().indexing ?? {})
  const projectCfg = createMemo<IndexingConfig>(() => projectConfig().indexing ?? {})
  const raw = createMemo<IndexingConfig>(() => (scope() === "global" ? globalCfg() : projectCfg()))
  const base = createMemo<IndexingConfig>(() => indexingConfig(scope(), globalCfg(), projectCfg()))
  const cfg = createMemo<IndexingConfig>(() => applyInternalIndexingDefaults(base()))
  const enabled = createMemo(() =>
    isInternalOfflineBuild() && raw().enabled === undefined
      ? cfg().enabled === true
      : indexingEnabled(scope(), globalCfg(), projectCfg()),
  )
  const inherited = createMemo(() => indexingEnabledInherited(scope(), globalCfg(), projectCfg()))
  const inheritance = (paths: readonly (readonly string[])[]) =>
    indexingInheritance(scope(), globalCfg(), projectCfg(), paths)
  const tag = (current: IndexingScope, paths: readonly (readonly string[])[]) =>
    sourceLabel(indexingSource(current, globalCfg(), projectCfg(), paths), language.t) || undefined
  const description = (value: string, paths: readonly (readonly string[])[]) =>
    indexingDescription(value, inheritance(paths), language.t)
  const changeScope = (next: IndexingScope) => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    setScope(next)
  }

  const updateIndexingAt = (target: IndexingScope, partial: IndexingConfig) => {
    const current = indexingConfig(target, globalCfg(), projectCfg())
    const materialized = materializeInternalIndexingDefaultsForSave(current, partial)
    const patch = { indexing: indexingUpdate(target, globalCfg(), projectCfg(), materialized) }
    if (target === "global") {
      updateGlobalConfig(patch)
      return
    }
    updateProjectConfig(patch)
  }

  const updateIndexing = (partial: IndexingConfig) => updateIndexingAt(scope(), partial)

  const updateDocumentsAt = (target: IndexingScope, partial: NonNullable<IndexingConfig["documents"]>) => {
    const current = target === "global" ? globalCfg() : projectCfg()
    updateIndexingAt(target, { documents: { ...(current.documents ?? {}), ...partial } })
  }

  const updateDocuments = (partial: NonNullable<IndexingConfig["documents"]>) => {
    updateDocumentsAt(scope(), partial)
  }

  const copyDiagnostics = (label: string, status: IndexingPipelineStatus) => {
    if (label === "Documents" && status.diagnosticRunId) {
      vscode.postMessage({ type: "copyDocumentIndexingDiagnostics", runId: status.diagnosticRunId })
      return
    }
    navigator.clipboard
      .writeText(formatIndexingDiagnostics(label, status))
      .then(() => {
        setCopied(label)
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => setCopied(undefined), 1200)
      })
      .catch((err) => console.warn("failed to copy indexing diagnostics", err))
  }

  const vectorStore = () => cfg().vectorStore ?? DEFAULT_VECTOR_STORE
  const documents = () => cfg().documents ?? {}
  const extraPaths = () => extraRoots(documents().paths)
  const chipmateDefault = () =>
    getChipMateEmbeddingModel(embeds.catalog().defaultModel, embeds.catalog())?.id ?? embeds.catalog().defaultModel
  const chipmateModels = createMemo(() =>
    embeds.catalog().models.map((model) => ({
      value: model.id,
      label: formatChipMateEmbeddingModelLabel(model),
    })),
  )
  const knownChipMateModel = (model: string | null | undefined) =>
    getChipMateEmbeddingModel(model ?? undefined, embeds.catalog())?.id
  const chipmateValue = () => knownChipMateModel(cfg().model) ?? chipmateDefault()
  const chipmateAvailable = () => !!server.profileData() || provider.authStates()[CHIPMATE_PROVIDER_ID] !== undefined
  const selectedProvider = createMemo<ProviderId | undefined>(
    () => cfg().provider ?? (chipmateAvailable() ? "chipmate" : undefined),
  )
  const staleChipMateModel = () => selectedProvider() === "chipmate" && !!cfg().model && !knownChipMateModel(cfg().model)
  const providers = createMemo(() =>
    allProviders
      .filter((item) => item.value !== "chipmate" || chipmateAvailable() || selectedProvider() === "chipmate")
      .map((item) =>
        item.value === "ollama"
          ? { ...item, label: language.t("settings.indexing.provider.local", { name: item.label }) }
          : item,
      ),
  )
  const stores = createMemo<Option[]>(() => [
    { value: "lancedb", label: language.t("settings.indexing.store.default", { name: "LanceDB" }) },
    { value: "qdrant", label: "Qdrant" },
  ])
  const fields = createMemo(() => providerFields(selectedProvider()))

  const saveProvider = (next: ProviderId | undefined) => {
    if (next === cfg().provider) return
    if (next === "chipmate") {
      const model = knownChipMateModel(cfg().model) ?? (chipmateDefault() || null)
      updateIndexing({
        provider: next,
        model,
        dimension: null,
        dimensionMode: "auto",
      })
      return
    }
    updateIndexing({ provider: next, model: null, dimension: null, dimensionMode: "auto" })
  }

  const saveEnabled = (enabled: boolean) => {
    if (enabled && !cfg().provider && chipmateAvailable()) {
      updateIndexing({
        enabled,
        provider: "chipmate",
        model: knownChipMateModel(cfg().model) ?? (chipmateDefault() || null),
        dimension: null,
        dimensionMode: "auto",
      })
      return
    }
    updateIndexing({ enabled })
  }

  const fieldValue = (key: "model" | "dimension", fallback: string) => fieldDrafts()[`${scope()}.${key}`] ?? fallback

  const stageField = (key: "model" | "dimension", value: string) => {
    setFieldDrafts((prev) => ({ ...prev, [`${scope()}.${key}`]: value }))
  }

  const clearField = (key: "model" | "dimension") => {
    const id = `${scope()}.${key}`
    setFieldDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([entry]) => entry !== id)))
  }

  const saveModel = (value: string) => {
    if (selectedProvider() === "chipmate") return
    const trimmed = value.trim()
    updateIndexing({ model: trimmed || null, dimension: null, dimensionMode: "auto" })
    clearField("model")
  }

  const providerValue = (group: string, key: string) => {
    const draftKey = `${scope()}.${group}.${key}`
    const draft = providerDrafts()[draftKey]
    if (draft !== undefined) return draft
    const value = (cfg()[group as keyof IndexingConfig] as Record<string, string | undefined> | undefined)?.[key]
    return value ?? ""
  }

  const storeValue = (group: "qdrant" | "lancedb", key: string) => {
    const draftKey = `${scope()}.${group}.${key}`
    const draft = storeDrafts()[draftKey]
    if (draft !== undefined) return draft
    const value = (cfg()[group] as Record<string, string | undefined> | undefined)?.[key]
    return value ?? ""
  }

  const saveProviderField = (group: ProviderId, key: string, value: string) => {
    const current = (raw()[group] as Record<string, string | undefined> | undefined) ?? {}
    updateIndexing({ [group]: { ...current, [key]: value.trim() || undefined } })
    const draftKey = `${scope()}.${group}.${key}`
    setProviderDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([entry]) => entry !== draftKey)))
  }

  const saveStoreField = (group: "qdrant" | "lancedb", key: string, value: string) => {
    const current = (raw()[group] as Record<string, string | undefined> | undefined) ?? {}
    updateIndexing({ [group]: { ...current, [key]: value.trim() || undefined } })
    const draftKey = `${scope()}.${group}.${key}`
    setStoreDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([entry]) => entry !== draftKey)))
  }

  const saveNumber = (
    key: TuningKey | "dimension",
    value: string,
    options?: { integer?: boolean; min?: number; max?: number },
  ) => {
    const trimmed = value.trim()
    if (!trimmed) {
      updateIndexing(
        key === "dimension" ? { dimension: null, dimensionMode: "auto" } : { [key]: undefined },
      )
      if (key === "dimension") {
        clearField(key)
      } else {
        const draftKey = `${scope()}.${key}`
        setTuningDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([entry]) => entry !== draftKey)))
      }
      return
    }

    const num = Number(trimmed)
    if (Number.isNaN(num)) return
    if (options?.integer && !Number.isInteger(num)) return
    if (options?.min !== undefined && num < options.min) return
    if (options?.max !== undefined && num > options.max) return
    updateIndexing(key === "dimension" ? { dimension: num, dimensionMode: "fixed" } : { [key]: num })
    if (key === "dimension") {
      clearField(key)
    } else {
      const draftKey = `${scope()}.${key}`
      setTuningDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([entry]) => entry !== draftKey)))
    }
  }

  const tuningValue = (key: TuningKey) => {
    const draft = tuningDrafts()[`${scope()}.${key}`]
    if (draft !== undefined) return draft
    const value = cfg()[key]
    return value === undefined ? "" : String(value)
  }

  const documentValue = (key: DocumentNumberKey) => {
    const draft = documentDrafts()[`${scope()}.${key}`]
    if (draft !== undefined) return draft
    const value = documents()[key]
    return value === undefined ? "" : String(value)
  }

  const saveDocumentNumber = (key: DocumentNumberKey, value: string, min = 0) => {
    const trimmed = value.trim()
    if (!trimmed) {
      updateDocuments({ [key]: undefined })
      return
    }
    const num = Math.floor(Number(trimmed))
    if (!Number.isFinite(num) || num < min) return
    updateDocuments({ [key]: num })
  }

  const saveDocumentPatterns = (key: "include" | "exclude", value: string) => {
    const patterns = value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
    updateDocuments({ [key]: patterns.length > 0 ? patterns : undefined })
  }

  const addDocumentPaths = (
    target: IndexingScope,
    paths: string[],
    approvals: NonNullable<NonNullable<IndexingConfig["documents"]>["approvedExternalRoots"]>,
  ) => {
    const current = indexingConfig(target, globalCfg(), projectCfg()).documents?.paths ?? []
    const next = documentRoots([...current, ...paths])
    const existing = globalCfg().documents?.approvedExternalRoots ?? []
    const trusted = mergeExternalRoots(existing, approvals)
    if (target === "global") {
      updateDocumentsAt("global", { paths: next, approvedExternalRoots: trusted })
      return
    }
    updateDocumentsAt("project", { paths: next })
    updateDocumentsAt("global", { approvedExternalRoots: trusted })
  }

  const removeDocumentPath = (path: string) => {
    updateDocuments({ paths: documentRoots(extraPaths().filter((item) => item !== path)) })
  }

  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "documentRagFoldersSelected") return
      addDocumentPaths(message.scope, message.paths, message.approvals)
    }),
  )

  // The settings surface intentionally combines scoped inheritance, provider variants, and three pipeline states.
  // eslint-disable-next-line complexity
  const content = (_scope: IndexingScope) => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Card>
        <SettingsRow
          title={language.t("settings.indexing.status.title")}
          description={localizeIndexingText(indexing.status().message, language.t)}
        >
          <span class={`indexing-status-badge indexing-status-badge--${indexing.tone()}`}>
            {formatIndexingLabel(indexing.status(), language.t)}
          </span>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.pipeline.codeGraph")}
          description={indexingPipelineDescription(indexing.pipelines().codeGraph, language.t)}
        >
          <PipelineBadge
            label={language.t("settings.indexing.pipeline.short.codeGraph")}
            status={indexing.pipelines().codeGraph}
            t={language.t}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.pipeline.rag")}
          description={indexingPipelineDescription(indexing.pipelines().rag, language.t)}
        >
          <PipelineBadge
            label={language.t("settings.indexing.pipeline.short.rag")}
            status={indexing.pipelines().rag}
            t={language.t}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.pipeline.documents")}
          description={indexingPipelineDescription(indexing.pipelines().documents, language.t)}
        >
          <PipelineBadge
            label={language.t("settings.indexing.pipeline.short.documents")}
            status={indexing.pipelines().documents}
            t={language.t}
          />
        </SettingsRow>
        <PipelineDiagnostics
          label={language.t("settings.indexing.pipeline.codeGraph")}
          diagnosticLabel="Code Graph"
          status={indexing.pipelines().codeGraph}
          copied={copied() === "Code Graph"}
          onCopy={copyDiagnostics}
          t={language.t}
        />
        <PipelineDiagnostics
          label={language.t("settings.indexing.pipeline.rag")}
          diagnosticLabel="RAG"
          status={indexing.pipelines().rag}
          copied={copied() === "RAG"}
          onCopy={copyDiagnostics}
          t={language.t}
        />
        <PipelineDiagnostics
          label={language.t("settings.indexing.pipeline.documents")}
          diagnosticLabel="Documents"
          status={indexing.pipelines().documents}
          copied={copied() === "Documents"}
          onCopy={copyDiagnostics}
          t={language.t}
        />
        <SettingsRow
          title={language.t("settings.indexing.scope.title")}
          description={
            scope() === "global"
              ? language.t("settings.indexing.globalEnable.description")
              : language.t("settings.indexing.projectEnable.description")
          }
        >
          <div style={{ display: "flex", gap: "8px" }}>
            <Button
              variant={scope() === "global" ? "primary" : "secondary"}
              size="small"
              onClick={() => changeScope("global")}
            >
              {language.t("settings.config.scope.global")}
            </Button>
            <Button
              variant={scope() === "project" ? "primary" : "secondary"}
              size="small"
              onClick={() => changeScope("project")}
            >
              {language.t("settings.config.scope.local")}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          title={
            scope() === "global"
              ? language.t("settings.indexing.globalEnable.title")
              : language.t("settings.indexing.projectEnable.title")
          }
          description={
            inherited()
              ? language.t("settings.indexing.inheritance.enabled", {
                  state: enabled()
                    ? language.t("settings.indexing.state.on")
                    : language.t("settings.indexing.state.off"),
                })
              : language.t("settings.indexing.enable.description")
          }
          tag={() => tag(scope(), [["enabled"]])}
        >
          <Switch checked={enabled()} onChange={saveEnabled} hideLabel>
            {language.t("settings.indexing.enable.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.showButton.title")}
          description={language.t("settings.indexing.showButton.description")}
          last
        >
          <Switch
            checked={Boolean(settings()["indexing.showButtonWhenDisabled"] ?? true)}
            onChange={(checked) => updateSetting("indexing.showButtonWhenDisabled", checked)}
            hideLabel
          >
            {language.t("settings.indexing.showButton.title")}
          </Switch>
        </SettingsRow>
      </Card>

      <Card>
        <SettingsRow
          title={language.t("settings.indexing.provider.title")}
          description={description(language.t("settings.indexing.provider.description"), [["provider"]])}
          tag={() => tag(scope(), [["provider"]])}
        >
          <Select
            options={providers()}
            current={providers().find((item) => item.value === selectedProvider())}
            value={(item) => item.value}
            label={(item) => item.label}
            onSelect={(item) => saveProvider(item?.value as ProviderId | undefined)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            placeholder={language.t("settings.providers.notSet")}
          />
        </SettingsRow>
        <Show when={selectedProvider() === "chipmate"}>
          <Show when={chipmateModels().length > 0}>
            <SettingsRow
              title={language.t("settings.indexing.chipmateModel.title")}
              description={description(language.t("settings.indexing.chipmateModel.description"), [["model"]])}
              tag={() => tag(scope(), [["model"]])}
            >
              <Select
                options={chipmateModels()}
                current={chipmateModels().find((item) => item.value === chipmateValue())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) =>
                  updateIndexing({
                    model: item?.value ?? chipmateDefault(),
                    dimension: null,
                    dimensionMode: "auto",
                  })
                }
                variant="secondary"
                size="small"
                triggerVariant="settings"
                placeholder={language.t("settings.indexing.model.select")}
              />
            </SettingsRow>
          </Show>
        </Show>
        <Show when={selectedProvider() !== "chipmate"}>
          <SettingsRow
            title={language.t("settings.indexing.model.title")}
            description={description(language.t("settings.indexing.model.description"), [["model"]])}
            tag={() => tag(scope(), [["model"]])}
          >
            <TextField
              value={fieldValue("model", cfg().model ?? "")}
              placeholder={
                isInternalOfflineBuild()
                  ? INTERNAL_OFFLINE_INDEXING_DEFAULTS.model
                  : language.t("settings.indexing.model.enter")
              }
              onInput={(event: InputEvent) => {
                const input = event.currentTarget as HTMLInputElement
                stageField("model", input.value)
              }}
              onBlur={(event: FocusEvent) => {
                const input = event.currentTarget as HTMLInputElement
                saveModel(input.value)
              }}
            />
          </SettingsRow>
        </Show>
        <SettingsRow
          title={language.t("settings.indexing.dimension.title")}
          description={
            selectedProvider() === "chipmate"
              ? language.t("settings.indexing.dimension.description")
              : description(language.t("settings.indexing.dimension.description"), [["dimension"]])
          }
          tag={() => (selectedProvider() === "chipmate" ? undefined : tag(scope(), [["dimension"]]))}
          last={!selectedProvider() || (fields().length === 0 && !(selectedProvider() === "chipmate" && !chipmateAvailable()))}
        >
          <TextField
            value={fieldValue(
              "dimension",
              staleChipMateModel() || cfg().dimension === undefined || cfg().dimension === null
                ? ""
                : String(cfg().dimension),
            )}
            placeholder={
              selectedProvider() === "chipmate"
                ? language.t("settings.indexing.model.provided")
                : language.t("settings.indexing.dimension.placeholder")
            }
            disabled={selectedProvider() === "chipmate"}
            onInput={(event: InputEvent) => {
              const input = event.currentTarget as HTMLInputElement
              stageField("dimension", input.value)
            }}
            onBlur={(event: FocusEvent) => {
              const input = event.currentTarget as HTMLInputElement
              saveNumber("dimension", input.value, {
                integer: true,
                min:
                  isInternalOfflineBuild() &&
                  selectedProvider() === INTERNAL_OFFLINE_INDEXING_DEFAULTS.provider &&
                  (cfg().model ?? INTERNAL_OFFLINE_INDEXING_DEFAULTS.model) === INTERNAL_OFFLINE_INDEXING_DEFAULTS.model
                    ? 32
                    : 1,
                max:
                  isInternalOfflineBuild() &&
                  selectedProvider() === INTERNAL_OFFLINE_INDEXING_DEFAULTS.provider &&
                  (cfg().model ?? INTERNAL_OFFLINE_INDEXING_DEFAULTS.model) === INTERNAL_OFFLINE_INDEXING_DEFAULTS.model
                    ? 4096
                    : undefined,
              })
            }}
          />
        </SettingsRow>
        <Show when={selectedProvider() === "chipmate" && !chipmateAvailable()}>
          <SettingsRow
            title={language.t("settings.indexing.chipmateSignIn.title")}
            description={language.t("settings.indexing.chipmateSignIn.description")}
            last
          >
            <span />
          </SettingsRow>
        </Show>
        <Show when={fields().length > 0 ? selectedProvider() : undefined} keyed>
          {(group) => {
            const fields = providerFields(group)
            const name = allProviders.find((item) => item.value === group)?.label ?? group
            return (
              <For each={fields}>
                {(field, index) => (
                  <SettingsRow
                    title={`${name} ${language.t(field.label)}${
                      field.optional ? ` ${language.t("settings.indexing.field.optionalSuffix")}` : ""
                    }`}
                    description={description(language.t("settings.indexing.providerField.description"), [
                      [group, field.key],
                    ])}
                    tag={() => tag(scope(), [[group, field.key]])}
                    last={index() === fields.length - 1}
                  >
                    <TextField
                      type={field.key === "apiKey" ? "password" : undefined}
                      value={providerValue(group, field.key)}
                      placeholder={
                        field.placeholder.startsWith("settings.") ? language.t(field.placeholder) : field.placeholder
                      }
                      onInput={(e: InputEvent) => {
                        const target = e.currentTarget as HTMLInputElement
                        setProviderDrafts((prev) => ({ ...prev, [`${scope()}.${group}.${field.key}`]: target.value }))
                      }}
                      onBlur={(e: FocusEvent) => {
                        const target = e.currentTarget as HTMLInputElement
                        saveProviderField(group, field.key, target.value)
                      }}
                    />
                  </SettingsRow>
                )}
              </For>
            )
          }}
        </Show>
      </Card>

      <Card>
        <SettingsRow
          title={language.t("settings.indexing.vectorStore.title")}
          description={description(language.t("settings.indexing.vectorStore.description"), [["vectorStore"]])}
          tag={() => tag(scope(), [["vectorStore"]])}
        >
          <Select
            options={stores()}
            current={stores().find((item) => item.value === vectorStore())}
            value={(item) => item.value}
            label={(item) => item.label}
            onSelect={(item) => updateIndexing({ vectorStore: item?.value as "lancedb" | "qdrant" | undefined })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <Show
          when={vectorStore() === "qdrant"}
          fallback={
            <SettingsRow
              title={language.t("settings.indexing.lancedbDirectory.title")}
              description={description(language.t("settings.indexing.lancedbDirectory.description"), [
                ["lancedb", "directory"],
              ])}
              tag={() => tag(scope(), [["lancedb", "directory"]])}
              last
            >
              <TextField
                value={storeValue("lancedb", "directory")}
                placeholder={language.t("settings.indexing.lancedbDirectory.placeholder")}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, [`${scope()}.lancedb.directory`]: target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  saveStoreField("lancedb", "directory", target.value)
                }}
              />
            </SettingsRow>
          }
        >
          <>
            <SettingsRow
              title={language.t("settings.indexing.qdrantUrl.title")}
              description={description(language.t("settings.indexing.qdrantUrl.description"), [["qdrant", "url"]])}
              tag={() => tag(scope(), [["qdrant", "url"]])}
            >
              <TextField
                value={storeValue("qdrant", "url")}
                placeholder="http://localhost:6333"
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, [`${scope()}.qdrant.url`]: target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  saveStoreField("qdrant", "url", target.value)
                }}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.indexing.qdrantApiKey.title")}
              description={description(language.t("settings.indexing.qdrantApiKey.description"), [
                ["qdrant", "apiKey"],
              ])}
              tag={() => tag(scope(), [["qdrant", "apiKey"]])}
              last
            >
              <TextField
                type="password"
                value={storeValue("qdrant", "apiKey")}
                placeholder={language.t("settings.indexing.qdrantApiKey.placeholder")}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, [`${scope()}.qdrant.apiKey`]: target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  saveStoreField("qdrant", "apiKey", target.value)
                }}
              />
            </SettingsRow>
          </>
        </Show>
      </Card>

      <Card>
        <div class="settings-section-title">{language.t("settings.indexing.documentsSection")}</div>
        <SettingsRow
          title={language.t("settings.indexing.documents.title")}
          description={description(language.t("settings.indexing.documents.description"), [["documents"]])}
          tag={() => tag(scope(), [["documents"]])}
        >
          <Switch
            checked={documents().enabled === true}
            onChange={(value) => updateDocuments({ enabled: value })}
            hideLabel
          >
            {language.t("settings.indexing.documents.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.documents.workspace.title")}
          description={language.t("settings.indexing.documents.workspace.description")}
        >
          <div style={{ width: "min(360px, 100%)" }}>
            <TextField value={server.workspaceDirectory() || "."} readOnly />
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.documents.folders.title")}
          description={language.t("settings.indexing.documents.folders.description")}
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px", width: "min(360px, 100%)" }}>
            <For
              each={extraPaths()}
              fallback={
                <span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "var(--chipmate-font-size-12)" }}>
                  {language.t("settings.indexing.documents.folders.empty")}
                </span>
              }
            >
              {(item) => (
                <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <TextField value={item} readOnly />
                  </div>
                  <Button variant="ghost" size="small" icon="trash" onClick={() => removeDocumentPath(item)}>
                    {language.t("settings.indexing.documents.folders.remove")}
                  </Button>
                </div>
              )}
            </For>
            <div style={{ display: "flex", "align-items": "center", gap: "8px", "justify-content": "flex-end" }}>
              <Button
                variant="secondary"
                size="small"
                icon="folder"
                onClick={() => vscode.postMessage({ type: "selectDocumentRagFolder", scope: scope() })}
              >
                {language.t("settings.indexing.documents.folders.add")}
              </Button>
              <Button
                variant="secondary"
                size="small"
                icon="reset"
                onClick={() => vscode.postMessage({ type: "rebuildDocumentRag" })}
              >
                {language.t("settings.indexing.documents.rebuild")}
              </Button>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.documents.include.title")}
          description={language.t("settings.indexing.documents.include.description")}
        >
          <TextField
            value={(documents().include ?? []).join(", ")}
            placeholder="**/*.pdf, docs/**/*.md"
            onChange={(value) => saveDocumentPatterns("include", value)}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.documents.exclude.title")}
          description={language.t("settings.indexing.documents.exclude.description")}
        >
          <TextField
            value={(documents().exclude ?? []).join(", ")}
            placeholder="**/archive/**"
            onChange={(value) => saveDocumentPatterns("exclude", value)}
          />
        </SettingsRow>
        <For
          each={[
            {
              key: "maxFileBytes" as const,
              title: "settings.indexing.documents.maxFileBytes.title",
              description: "settings.indexing.documents.maxFileBytes.description",
              placeholder: "52428800",
              min: 1,
            },
            {
              key: "chunkChars" as const,
              title: "settings.indexing.documents.chunkChars.title",
              description: "settings.indexing.documents.chunkChars.description",
              placeholder: "1200",
              min: 1,
            },
            {
              key: "chunkOverlapChars" as const,
              title: "settings.indexing.documents.chunkOverlapChars.title",
              description: "settings.indexing.documents.chunkOverlapChars.description",
              placeholder: "200",
              min: 0,
            },
            {
              key: "searchMaxResults" as const,
              title: "settings.indexing.documents.searchMaxResults.title",
              description: "settings.indexing.documents.searchMaxResults.description",
              placeholder: "8",
              min: 1,
            },
          ]}
        >
          {(item, index) => (
            <SettingsRow title={language.t(item.title)} description={language.t(item.description)} last={index() === 3}>
              <TextField
                value={documentValue(item.key)}
                placeholder={item.placeholder}
                onInput={(event: InputEvent) => {
                  const input = event.currentTarget as HTMLInputElement
                  setDocumentDrafts((prev) => ({ ...prev, [`${scope()}.${item.key}`]: input.value }))
                }}
                onBlur={(event: FocusEvent) => {
                  const input = event.currentTarget as HTMLInputElement
                  saveDocumentNumber(item.key, input.value, item.min)
                }}
              />
            </SettingsRow>
          )}
        </For>
      </Card>

      <Card>
        <div class="settings-section-title">{language.t("settings.indexing.advancedSection")}</div>
        <For each={tuning}>
          {(item, index) => (
            <SettingsRow
              title={language.t(item.label)}
              description={description(language.t("settings.indexing.tuning.description"), [[item.key]])}
              tag={() => tag(scope(), [[item.key]])}
              last={index() === tuning.length - 1}
            >
              <TextField
                value={tuningValue(item.key)}
                placeholder={item.placeholder}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setTuningDrafts((prev) => ({ ...prev, [`${scope()}.${item.key}`]: target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  const integer = item.key !== "searchMinScore"
                  const max = item.key === "searchMinScore" ? 1 : undefined
                  saveNumber(item.key, target.value, { integer, min: 0, max })
                }}
              />
            </SettingsRow>
          )}
        </For>
      </Card>
    </div>
  )

  return (
    <Show when={scope()} keyed>
      {content}
    </Show>
  )
}

export default IndexingTab
