import { createMemo, createSignal, onCleanup, Show, createEffect, on } from "solid-js"
import type { Component } from "solid-js"
import { CodeComponentProvider } from "@chipmate/chipmate-ui/context/code"
import { DiffComponentProvider } from "@chipmate/chipmate-ui/context/diff"
import { FileComponentProvider } from "@chipmate/chipmate-ui/context/file"
import { MarkedProvider } from "@chipmate/chipmate-ui/context/marked"
import { Code } from "@chipmate/chipmate-ui/code"
import { Diff } from "@chipmate/chipmate-ui/diff"
import { File } from "@chipmate/chipmate-ui/file"
import { FileIcon } from "@chipmate/chipmate-ui/file-icon"
import { IconButton } from "@chipmate/chipmate-ui/icon-button"
import { RadioGroup } from "@chipmate/chipmate-ui/radio-group"
import { ThemeProvider } from "@chipmate/chipmate-ui/theme"
import { Tooltip } from "@chipmate/chipmate-ui/tooltip"
import { normalize } from "@chipmate/chipmate-ui/session-diff"
import { LanguageProvider, useLanguage } from "../src/context/language"
import { ServerProvider, useServer } from "../src/context/server"
import { getVSCodeAPI, VSCodeProvider } from "../src/context/vscode"
import { isMarkdownFile, MarkdownDiffView } from "../diff-viewer/MarkdownDiffView"

type DiffStyle = "unified" | "split"

interface DiffVirtualFile {
  file: string
  patch?: string
  additions: number
  deletions: number
}

const DiffVirtualContent: Component = () => {
  const { t } = useLanguage()
  const [diff, setDiff] = createSignal<DiffVirtualFile | null>(null)
  const [style, setStyle] = createSignal<DiffStyle>("unified")
  const [markdown, setMarkdown] = createSignal(false)
  let scrollerRef: HTMLDivElement | undefined

  createEffect(
    on(
      diff,
      () => {
        if (scrollerRef) {
          scrollerRef.scrollTop = 0
        }
      },
      { defer: true },
    ),
  )

  const handler = (event: MessageEvent) => {
    const msg = event.data as {
      type: string
      diff?: DiffVirtualFile
      initialDiffStyle?: DiffStyle
      markdownRender?: boolean
    }
    if (msg?.type === "diffVirtual.data" && msg.diff) {
      setDiff(msg.diff)
      setStyle(msg.initialDiffStyle ?? "unified")
      setMarkdown(msg.markdownRender === true)
    }
  }

  window.addEventListener("message", handler)
  onCleanup(() => window.removeEventListener("message", handler))

  const filename = () => {
    const f = diff()?.file ?? ""
    return f.includes("/") ? (f.split("/").pop() ?? f) : f
  }

  const directory = () => {
    const f = diff()?.file ?? ""
    if (!f.includes("/")) return null
    return f.split("/").slice(0, -1).join("/")
  }

  const view = createMemo(() => {
    const d = diff()
    if (!d?.patch) return
    return normalize(d)
  })

  return (
    <div class="am-review-layout">
      <Show when={diff()}>
        {(d) => (
          <>
            <div class="am-review-toolbar">
              <div class="am-review-toolbar-left">
                <RadioGroup
                  options={["unified", "split"] as const}
                  current={style()}
                  size="small"
                  value={(s) => s}
                  label={(s) =>
                    s === "unified" ? t("ui.sessionReview.diffStyle.unified") : t("ui.sessionReview.diffStyle.split")
                  }
                  onSelect={(s) => {
                    if (s) setStyle(s)
                  }}
                />
                <span class="am-review-toolbar-stats">
                  <FileIcon node={{ path: d().file, type: "file" }} />
                  <Show when={directory()}>
                    <span class="am-review-toolbar-dir">{`\u2066${directory()}/\u2069`}</span>
                  </Show>
                  <span class="am-review-toolbar-fname">{filename()}</span>
                  <span class="am-review-toolbar-adds">+{d().additions}</span>
                  <span class="am-review-toolbar-dels">-{d().deletions}</span>
                </span>
              </div>
              <Show when={isMarkdownFile(d().file)}>
                <Tooltip value={markdown() ? "Show raw Markdown" : "Render Markdown"} placement="bottom">
                  <IconButton
                    icon={markdown() ? "code" : "eye"}
                    size="small"
                    variant="ghost"
                    label={markdown() ? "Show raw Markdown" : "Render Markdown"}
                    onClick={() => {
                      const next = !markdown()
                      setMarkdown(next)
                      getVSCodeAPI().postMessage({ type: "diffVirtual.setMarkdownRender", render: next })
                    }}
                  />
                </Tooltip>
              </Show>
            </div>
            <div class="am-review-diff" style={{ width: "100%" }} ref={(el) => (scrollerRef = el)}>
              <Show when={view()}>
                {(v) => (
                  <Show
                    when={markdown() && isMarkdownFile(d().file)}
                    fallback={<Diff fileDiff={v().fileDiff} diffStyle={style()} hunkSeparators="simple" />}
                  >
                    <MarkdownDiffView diff={{ file: d().file, before: v().before, after: v().after }} />
                  </Show>
                )}
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}

const DiffVirtualShell: Component = () => {
  const server = useServer()

  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      <DiffComponentProvider component={Diff}>
        <CodeComponentProvider component={Code}>
          <FileComponentProvider component={File}>
            <MarkedProvider>
              <DiffVirtualContent />
            </MarkedProvider>
          </FileComponentProvider>
        </CodeComponentProvider>
      </DiffComponentProvider>
    </LanguageProvider>
  )
}

export const DiffVirtualApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="chipmate-vscode">
      <VSCodeProvider>
        <ServerProvider>
          <DiffVirtualShell />
        </ServerProvider>
      </VSCodeProvider>
    </ThemeProvider>
  )
}
