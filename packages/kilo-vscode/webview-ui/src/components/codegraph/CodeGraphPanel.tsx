import { For, Show } from "solid-js"
import type { Component } from "solid-js"
import {
  formatIndexingDiagnostic,
  formatIndexingPipelineLabel,
  indexingPipelineDescription,
  indexingPipelineTone,
  useIndexing,
} from "../../context/indexing"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import type { IndexingPipelineStatus } from "../../types/messages"

const count = new Intl.NumberFormat()

const clamp = (value: number) => `${Math.max(0, Math.min(100, value))}%`

const date = (value?: string) => {
  if (!value) return "Not scanned"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

const metric = (pipe: IndexingPipelineStatus) => [
  { label: "Progress", value: `${pipe.percent}%` },
  { label: "Files", value: `${count.format(pipe.processedFiles)}/${count.format(pipe.totalFiles)}` },
  { label: "Valid", value: count.format(pipe.validFileCount ?? pipe.processedFiles) },
  { label: "Issues", value: count.format(pipe.errorCount + pipe.staleCount + pipe.skippedCount) },
]

const CodeGraphPanel: Component = () => {
  const server = useServer()
  const vscode = useVSCode()
  const indexing = useIndexing()
  const code = () => indexing.pipelines().codeGraph
  const rows = () => [
    { label: "Code Graph", icon: "type-hierarchy", pipe: code() },
    { label: "RAG", icon: "database", pipe: indexing.pipelines().rag },
  ]
  const errors = () => code().recentErrors?.slice(0, 4) ?? []
  const workspace = () => {
    const dir = server.workspaceDirectory()
    if (!dir) return "Current workspace"
    const root = dir.replace(/[\\/]+$/, "")
    return root.split(/[\\/]/).pop() || root
  }

  return (
    <section class="cm-codegraph" aria-label="CodeGraph">
      <header class="cm-codegraph__header">
        <div class="cm-codegraph__title">
          <span class="codicon codicon-type-hierarchy" />
          <div>
            <p>{workspace()}</p>
            <h1>CodeGraph</h1>
          </div>
        </div>
        <div class="cm-codegraph__actions">
          <button
            class="cm-secondary-button"
            type="button"
            onClick={() => vscode.postMessage({ type: "openSettingsTab", tab: "indexing" })}
          >
            <span class="codicon codicon-settings-gear" />
            Settings
          </button>
          <button
            class="cm-primary-button"
            type="button"
            onClick={() => vscode.postMessage({ type: "requestIndexingStatus" })}
          >
            <span class="codicon codicon-sync" />
            Refresh
          </button>
        </div>
      </header>

      <section class={`cm-status-card cm-status-card--${indexingPipelineTone(code())}`}>
        <div>
          <p>Current status</p>
          <strong>{indexing.loading() ? "Loading" : formatIndexingPipelineLabel("Code Graph", code())}</strong>
          <span>{indexingPipelineDescription(code())}</span>
        </div>
        <div class="cm-status-card__scan">
          <span>Last scan</span>
          <strong>{date(code().lastFullScanAt)}</strong>
        </div>
      </section>

      <div class="cm-pipeline-grid">
        <For each={rows()}>
          {(row) => (
            <section class={`cm-glass-card cm-pipeline-card cm-pipeline-card--${indexingPipelineTone(row.pipe)}`}>
              <div class="cm-pipeline-card__heading">
                <span class={`codicon codicon-${row.icon}`} />
                <div>
                  <h2>{row.label}</h2>
                  <p>{indexingPipelineDescription(row.pipe)}</p>
                </div>
              </div>
              <div class="cm-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={row.pipe.percent}>
                <span style={{ width: clamp(row.pipe.percent) }} />
              </div>
              <div class="cm-metric-grid">
                <For each={metric(row.pipe)}>
                  {(item) => (
                    <div>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>

      <section class="cm-glass-card cm-diagnostics-card">
        <div class="cm-diagnostics-card__heading">
          <span class="codicon codicon-warning" />
          <h2>Recent diagnostics</h2>
        </div>
        <Show
          when={errors().length > 0}
          fallback={<p class="cm-diagnostics-card__empty">No recent Code Graph diagnostics.</p>}
        >
          <ul>
            <For each={errors()}>{(err) => <li>{formatIndexingDiagnostic(err, code())}</li>}</For>
          </ul>
        </Show>
      </section>
    </section>
  )
}

export default CodeGraphPanel
