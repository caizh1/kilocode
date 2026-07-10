import { Component, For, Show, createMemo } from "solid-js"
import type { ToolPart } from "../../types/messages"
import { useVSCode } from "../../context/vscode"
import { documentArtifactCardFromToolPart } from "./document-artifact-card"

export const DocumentArtifactCard: Component<{ part: ToolPart }> = (props) => {
  const vscode = useVSCode()
  const card = createMemo(() => documentArtifactCardFromToolPart(props.part))
  const open = (path: string) => (event: MouseEvent) => {
    event.preventDefault()
    vscode.postMessage({ type: "openFile", filePath: path })
  }
  return (
    <Show when={card()}>
      {(item) => (
        <section class="document-artifact-card" data-quality={item().quality ?? "unknown"}>
          <div class="document-artifact-card__header">
            <div>
              <div class="document-artifact-card__eyebrow">Document Artifact</div>
              <div class="document-artifact-card__title">{item().title}</div>
            </div>
            <span class="document-artifact-card__status" data-quality={item().quality ?? "unknown"}>
              {label(item().quality)}
            </span>
          </div>
          <Show when={item().artifactDir}>
            {(dir) => <div class="document-artifact-card__path">{dir()}</div>}
          </Show>
          <div class="document-artifact-card__links">
            <For each={item().links}>
              {(link) => (
                <a
                  class="document-artifact-card__link"
                  data-kind={link.kind}
                  href="#"
                  onClick={open(link.path)}
                  title={link.path}
                >
                  {link.label}
                </a>
              )}
            </For>
          </div>
          <div class="document-artifact-card__previews">
            <For each={item().links.filter((link) => link.kind === "page-png" && link.webviewUri)}>
              {(link) => <img class="document-artifact-card__preview" src={link.webviewUri} alt={link.label} title={link.path} loading="lazy" />}
            </For>
          </div>
          <Show when={item().warnings.length > 0}>
            <ul class="document-artifact-card__warnings">
              <For each={item().warnings.slice(0, 4)}>{(warning) => <li>{warning}</li>}</For>
            </ul>
          </Show>
        </section>
      )}
    </Show>
  )
}

function label(input: string | undefined): string {
  if (input === "ok") return "OK"
  if (input === "warning") return "Warning"
  if (input === "failed") return "Failed"
  return "Unknown"
}
