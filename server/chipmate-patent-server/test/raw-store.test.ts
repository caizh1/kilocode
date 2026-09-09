import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { RawStore } from "../src/raw-store.js"
import { manifestForTest } from "../src/source.js"

test("原始包按 SHA-256 幂等保存且不会覆盖不同内容", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-patent-"))
  try {
    const store = new RawStore(root)
    await store.initialize()
    const file = path.join(store.paths.drop, "CN-fulltext-2026-01.xml")
    await fs.writeFile(file, "第一份公开专利数据")
    const manifest = manifestForTest("CN", "CN-fulltext-2026-01")
    const first = await store.preserve(file, manifest)
    const second = await store.preserve(file, manifest)
    assert.equal(first.sha256, second.sha256)
    assert.match(first.rawPath, /payload\.xml$/)
    assert.equal(await fs.readFile(first.rawPath, "utf8"), "第一份公开专利数据")
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(path.dirname(first.rawPath), "manifest.json"), "utf8")),
      manifest,
    )
    const queued = await store.requeueRaw(first.sha256)
    assert.equal(queued.length, 1)
    assert.equal(await fs.readFile(queued[0]!, "utf8"), "第一份公开专利数据")
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("仍在变化的 drop 文件不会进入导入", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-patent-"))
  try {
    const store = new RawStore(root)
    await store.initialize()
    const file = path.join(store.paths.drop, "CN-fulltext-2026-01.xml")
    await fs.writeFile(file, "开始")
    const checking = store.stable(file, 20)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await fs.appendFile(file, "继续复制")
    assert.equal(await checking, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
