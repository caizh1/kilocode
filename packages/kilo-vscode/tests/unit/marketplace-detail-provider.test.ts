import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const app = fs.readFileSync(path.join(root, "webview-ui/marketplace/MarketplaceApp.tsx"), "utf8")
const detail = fs.readFileSync(
  path.join(root, "webview-ui/src/components/marketplace/AlignedSkillMarket.tsx"),
  "utf8",
)

describe("Marketplace Skill detail providers", () => {
  it("mounts the Markdown context used by the real Skill detail view", () => {
    expect(detail).toContain("<Markdown text={detail().markdown} />")
    expect(app).toContain('import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"')
    expect(app.indexOf("<MarkedProvider>")).toBeLessThan(app.indexOf("<MarketplaceView />"))
    expect(app.indexOf("</MarkedProvider>")).toBeGreaterThan(app.indexOf("<MarketplaceView />"))
  })
})
