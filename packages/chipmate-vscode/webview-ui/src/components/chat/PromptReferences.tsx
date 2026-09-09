import { For, Show, createSignal } from "solid-js"
import { Button } from "@chipmate/chipmate-ui/button"
import { Tooltip } from "@chipmate/chipmate-ui/tooltip"
import { PopupSelector } from "../shared/PopupSelector"
import type { usePromptReferences } from "../../hooks/usePromptReferences"
import { ACCEPTED_IMAGE_TYPES } from "../../hooks/image-attachments-utils"

type References = ReturnType<typeof usePromptReferences>

export function PromptReferenceActions(props: { references: References; disabled: boolean }) {
  let picker: HTMLInputElement | undefined
  const actions = [
    { icon: "attach", label: "引用文件", run: () => props.references.file("file") },
    { icon: "file-media", label: "添加图片", run: () => picker && props.references.images(picker) },
    { icon: "code", label: "引用选中代码", run: () => props.references.editor("selection") },
    { icon: "folder-opened", label: "引用文件夹", run: () => props.references.file("folder") },
  ]
  return (
    <div class="night-city-reference-actions" aria-label="添加引用">
      <input ref={picker} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} multiple hidden aria-label="选择图片" />
      <For each={actions}>
        {(action) => (
          <Tooltip value={action.label} placement="top">
            <Button
              variant="ghost"
              size="small"
              aria-label={action.label}
              disabled={props.disabled}
              onMouseDown={(event: MouseEvent) => event.preventDefault()}
              onClick={action.run}
            >
              <span class={`codicon codicon-${action.icon}`} aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
      </For>
    </div>
  )
}

export function PromptReferenceSummary(props: { references: References; disabled: boolean }) {
  const [open, setOpen] = createSignal(false)
  const count = () => props.references.paths().length + props.references.quotes().length
  const summary = () => {
    const paths = props.references.paths()
    const count = paths.length + props.references.quotes().length
    if (!count) return "上下文：未添加"
    if (count === 1 && paths.length === 1 && paths[0] === props.references.current()) return "上下文：当前文件"
    return `上下文：${count} 项引用`
  }
  return (
    <div class="night-city-reference-summary">
      <PopupSelector
        expanded={false}
        open={open()}
        onOpenChange={setOpen}
        preferredWidth={320}
        preferredHeight={260}
        minHeight={80}
        placement="top-start"
        triggerAs={Button}
        triggerProps={{
          variant: "ghost",
          size: "small",
          class: "night-city-context-trigger",
          "aria-label": "上下文引用",
          get title() {
            return summary()
          },
          get "aria-description"() {
            return summary()
          },
        }}
        trigger={
          <>
            <span class="codicon codicon-references" aria-hidden="true" />
            <Show when={count()}>
              <span class="night-city-context-count" aria-hidden="true">
                {count()}
              </span>
            </Show>
          </>
        }
      >
        {() => (
          <div class="night-city-context-menu">
            <Button
              variant="ghost"
              size="small"
              disabled={props.disabled}
              onClick={() => {
                setOpen(false)
                props.references.editor("file")
              }}
            >
              添加当前文件
            </Button>
            <Show
              when={props.references.paths().length + props.references.quotes().length}
              fallback={<p>尚未添加文件、文件夹或代码引用。</p>}
            >
              <For each={props.references.paths()}>
                {(path) => (
                  <div class="night-city-context-item">
                    <Button variant="ghost" size="small" title={path} onClick={() => props.references.open(path)}>
                      {path}
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      aria-label={`移除引用 ${path}`}
                      onClick={() => props.references.remove(path)}
                    >
                      <span class="codicon codicon-close" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </For>
              <For each={props.references.quotes()}>
                {(quote) => (
                  <div class="night-city-context-item">
                    <Button
                      variant="ghost"
                      size="small"
                      title={quote.text}
                      onClick={() => props.references.open(quote.path)}
                    >
                      {quote.label}
                    </Button>
                    <Button
                      variant="ghost"
                      size="small"
                      aria-label={`移除代码引用 ${quote.label}`}
                      onClick={() => props.references.removeQuote(quote)}
                    >
                      <span class="codicon codicon-close" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        )}
      </PopupSelector>
    </div>
  )
}
