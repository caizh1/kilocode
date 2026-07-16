import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { validateSkillArchive } from "@chipmate/skill-spec"

import { createSkillArchive } from "../../src/services/marketplace/archive"
import { publish, type PublicationOutcome, type PublicationPhase } from "../../src/services/marketplace/publication"
import { buildMarketplaceSkillUploadPayload } from "../../src/services/marketplace/upload"
import type { MarketplaceUploadPayload, PublicationRun } from "../../src/services/marketplace/types"

const payload: MarketplaceUploadPayload = {
  id: "local-skill",
  name: "local-skill",
  description: "Local Skill",
  files: [],
}

function run(status: PublicationRun["status"]): PublicationRun {
  return {
    id: "publication-local-skill",
    skillId: "local-skill",
    ownerId: "owner-local-skill",
    status,
    stage: "complete",
    patches: [],
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  }
}

function boundary(state: { open: boolean }, phases: Array<[PublicationPhase, PublicationRun["status"]?]>) {
  return async (
    task: (report: (phase: PublicationPhase, status?: PublicationRun["status"]) => void) => Promise<PublicationOutcome>,
  ) => {
    state.open = true
    return task((phase, status) => phases.push([phase, status])).finally(() => {
      state.open = false
    })
  }
}

describe("Marketplace publication lifecycle", () => {
  it("closes progress before running follow-up work for every server terminal status", async () => {
    const statuses = ["PUBLISHED", "UNCHANGED", "NEEDS_AUTHOR_FIX", "SECURITY_REJECTED"] as const
    for (const status of statuses) {
      const state = { open: false }
      const phases: Array<[PublicationPhase, PublicationRun["status"]?]> = []
      await publish({
        progress: boundary(state, phases),
        build: async () => payload,
        submit: async () => run(status),
        finish: async (outcome) => {
          expect(state.open).toBe(false)
          expect(outcome.run?.status).toBe(status)
        },
      })
      expect(phases).toEqual([
        ["preparing", undefined],
        ["submitting", undefined],
        ["complete", status],
      ])
    }
  })

  it("keeps progress closed while a repair or refresh follow-up is delayed", async () => {
    const state = { open: false }
    const phases: Array<[PublicationPhase, PublicationRun["status"]?]> = []
    const started = { resolve: () => undefined }
    const release = { resolve: () => undefined }
    const active = new Promise<void>((resolve) => {
      started.resolve = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release.resolve = resolve
    })
    const pending = publish({
      progress: boundary(state, phases),
      build: async () => payload,
      submit: async () => run("PUBLISHED"),
      finish: async () => {
        expect(state.open).toBe(false)
        started.resolve()
        await gate
      },
    })

    await active
    expect(state.open).toBe(false)
    release.resolve()
    await pending
  })

  it("keeps progress closed when background reconciliation fails", async () => {
    const state = { open: false }
    const phases: Array<[PublicationPhase, PublicationRun["status"]?]> = []
    await expect(
      publish({
        progress: boundary(state, phases),
        build: async () => payload,
        submit: async () => run("UNCHANGED"),
        finish: async () => {
          expect(state.open).toBe(false)
          throw new Error("refresh failed")
        },
      }),
    ).rejects.toThrow("refresh failed")
    expect(state.open).toBe(false)
    expect(phases.at(-1)).toEqual(["complete", "UNCHANGED"])
  })

  it("closes progress and skips follow-up work when submission fails", async () => {
    const state = { open: false }
    const phases: Array<[PublicationPhase, PublicationRun["status"]?]> = []
    const finish = { called: false }
    await expect(
      publish({
        progress: boundary(state, phases),
        build: async () => payload,
        submit: async () => {
          throw new Error("server unavailable")
        },
        finish: async () => {
          finish.called = true
        },
      }),
    ).rejects.toThrow("server unavailable")
    expect(state.open).toBe(false)
    expect(finish.called).toBe(false)
    expect(phases).toEqual([
      ["preparing", undefined],
      ["submitting", undefined],
    ])
  })

  it("publishes a real installed Skill snapshot without mutating its source", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "marketplace-publication-"))
    const root = path.join(tmp, "publication-skill")
    const file = path.join(root, "SKILL.md")
    const source =
      "---\nname: publication-skill\ndescription: Publication lifecycle fixture\n---\n\n# Publication Fixture\n"
    await fs.mkdir(root)
    await fs.writeFile(file, source)
    await fs.mkdir(path.join(root, "references"))
    await fs.writeFile(path.join(root, "references", "guide.md"), "# Guide\n")

    try {
      const state = { open: false }
      const phases: Array<[PublicationPhase, PublicationRun["status"]?]> = []
      await publish({
        progress: boundary(state, phases),
        build: () => buildMarketplaceSkillUploadPayload(root),
        submit: async (value) => {
          const snapshot = validateSkillArchive(createSkillArchive(value.id, value.files))
          expect(snapshot.valid).toBe(true)
          expect(snapshot.changed).toBe(false)
          return {
            ...run("PUBLISHED"),
            report: {
              valid: true,
              stage: "complete",
              issues: snapshot.issues,
              sourceSha256: snapshot.sourceSha256,
              snapshotSha256: snapshot.snapshotSha256,
              changed: snapshot.changed,
            },
          }
        },
        finish: async (outcome) => {
          expect(state.open).toBe(false)
          expect(outcome.run?.status).toBe("PUBLISHED")
          expect(outcome.run?.report?.valid).toBe(true)
        },
      })
      expect(await fs.readFile(file, "utf8")).toBe(source)
      expect(phases.at(-1)).toEqual(["complete", "PUBLISHED"])
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
