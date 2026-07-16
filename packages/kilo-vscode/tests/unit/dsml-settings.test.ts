import { describe, expect, test } from "bun:test"

const tab = await Bun.file(
  new URL("../../webview-ui/src/components/settings/ExperimentalTab.tsx", import.meta.url),
).text()
const types = await Bun.file(new URL("../../webview-ui/src/types/messages/config.ts", import.meta.url)).text()
const en = await Bun.file(new URL("../../webview-ui/src/i18n/en.ts", import.meta.url)).text()
const zh = await Bun.file(new URL("../../webview-ui/src/i18n/zh.ts", import.meta.url)).text()

describe("DSML experimental settings", () => {
  test("requires an explicit target before enabling repair", () => {
    expect(tab).toContain("checked={dsml().enabled === true && !!dsml().model}")
    expect(tab).toContain("disabled={!dsml().model}")
    expect(tab).toContain('updateExperimental("dsml_tool_call_repair"')
  })

  test("uses the shared provider and model selector", () => {
    expect(tab).toContain("<ModelSelectorBase")
    expect(tab).toContain("value={parseModelString(dsml().model)}")
    expect(tab).toContain("model: providerID && modelID ? `${providerID}/${modelID}` : undefined")
  })

  test("declares the config shape and localized labels", () => {
    expect(types).toContain("dsml_tool_call_repair?: {")
    expect(types).toContain("enabled?: boolean")
    expect(types).toContain("model?: string")
    expect(en).toContain('"settings.experimental.dsml.title": "DSML Tool Call Repair"')
    expect(zh).toContain('"settings.experimental.dsml.title": "DSML 工具调用兼容解析"')
  })
})
