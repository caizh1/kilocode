import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { SkillMarketRequest } from "@kilocode/sdk/v2/client"
import type { MarketplaceService } from "../../src/services/marketplace"
import { MarketTransactionError, MarketTransactionManager } from "../../src/services/skill-market/transaction"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("Skill Market transactions", () => {
  it("commits and undoes a created Skill without leaving target state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-market-transaction-"))
    roots.push(root)
    const manager = service(root)
    const prepared = await manager.execute(create(), root)
    const id = prepared.transactionId!
    await manager.execute(action("approve", id), root)
    const committed = await manager.execute(action("commit", id), root)
    const target = path.join(root, ".chipmate-v2", "skills", "demo-skill", "SKILL.md")
    expect(committed.state).toBe("COMMITTED")
    expect(await fs.readFile(target, "utf8")).toContain("Demo Skill")
    expect(committed.undoUntil).toBeDefined()

    const undone = await manager.execute(action("undo", id), root)
    expect(undone.state).toBe("UNDONE")
    expect(await fs.access(target).then(() => true, () => false)).toBe(false)
  })

  it("refuses to overwrite user changes during undo", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-market-transaction-"))
    roots.push(root)
    const manager = service(root)
    const prepared = await manager.execute(create(), root)
    const id = prepared.transactionId!
    await manager.execute(action("approve", id), root)
    await manager.execute(action("commit", id), root)
    const target = path.join(root, ".chipmate-v2", "skills", "demo-skill", "SKILL.md")
    await fs.appendFile(target, "\nUser change\n")

    await expect(manager.execute(action("undo", id), root)).rejects.toMatchObject({
      code: "undo_conflict",
    } satisfies Partial<MarketTransactionError>)
    expect(await fs.readFile(target, "utf8")).toContain("User change")
  })

  it("keeps a create-and-publish parent transaction recoverable while the remote result is uncertain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-market-transaction-"))
    roots.push(root)
    const calls = { count: 0 }
    const market = {
      uploadSkill: async () => {
        calls.count += 1
        if (calls.count < 3) throw new Error("response lost")
        return {
          id: "publication-1",
          ownerId: "owner-1",
          status: "PUBLISHED" as const,
          stage: "complete" as const,
          patches: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          release: {
            skillId: "demo-skill",
            revision: 1,
            sha256: "a".repeat(64),
            archiveUrl: "/archive",
            publishedAt: new Date().toISOString(),
          },
        }
      },
    } as unknown as MarketplaceService
    const manager = new MarketTransactionManager({
      global: path.join(root, "global"),
      market,
      key: async () => "api-key",
    })
    const begun = await manager.execute(
      {
        id: "smr-begin",
        sessionID: "ses_test",
        key: "0123456789abcdef-begin",
        operation: "begin",
        skillId: "demo-skill",
        scope: "project",
        intents: ["create", "publish"],
      },
      root,
    )
    const id = begun.transactionId!
    await manager.execute({ ...create(), transactionId: id }, root)
    await manager.execute(action("approve", id), root)
    await manager.execute(
      {
        id: "smr-publish",
        sessionID: "ses_test",
        key: "0123456789abcdef-publish",
        operation: "prepare_publish",
        transactionId: id,
        skillId: "demo-skill",
        scope: "project",
      },
      root,
    )
    await manager.execute(action("approve", id), root)
    await expect(manager.execute(action("commit", id), root)).rejects.toMatchObject({ code: "remote_uncertain" })
    expect((await manager.execute(action("commit", id), root)).state).toBe("COMMITTED")
    expect(calls.count).toBe(3)
  })

  it("recovers a crash before the first directory rename without deleting the original Skill", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-market-transaction-"))
    roots.push(root)
    const target = path.join(root, ".chipmate-v2", "skills", "demo-skill")
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, "SKILL.md"), skill("Original Skill"))
    const prepared = await service(root).execute({ ...create(), replace: true }, root)
    const id = prepared.transactionId!
    const dir = path.join(root, ".chipmate-v2", ".marketplace-transactions", id)
    const file = path.join(dir, "record.json")
    const record = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>
    record.state = "COMMITTING"
    record.localStarted = true
    await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`)
    await fs.writeFile(`${target}.market.lock`, `${JSON.stringify({ pid: 2_147_483_647 })}\n`)

    const recovered = await service(root).execute(action("status", id), root)
    expect(recovered.state).toBe("ROLLED_BACK")
    expect(await fs.readFile(path.join(target, "SKILL.md"), "utf8")).toContain("Original Skill")
    expect(await fs.access(`${target}.market.lock`).then(() => true, () => false)).toBe(false)
  })
})

function service(root: string) {
  const market = {} as MarketplaceService
  return new MarketTransactionManager({
    global: path.join(root, "global"),
    market,
    key: async () => undefined,
    workspaces: () => [root],
  })
}

function create(): SkillMarketRequest {
  return {
    id: "smr-test",
    sessionID: "ses_test",
    key: "0123456789abcdef",
    operation: "prepare_create",
    skillId: "demo-skill",
    name: "Demo Skill",
    description: "A transaction test Skill",
    category: "testing",
    tags: ["test"],
    scope: "project",
    replace: false,
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content: skill("Demo Skill"),
      },
    ],
  }
}

function action(operation: "approve" | "commit" | "status" | "undo", transactionId: string): SkillMarketRequest {
  return {
    id: `smr-${operation}`,
    sessionID: "ses_test",
    key: `0123456789abcdef-${operation}`,
    operation,
    transactionId,
  }
}

function skill(name: string) {
  return `---\nid: "demo-skill"\nname: "${name}"\ndescription: "A transaction test Skill"\ncategory: "testing"\ntags: ["test"]\n---\n\n# ${name}\n\nUse this Skill for transaction tests.\n`
}
