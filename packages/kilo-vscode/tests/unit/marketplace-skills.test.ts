import { describe, expect, it } from "bun:test"
import {
  isListedUploadableSkill,
  mergeMarketplaceSkills,
  normalizeSkillKey,
  skillOrigin,
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
  it("shows a built-in grill-me Skill as a local-only installed card", () => {
    const result = mergeMarketplaceSkills(
      [],
      [
        {
          name: "grill-me",
          description: "Interview the user relentlessly about a plan or design.",
          location: "builtin",
          content: "# grill-me",
        },
      ],
      { project: {}, global: { "grill-me": { type: "skill" } } },
      true,
    )

    expect(result.marketplaceItems).toHaveLength(1)
    expect(result.marketplaceItems[0]).toMatchObject({
      id: "grill-me",
      localOnly: true,
      uploadable: true,
      origin: "builtin",
      displayCategory: "本地",
    })
    expect(result.marketplaceInstalledMetadata.global["grill-me"]).toEqual({ type: "skill" })
  })

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
    const ids = new Set(["local-guide", "global:shared"])

    expect(isListedUploadableSkill("Local Guide", ids)).toBe(true)
    expect(isListedUploadableSkill("global:shared", ids)).toBe(true)
    expect(isListedUploadableSkill("code-review", ids)).toBe(false)
    expect(isListedUploadableSkill("unknown", ids)).toBe(false)
  })

  it("renders project and global copies of one logical Skill as separate cards", () => {
    const instances = [
      {
        instanceId: "project:code-review",
        id: "code-review",
        name: "code-review",
        description: "Project v1",
        scope: "project" as const,
        root: "/workspace/.chipmate-v2/skills/code-review",
        location: "/workspace/.chipmate-v2/skills/code-review/SKILL.md",
        sha256: "1".repeat(64),
        effective: true,
      },
      {
        instanceId: "global:code-review",
        id: "code-review",
        name: "code-review",
        description: "Global v2",
        scope: "global" as const,
        root: "/storage/config/skills/code-review",
        location: "/storage/config/skills/code-review/SKILL.md",
        sha256: "2".repeat(64),
        effective: false,
        shadowedBy: "project:code-review",
      },
    ]
    const result = mergeMarketplaceSkills(
      [remote],
      [{ name: "code-review", location: instances[0].location }],
      { project: { "code-review": { type: "skill" } }, global: { "code-review": { type: "skill" } } },
      true,
      undefined,
      instances,
    )

    expect(result.marketplaceItems).toHaveLength(2)
    expect(result.marketplaceItems[0]).toMatchObject({
      id: "code-review",
      instanceId: "project:code-review",
      localScope: "project",
      effective: true,
    })
    expect(result.marketplaceItems[1]).toMatchObject({
      id: "code-review",
      instanceId: "global:code-review",
      localScope: "global",
      effective: false,
      shadowedBy: "project:code-review",
    })
  })

  it("classifies only ChipMate managed roots as marketplace-managed", () => {
    const roots = {
      project: ["/workspace/.chipmate-v2/skills", "/real/workspace/.chipmate-v2/skills"],
      global: ["/storage/config/skills"],
    }

    expect(skillOrigin({ name: "project", location: "/workspace/.chipmate-v2/skills/project/SKILL.md" }, roots)).toBe(
      "market",
    )
    expect(skillOrigin({ name: "global", location: "/storage/config/skills/global/SKILL.md" }, roots)).toBe("market")
    expect(skillOrigin({ name: "agent", location: "/workspace/.agents/skills/agent/SKILL.md" }, roots)).toBe("local")
    expect(skillOrigin({ name: "custom", location: "/opt/custom/custom/SKILL.md" }, roots)).toBe("local")
    expect(
      skillOrigin({ name: "aliased", location: "/real/workspace/.chipmate-v2/skills/aliased/SKILL.md" }, roots),
    ).toBe("market")
    expect(skillOrigin({ name: "builtin", location: "/cache/builtin-skills/builtin/SKILL.md" }, roots)).toBe("builtin")
  })
})
