import { access, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  CODE_POSTINGS_SCHEMA_VERSION,
  CODE_POSTINGS_FIELD_WEIGHTS,
  CODE_POSTINGS_STORAGE_VERSION_DIR,
  CODE_POSTINGS_TOKENIZER_VERSION,
  type CodePostingsManifest,
} from "../../../../src/indexing/codegraph"
import type { CodePostingsTermDocument } from "../../../../src/indexing/codegraph/types"
import { parseCodeGraphFile } from "../../../../src/indexing/codegraph/parser"
import { buildPostingsDocument } from "../../../../src/indexing/codegraph/postings/builder"
import { CodePostingsJsonStorage } from "../../../../src/indexing/codegraph/storage"
import { tokenizeField, tokenizePath } from "../../../../src/indexing/codegraph/postings/tokenizer"
import { workspaceKey } from "../../../../src/indexing/workspace-key"

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
  test("tracks never, interrupted, and complete empty scans", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodePostingsJsonStorage({
      workspacePath,
      cacheDirectory,
      clock: () => new Date("2026-06-10T00:00:00.000Z"),
    })

    expect(storage.getScanState()).toBe("never")
    await storage.beginFullScan()
    expect(storage.getScanState()).toBe("interrupted")
    await storage.markFullScanComplete()

    expect(storage.getScanState()).toBe("complete")
    expect(storage.status()).toMatchObject({
      recordCount: 0,
      validFileCount: 0,
      documentCount: 0,
      lastFullScanAt: "2026-06-10T00:00:00.000Z",
    })

    await storage.beginFullScan()
    expect(storage.getScanState()).toBe("interrupted")
    expect(storage.status().lastFullScanAt).toBeUndefined()
  })

  test("builds postings for prototype-named source tokens", async () => {
    const workspacePath = await root()
    const filePath = "drivers/ufs/prototype_tokens.c"
    const content = `
// constructor __proto__ toString prototype
static void __attribute__((__constructor__)) prototype_tokens(void) {}
`
    const parsed = graph(workspacePath, filePath, content)
    const doc = buildPostingsDocument({
      workspacePath,
      graph: parsed,
      content,
      updatedAt: "2026-06-10T00:00:00.000Z",
    })

    expect(Object.prototype.hasOwnProperty.call(doc.terms, "constructor")).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(doc.terms, "__proto__")).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(doc.terms, "tostring")).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(doc.terms, "prototype")).toBe(true)
    expect(doc.terms["constructor"]?.filePath).toBe(filePath)
  })

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

  test("writes and searches prototype-named tokens without postings errors", async () => {
    const content = `
// constructor __proto__ toString prototype
static void __attribute__((__constructor__)) prototype_tokens(void) {}
`
    const ctx = await fixture(content)

    expect((await ctx.storage.search("constructor"))[0]?.filePath).toBe(ctx.filePath)
    expect((await ctx.storage.search("__proto__"))[0]?.filePath).toBe(ctx.filePath)
    expect((await ctx.storage.search("prototype"))[0]?.filePath).toBe(ctx.filePath)
    expect(ctx.storage.status()).toMatchObject({ validFileCount: 1, postingsErrorCount: 0 })
  })

  test("handles prototype-like file paths in postings manifests", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const filePath = "__proto__/constructor.c"
    const parsed = graph(workspacePath, filePath, source)
    const storage = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })

    await storage.beginFullScan()
    await storage.upsertFilePostings(path.join(workspacePath, filePath), parsed.fileHash, parsed, { content: source })
    await storage.markFullScanComplete()

    expect(await storage.listFiles()).toEqual([filePath])
    expect((await storage.search("UART0_CTRL_REG"))[0]?.filePath).toBe(filePath)
    await storage.removeFilePostings(path.join(workspacePath, filePath))
    expect(storage.status()).toMatchObject({ validFileCount: 0, staleCount: 1 })
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
    expect((await walk(postingsDir(ctx.cacheDirectory))).some((item) => item.includes("/terms/"))).toBe(true)
  })

  test("resumes checkpointed posting documents in a replacement storage instance", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })
    await storage.beginFullScan()
    for (let index = 0; index < 64; index += 1) {
      const file = `drivers/ufs/unit-${index}.c`
      const content = `int unit_${index}(void) { return ${index}; }\n`
      const parsed = graph(workspacePath, file, content)
      await storage.upsertFilePostings(path.join(workspacePath, file), parsed.fileHash, parsed, { content })
    }

    const resumed = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })
    await resumed.beginFullScan()
    expect(await resumed.getFilePostings(path.join(workspacePath, "drivers/ufs/unit-63.c"))).toMatchObject({
      filePath: "drivers/ufs/unit-63.c",
    })
  })

  test("persists each document during a full scan before publishing term buckets", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const filePath = "drivers/ufs/streamed.c"
    const parsed = graph(workspacePath, filePath, source)
    const storage = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })

    await storage.beginFullScan()
    await storage.upsertFilePostings(path.join(workspacePath, filePath), parsed.fileHash, parsed, { content: source })

    const docs = await walk(path.join(postingsDir(cacheDirectory), "docs"))
    expect(docs).toHaveLength(1)
    expect(docs[0]).toEndWith(".jsonl")
    expect(await storage.getFilePostings(filePath)).toMatchObject({ filePath, fileHash: parsed.fileHash })
    expect(await exists(path.join(postingsDir(cacheDirectory), "terms"))).toBe(false)

    await storage.markFullScanComplete()
    expect((await storage.search("UART0_CTRL_REG"))[0]?.filePath).toBe(filePath)
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

  test("reuses current full scan postings and prunes unseen files", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const main = "drivers/ufs/main_device.c"
    const old = "drivers/ufs/old_device.c"
    const storage = new CodePostingsJsonStorage({
      workspacePath,
      cacheDirectory,
      clock: () => new Date("2026-06-10T00:00:00.000Z"),
    })
    const parsed = graph(workspacePath, main, source)
    const oldSource = source.replace("timeout waiting for device_ready error path EIO", "legacyonly deleted token")
    const stale = graph(workspacePath, old, oldSource)

    await storage.beginFullScan()
    await storage.upsertFilePostings(path.join(workspacePath, main), parsed.fileHash, parsed, { content: source })
    await storage.upsertFilePostings(path.join(workspacePath, old), stale.fileHash, stale, { content: oldSource })
    await storage.markFullScanComplete()

    const manifestPath = path.join(postingsDir(cacheDirectory), "manifest.json")
    const before = JSON.parse(await readFile(manifestPath, "utf-8")) as CodePostingsManifest
    const prior = before.records[main]!

    await storage.beginFullScan()
    await storage.upsertFilePostings(path.join(workspacePath, main), parsed.fileHash, parsed, { content: source })
    await storage.markFullScanComplete()

    const after = JSON.parse(await readFile(manifestPath, "utf-8")) as CodePostingsManifest
    expect(Object.keys(after.records).sort()).toEqual([main])
    expect(after.records[main]?.updatedAt).toBe(prior.updatedAt)
    expect(after.records[main]?.fileHash).toBe(prior.fileHash)
    expect((await storage.search("UART0_CTRL_REG"))[0]?.filePath).toBe(main)
    expect(await storage.search("legacyonly")).toEqual([])
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

    const manifestPath = path.join(postingsDir(ctx.cacheDirectory), "manifest.json")
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
    expect(mismatched.getScanState()).toBe("needs-rebuild")
    expect(await mismatched.search("UART0_CTRL_REG")).toHaveLength(0)
  })

  test("reuses compatible postings manifests", async () => {
    const ctx = await fixture()

    const decision = await ctx.storage.ensureCompatible()

    expect(decision).toEqual({ action: "reuse", reason: "compatible" })
    expect((await ctx.storage.search("UART0_CTRL_REG"))[0]?.filePath).toBe(ctx.filePath)
  })

  test("isolates workspaces sharing one cache and clears only the selected postings", async () => {
    const first = await root()
    const second = await root()
    const cacheDirectory = await root()
    const left = new CodePostingsJsonStorage({ workspacePath: first, cacheDirectory })
    const right = new CodePostingsJsonStorage({ workspacePath: second, cacheDirectory })
    const leftFile = "drivers/ufs/left.c"
    const rightFile = "drivers/ufs/right.c"
    const leftGraph = graph(first, leftFile, "int left(void) { return 1; }\n")
    const rightGraph = graph(second, rightFile, "int right(void) { return 2; }\n")

    await left.beginFullScan()
    await left.upsertFilePostings(path.join(first, leftFile), leftGraph.fileHash, leftGraph)
    await left.markFullScanComplete()
    await right.beginFullScan()
    await right.upsertFilePostings(path.join(second, rightFile), rightGraph.fileHash, rightGraph)
    await right.markFullScanComplete()

    expect(left.status().postingsDirectory).not.toBe(right.status().postingsDirectory)
    expect(await left.listFiles()).toEqual([leftFile])
    expect(await right.listFiles()).toEqual([rightFile])

    await left.clear()
    expect(await left.listFiles()).toEqual([])
    expect(await right.listFiles()).toEqual([rightFile])
  })

  test("retains and ignores a completed legacy shared postings cache", async () => {
    const ctx = await fixture()
    const isolated = postingsDir(ctx.cacheDirectory, ctx.workspacePath)
    const legacy = legacyPostingsDir(ctx.cacheDirectory)
    await rename(isolated, legacy)

    const storage = new CodePostingsJsonStorage({
      workspacePath: ctx.workspacePath,
      cacheDirectory: ctx.cacheDirectory,
    })
    expect(await storage.ensureCompatible()).toEqual({ action: "rebuild", reason: "missing compatibility metadata" })
    expect(await storage.listFiles()).toEqual([])
    expect(await exists(legacy)).toBe(true)
    expect(await exists(path.join(isolated, "manifest.json"))).toBe(true)
  })

  test("retains an incompatible legacy postings cache while rebuilding isolated storage", async () => {
    const ctx = await fixture()
    const isolated = postingsDir(ctx.cacheDirectory, ctx.workspacePath)
    const legacy = legacyPostingsDir(ctx.cacheDirectory)
    await rename(isolated, legacy)
    const file = path.join(legacy, "manifest.json")
    const manifest = JSON.parse(await readFile(file, "utf-8")) as CodePostingsManifest
    manifest.tokenizerVersion = CODE_POSTINGS_TOKENIZER_VERSION + 1
    await writeFile(file, JSON.stringify(manifest), "utf-8")
    const before = await readFile(file, "utf-8")

    const storage = new CodePostingsJsonStorage({
      workspacePath: ctx.workspacePath,
      cacheDirectory: ctx.cacheDirectory,
    })
    expect((await storage.ensureCompatible()).action).toBe("rebuild")

    expect(await readFile(file, "utf-8")).toBe(before)
    expect(await exists(legacy)).toBe(true)
    expect(await exists(path.join(isolated, "manifest.json"))).toBe(true)
    expect(await storage.listFiles()).toEqual([])
  })

  test("retains interrupted or mismatched legacy postings caches", async () => {
    const ctx = await fixture()
    const other = await root()
    const isolated = postingsDir(ctx.cacheDirectory, ctx.workspacePath)
    const legacy = legacyPostingsDir(ctx.cacheDirectory)
    await rename(isolated, legacy)
    const manifest = await readFile(path.join(legacy, "manifest.json"), "utf-8")
    await writeFile(path.join(legacy, "manifest.rebuild.json"), manifest, "utf-8")

    const interrupted = new CodePostingsJsonStorage({
      workspacePath: ctx.workspacePath,
      cacheDirectory: ctx.cacheDirectory,
    })
    expect((await interrupted.ensureCompatible()).action).toBe("rebuild")
    expect(await exists(legacy)).toBe(true)

    const mismatch = new CodePostingsJsonStorage({ workspacePath: other, cacheDirectory: ctx.cacheDirectory })
    expect((await mismatch.ensureCompatible()).action).toBe("rebuild")
    expect(await exists(legacy)).toBe(true)
  })

  test("rebuilds postings storage when key compatibility metadata is missing", async () => {
    const ctx = await fixture()
    const manifestPath = path.join(postingsDir(ctx.cacheDirectory), "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as Partial<CodePostingsManifest>
    delete manifest.documentCount
    await writeFile(manifestPath, JSON.stringify(manifest), "utf-8")

    const broken = new CodePostingsJsonStorage({
      workspacePath: ctx.workspacePath,
      cacheDirectory: ctx.cacheDirectory,
    })
    expect(broken.getScanState()).toBe("needs-rebuild")
    const decision = await broken.ensureCompatible()

    expect(decision).toEqual({ action: "rebuild", reason: "missing compatibility metadata" })
    expect(
      new CodePostingsJsonStorage({ workspacePath: ctx.workspacePath, cacheDirectory: ctx.cacheDirectory }).status(),
    ).toMatchObject({
      postingsSchemaVersion: CODE_POSTINGS_SCHEMA_VERSION,
      recordCount: 0,
      needsRebuild: false,
    })
  })

  test("ignores staged rebuild manifests from another workspace", async () => {
    const workspacePath = await root()
    const other = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const stage = path.join(postingsDir(cacheDirectory), "manifest.rebuild.json")

    await mkdir(path.dirname(stage), { recursive: true })
    await writeFile(
      stage,
      JSON.stringify({
        workspacePath: other,
        postingsSchemaVersion: 1,
        tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
        graphSchemaVersion: 1,
        parserVersion: 1,
        dataGeneration: "foreign",
        documentCount: 1,
        updatedAt: "2026-06-10T00:00:00.000Z",
        diagnostics: [],
        records: {
          "foreign.c": {
            filePath: "foreign.c",
            docFile: "docs/foreign/foreign.json",
            status: "ok",
            fileHash: "foreign",
            documentLength: 1,
            updatedAt: "2026-06-10T00:00:00.000Z",
          },
        },
        docParts: [],
        termParts: [],
      }),
      "utf-8",
    )

    const storage = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })
    await storage.beginFullScan()
    await storage.markFullScanComplete()

    expect(storage.status()).toMatchObject({
      workspacePath,
      recordCount: 0,
      validFileCount: 0,
    })
    expect(await storage.search("foreign")).toEqual([])
  })

  test("cleans only same-workspace abandoned postings artifacts", async () => {
    const ctx = await fixture()
    const dir = postingsDir(ctx.cacheDirectory)
    const manifestPath = path.join(dir, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CodePostingsManifest
    const active = path.join(dir, manifest.docParts![0]!.path)
    const stage = path.join(dir, "manifest.rebuild.json")
    const staleDoc = path.join(dir, "docs/orphan/dead.json")
    const staleTerm = path.join(dir, "terms/orphan/aa/dead.json")
    const extra = path.join(dir, "docs", manifest.dataGeneration!, "extra.json")
    const settings = path.join(ctx.cacheDirectory, "settings/keep.json")

    await mkdir(path.dirname(staleDoc), { recursive: true })
    await mkdir(path.dirname(staleTerm), { recursive: true })
    await mkdir(path.dirname(extra), { recursive: true })
    await mkdir(path.dirname(settings), { recursive: true })
    await writeFile(stage, JSON.stringify({ ...manifest, records: {} }), "utf-8")
    await writeFile(staleDoc, "{}", "utf-8")
    await writeFile(staleTerm, "{}", "utf-8")
    await writeFile(extra, "{}", "utf-8")
    await writeFile(settings, "{}", "utf-8")

    const stats = await ctx.storage.cleanupAbandonedArtifacts()

    expect(await exists(active)).toBe(true)
    expect(await exists(settings)).toBe(true)
    expect(await exists(stage)).toBe(true)
    expect(await exists(staleDoc)).toBe(false)
    expect(await exists(staleTerm)).toBe(false)
    expect(await exists(extra)).toBe(false)
    expect((await ctx.storage.search("UART0_CTRL_REG"))[0]?.filePath).toBe(ctx.filePath)
    expect(stats.filesDeleted + stats.directoriesDeleted).toBeGreaterThan(0)
  })

  test("skips postings cleanup when active manifest belongs to another workspace", async () => {
    const workspacePath = await root()
    const other = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const dir = postingsDir(cacheDirectory)
    const stale = path.join(dir, "docs/orphan/dead.json")

    await mkdir(path.dirname(stale), { recursive: true })
    await writeFile(stale, "{}", "utf-8")
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        workspacePath: other,
        postingsSchemaVersion: 1,
        tokenizerVersion: CODE_POSTINGS_TOKENIZER_VERSION,
        graphSchemaVersion: 1,
        parserVersion: 1,
        dataGeneration: "foreign",
        documentCount: 0,
        updatedAt: "2026-06-10T00:00:00.000Z",
        diagnostics: [],
        records: {},
        docParts: [],
        termParts: [],
      }),
      "utf-8",
    )

    const storage = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })
    const stats = await storage.cleanupAbandonedArtifacts()

    expect(await exists(stale)).toBe(true)
    expect(stats.skipped).toContain("codepostings: active manifest workspace mismatch")
  })

  test("omits bm25 hits without line ranges and reports diagnostics", async () => {
    const ctx = await fixture()
    const term = (await walk(path.join(postingsDir(ctx.cacheDirectory), "terms"))).find((item) =>
      item.endsWith(".jsonl"),
    )
    expect(term).toBeDefined()
    const lines = (await readFile(term!, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { term: string; document: CodePostingsTermDocument })
    const match = lines[0]!.term
    for (const line of lines) {
      if (line.term !== match) continue
      line.document.ranges = [{ ...line.document.ranges[0]!, startLine: undefined as unknown as number }]
    }
    await writeFile(term!, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8")

    const storage = new CodePostingsJsonStorage({
      workspacePath: ctx.workspacePath,
      cacheDirectory: ctx.cacheDirectory,
    })
    const diagnostics: NonNullable<Parameters<typeof storage.search>[1]>["diagnostics"] = []
    const result = await storage.search(match, { diagnostics })

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

function postingsDir(cacheDirectory: string, workspacePath = path.dirname(cacheDirectory)): string {
  return path.join(cacheDirectory, "codepostings", workspaceKey(workspacePath), CODE_POSTINGS_STORAGE_VERSION_DIR)
}

function legacyPostingsDir(cacheDirectory: string): string {
  return path.join(cacheDirectory, "codepostings", CODE_POSTINGS_STORAGE_VERSION_DIR)
}

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

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch (err) {
    void err
    return false
  }
}
