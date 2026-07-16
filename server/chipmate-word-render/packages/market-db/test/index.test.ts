import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { MarketDb, MARKET_DB_SCHEMA_VERSION, MIGRATIONS } from "../src/index.ts"
import { readSkillArchive, validateSkillArchive } from "@chipmate/skill-spec"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../../..")
const archive = resolve(repo, "docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz")
const source = resolve(repo, ".kilo/skills/source-backed-detail-design")

test("database schema uses ordered migrations", () => {
  assert.equal(MARKET_DB_SCHEMA_VERSION, 6)
  assert.deepEqual(
    MIGRATIONS.map((migration) => migration.version),
    [1, 2, 3, 4, 5, 6],
  )
})

test("worker owns import, revisions, FTS, state, metrics, and legacy export", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-market-db-"))
  const legacy = join(root, "legacy")
  const skills = join(legacy, "skills")
  const store = join(root, "store")
  const output = join(root, "legacy-latest")
  const v1 = join(skills, "source-backed-detail-design.tar.gz")
  const v2 = join(skills, "source-backed-detail-design-v2.tar.gz")
  await mkdir(skills, { recursive: true })
  await copyFile(archive, v1)
  await catalog(legacy, "skills/source-backed-detail-design.tar.gz", "2026-07-10T00:00:00.000Z")

  const db = new MarketDb({ dir: store })
  try {
    const health = await db.health()
    assert.deepEqual(
      {
        available: health.available,
        schemaVersion: health.schemaVersion,
        journalMode: health.journalMode,
        foreignKeys: health.foreignKeys,
        busyTimeout: health.busyTimeout,
      },
      { available: true, schemaVersion: 6, journalMode: "wal", foreignKeys: true, busyTimeout: 5000 },
    )

    const first = await db.importLegacy(legacy)
    assert.equal(first.imported, 1)
    assert.equal(first.revisions[0]?.revision, 1)
    assert.equal((await db.importLegacy(legacy)).unchanged, 1)
    const found = await db.search({ q: "Detail Design", category: "documents" })
    assert.equal(found.length, 1)
    assert.equal((await db.get("source-backed-detail-design"))?.latestRevision, 1)
    assert.equal((await db.version()).length, 64)
    assert.equal((await db.releases("source-backed-detail-design")).length, 1)
    assert.equal((await db.release("source-backed-detail-design", 1))?.revision, 1)
    assert.equal((await db.categories())[0]?.id, "documents")
    assert.equal((await db.author(found[0]?.authorId ?? ""))?.skills.length, 1)
    const files = await db.files("source-backed-detail-design", 1)
    assert.ok(files.some((file) => file.path === "SKILL.md"))
    assert.match((await db.file("source-backed-detail-design", "SKILL.md", 1))?.text ?? "", /source-backed/i)

    await db.favorite({
      userId: "user-000000000001",
      displayName: "测试用户",
      skillId: "source-backed-detail-design",
      value: true,
    })
    assert.equal((await db.favorites("user-000000000001"))[0]?.favorites, 1)

    const installed = await db.installation({
      userId: "user-000000000001",
      displayName: "测试用户",
      clientId: "client-0000000001",
      skillId: "source-backed-detail-design",
      revision: 1,
      sha256: first.revisions[0]?.sha256 ?? "",
      scope: "project",
      workspaceId: "workspace-0000001",
      status: "installed",
    })
    assert.equal(installed.status, "installed")

    const publication = await db.publication({
      id: "run-1",
      ownerId: "user-000000000001",
      ownerName: "测试用户",
      skillId: "source-backed-detail-design",
      status: "VALIDATING",
      stage: "uploaded",
      snapshotPath: join(root, "snapshot"),
      snapshotSha256: "a".repeat(64),
    })
    assert.equal(publication.status, "VALIDATING")

    const accepted = await db.events([
      {
        id: "event-1",
        name: "skill_open",
        surface: "web",
        userId: "user-000000000001",
        clientId: "client-0000000001",
        skillId: "source-backed-detail-design",
        revision: 1,
        occurredAt: "2026-07-12T01:00:00.000Z",
      },
      {
        id: "event-2",
        name: "skill_install",
        surface: "vscode",
        userId: "user-000000000001",
        clientId: "client-0000000001",
        skillId: "source-backed-detail-design",
        revision: 1,
        occurredAt: "2026-07-12T01:01:00.000Z",
      },
    ])
    assert.equal(accepted.accepted, 2)
    assert.equal(
      (
        await db.events([
          {
            id: "event-1",
            name: "skill_open",
            surface: "web",
            userId: "user-000000000001",
            clientId: "client-0000000001",
            occurredAt: "2026-07-12T01:00:00.000Z",
          },
        ])
      ).accepted,
      0,
    )
    assert.equal((await db.aggregate()).length, 2)
    await db.events([
      {
        id: "event-old",
        name: "market_impression",
        surface: "web",
        userId: "user-000000000001",
        clientId: "client-0000000001",
        occurredAt: "2026-04-01T01:00:00.000Z",
      },
    ])
    const retained = await db.maintain("2026-07-12T12:00:00.000Z")
    assert.equal(retained.rawDeleted, 1)
    assert.equal(retained.metricsDeleted, 0)
    assert.ok(retained.metrics.some((item) => item.date === "2026-04-01" && item.name === "market_impression"))
    assert.ok((await db.aggregate()).some((item) => item.date === "2026-04-01" && item.name === "market_impression"))

    const rev = join(root, "revision")
    await cp(source, join(rev, "source-backed-detail-design"), { recursive: true })
    await writeFile(join(rev, "source-backed-detail-design", "revision.txt"), "revision 2\n")
    execFileSync("tar", ["-czf", v2, "-C", rev, "source-backed-detail-design"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    })
    await catalog(legacy, "skills/source-backed-detail-design-v2.tar.gz", "2026-07-12T02:00:00.000Z")
    const second = await db.importLegacy(legacy)
    assert.equal(second.imported, 1)
    assert.equal(second.revisions[0]?.revision, 2)
    await readFile(v1)

    const exported = await db.exportLegacy(output)
    assert.equal(exported.count, 1)
    const latest = JSON.parse(await readFile(join(output, "skills.json"), "utf8")) as {
      items: Array<{ revision: number; sha256: string; githubUrl: string; legacyOnly: string }>
    }
    assert.equal(latest.items[0]?.revision, 2)
    assert.equal(latest.items[0]?.sha256, second.revisions[0]?.sha256)
    assert.equal(latest.items[0]?.githubUrl, "https://git.example/skill")
    assert.equal(latest.items[0]?.legacyOnly, "preserved")
    await readFile(join(output, "skills", "source-backed-detail-design.tar.gz"))
  } finally {
    await db.close()
  }

  const sqlite = new DatabaseSync(join(store, "market.sqlite"))
  const tables = new Set(
    (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as unknown as Array<{ name: string }>
    ).map((row) => row.name),
  )
  for (const table of [
    "users",
    "sessions",
    "skills",
    "releases",
    "assets",
    "favorites",
    "installations",
    "publication_runs",
    "validation_issues",
    "events",
    "daily_metrics",
    "audit_events",
    "imports",
    "skill_search",
  ]) {
    assert.ok(tables.has(table), table)
  }
  assert.throws(() => sqlite.prepare("UPDATE releases SET notes='mutated'").run(), /releases are immutable/)
  sqlite.close()
  await rm(root, { recursive: true, force: true })
})

test("worker validates, repairs, publishes, deduplicates, versions, and unpublishes immutable releases", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-publication-"))
  const store = join(root, "store")
  const source = join(root, "source", "new-skill")
  await mkdir(source, { recursive: true })
  await writeFile(
    join(source, "skill.md"),
    "---\n# retained comment\nname: New Skill\ndescription: First release\nversion: 9.9.9\nlicense: Apache-2.0\ncompatibility: Kilo or Codex\nallowed-tools: Read Bash\nx-vendor-mode: careful\n---\n\n# New Skill\n\nFirst body.\n",
  )
  await writeFile(
    join(source, "skill.json"),
    `${JSON.stringify({ id: "new-skill", semver: "1.0.0", category: "general", tags: ["portable"], vendor: { icon: "glass" } })}\n`,
  )
  await mkdir(join(source, "agents"), { recursive: true })
  await writeFile(join(source, "agents", "openai.yaml"), "interface:\n  display_name: New Skill\n")
  const archive = join(root, "new-skill.tar.gz")
  const pack = () =>
    execFileSync("tar", ["-czf", archive, "-C", join(root, "source"), "new-skill"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    })
  pack()
  const db = new MarketDb({ dir: store })
  try {
    const input = {
      id: "publication-1",
      ownerId: "user-publication-0001",
      ownerName: "Alice",
      idempotencyKey: "idempotency-0001",
      archive: await readFile(archive),
    }
    const first = await db.startPublication(input)
    assert.equal(first.status, "PUBLISHED")
    assert.equal(first.release?.revision, 1)
    assert.equal(first.release?.semver, "1.0.0")
    assert.equal(first.report?.valid, true)
    assert.ok(first.patches.some((patch) => patch.kind === "deterministic"))
    assert.equal((await db.publications(input.ownerId))[0]?.id, first.id)
    assert.deepEqual(await db.publications("user-publication-missing"), [])
    assert.equal((await db.startPublication(input)).id, first.id)
    const release = await db.release("new-skill", 1)
    assert.ok(release)
    const roundtrip = readSkillArchive(await readFile(release.archivePath))
    const markdown = roundtrip.find((file) => file.path === "SKILL.md")?.data.toString("utf8") ?? ""
    assert.match(markdown, /# retained comment/)
    assert.match(markdown, /license: Apache-2\.0/)
    assert.match(markdown, /allowed-tools: Read Bash/)
    assert.match(markdown, /x-vendor-mode: careful/)
    assert.ok(roundtrip.some((file) => file.path === "agents/openai.yaml"))
    const metadata = JSON.parse(roundtrip.find((file) => file.path === "skill.json")!.data.toString("utf8")) as Record<
      string,
      unknown
    >
    assert.deepEqual(metadata.vendor, { icon: "glass" })
    assert.equal(metadata.semver, "1.0.0")

    const unchanged = await db.startPublication({ ...input, id: "publication-2", idempotencyKey: "idempotency-0002" })
    assert.equal(unchanged.status, "UNCHANGED")
    assert.equal(unchanged.release?.revision, 1)

    await writeFile(
      join(source, "skill.md"),
      "---\nname: New Skill\ndescription: Second release\nversion: 1.1.0\n---\n\n# New Skill\n\nSecond body.\n",
    )
    await writeFile(
      join(source, "skill.json"),
      `${JSON.stringify({ id: "new-skill", semver: "1.1.0", category: "general", tags: ["portable"], vendor: { icon: "glass" } })}\n`,
    )
    pack()
    await assert.rejects(
      db.startPublication({
        ...input,
        id: "publication-conflict",
        idempotencyKey: input.idempotencyKey,
        archive: await readFile(archive),
      }),
      /IDEMPOTENCY_CONFLICT/,
    )
    const second = await db.startPublication({
      ...input,
      id: "publication-3",
      idempotencyKey: "idempotency-0003",
      archive: await readFile(archive),
    })
    assert.equal(second.status, "PUBLISHED")
    assert.equal(second.release?.revision, 2)
    assert.equal((await db.getPublication({ id: second.id, ownerId: input.ownerId }))?.release?.revision, 2)
    await assert.rejects(
      db.startPublication({
        ...input,
        id: "publication-4",
        ownerId: "user-publication-0002",
        idempotencyKey: "idempotency-0004",
        archive: await readFile(archive),
      }),
      /OWNERSHIP_REQUIRED/,
    )
    await writeFile(
      join(source, "skill.md"),
      "---\nname: New Skill\ndescription: Duplicate semantic version\nversion: 1.1.0\n---\n\n# New Skill\n\nDifferent body.\n",
    )
    pack()
    await assert.rejects(
      db.startPublication({
        ...input,
        id: "publication-semver",
        idempotencyKey: "idempotency-semver",
        archive: await readFile(archive),
      }),
      /semver already exists/,
    )

    const tiny = join(root, "source", "tiny-skill")
    await mkdir(tiny, { recursive: true })
    await writeFile(
      join(tiny, "SKILL.md"),
      '---\nid: "tiny-skill"\nname: "Tiny Skill"\ndescription: "Needs AI"\ncategory: "general"\ntags: []\n---\n\n# Tiny\n\nx\n',
    )
    await writeFile(
      join(tiny, "skill.json"),
      `${JSON.stringify({ id: "tiny-skill", name: "Tiny Skill", description: "Needs AI", category: "general", tags: [] }, null, 2)}\n`,
    )
    const tinyArchive = join(root, "tiny.tar.gz")
    execFileSync("tar", ["-czf", tinyArchive, "-C", join(root, "source"), "tiny-skill"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    })
    const normalized = validateSkillArchive(validateSkillArchive(await readFile(tinyArchive)).archive)
    assert.equal(normalized.changes.length, 0)
    const repair = await db.startPublication({
      ...input,
      id: "publication-tiny",
      idempotencyKey: "idempotency-tiny",
      archive: normalized.archive,
    })
    assert.equal(repair.status, "NEEDS_AI_CONFIRMATION")
    const skill = repair.patches.flatMap((patch) => patch.files).find((file) => file.path === "SKILL.md")
    assert.ok(skill)
    assert.equal(skill.beforeSha256, skill.afterSha256)

    const unpublished = await db.unpublish({
      id: "publication-5",
      ownerId: input.ownerId,
      ownerName: input.ownerName,
      skillId: "new-skill",
    })
    assert.equal(unpublished.status, "UNPUBLISHED")
    assert.equal((await db.release("new-skill", 1))?.revision, 1)
    await writeFile(
      join(source, "skill.md"),
      "---\nname: New Skill\ndescription: Republished release\nversion: 1.2.0\n---\n\n# New Skill\n\nRepublished body.\n",
    )
    await writeFile(
      join(source, "skill.json"),
      `${JSON.stringify({ id: "new-skill", semver: "1.2.0", category: "general", tags: ["portable"], vendor: { icon: "glass" } })}\n`,
    )
    pack()
    const republished = await db.startPublication({
      ...input,
      id: "publication-6",
      idempotencyKey: "idempotency-0006",
      archive: await readFile(archive),
    })
    assert.equal(republished.status, "PUBLISHED")
    assert.equal(republished.release?.revision, 3)
  } finally {
    await db.close()
    await rm(root, { recursive: true, force: true })
  }
})

async function catalog(root: string, content: string, updatedAt: string) {
  await writeFile(
    join(root, "skills.json"),
    `${JSON.stringify(
      {
        items: [
          {
            id: "source-backed-detail-design",
            name: "Source-backed Detail Design",
            description: "Generate source-backed module detail designs.",
            category: "documents",
            tags: ["design", "source"],
            author: "ChipMate",
            githubUrl: "https://git.example/skill",
            legacyOnly: "preserved",
            content,
            updatedAt,
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
}
