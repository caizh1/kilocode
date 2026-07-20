import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "shared", "ModelSelector.tsx")
const source = readFileSync(path, "utf8")

describe("chat model selector empty state", () => {
  it("uses the prompt-only empty label without enabling the clear row", () => {
    const start = source.indexOf("export const ModelSelector:")
    const wrapper = source.slice(start)
    expect(wrapper).toContain('emptyLabel={language.t("dialog.model.noneSelected")}')
    expect(wrapper).not.toContain("allowClear")
  })
})
