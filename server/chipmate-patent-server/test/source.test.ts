import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import test from "node:test"
import { contentStreams, loadManifest } from "../src/source.js"

const execute = promisify(execFile)

test("manifest 固化归档内部文件哈希和记录数", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-patent-source-"))
  try {
    const archive = path.join(root, "CN-fulltext-1.tar")
    const data = path.join(root, "data.xml")
    const xml = "<exchange-documents></exchange-documents>"
    await fs.writeFile(data, xml)
    await execute("bsdtar", ["-cf", archive, "-C", root, "data.xml"])
    await fs.writeFile(
      `${archive}.manifest.json`,
      JSON.stringify({
        schemaVersion: 1,
        source: "CNIPA",
        jurisdiction: "CN",
        batchId: "CN-fulltext-1",
        dataType: "fulltext",
        files: [{ path: "data.xml", sha256: createHash("sha256").update(xml).digest("hex"), records: 0 }],
      }),
    )
    const manifest = await loadManifest(archive)
    assert.equal(manifest.files?.[0]?.records, 0)
    let body = ""
    for await (const source of contentStreams(archive, manifest)) {
      for await (const chunk of source.stream) body += Buffer.from(chunk).toString("utf8")
    }
    assert.equal(body, xml)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("归档内部文件哈希不匹配时流读取失败", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-patent-source-"))
  try {
    const archive = path.join(root, "CN-fulltext-2.tar")
    await fs.writeFile(path.join(root, "data.xml"), "<exchange-documents/>")
    await execute("bsdtar", ["-cf", archive, "-C", root, "data.xml"])
    const manifest = {
      schemaVersion: 1 as const,
      source: "CNIPA" as const,
      jurisdiction: "CN" as const,
      batchId: "CN-fulltext-2",
      dataType: "fulltext" as const,
      files: [{ path: "data.xml", sha256: "0".repeat(64) }],
    }
    await assert.rejects(async () => {
      for await (const source of contentStreams(archive, manifest)) {
        for await (const _chunk of source.stream) void _chunk
      }
    }, /SHA-256 不匹配/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
