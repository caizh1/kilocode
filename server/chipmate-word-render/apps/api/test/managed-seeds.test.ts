import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "../../..")
const script = path.join(root, "scripts/merge-managed-seeds.mjs")

test("managed seed upgrade preserves user skills and managed counters", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "managed-seeds-"))
  const seed = path.join(dir, "seed")
  const market = path.join(dir, "market")
  try {
    await Promise.all([mkdir(path.join(seed, "skills"), { recursive: true }), mkdir(path.join(market, "skills"), { recursive: true })])
    await writeFile(
      path.join(seed, "skills.json"),
      JSON.stringify({ items: [item("source-backed-detail-design", "new-detail"), item("documents", "new-documents")] }),
    )
    await writeFile(
      path.join(market, "skills.json"),
      JSON.stringify({ items: [item("user-skill", "user"), { ...item("documents", "old"), downloadCount: 17, stars: 9 }] }),
    )
    await Promise.all([
      archive(dir, seed, "source-backed-detail-design", "new-detail"),
      archive(dir, seed, "documents", "new-documents"),
      writeFile(path.join(market, "skills", "user-skill.tar.gz"), "user-owned"),
    ])
    const result = spawnSync(process.execPath, [script, seed, market], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    const catalog = JSON.parse(await readFile(path.join(market, "skills.json"), "utf8"))
    assert.equal(catalog.items.find((entry: { id: string }) => entry.id === "user-skill").description, "user")
    const documents = catalog.items.find((entry: { id: string }) => entry.id === "documents")
    assert.equal(documents.description, "new-documents")
    assert.equal(documents.downloadCount, 17)
    assert.equal(documents.stars, 9)
    assert.match(documents.sha256, /^[a-f0-9]{64}$/)
    for (const id of ["source-backed-detail-design", "documents"]) {
      const target = path.join(market, "skills", `${id}.tar.gz`)
      const listing = spawnSync("tar", ["-tzf", target], { encoding: "utf8" })
      assert.equal(listing.status, 0, listing.stderr)
      assert.ok(listing.stdout.split(/\r?\n/).includes(`${id}/SKILL.md`))
    }
    assert.equal(await readFile(path.join(market, "skills", "user-skill.tar.gz"), "utf8"), "user-owned")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("managed seed upgrade rejects archives without the Skill ID root", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "managed-seeds-root-"))
  const seed = path.join(dir, "seed")
  const market = path.join(dir, "market")
  try {
    await Promise.all([mkdir(path.join(seed, "skills"), { recursive: true }), mkdir(market, { recursive: true })])
    await writeFile(
      path.join(seed, "skills.json"),
      JSON.stringify({ items: [item("source-backed-detail-design", "detail"), item("documents", "documents")] }),
    )
    await archive(dir, seed, "source-backed-detail-design", "detail")
    await archive(dir, seed, "documents", "documents", false)

    const result = spawnSync(process.execPath, [script, seed, market], { encoding: "utf8" })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /documents\/ as its only root/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function item(id: string, description: string) {
  return {
    id,
    name: id,
    description,
    category: "test",
    content: `skills/${id}.tar.gz`,
    downloadCount: 0,
    stars: 0,
  }
}

async function archive(root: string, seed: string, id: string, content: string, wrapped = true) {
  const source = path.join(root, id)
  await mkdir(source, { recursive: true })
  await writeFile(path.join(source, "SKILL.md"), content)
  const target = path.join(seed, "skills", `${id}.tar.gz`)
  const args = wrapped ? ["-czf", target, "-C", root, id] : ["-czf", target, "-C", source, "."]
  const result = spawnSync("tar", args, { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
}
