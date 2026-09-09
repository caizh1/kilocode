import { expect, test } from "bun:test"
import * as vscode from "vscode"
import { buildWebviewHtml } from "../../src/utils"

test("首屏标记区分原生侧栏导航与独立面板", () => {
  const uri = vscode.Uri.file("/验收/资源")
  const options = {
    scriptUri: uri,
    styleUri: uri,
    iconsBaseUri: uri,
    motionBaseUri: uri,
    workerUri: uri,
    title: "验收",
  }
  const webview = { cspSource: "vscode-webview://验收" } as vscode.Webview
  expect(buildWebviewHtml(webview, { ...options, nativeNavigation: true })).toContain(
    'data-chipmate-native-navigation="true"',
  )
  expect(buildWebviewHtml(webview, options)).toContain('data-chipmate-native-navigation="false"')
})

test("安装与升级沿用原版默认，页面不由宿主主题启用未来风", async () => {
  const manifest = await Bun.file(new URL("../../package.json", import.meta.url)).json()
  expect(manifest.contributes.configuration.properties["chipmate.v2.appearance.skin"].default).toBe("default")
  const uri = vscode.Uri.file("/验收/资源")
  const html = buildWebviewHtml({ cspSource: "vscode-webview://验收" } as vscode.Webview, {
    scriptUri: uri,
    styleUri: uri,
    iconsBaseUri: uri,
    motionBaseUri: uri,
    workerUri: uri,
    title: "默认验收",
  })
  expect(html).toContain('data-chipmate-skin="default"')
  expect(html).not.toContain('data-color-scheme="dark"')
  for (const name of ["page", "composer", "tab"]) expect(html).toContain(`--future-${name}-frame: url(`)
  // 受控错误默认值会被同一首屏断言拒绝。
  expect(html.replace('data-chipmate-skin="default"', 'data-chipmate-skin="night-city"')).not.toContain(
    'data-chipmate-skin="default"',
  )
})
