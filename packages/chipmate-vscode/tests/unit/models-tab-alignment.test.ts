import { describe, expect, it } from "bun:test"

const models = await Bun.file(
  new URL("../../webview-ui/src/components/settings/ModelsTab.tsx", import.meta.url),
).text()
const styles = await Bun.file(new URL("../../webview-ui/src/styles/settings.css", import.meta.url)).text()

describe("Models tab alignment", () => {
  it("stretches the subagent model controls across the settings input column", () => {
    expect(models).toContain('class="settings-model-controls"')
    expect(models).not.toContain('"align-items": "flex-end"')
    expect(styles).toMatch(
      /\.settings-shell \.settings-model-controls \{[\s\S]*?align-items: stretch;[\s\S]*?width: 100%;/,
    )
    expect(styles).toMatch(
      /\.settings-shell \[data-slot="settings-row-input"\] \[data-slot="popover-trigger"\] \{[\s\S]*?width: 100%;/,
    )
  })
})
