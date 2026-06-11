import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  CODE_POSTINGS_FIELD_WEIGHTS,
  CODE_POSTINGS_TOKENIZER_VERSION,
  type CodePostingsManifest,
  type CodePostingsTermShard,
} from "../../../../src/indexing/codegraph"
import { parseCodeGraphFile } from "../../../../src/indexing/codegraph/parser"
import { CodePostingsJsonStorage } from "../../../../src/indexing/codegraph/storage"
import { tokenizeField, tokenizePath } from "../../../../src/indexing/codegraph/postings/tokenizer"

const source = `
#include "driver.h"
#define UART0_CTRL_REG (*(volatile uint32_t *)(UART0_BASE + 0x00))

// timeout waiting for device_ready error path EIO
static int startDevice(void)
{
  return read_reg(UART0_CTRL_REG);
}
`

async function root() {
  const dir = await mkdtemp(path.join(tmpdir(), "codepostings-test-"))
  await mkdir(path.join(dir, "drivers/ufs"), { recursive: true })
  return dir
}

function graph(workspacePath: string, filePath: string, content: string) {
  return parseCodeGraphFile({
    workspacePath,
    filePath,
    content,
    fileHash: hash(content),
    updatedAt: "2026-06-10T00:00:00.000Z",
  })
}

async function fixture(content = source) {
  const workspacePath = await root()
  const cacheDirectory = path.join(workspacePath, ".cache")
  const filePath = "drivers/ufs/main_device.c"
  const parsed = graph(workspacePath, filePath, content)
  const storage = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })
  await storage.beginFullScan()
  await storage.upsertFilePostings(path.join(workspacePath, filePath), parsed.fileHash, parsed, { content })
  await storage.markFullScanComplete()
  return { workspacePath, cacheDirectory, filePath, parsed, storage }
}

describe("code postings tokenizer and storage", () => {
  test("tokenizes snake case, camel case, macros, registers, paths, and weighted comments", () => {
    expect(tokenizeField("start_device", "symbol").map((item) => item.term)).toEqual(
      expect.arrayContaining(["start_device", "start", "device"]),
    )
    expect(tokenizeField("startDevice", "symbol").map((item) => item.term)).toEqual(
      expect.arrayContaining(["startdevice", "start", "device"]),
    )
    expect(tokenizeField("UART0_CTRL_REG", "macro").map((item) => item.term)).toEqual(
      expect.arrayContaining(["uart0_ctrl_reg", "uart0", "uart", "0", "ctrl", "reg"]),
    )
    expect(tokenizePath("drivers/ufs/main_device.c").map((item) => item.term)).toEqual(
      expect.arrayContaining(["drivers", "ufs", "main", "device"]),
    )
    expect(CODE_POSTINGS_FIELD_WEIGHTS.comment).toBeLessThan(CODE_POSTINGS_FIELD_WEIGHTS.symbol)
    expect(CODE_POSTINGS_FIELD_WEIGHTS.comment).toBeLessThan(CODE_POSTINGS_FIELD_WEIGHTS.code)
  })

  test("writes docs plus term shards, searches macro, path, and comment terms without full source", async () => {
    const ctx = await fixture()
    const macro = await ctx.storage.search("UART0_CTRL_REG")
    const pathHit = await ctx.storage.search("drivers ufs")
    const err = await ctx.storage.search("timeout EIO")

    expect(macro[0]).toMatchObject({
      filePath: ctx.filePath,
      displayName: "UART0_CTRL_REG",
    })
    expect(pathHit[0]).toMatchObject({
      filePath: ctx.filePath,
    })
    expect(pathHit[0]?.fields).toContain("path")
    expect(err[0]).toMatchObject({
      filePath: ctx.filePath,
      displayName: "comment",
    })
    const doc = await ctx.storage.getFilePostings(ctx.filePath)
    expect(JSON.stringify(doc)).not.toContain(source)
    expect((await walk(path.join(ctx.cacheDirectory, "codepostings/v1"))).some((item) => item.includes("/terms/"))).toBe(true)
  })

  test("updates modified files and removes deleted postings", async () => {
    const ctx = await fixture()
    const changed = source.replace("timeout waiting", "fatal underrun")
    const parsed = graph(ctx.workspacePath, ctx.filePath, changed)
    await ctx.storage.upsertFilePostings(path.join(ctx.workspacePath, ctx.filePath), parsed.fileHash, parsed, {
      content: changed,
    })

    expect(await ctx.storage.search("timeout waiting")).toHaveLength(0)
    expect((await ctx.storage.search("fatal underrun"))[0]?.filePath).toBe(ctx.filePath)

    await ctx.storage.removeFilePostings(path.join(ctx.workspacePath, ctx.filePath))
    expect(await ctx.storage.search("fatal underrun")).toHaveLength(0)
    expect(ctx.storage.status()).toMatchObject({ validFileCount: 0, staleCount: 1 })
  })

  test("skips mismatched, parse_error, unsupported, stale, and postings_error records", async () => {
    const ctx = await fixture()
    await ctx.storage.markFilePostingsStatus(path.join(ctx.workspacePath, "bad.c"), "parse_error", { fileHash: "bad" })
    await ctx.storage.markFilePostingsStatus(path.join(ctx.workspacePath, "readme.md"), "unsupported", {
      fileHash: "md",
    })
    await ctx.storage.markFilePostingsStatus(path.join(ctx.workspacePath, "old.c"), "stale", { fileHash: "old" })
    await ctx.storage.markFilePostingsStatus(path.join(ctx.workspacePath, ctx.filePath), "postings_error", {
      fileHash: ctx.parsed.fileHash,
      error: "postings failed",
    })

    expect(await ctx.storage.search("UART0_CTRL_REG")).toHaveLength(0)
    expect(ctx.storage.status()).toMatchObject({
      validFileCount: 0,
      parseErrorCount: 1,
      unsupportedCount: 1,
      staleCount: 1,
      postingsErrorCount: 1,
    })

    const manifestPath = path.join(ctx.cacheDirectory, "codepostings/v1/manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CodePostingsManifest
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION + 1 }),
      "utf-8",
    )
    const mismatched = new CodePostingsJsonStorage({
      workspacePath: ctx.workspacePath,
      cacheDirectory: ctx.cacheDirectory,
    })
    expect(mismatched.status()).toMatchObject({ tokenizerMismatch: true, needsRebuild: true, validFileCount: 0 })
    expect(await mismatched.search("UART0_CTRL_REG")).toHaveLength(0)
  })

  test("omits bm25 hits without line ranges and reports diagnostics", async () => {
    const ctx = await fixture()
    const term = (await walk(path.join(ctx.cacheDirectory, "codepostings/v1/terms"))).find((item) => item.endsWith(".json"))
    expect(term).toBeDefined()
    const shard = JSON.parse(await readFile(term!, "utf-8")) as CodePostingsTermShard
    for (const doc of Object.values(shard.documents)) {
      doc.ranges = [{ ...doc.ranges[0]!, startLine: undefined as unknown as number }]
    }
    await writeFile(term!, JSON.stringify(shard), "utf-8")

    const diagnostics: NonNullable<Parameters<typeof ctx.storage.search>[1]>["diagnostics"] = []
    const result = await ctx.storage.search(shard.term, { diagnostics })

    expect(result).toEqual([])
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "missing-line-range",
          kind: "bm25",
        }),
      ]),
    )
  })
})

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const next = path.join(dir, item.name)
    if (item.isDirectory()) out.push(...(await walk(next)))
    else out.push(next)
  }
  return out
}

function hash(value: string): string {
  return `${fnv(value, 0x811c9dc5)}${fnv(value, 0x45d9f3b)}`
}

function fnv(value: string, seed: number): string {
  let out = seed
  for (let index = 0; index < value.length; index++) {
    out ^= value.charCodeAt(index)
    out = Math.imul(out, 0x01000193)
  }
  return (out >>> 0).toString(16).padStart(8, "0")
}
