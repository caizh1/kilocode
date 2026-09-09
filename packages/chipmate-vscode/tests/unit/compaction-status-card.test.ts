import { describe, expect, it } from "bun:test"
import path from "node:path"

const WEBVIEW = path.resolve(import.meta.dir, "../../webview-ui")

describe("compaction status card", () => {
  it("renders truthful stage progress, elapsed time, and the none fallback state", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        "--conditions=browser",
        "--jsx-import-source=solid-js",
        "-e",
        `
          import { Window } from "happy-dom"

          const window = new Window()
          globalThis.window = window
          globalThis.document = window.document
          globalThis.Node = window.Node
          globalThis.Element = window.Element
          globalThis.HTMLElement = window.HTMLElement
          globalThis.SVGElement = window.SVGElement
          globalThis.acquireVsCodeApi = () => ({
            postMessage: () => {},
            getState: () => undefined,
            setState: () => {},
          })

          const { default: h } = await import("solid-js/h")
          globalThis.React = { createElement: h }
          const { createComponent } = await import("solid-js")
          const { render } = await import("solid-js/web")
          const { CompactionStatusCard } = await import("./src/components/chat/CompactionStatusCard.tsx")
          const { LanguageContext } = await import("./src/context/language.tsx")
          const { SessionContext } = await import("./src/context/session.tsx")
          const { resolveTemplate } = await import("./src/context/language-utils.ts")
          const { dict } = await import("./src/i18n/zh.ts")

          const t = (key, params) => resolveTemplate(dict[key] ?? key, params)
          const language = {
            locale: () => "zh",
            setLocale: () => {},
            userOverride: () => "",
            t,
            text: (_locale, key, params) => t(key, params),
          }
          const session = { statusInfo: () => ({ type: "busy" }) }

          const mount = (status) => {
            const root = document.createElement("div")
            const dispose = render(
              () =>
                createComponent(LanguageContext.Provider, {
                  value: language,
                  get children() {
                    return createComponent(SessionContext.Provider, {
                      value: session,
                      get children() {
                        return createComponent(CompactionStatusCard, { status })
                      },
                    })
                  },
                }),
              root,
            )
            return { root, dispose }
          }

          const stage = mount({
            state: "running",
            source: "manual",
            startedAt: Date.now() - 65_000,
            attempt: 1,
            attemptMode: "selected",
            phase: "chunk",
            completedUnits: 2,
            totalUnits: 5,
          })
          if (!stage.root.textContent.includes("当前阶段 2/5 · 40%")) throw new Error("missing determinate progress")
          if (!stage.root.textContent.includes("已等待 1分05秒")) throw new Error("missing elapsed time")
          const determinate = stage.root.querySelector('[role="progressbar"]')
          if (determinate?.getAttribute("aria-valuenow") !== "2") throw new Error("missing aria-valuenow")
          if (determinate?.getAttribute("aria-valuemax") !== "5") throw new Error("missing aria-valuemax")
          if (determinate?.hasAttribute("data-indeterminate")) throw new Error("determinate progress marked indeterminate")
          stage.dispose()

          const none = mount({
            state: "running",
            source: "manual",
            startedAt: Date.now() - 2_000,
            attempt: 2,
            attemptMode: "none",
            phase: "generating",
          })
          if (!none.root.textContent.includes("本次压缩未生成有效摘要，正在关闭思考后重试…")) {
            throw new Error("missing none fallback copy")
          }
          const indeterminate = none.root.querySelector('[role="progressbar"]')
          if (!indeterminate?.hasAttribute("data-indeterminate")) throw new Error("missing indeterminate progress")
          if (indeterminate?.hasAttribute("aria-valuenow")) throw new Error("indeterminate progress exposed a fake value")
          none.dispose()

          const finished = mount({
            state: "succeeded",
            source: "auto",
            startedAt: 1_000,
            completedAt: 66_000,
            attempt: 1,
            attemptMode: "selected",
            phase: "committing",
          })
          if (!finished.root.textContent.includes("总耗时 1分05秒")) throw new Error("missing terminal duration")
          if (finished.root.querySelector('[role="progressbar"]')) throw new Error("terminal card kept progress bar")
          finished.dispose()
        `,
      ],
      { cwd: WEBVIEW, stdout: "pipe", stderr: "pipe" },
    )

    const output = result.stdout.toString() + result.stderr.toString()
    expect(result.exitCode, output).toBe(0)
  })
})
