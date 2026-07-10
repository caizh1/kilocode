import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { formatKiloEmbeddingModelLabel, getKiloEmbeddingModel } from "@kilocode/kilo-indexing/embedding-models"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useConfig } from "../../context/config"
import {
  formatIndexingLabel,
  formatIndexingDiagnostic,
  formatIndexingDiagnostics,
  formatIndexingPipelineLabel,
  hasIndexingDiagnostics,
  indexingDiagnosticMessage,
  indexingPipelineDescription,
  indexingPipelineTone,
  useIndexing,
} from "../../context/indexing"
import { useKiloEmbeddingModels } from "../../context/kilo-embedding-models"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import type { IndexingConfig, IndexingPipelineStatus, IndexingProvider as ProviderId } from "../../types/messages"
import { KILO_PROVIDER_ID } from "../../../../src/shared/provider-model"
import { INTERNAL_OFFLINE_INDEXING_DEFAULTS, isInternalOfflineBuild } from "../../../../src/shared/internal-offline"
import {
  applyInternalIndexingDefaults,
  materializeInternalIndexingDefaultsForSave,
  mergeIndexingConfigForDisplay,
} from "../../utils/indexing-defaults"
import SettingsRow from "./SettingsRow"

type Option = { value: string; label: string }
type TuningKey = "searchMinScore" | "searchMaxResults" | "embeddingBatchSize" | "scannerMaxBatchRetries"
type DocumentNumberKey = "maxFileBytes" | "chunkChars" | "chunkOverlapChars" | "searchMaxResults"

const allProviders: { value: ProviderId; label: string }[] = [
  { value: "kilo", label: "Kilo" },
  { value: "openai", label: "OpenAI" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai-compatible", label: "OpenAI-Compatible" },
  { value: "gemini", label: "Gemini" },
  { value: "mistral", label: "Mistral" },
  { value: "vercel-ai-gateway", label: "Vercel AI Gateway" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "voyage", label: "Voyage" },
]

const stores: Option[] = [
  { value: "lancedb", label: "LanceDB (default)" },
  { value: "qdrant", label: "Qdrant" },
]

const tuning: Array<{ key: TuningKey; label: string; placeholder: string }> = [
  { key: "searchMinScore", label: "Search Min Score", placeholder: "0.4" },
  { key: "searchMaxResults", label: "Search Max Results", placeholder: "50" },
  { key: "embeddingBatchSize", label: "Embedding Batch Size", placeholder: "60" },
  { key: "scannerMaxBatchRetries", label: "Scanner Max Batch Retries", placeholder: "3" },
]

const PipelineBadge: Component<{ label: string; status: IndexingPipelineStatus }> = (props) => (
  <div style={{ display: "flex", "align-items": "center", gap: "8px", "justify-content": "flex-end" }}>
    <span class={`indexing-status-badge indexing-status-badge--${indexingPipelineTone(props.status)}`}>
      {formatIndexingPipelineLabel(props.label, props.status)}
    </span>
    <span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "var(--kilo-font-size-12)" }}>
      {props.status.errorCount} err / {props.status.staleCount} stale / {props.status.skippedCount} skipped
    </span>
  </div>
)

const PipelineDiagnostics: Component<{
  label: string
  status: IndexingPipelineStatus
  copied: boolean
  onCopy: (label: string, status: IndexingPipelineStatus) => void
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
        "font-size": "var(--kilo-font-size-12)",
        "min-width": 0,
      }}
    >
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}>
        <strong style={{ color: "var(--vscode-foreground)" }}>{props.label} diagnostics</strong>
        <Button
          variant="ghost"
          size="small"
          icon={props.copied ? "check" : "copy"}
          onClick={() => props.onCopy(props.label, props.status)}
        >
          {props.copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Show
        when={(props.status.recentErrors?.length ?? 0) > 0}
        fallback={
          <div style={{ color: "var(--vscode-foreground)", "overflow-wrap": "anywhere" }}>
            {indexingPipelineDescription(props.status)}
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

function providerFields(provider: ProviderId | undefined): Array<{ key: string; label: string; placeholder: string }> {
  if (provider === "kilo") return []
  if (provider === "openai") return [{ key: "apiKey", label: "API Key", placeholder: "sk-..." }]
  if (provider === "ollama") return [{ key: "baseUrl", label: "Base URL", placeholder: "http://localhost:11434" }]
  if (provider === "openai-compatible") {
    return [
      { key: "baseUrl", label: "Base URL", placeholder: "https://api.example.com/v1" },
      { key: "apiKey", label: "API Key", placeholder: "sk-..." },
    ]
  }
  if (provider === "gemini") return [{ key: "apiKey", label: "API Key", placeholder: "AI..." }]
  if (provider === "mistral") return [{ key: "apiKey", label: "API Key", placeholder: "..." }]
  if (provider === "vercel-ai-gateway") return [{ key: "apiKey", label: "API Key", placeholder: "..." }]
  if (provider === "bedrock") {
    return [
      { key: "region", label: "AWS Region", placeholder: "us-east-1" },
      { key: "profile", label: "AWS Profile", placeholder: "default" },
    ]
  }
  if (provider === "openrouter") {
    return [
      { key: "apiKey", label: "API Key", placeholder: "sk-or-..." },
      { key: "specificProvider", label: "Specific Provider", placeholder: "optional" },
    ]
  }
  if (provider === "voyage") return [{ key: "apiKey", label: "API Key", placeholder: "pa-..." }]
  return []
}

const IndexingTab: Component = () => {
  const { config, globalConfig, updateConfig, updateGlobalConfig } = useConfig()
  const indexing = useIndexing()
  const embeds = useKiloEmbeddingModels()
  const language = useLanguage()
  const provider = useProvider()
  const server = useServer()
  const vscode = useVSCode()
  const [providerDrafts, setProviderDrafts] = createSignal<Record<string, string>>({})
  const [storeDrafts, setStoreDrafts] = createSignal<Record<string, string>>({})
  const [tuningDrafts, setTuningDrafts] = createSignal<Record<string, string>>({})
  const [documentDrafts, setDocumentDrafts] = createSignal<Record<string, string>>({})
  const [modelDraft, setModelDraft] = createSignal<string>()
  const [dimensionDraft, setDimensionDraft] = createSignal<string>()
  const [pendingModelCommit, setPendingModelCommit] = createSignal<string>()
  const [pendingDimensionCommit, setPendingDimensionCommit] = createSignal<number>()
  const [copied, setCopied] = createSignal<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "documentRagFoldersSelected") return
      addDocumentPaths(message.paths)
    }),
  )

  const rawCfg = createMemo<IndexingConfig>(() => config().indexing ?? {})
  const rawGlobalCfg = createMemo<IndexingConfig>(() => globalConfig().indexing ?? {})
  const effectiveRawCfg = createMemo<IndexingConfig>(() => mergeIndexingConfigForDisplay(rawGlobalCfg(), rawCfg()))
  const cfg = createMemo<IndexingConfig>(() => applyInternalIndexingDefaults(effectiveRawCfg()))
  const globalCfg = createMemo<IndexingConfig>(() => applyInternalIndexingDefaults(rawGlobalCfg()))
  const globalOn = createMemo(() => globalCfg().enabled === true)

  const updateIndexing = (partial: IndexingConfig) => {
    const materialized = materializeInternalIndexingDefaultsForSave(effectiveRawCfg(), partial)
    updateConfig({ indexing: { ...rawCfg(), ...materialized } })
  }

  const updateDocuments = (partial: NonNullable<IndexingConfig["documents"]>) => {
    updateIndexing({ documents: { ...(rawCfg().documents ?? {}), ...partial } })
  }

  const copyDiagnostics = (label: string, status: IndexingPipelineStatus) => {
    navigator.clipboard
      .writeText(formatIndexingDiagnostics(label, status))
      .then(() => {
        setCopied(label)
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => setCopied(undefined), 1200)
      })
      .catch((err) => {
        console.warn("failed to copy indexing diagnostics", err)
      })
  }

  createEffect(() => {
    const pending = pendingModelCommit()
    if (pending === undefined) return
    if ((cfg().model ?? "") !== pending) return
    setModelDraft(undefined)
    setPendingModelCommit(undefined)
  })

  createEffect(() => {
    const pending = pendingDimensionCommit()
    if (pending === undefined) return
    if (cfg().dimension !== pending) return
    setDimensionDraft(undefined)
    setPendingDimensionCommit(undefined)
  })

  const vectorStore = () => cfg().vectorStore ?? "lancedb"
  const documents = () => cfg().documents ?? {}
  const documentPaths = () => documents().paths ?? []
  const kiloDefault = () =>
    getKiloEmbeddingModel(embeds.catalog().defaultModel, embeds.catalog())?.id ?? embeds.catalog().defaultModel
  const kiloModels = createMemo(() =>
    embeds.catalog().models.map((model) => ({
      value: model.id,
      label: formatKiloEmbeddingModelLabel(model),
    })),
  )
  const knownKiloModel = (model: string | null | undefined) =>
    getKiloEmbeddingModel(model ?? undefined, embeds.catalog())?.id
  const kiloValue = () => knownKiloModel(cfg().model) ?? kiloDefault()
  const kiloAvailable = () => !!server.profileData() || provider.authStates()[KILO_PROVIDER_ID] !== undefined
  const selectedProvider = () => cfg().provider ?? (kiloAvailable() ? "kilo" : undefined)
  const staleKiloModel = () => selectedProvider() === "kilo" && !!cfg().model && !knownKiloModel(cfg().model)
  const providers = createMemo(() =>
    allProviders.filter((item) => item.value !== "kilo" || kiloAvailable() || selectedProvider() === "kilo"),
  )
  const fields = createMemo(() => providerFields(selectedProvider()))

  const saveProvider = (next: ProviderId | undefined) => {
    setModelDraft(undefined)
    setDimensionDraft(undefined)
    if (next === "kilo") {
      const model = knownKiloModel(cfg().model) ?? (kiloDefault() || null)
      updateIndexing({
        provider: next,
        model,
        dimension: null,
      })
      return
    }
    updateIndexing({ provider: next, model: null, dimension: null })
  }

  const saveEnabled = (enabled: boolean) => {
    if (enabled && isInternalOfflineBuild() && !rawCfg().provider) {
      updateIndexing({ enabled })
      return
    }
    if (enabled && !cfg().provider && kiloAvailable()) {
      updateIndexing({
        enabled,
        provider: "kilo",
        model: knownKiloModel(cfg().model) ?? (kiloDefault() || null),
        dimension: null,
      })
      return
    }
    updateIndexing({ enabled })
  }

  const saveGlobalEnabled = (enabled: boolean) => {
    if (enabled && isInternalOfflineBuild() && !rawGlobalCfg().provider && !rawCfg().provider) {
      updateGlobalConfig({
        indexing: { enabled },
      })
      return
    }
    if (enabled && !globalCfg().provider && !cfg().provider && kiloAvailable()) {
      updateGlobalConfig({
        indexing: {
          enabled,
          provider: "kilo",
          model: knownKiloModel(cfg().model) ?? (kiloDefault() || null),
          dimension: null,
        },
      })
      return
    }
    updateGlobalConfig({ indexing: { enabled } })
  }

  const saveModel = (value: string) => {
    if (selectedProvider() === "kilo") return
    const trimmed = value.trim()
    if (!trimmed) {
      updateIndexing({ model: null })
      setModelDraft(undefined)
      setPendingModelCommit(undefined)
      return
    }
    updateIndexing({ model: trimmed })
    setPendingModelCommit(trimmed)
  }

  const modelValue = () => modelDraft() ?? (cfg().model ?? "")

  const providerValue = (group: string, key: string) => {
    const draftKey = `${group}.${key}`
    const draft = providerDrafts()[draftKey]
    if (draft !== undefined) return draft
    const value = (cfg()[group as keyof IndexingConfig] as Record<string, string | undefined> | undefined)?.[key]
    return value ?? ""
  }

  const storeValue = (group: "qdrant" | "lancedb", key: string) => {
    const draftKey = `${group}.${key}`
    const draft = storeDrafts()[draftKey]
    if (draft !== undefined) return draft
    const value = (cfg()[group] as Record<string, string | undefined> | undefined)?.[key]
    return value ?? ""
  }

  const saveProviderField = (group: ProviderId, key: string, value: string) => {
    const current = (cfg()[group] as Record<string, string | undefined> | undefined) ?? {}
    updateIndexing({ [group]: { ...current, [key]: value.trim() || undefined } })
  }

  const saveStoreField = (group: "qdrant" | "lancedb", key: string, value: string) => {
    const current = (cfg()[group] as Record<string, string | undefined> | undefined) ?? {}
    updateIndexing({ [group]: { ...current, [key]: value.trim() || undefined } })
  }

  const saveNumber = (
    key: TuningKey | "dimension",
    value: string,
    options?: { integer?: boolean; min?: number; max?: number },
  ) => {
    const trimmed = value.trim()
    if (!trimmed) {
      updateIndexing({ [key]: key === "dimension" ? null : undefined })
      if (key === "dimension") {
        setDimensionDraft(undefined)
        setPendingDimensionCommit(undefined)
      }
      return
    }

    const num = Number(trimmed)
    if (Number.isNaN(num)) return
    if (options?.integer && !Number.isInteger(num)) return
    if (options?.min !== undefined && num < options.min) return
    if (options?.max !== undefined && num > options.max) return
    updateIndexing({ [key]: num })
    if (key === "dimension") setPendingDimensionCommit(num)
  }

  const tuningValue = (key: TuningKey) => {
    const draft = tuningDrafts()[key]
    if (draft !== undefined) return draft
    const value = cfg()[key]
    return value === undefined ? "" : String(value)
  }

  const dimensionValue = () => {
    const draft = dimensionDraft()
    if (draft !== undefined) return draft
    return staleKiloModel() || cfg().dimension === undefined || cfg().dimension === null ? "" : String(cfg().dimension)
  }

  const documentValue = (key: DocumentNumberKey) => {
    const draft = documentDrafts()[key]
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

  const addDocumentPaths = (paths: string[]) => {
    const next = [...new Set([...documentPaths(), ...paths])]
    updateDocuments({ paths: next })
  }

  const setDocumentPath = (index: number, value: string) => {
    const next = documentPaths().slice()
    next[index] = value.trim()
    updateDocuments({ paths: next.filter(Boolean) })
  }

  const removeDocumentPath = (index: number) => {
    updateDocuments({ paths: documentPaths().filter((_, item) => item !== index) })
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Card>
        <SettingsRow title={language.t("settings.indexing.status.title")} description={indexing.status().message}>
          <span class={`indexing-status-badge indexing-status-badge--${indexing.tone()}`}>
            {formatIndexingLabel(indexing.status())}
          </span>
        </SettingsRow>
        <SettingsRow title="Code Graph" description={indexingPipelineDescription(indexing.pipelines().codeGraph)}>
          <PipelineBadge label="CG" status={indexing.pipelines().codeGraph} />
        </SettingsRow>
        <SettingsRow title="RAG" description={indexingPipelineDescription(indexing.pipelines().rag)}>
          <PipelineBadge label="RAG" status={indexing.pipelines().rag} />
        </SettingsRow>
        <SettingsRow title="Documents" description={indexingPipelineDescription(indexing.pipelines().documents)}>
          <PipelineBadge label="DOC" status={indexing.pipelines().documents} />
        </SettingsRow>
        <PipelineDiagnostics
          label="Code Graph"
          status={indexing.pipelines().codeGraph}
          copied={copied() === "Code Graph"}
          onCopy={copyDiagnostics}
        />
        <PipelineDiagnostics
          label="RAG"
          status={indexing.pipelines().rag}
          copied={copied() === "RAG"}
          onCopy={copyDiagnostics}
        />
        <PipelineDiagnostics
          label="Documents"
          status={indexing.pipelines().documents}
          copied={copied() === "Documents"}
          onCopy={copyDiagnostics}
        />
        <SettingsRow
          title={language.t("settings.indexing.globalEnable.title")}
          description={language.t("settings.indexing.globalEnable.description")}
        >
          <Switch checked={globalCfg().enabled ?? false} onChange={saveGlobalEnabled} hideLabel>
            {language.t("settings.indexing.globalEnable.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.projectEnable.title")}
          description={language.t("settings.indexing.projectEnable.description")}
          last
        >
          <Tooltip
            value={language.t("settings.indexing.projectEnable.disabledTooltip")}
            placement="top"
            inactive={!globalOn()}
          >
            <Switch checked={cfg().enabled === true} onChange={saveEnabled} disabled={globalOn()} hideLabel>
              {language.t("settings.indexing.projectEnable.title")}
            </Switch>
          </Tooltip>
        </SettingsRow>
      </Card>

      <Card>
        <SettingsRow
          title={language.t("settings.indexing.provider.title")}
          description={language.t("settings.indexing.provider.description")}
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
        <Show when={selectedProvider() === "kilo"}>
          <Show when={kiloModels().length > 0}>
            <SettingsRow
              title={language.t("settings.indexing.kiloModel.title")}
              description={language.t("settings.indexing.kiloModel.description")}
            >
              <Select
                options={kiloModels()}
                current={kiloModels().find((item) => item.value === kiloValue())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => updateIndexing({ model: item?.value ?? kiloDefault(), dimension: null })}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                placeholder="Select a model"
              />
            </SettingsRow>
          </Show>
        </Show>
        <Show when={selectedProvider() !== "kilo"}>
          <SettingsRow
            title={language.t("settings.indexing.model.title")}
            description={language.t("settings.indexing.model.description")}
          >
            <TextField
              value={modelValue()}
              placeholder={isInternalOfflineBuild() ? INTERNAL_OFFLINE_INDEXING_DEFAULTS.model : "Enter model ID"}
              onInput={(e: InputEvent) => {
                const target = e.currentTarget as HTMLInputElement
                setModelDraft(target.value)
              }}
              onBlur={(e: FocusEvent) => {
                const target = e.currentTarget as HTMLInputElement
                saveModel(target.value)
              }}
            />
          </SettingsRow>
        </Show>
        <SettingsRow
          title={language.t("settings.indexing.dimension.title")}
          description={language.t("settings.indexing.dimension.description")}
          last={!selectedProvider() || (fields().length === 0 && !(selectedProvider() === "kilo" && !kiloAvailable()))}
        >
          <TextField
            value={dimensionValue()}
            placeholder={
              isInternalOfflineBuild() && selectedProvider() === INTERNAL_OFFLINE_INDEXING_DEFAULTS.provider
                ? String(INTERNAL_OFFLINE_INDEXING_DEFAULTS.dimension)
                : language.t("settings.indexing.dimension.placeholder")
            }
            onInput={(e: InputEvent) => {
              const target = e.currentTarget as HTMLInputElement
              setDimensionDraft(target.value)
            }}
            onBlur={(e: FocusEvent) => {
              const target = e.currentTarget as HTMLInputElement
              saveNumber("dimension", target.value, { integer: true, min: 1 })
            }}
          />
        </SettingsRow>
        <Show when={selectedProvider() === "kilo" && !kiloAvailable()}>
          <SettingsRow
            title={language.t("settings.indexing.kiloSignIn.title")}
            description={language.t("settings.indexing.kiloSignIn.description")}
            last
          >
            <span />
          </SettingsRow>
        </Show>
        <Show when={fields().length > 0 ? selectedProvider() : undefined} keyed>
          {(group) => {
            const fields = providerFields(group)
            const label = allProviders.find((item) => item.value === group)?.label ?? group
            return (
              <For each={fields}>
                {(field, index) => (
                  <SettingsRow
                    title={`${label} ${field.label}`}
                    description={language.t("settings.indexing.providerField.description")}
                    last={index() === fields.length - 1}
                  >
                    <TextField
                      type={field.key === "apiKey" ? "password" : undefined}
                      value={providerValue(group, field.key)}
                      placeholder={field.placeholder}
                      onInput={(e: InputEvent) => {
                        const target = e.currentTarget as HTMLInputElement
                        setProviderDrafts((prev) => ({ ...prev, [`${group}.${field.key}`]: target.value }))
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
          description={language.t("settings.indexing.vectorStore.description")}
        >
          <Select
            options={stores}
            current={stores.find((item) => item.value === vectorStore())}
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
              description={language.t("settings.indexing.lancedbDirectory.description")}
              last
            >
              <TextField
                value={storeValue("lancedb", "directory")}
                placeholder={language.t("settings.indexing.lancedbDirectory.placeholder")}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, "lancedb.directory": target.value }))
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
              description={language.t("settings.indexing.qdrantUrl.description")}
            >
              <TextField
                value={storeValue("qdrant", "url")}
                placeholder="http://localhost:6333"
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, "qdrant.url": target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  saveStoreField("qdrant", "url", target.value)
                }}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.indexing.qdrantApiKey.title")}
              description={language.t("settings.indexing.qdrantApiKey.description")}
              last
            >
              <TextField
                type="password"
                value={storeValue("qdrant", "apiKey")}
                placeholder={language.t("settings.indexing.qdrantApiKey.placeholder")}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, "qdrant.apiKey": target.value }))
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
        <SettingsRow
          title="Documents"
          description="Index configured workspace document folders into a separate RAG store."
        >
          <Switch checked={documents().enabled === true} onChange={(enabled) => updateDocuments({ enabled })} hideLabel>
            Documents
          </Switch>
        </SettingsRow>
        <SettingsRow title="Document Folders" description="Workspace-relative folders scanned for document RAG.">
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px", width: "min(360px, 100%)" }}>
            <For
              each={documentPaths()}
              fallback={
                <span style={{ color: "var(--vscode-descriptionForeground)", "font-size": "var(--kilo-font-size-12)" }}>
                  No folders
                </span>
              }
            >
              {(item, index) => (
                <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": 0 }}>
                  <TextField value={item} placeholder="docs" onChange={(value) => setDocumentPath(index(), value)} />
                  <Button variant="ghost" size="small" icon="trash" onClick={() => removeDocumentPath(index())}>
                    Remove
                  </Button>
                </div>
              )}
            </For>
            <div style={{ display: "flex", "align-items": "center", gap: "8px", "justify-content": "flex-end" }}>
              <Button
                variant="secondary"
                size="small"
                icon="folder"
                onClick={() => vscode.postMessage({ type: "selectDocumentRagFolder" })}
              >
                Add Folder
              </Button>
              <Button
                variant="secondary"
                size="small"
                icon="reset"
                onClick={() => vscode.postMessage({ type: "rebuildDocumentRag" })}
              >
                Rebuild
              </Button>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow title="Include" description="Optional comma-separated glob patterns for document files.">
          <TextField
            value={(documents().include ?? []).join(", ")}
            placeholder="**/*.pdf, docs/**/*.md"
            onChange={(value) => saveDocumentPatterns("include", value)}
          />
        </SettingsRow>
        <SettingsRow title="Exclude" description="Optional comma-separated glob patterns skipped by document RAG.">
          <TextField
            value={(documents().exclude ?? []).join(", ")}
            placeholder="**/archive/**"
            onChange={(value) => saveDocumentPatterns("exclude", value)}
          />
        </SettingsRow>
        <SettingsRow title="Max File Bytes" description="Documents larger than this are skipped.">
          <TextField
            value={documentValue("maxFileBytes")}
            placeholder="52428800"
            onInput={(e: InputEvent) => {
              const target = e.currentTarget as HTMLInputElement
              setDocumentDrafts((prev) => ({ ...prev, maxFileBytes: target.value }))
            }}
            onBlur={(e: FocusEvent) => {
              const target = e.currentTarget as HTMLInputElement
              saveDocumentNumber("maxFileBytes", target.value, 1)
            }}
          />
        </SettingsRow>
        <SettingsRow title="Chunk Chars" description="Approximate character budget for each document chunk.">
          <TextField
            value={documentValue("chunkChars")}
            placeholder="1200"
            onInput={(e: InputEvent) => {
              const target = e.currentTarget as HTMLInputElement
              setDocumentDrafts((prev) => ({ ...prev, chunkChars: target.value }))
            }}
            onBlur={(e: FocusEvent) => {
              const target = e.currentTarget as HTMLInputElement
              saveDocumentNumber("chunkChars", target.value, 1)
            }}
          />
        </SettingsRow>
        <SettingsRow title="Chunk Overlap Chars" description="Character overlap between adjacent document chunks.">
          <TextField
            value={documentValue("chunkOverlapChars")}
            placeholder="200"
            onInput={(e: InputEvent) => {
              const target = e.currentTarget as HTMLInputElement
              setDocumentDrafts((prev) => ({ ...prev, chunkOverlapChars: target.value }))
            }}
            onBlur={(e: FocusEvent) => {
              const target = e.currentTarget as HTMLInputElement
              saveDocumentNumber("chunkOverlapChars", target.value, 0)
            }}
          />
        </SettingsRow>
        <SettingsRow
          title="Search Max Results"
          description="Default number of snippets returned by document_search."
          last
        >
          <TextField
            value={documentValue("searchMaxResults")}
            placeholder="8"
            onInput={(e: InputEvent) => {
              const target = e.currentTarget as HTMLInputElement
              setDocumentDrafts((prev) => ({ ...prev, searchMaxResults: target.value }))
            }}
            onBlur={(e: FocusEvent) => {
              const target = e.currentTarget as HTMLInputElement
              saveDocumentNumber("searchMaxResults", target.value, 1)
            }}
          />
        </SettingsRow>
      </Card>

      <Card>
        <For each={tuning}>
          {(item, index) => (
            <SettingsRow
              title={item.label}
              description={language.t("settings.indexing.tuning.description")}
              last={index() === tuning.length - 1}
            >
              <TextField
                value={tuningValue(item.key)}
                placeholder={item.placeholder}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setTuningDrafts((prev) => ({ ...prev, [item.key]: target.value }))
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
}

export default IndexingTab
