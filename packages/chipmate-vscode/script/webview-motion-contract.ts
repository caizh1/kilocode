function canonical(css: string) {
  return css
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([>,{}])\s*/g, "$1")
    .trim()
}

const unscopedChatWildcard =
  /(?:^|[,{])\.chat-view\[data-ui=qa-shell\] \*(?::before|::before|:after|::after)?(?:,|\{)/

const required = [
  {
    label: "VS Code reduced-motion 工作区规则",
    selector: "body.vscode-reduce-motion .chat-view[data-ui=qa-shell] *",
  },
  {
    label: "非 VS Code 页面系统 reduced-motion fallback",
    selector: "body:not([data-vscode-theme-id]) .chat-view[data-ui=qa-shell] *",
  },
  {
    label: "VS Code 动态 Spinner reduced-motion 规则",
    selector:
      "body.vscode-reduce-motion [data-component=spinner][data-spinner-variant]>[data-slot=spinner-motion]",
  },
  {
    label: "非 VS Code 页面动态 Spinner fallback",
    selector:
      "body:not([data-vscode-theme-id]) [data-component=spinner][data-spinner-variant]>[data-slot=spinner-motion]",
  },
] as const

export function verifyWebviewMotionContract(css: string): void {
  const value = canonical(css)
  if (!value) throw new Error("VSIX 中的 extension/dist/webview.css 为空。")
  if (unscopedChatWildcard.test(value)) {
    throw new Error(
      "VSIX 的 webview.css 含有未受 VS Code 最终运动偏好约束的聊天区通配动画规则；它会让 WorkingIndicator 在 Reduce Motion 关闭后仍退化为静态图标。",
    )
  }
  for (const item of required) {
    if (!value.includes(item.selector)) {
      throw new Error(`VSIX 的 webview.css 缺少${item.label}：${item.selector}`)
    }
  }
}
