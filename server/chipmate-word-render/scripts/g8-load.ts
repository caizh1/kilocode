import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { MarketDb, MIGRATIONS } from "@chipmate/market-db"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const repo = resolve(root, "../..")
const evidence = resolve(
  repo,
  process.env.SKILL_LOAD_EVIDENCE ?? "docs/chipmate-skill-market-alignment-evidence/g8/load.json",
)
const count = 10_000
const users = 200
const rounds = 1

void main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-g8-load-"))
  const store = join(dir, "db")
  const bin = join(dir, "bin")
  await mkdir(store, { recursive: true })
  await mkdir(bin, { recursive: true })
  await wrapper(bin)
  seed(store)
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`
  process.env.PACKAGE_ROOT = join(dir, "packages")
  process.env.SKILL_MARKET_ROOT = join(dir, "packages", "skill-market")

  const db = new MarketDb({ dir: store })
  const { build } = await import("../apps/api/src/index.ts")
  const app = build(db)
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })

  try {
    await Promise.all([word(origin), mermaid(origin)])
    const baseline = await renders(origin)
    const market: number[] = []
    const traffic = Promise.all(
      Array.from({ length: users }, async (_, user) => {
        await new Promise((resolve) => setTimeout(resolve, user * 2))
        for (const round of Array.from({ length: rounds }, (_, index) => index)) {
          const path =
            (user + round) % 2 === 0
              ? `/api/v1/skills?limit=24&cursor=${(user * 24) % count}`
              : "/api/v1/skills?q=Skill&limit=24&sort=downloads"
          const start = performance.now()
          const response = await safeFetch(`${origin}${path}`, undefined, `market user ${user} round ${round}`)
          market.push(performance.now() - start)
          assert.equal(response.status, 200)
          const payload = (await response.json()) as { items?: unknown[] }
          assert.ok(Array.isArray(payload.items) && payload.items.length > 0)
        }
      }),
    )
    const [loaded] = await Promise.all([renders(origin), traffic])

    const result = {
      generatedAt: new Date().toISOString(),
      dataset: { skills: count, concurrentUsers: users, requests: users * rounds },
      market: { errors: 0, p95Ms: round(p95(market)), budgetMs: 2_000 },
      render: {
        baselineP95Ms: round(p95(baseline)),
        loadedP95Ms: round(p95(loaded)),
        degradation: round(p95(loaded) / p95(baseline) - 1, 4),
        budget: 0.2,
        errors: 0,
      },
    }
    assert.ok(
      result.market.p95Ms <= result.market.budgetMs,
      `market p95 ${result.market.p95Ms}ms exceeds ${result.market.budgetMs}ms`,
    )
    assert.ok(
      result.render.degradation <= result.render.budget,
      `render degradation ${result.render.degradation} exceeds ${result.render.budget}`,
    )
    await mkdir(dirname(evidence), { recursive: true })
    await writeFile(evidence, `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await app.close()
    await db.close()
    await rm(dir, { recursive: true, force: true })
  }
}

function seed(dir: string) {
  const sqlite = new DatabaseSync(join(dir, "market.sqlite"))
  sqlite.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)",
  )
  for (const migration of MIGRATIONS) {
    sqlite.exec(migration.sql)
    sqlite
      .prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)")
      .run(migration.version, migration.name, "2026-07-12T00:00:00.000Z")
  }
  sqlite
    .prepare("INSERT INTO users(id,display_name,first_seen_at,last_seen_at) VALUES(?,?,?,?)")
    .run("author-load-00000001", "Load Author", "2026-07-12T00:00:00.000Z", "2026-07-12T00:00:00.000Z")
  const skill = sqlite.prepare(
    "INSERT INTO skills(id,name,description,category,tags_json,author_id,status,latest_revision,download_count,favorite_count,created_at,updated_at,legacy_json) VALUES(?,?,?,?,? ,?,'published',1,?,?,?,?,'{}')",
  )
  const release = sqlite.prepare(
    "INSERT INTO releases(skill_id,revision,semver,sha256,size_bytes,notes,validation_report_json,archive_path,published_at,metadata_json) VALUES(?,1,?,?,?,?,?,?,?,'{}')",
  )
  sqlite.exec("BEGIN IMMEDIATE")
  for (const index of Array.from({ length: count }, (_, value) => value)) {
    const id = `load-skill-${String(index).padStart(5, "0")}`
    const date = new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString()
    skill.run(
      id,
      `Skill ${String(index).padStart(5, "0")}`,
      `Evidence catalog fixture ${index}`,
      index % 2 ? "development" : "documents",
      '["evidence","load"]',
      "author-load-00000001",
      index,
      index % 17,
      date,
      date,
    )
    release.run(
      id,
      "1.0.0",
      String(index).padStart(64, "0"),
      1,
      null,
      '{"valid":true}',
      resolve(repo, "docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz"),
      date,
    )
  }
  sqlite.exec("COMMIT")
  sqlite.close()
}

async function renders(origin: string) {
  const times: number[] = []
  for (const index of [0, 1, 2]) {
    void index
    const pair = await Promise.all([timed(() => word(origin)), timed(() => mermaid(origin))])
    times.push(...pair)
  }
  return times
}

async function word(origin: string) {
  const bytes = await readFile(resolve(repo, "ufs-task-module-interface.docx"))
  const response = await safeFetch(
    `${origin}/render/word`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "ufs-task-module-interface.docx", docxBase64: bytes.toString("base64") }),
    },
    "word",
  )
  assert.equal(response.status, 200)
  assert.equal(((await response.json()) as { ok?: boolean }).ok, true)
}

async function mermaid(origin: string) {
  const response = await safeFetch(
    `${origin}/render/mermaid`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "g8-load",
        scale: 2,
        source: "flowchart TD\nA[Load] --> B{Market}\nB --> C[Render]",
      }),
    },
    "mermaid",
  )
  assert.equal(response.status, 200)
  assert.equal(((await response.json()) as { ok?: boolean }).ok, true)
}

async function timed(run: () => Promise<void>) {
  const start = performance.now()
  await run()
  return performance.now() - start
}

function p95(values: number[]) {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

async function safeFetch(url: string, init: RequestInit | undefined, label: string) {
  try {
    return await fetch(url, init)
  } catch (err) {
    throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}

async function wrapper(dir: string) {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  const path = join(dir, "chromium")
  await writeFile(path, `#!/bin/sh\nexec ${JSON.stringify(chrome)} "$@"\n`, { mode: 0o755 })
}
