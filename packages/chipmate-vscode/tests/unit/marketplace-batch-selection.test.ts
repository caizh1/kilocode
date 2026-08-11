import { describe, expect, it } from "bun:test"

import {
  reconcileSelection,
  selectionKey,
  selectVisible,
  uploadable,
} from "../../webview-ui/src/components/marketplace/batch-selection"
import type { SkillMarketplaceItem } from "../../webview-ui/src/types/marketplace"

function skill(id: string, ready: boolean): SkillMarketplaceItem {
  return {
    id,
    name: id,
    description: `${id} description`,
    category: "general",
    type: "skill",
    content: "",
    displayName: id,
    displayCategory: "General",
    uploadable: ready,
  }
}

describe("Marketplace batch selection", () => {
  it("adds only visible uploadable Skills while preserving prior selections", () => {
    const items = [skill("second", true), skill("blocked", false)]

    expect(selectVisible(["first"], items)).toEqual(["first", "second"])
    expect(uploadable(items).map((item) => item.id)).toEqual(["second"])
  })

  it("removes stale and no-longer-uploadable selections after catalog refresh", () => {
    const items = [skill("kept", true), skill("blocked", false)]

    expect(reconcileSelection(["stale", "blocked", "kept"], items)).toEqual(["kept"])
  })

  it("keeps project and global copies of the same Skill independently selectable", () => {
    const project = { ...skill("shared", true), instanceId: "project:shared" }
    const global = { ...skill("shared", true), instanceId: "global:shared" }

    expect(selectionKey(project)).toBe("project:shared")
    expect(selectVisible([], [project, global])).toEqual(["project:shared", "global:shared"])
    expect(reconcileSelection(["project:shared", "global:shared"], [global])).toEqual(["global:shared"])
  })
})
