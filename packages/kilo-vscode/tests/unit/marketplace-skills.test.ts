import { describe, expect, it } from "bun:test"
import {
  isListedUploadableSkill,
  mergeMarketplaceSkills,
  normalizeSkillKey,
} from "../../src/services/marketplace/skills"
import type { MarketplaceItem } from "../../src/services/marketplace/types"

const remote: MarketplaceItem = {
  type: "skill",
  id: "code-review",
  name: "Code Review",
  displayName: "Code Review",
  description: "Review source changes",
  category: "engineering",
  displayCategory: "Engineering",
  content: "https://market.test/code-review.tar.gz",
}

const metadata = {
  project: { [normalizeSkillKey("Code Review")]: { type: "skill" } },
  global: { [normalizeSkillKey("Local Guide")]: { type: "skill" } },
}

describe("Marketplace Skill merge", () => {
  it("uses one remote card and aliases local installation scopes", () => {
    const result = mergeMarketplaceSkills(
      [remote],
      [
        {
          name: "Code Review",
          description: "Local copy",
          location: "/workspace/.kilo/skills/code-review/SKILL.md",
          content: "# Code Review",
        },
        {
          name: "Local Guide",
          description: "Only installed locally",
          location: "/home/user/.config/kilo/skills/local-guide/SKILL.md",
          content: "# Local Guide",
        },
      ],
      metadata,
      true,
    )

    expect(result.marketplaceItems.filter((item) => item.type === "skill")).toHaveLength(2)
    expect(result.marketplaceItems.find((item) => item.id === "code-review")?.localOnly).toBeUndefined()
    expect(result.marketplaceItems.find((item) => item.id === "code-review")?.uploadable).toBe(true)
    expect(result.marketplaceInstalledMetadata.project["code-review"]).toEqual({ type: "skill" })
    expect(result.marketplaceInstalledMetadata.global["local-guide"]).toEqual({ type: "skill" })
    expect(result.marketplaceItems.find((item) => item.id === "local-guide")).toMatchObject({
      localOnly: true,
      uploadable: true,
      displayCategory: "本地",
    })
  })

  it("deduplicates local Skills and keeps them visible but not uploadable when the remote catalog fails", () => {
    const result = mergeMarketplaceSkills(
      [],
      [
        {
          name: "Local Guide",
          location: "/workspace/.kilo/skills/local-guide/SKILL.md",
          content: "# Local Guide",
        },
        {
          name: "local guide",
          location: "/home/user/.config/kilo/skills/local-guide/SKILL.md",
          content: "# Local Guide",
        },
      ],
      {
        project: { "local-guide": { type: "skill" } },
        global: { "local-guide": { type: "skill" } },
      },
      false,
    )

    expect(result.marketplaceItems).toHaveLength(1)
    expect(result.marketplaceItems[0]).toMatchObject({ id: "local-guide", localOnly: true, uploadable: false })
    expect(result.marketplaceInstalledMetadata.project["local-guide"]).toEqual({ type: "skill" })
    expect(result.marketplaceInstalledMetadata.global["local-guide"]).toEqual({ type: "skill" })
  })

  it("does not mark unreadable local entries as uploadable", () => {
    const result = mergeMarketplaceSkills(
      [],
      [{ name: "Metadata Only", location: "/workspace/.kilo/skills/metadata-only/README.md" }],
      { project: { "metadata-only": { type: "skill" } }, global: {} },
      true,
    )

    expect(result.marketplaceItems[0]).toMatchObject({ id: "metadata-only", localOnly: true, uploadable: false })
  })

  it("accepts upload requests only for currently verified uploadable card ids", () => {
    const ids = new Set(["local-guide"])

    expect(isListedUploadableSkill("Local Guide", ids)).toBe(true)
    expect(isListedUploadableSkill("code-review", ids)).toBe(false)
    expect(isListedUploadableSkill("unknown", ids)).toBe(false)
  })
})
