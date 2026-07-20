#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const managed = new Set(["source-backed-detail-design", "documents"])
const seed = path.resolve(process.argv[2] || "")
const market = path.resolve(process.argv[3] || "")

if (!process.argv[2] || !process.argv[3]) throw new Error("usage: merge-managed-seeds.mjs <seed-root> <market-root>")

await merge(seed, market)

async function merge(seedRoot, marketRoot) {
  const stage = path.join(marketRoot, `.managed-seed-stage-${randomUUID()}`)
  const rollback = path.join(marketRoot, `.managed-seed-rollback-${randomUUID()}`)
  const catalogPath = path.join(marketRoot, "skills.json")
  const skills = path.join(marketRoot, "skills")
  const catalogExisted = await exists(catalogPath)
  await Promise.all([mkdir(stage, { recursive: true }), mkdir(rollback, { recursive: true }), mkdir(skills, { recursive: true })])
  try {
    const seedCatalog = await readCatalog(path.join(seedRoot, "skills.json"), true)
    const current = await readCatalog(catalogPath, false)
    const seeds = new Map(seedCatalog.items.filter((item) => managed.has(item.id)).map((item) => [item.id, item]))
    if (seeds.size !== managed.size) throw new Error("seed catalog must contain both managed skill IDs")
    for (const id of managed) {
      const item = seeds.get(id)
      const rel = safeArchive(item.content, id)
      const source = path.join(seedRoot, rel)
      const target = path.join(stage, `${id}.tar.gz`)
      const info = await stat(source)
      if (!info.isFile() || info.size <= 0) throw new Error(`managed seed archive is empty: ${source}`)
      const listing = execFileSync("tar", ["-tzf", source], { encoding: "utf8" }).split(/\r?\n/)
      if (!listing.includes("./SKILL.md") && !listing.includes("SKILL.md"))
        throw new Error(`managed seed archive has no root SKILL.md: ${source}`)
      await cp(source, target)
      item.sha256 = await sha256(target)
    }
    const existing = new Map(current.items.map((item) => [item.id, item]))
    const items = current.items.filter((item) => !managed.has(item.id))
    for (const id of managed) {
      const previous = existing.get(id) || {}
      const item = seeds.get(id)
      items.push({
        ...item,
        downloadCount: Number.isFinite(previous.downloadCount) ? previous.downloadCount : item.downloadCount || 0,
        stars: Number.isFinite(previous.stars) ? previous.stars : item.stars || 0,
      })
    }
    items.sort((left, right) => String(left.id).localeCompare(String(right.id)))
    await writeFile(path.join(stage, "skills.json"), `${JSON.stringify({ ...current, items }, null, 2)}\n`)
    if (await exists(catalogPath)) await cp(catalogPath, path.join(rollback, "skills.json"))
    for (const id of managed) {
      const target = path.join(skills, `${id}.tar.gz`)
      if (await exists(target)) await cp(target, path.join(rollback, `${id}.tar.gz`))
      await rename(path.join(stage, `${id}.tar.gz`), target)
    }
    await rename(path.join(stage, "skills.json"), catalogPath)
    const verified = await readCatalog(catalogPath, true)
    if (![...managed].every((id) => verified.items.some((item) => item.id === id)))
      throw new Error("managed seed verification failed after atomic replacement")
  } catch (error) {
    const previous = path.join(rollback, "skills.json")
    if (await exists(previous)) await cp(previous, catalogPath)
    if (!catalogExisted) await rm(catalogPath, { force: true })
    for (const id of managed) {
      const archived = path.join(rollback, `${id}.tar.gz`)
      if (await exists(archived)) await cp(archived, path.join(skills, `${id}.tar.gz`))
      if (!(await exists(archived))) await rm(path.join(skills, `${id}.tar.gz`), { force: true })
    }
    throw error
  } finally {
    await Promise.all([rm(stage, { recursive: true, force: true }), rm(rollback, { recursive: true, force: true })])
  }
}

async function readCatalog(file, required) {
  if (!(await exists(file))) {
    if (required) throw new Error(`skill catalog is missing: ${file}`)
    return { items: [] }
  }
  const parsed = JSON.parse(await readFile(file, "utf8"))
  const items = Array.isArray(parsed) ? parsed : parsed.items
  if (!Array.isArray(items)) throw new Error(`skill catalog has no items array: ${file}`)
  if (items.some((item) => !item || typeof item.id !== "string")) throw new Error(`skill catalog has invalid items: ${file}`)
  return Array.isArray(parsed) ? { items } : { ...parsed, items }
}

function safeArchive(value, id) {
  const expected = `skills/${id}.tar.gz`
  if (value !== expected) throw new Error(`managed seed ${id} must use ${expected}`)
  return value
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex")
}

async function exists(file) {
  return stat(file).then(() => true, () => false)
}
