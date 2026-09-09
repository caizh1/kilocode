import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { verifyWebviewMotionContract } from "../../script/webview-motion-contract"

const valid = `
body.vscode-reduce-motion .chat-view[data-ui="qa-shell"] *,
body.vscode-reduce-motion .chat-view[data-ui="qa-shell"] *::before {
  animation-duration: 0.01ms !important;
}
@media (prefers-reduced-motion: reduce) {
  body:not([data-vscode-theme-id]) .chat-view[data-ui="qa-shell"] * {
    animation-duration: 0.01ms !important;
  }
}
body.vscode-reduce-motion
  [data-component="spinner"][data-spinner-variant]
  > [data-slot="spinner-motion"] {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  body:not([data-vscode-theme-id])
    [data-component="spinner"][data-spinner-variant]
    > [data-slot="spinner-motion"] {
    display: none;
  }
}
`

describe("VSIX Webview 动画契约", () => {
  it("接受由 VS Code 最终运动偏好约束的规则", () => {
    expect(() => verifyWebviewMotionContract(valid)).not.toThrow()
  })

  it("拒绝会覆盖工作动画的原始媒体查询通配规则", () => {
    const stale = `${valid}@media (prefers-reduced-motion: reduce) {
      .chat-view[data-ui="qa-shell"] *,
      .chat-view[data-ui="qa-shell"] *::before {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
      }
    }`
    expect(() => verifyWebviewMotionContract(stale)).toThrow("未受 VS Code 最终运动偏好约束")
  })

  it("拒绝缺少动态 Spinner fallback 的产物", () => {
    const incomplete = valid.replace(
      "body:not([data-vscode-theme-id])\n    [data-component=\"spinner\"][data-spinner-variant]\n    > [data-slot=\"spinner-motion\"]",
      "body .missing-spinner-fallback",
    )
    expect(() => verifyWebviewMotionContract(incomplete)).toThrow("缺少非 VS Code 页面动态 Spinner fallback")
  })

  it("要求正式打包流程审计最终 VSIX", () => {
    const build = readFileSync(join(import.meta.dir, "../../script/build.ts"), "utf8")
    expect(build).toContain("await verifyWebviewMotionVsix(vsixPath)")
    expect(build).toContain("verifyWebviewMotionContract(out.text())")
  })
})
