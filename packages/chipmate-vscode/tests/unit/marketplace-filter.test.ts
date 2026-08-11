import { describe, expect, it } from "bun:test"
import { filterMarketplaceItems } from "../../webview-ui/src/components/marketplace/filter"
import type { MarketplaceItem } from "../../webview-ui/src/types/marketplace"

const remote: MarketplaceItem = {
  type: "skill",
  id: "doc-helper",
  name: "Document Helper",
  displayName: "Document Helper",
  description: "Create polished product documentation",
  category: "documents",
  displayCategory: "Documents",
  tags: ["writing", "product"],
  author: "ChipMate",
  uploadedBy: "alice",
  content: "https://market.test/doc-helper.tar.gz",
}

const local: MarketplaceItem = {
  type: "skill",
  id: "board-review",
  name: "Board Review",
  displayName: "Board Review",
  description: "Review local architecture",
  category: "local",
  displayCategory: "本地",
  content: "",
  localOnly: true,
}

const metadata = { project: { "doc-helper": { type: "skill" } }, global: {} }

describe("Marketplace Skill filters", () => {
  it("searches remote and local skills across all visible metadata", () => {
    for (const query of ["document", "POLISHED", "documents", "writing", "chipmate", "alice", " board "]) {
      expect(filterMarketplaceItems([remote, local], metadata, query, "all", [])).toHaveLength(1)
    }
  })

  it("returns the full collection for blank search and intersects search with status and tags", () => {
    expect(filterMarketplaceItems([remote, local], metadata, "   ", "all", [])).toHaveLength(2)
    expect(filterMarketplaceItems([remote, local], metadata, "document", "installed", ["writing"])).toEqual([remote])
    expect(filterMarketplaceItems([remote, local], metadata, "document", "notInstalled", ["writing"])).toEqual([])
    expect(filterMarketplaceItems([remote, local], metadata, "board", "notInstalled", ["本地"])).toEqual([local])
  })
})
