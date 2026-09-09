import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
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
const source = resolve(repo, ".chipmate/skills/source-backed-detail-design")

test("database schema uses ordered migrations", () => {
  assert.equal(MARKET_DB_SCHEMA_VERSION, 11)
  assert.deepEqual(
    MIGRATIONS.map((migration) => migration.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  )
})

test("v9 升级到 LDAP 认证架构后保留作者、收藏、安装和发布归属", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-market-v9-auth-"))
  const path = join(root, "market.sqlite")
  const sqlite = new DatabaseSync(path)
  const now = "2026-09-03T00:00:00.000Z"
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)")
  for (const migration of MIGRATIONS.slice(0, 9)) {
    sqlite.exec(migration.sql)
    sqlite.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)").run(migration.version, migration.name, now)
  }
  sqlite.prepare("INSERT INTO users(id,display_name,first_seen_at,last_seen_at) VALUES(?,?,?,?)").run("historic-alice", "Alice", now, now)
  sqlite.prepare(
    "INSERT INTO skills(id,name,description,category,author_id,latest_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run("historic-skill", "历史技能", "迁移验证", "test", "historic-alice", 1, now, now)
  sqlite.prepare(
    "INSERT INTO releases(skill_id,revision,sha256,size_bytes,validation_report_json,archive_path,published_at) VALUES(?,?,?,?,?,?,?)",
  ).run("historic-skill", 1, "a".repeat(64), 1, "{}", "/tmp/historic-skill.tar.gz", now)
  sqlite.prepare("INSERT INTO favorites(user_id,skill_id,created_at) VALUES(?,?,?)").run("historic-alice", "historic-skill", now)
  sqlite.prepare(
    "INSERT INTO installations(user_id,client_id,skill_id,scope,revision,sha256,status,changed_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run("historic-alice", "client-history", "historic-skill", "global", 1, "a".repeat(64), "installed", now)
  sqlite.prepare(
    "INSERT INTO publication_runs(id,owner_id,skill_id,status,stage,snapshot_path,snapshot_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run("publication-history", "historic-alice", "historic-skill", "PUBLISHED", "complete", "/tmp/snapshot", "b".repeat(64), now, now)
  sqlite.close()

  const migrated = new MarketDb({ dir: root })
  assert.equal((await migrated.health()).schemaVersion, 11)
  await migrated.close()
  const check = new DatabaseSync(path, { readOnly: true })
  assert.deepEqual(plain(check.prepare("SELECT id,author_id FROM skills").all()), [{ id: "historic-skill", author_id: "historic-alice" }])
  assert.deepEqual(plain(check.prepare("SELECT user_id,skill_id FROM favorites").all()), [{ user_id: "historic-alice", skill_id: "historic-skill" }])
  assert.deepEqual(plain(check.prepare("SELECT user_id,skill_id,status FROM installations").all()), [{ user_id: "historic-alice", skill_id: "historic-skill", status: "installed" }])
  assert.deepEqual(plain(check.prepare("SELECT id,owner_id,skill_id FROM publication_runs").all()), [{ id: "publication-history", owner_id: "historic-alice", skill_id: "historic-skill" }])
  check.close()
  await rm(root, { recursive: true, force: true })
})

function plain(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown
}

test("publication request aliases backfill existing idempotency keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-market-v7-"))
  const path = join(root, "market.sqlite")
  const sqlite = new DatabaseSync(path)
  const now = "2026-07-21T00:00:00.000Z"
  const bytes = Buffer.from("existing request")
  const hash = createHash("sha256").update(bytes).digest("hex")
  sqlite.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)")
  for (const migration of MIGRATIONS.slice(0, 7)) {
    sqlite.exec(migration.sql)
    sqlite.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)").run(migration.version, migration.name, now)
  }
  sqlite
    .prepare("INSERT INTO users(id,display_name,first_seen_at,last_seen_at) VALUES(?,?,?,?)")
    .run("user-migration-0001", "Alice", now, now)
  sqlite
    .prepare(
      `INSERT INTO publication_runs(id,owner_id,status,stage,snapshot_path,snapshot_sha256,created_at,updated_at,idempotency_key,source_sha256)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "publication-migration",
      "user-migration-0001",
      "VALIDATING",
      "uploaded",
      join(root, "snapshot.tar.gz"),
      "a".repeat(64),
      now,
      now,
      "idempotency-migration",
      hash,
    )
  sqlite.close()

  const db = new MarketDb({ dir: root })
  try {
    assert.equal((await db.health()).schemaVersion, 11)
    const run = await db.startPublication({
      id: "publication-migration-retry",
      ownerId: "user-migration-0001",
      ownerName: "Alice",
      idempotencyKey: "idempotency-migration",
      archive: bytes,
    })
    assert.equal(run.id, "publication-migration")
  } finally {
    await db.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("worker owns import, revisions, FTS, state, metrics, and legacy export", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-market-db-"))
  const legacy = join(root, "legacy")
  const skills = join(legacy, "skills")
  const store = join(root, "store")
  const output = join(root, "legacy-latest")
  const v1 = join(skills, "source-backed-detail-design.tar.gz")
  const v2 = join(skills, "source-backed-detail-design-v2.tar.gz")
  const v3 = join(skills, "source-backed-detail-design-v3.tar.gz")
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
      { available: true, schemaVersion: 11, journalMode: "wal", foreignKeys: true, busyTimeout: 5000 },
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

    const beforeDownload = await db.get("source-backed-detail-design")
    const beforeDownloadVersion = await db.version()
    assert.ok(beforeDownload)
    assert.deepEqual(
      await Promise.all([
        db.skillDownload("source-backed-detail-design"),
        db.skillDownload("source-backed-detail-design"),
        db.skillDownload("source-backed-detail-design"),
      ]),
      [beforeDownload.downloads + 1, beforeDownload.downloads + 2, beforeDownload.downloads + 3],
    )
    const afterDownload = await db.get("source-backed-detail-design")
    assert.equal(afterDownload?.downloads, beforeDownload.downloads + 3)
    assert.equal(afterDownload?.updatedAt, beforeDownload.updatedAt)
    assert.notEqual(await db.version(), beforeDownloadVersion)
    assert.equal(await db.skillDownload("missing-skill"), undefined)

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

    await catalog(legacy, "skills/source-backed-detail-design.tar.gz", "2026-07-12T03:00:00.000Z")
    const reused = await db.importLegacy(legacy)
    assert.equal(reused.imported, 0)
    assert.equal(reused.unchanged, 1)
    assert.equal((await db.get("source-backed-detail-design"))?.latestRevision, 2)
    assert.equal((await db.releases("source-backed-detail-design")).length, 2)
    assert.equal((await db.release("source-backed-detail-design"))?.revision, 2)

    await writeFile(join(rev, "source-backed-detail-design", "revision.txt"), "revision 3\n")
    execFileSync("tar", ["-czf", v3, "-C", rev, "source-backed-detail-design"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    })
    await catalog(legacy, "skills/source-backed-detail-design-v3.tar.gz", "2026-07-12T04:00:00.000Z")
    const third = await db.importLegacy(legacy)
    assert.equal(third.revisions[0]?.revision, 3)
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
    "publication_request_keys",
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
    "---\n# retained comment\nname: New Skill\ndescription: First release\nversion: 9.9.9\nlicense: Apache-2.0\ncompatibility: ChipMate or Codex\nallowed-tools: Read Bash\nx-vendor-mode: careful\n---\n\n# New Skill\n\nFirst body.\n",
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

    const canonical = validateSkillArchive(input.archive).archive
    assert.notEqual(canonical.compare(input.archive), 0)
    const unchanged = await db.startPublication({
      ...input,
      id: "publication-2",
      idempotencyKey: "idempotency-0002",
      archive: canonical,
    })
    assert.equal(unchanged.id, first.id)
    assert.equal(unchanged.status, "PUBLISHED")
    assert.equal((await db.publications(input.ownerId)).filter((item) => item.skillId === "new-skill").length, 1)

    await writeFile(
      join(source, "skill.md"),
      "---\nname: New Skill\ndescription: Second release\nversion: 1.1.0\n---\n\n# New Skill\n\nSecond body.\n",
    )
    await writeFile(
      join(source, "skill.json"),
      `${JSON.stringify({ id: "new-skill", semver: "1.1.0", category: "general", tags: ["portable"], vendor: { icon: "glass" } })}\n`,
    )
    pack()
    const secondArchive = await readFile(archive)
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
      archive: secondArchive,
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
        archive: secondArchive,
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
    const restored = await db.startPublication({
      ...input,
      id: "publication-restore",
      idempotencyKey: "idempotency-restore",
      archive: secondArchive,
    })
    assert.equal(restored.status, "PUBLISHED")
    assert.equal(restored.release?.revision, 2)
    assert.equal((await db.releases("new-skill")).length, 2)
    assert.equal(
      (
        await db.unpublish({
          id: "publication-restore-unpublish",
          ownerId: input.ownerId,
          ownerName: input.ownerName,
          skillId: "new-skill",
        })
      ).status,
      "UNPUBLISHED",
    )
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
    const undone = await db.undoPublication({
      id: "publication-undo-6",
      ownerId: input.ownerId,
      ownerName: input.ownerName,
      runId: republished.id,
      idempotencyKey: "undo-idempotency-0006",
    })
    assert.equal(undone.status, "UNDONE")
    assert.equal(await db.get("new-skill"), undefined)
    assert.equal((await db.release("new-skill"))?.revision, 3)
    assert.equal(
      (
        await db.undoPublication({
          id: "publication-undo-replay",
          ownerId: input.ownerId,
          ownerName: input.ownerName,
          runId: republished.id,
          idempotencyKey: "undo-idempotency-0006",
        })
      ).status,
      "UNDONE",
    )
    await writeFile(
      join(source, "skill.md"),
      "---\nname: New Skill\ndescription: Fourth release\nversion: 1.3.0\n---\n\n# New Skill\n\nFourth body.\n",
    )
    await writeFile(
      join(source, "skill.json"),
      `${JSON.stringify({ id: "new-skill", semver: "1.3.0", category: "general", tags: ["portable"] })}\n`,
    )
    pack()
    const fourth = await db.startPublication({
      ...input,
      id: "publication-7",
      idempotencyKey: "idempotency-0007",
      archive: await readFile(archive),
    })
    await writeFile(
      join(source, "skill.md"),
      "---\nname: New Skill\ndescription: Fifth release\nversion: 1.4.0\n---\n\n# New Skill\n\nFifth body.\n",
    )
    await writeFile(
      join(source, "skill.json"),
      `${JSON.stringify({ id: "new-skill", semver: "1.4.0", category: "general", tags: ["portable"] })}\n`,
    )
    pack()
    await db.startPublication({
      ...input,
      id: "publication-8",
      idempotencyKey: "idempotency-0008",
      archive: await readFile(archive),
    })
    await assert.rejects(
      db.undoPublication({
        id: "publication-undo-stale",
        ownerId: input.ownerId,
        ownerName: input.ownerName,
        runId: fourth.id,
        idempotencyKey: "undo-idempotency-stale",
      }),
      /STALE_PUBLICATION/,
    )
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
