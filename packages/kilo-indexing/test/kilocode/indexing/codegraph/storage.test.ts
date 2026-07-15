import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { describe, expect, test } from "bun:test"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  CODE_GRAPH_STORAGE_VERSION_DIR,
  type CodeGraphManifest,
} from "../../../../src/indexing/codegraph"
import { parseCodeGraphFile } from "../../../../src/indexing/codegraph/parser"
import { CodeGraphJsonStorage } from "../../../../src/indexing/codegraph/storage"

async function root() {
  return mkdtemp(path.join(tmpdir(), "codegraph-storage-test-"))
}

function sample(
  workspacePath: string,
  filePath = path.join(workspacePath, "src/main.c"),
  text = "int main(void) { return helper(); }\n",
) {
  return parseCodeGraphFile({
    workspacePath,
    filePath: path.relative(workspacePath, filePath),
    content: text,
    fileHash: digest(text),
    updatedAt: "2026-06-10T00:00:00.000Z",
  })
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

describe("CodeGraphJsonStorage", () => {
  test("upserts, gets, lists, and writes atomically with sharded graph parts", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({
      workspacePath,
      cacheDirectory,
      clock: () => new Date("2026-06-10T00:00:00.000Z"),
    })
    const filePath = path.join(workspacePath, "src/main.c")
    const graph = sample(workspacePath, filePath)

    await storage.beginFullScan()
    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFullScanComplete()

    expect(await storage.listFiles()).toEqual(["src/main.c"])
    expect(await storage.getFileGraph(filePath)).toMatchObject({ filePath: "src/main.c", fileHash: graph.fileHash })
    expect(storage.status()).toMatchObject({
      recordCount: 1,
      validFileCount: 1,
      parseErrorCount: 0,
      unsupportedCount: 0,
      staleCount: 0,
      schemaMismatch: false,
      needsRebuild: false,
      lastFullScanAt: "2026-06-10T00:00:00.000Z",
      evidenceAvailable: false,
    })

    const dir = graphDir(cacheDirectory)
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf-8")) as CodeGraphManifest
    const record = manifest.records["src/main.c"]!
    expect(record.graphFile).toContain("shards/")
    expect(record.graphFile).not.toContain("main.c")
    expect(manifest.shards?.length).toBeGreaterThan(0)
    const part = manifest.shards?.[0]?.parts[0]
    expect(part?.path).toContain("shards/")
    expect(await exists(path.join(dir, part!.path))).toBe(true)
    const symbols = manifest.derived?.fields.symbolsByName[0]
    expect(symbols?.path).toContain("derived/")
    expect(await exists(path.join(dir, symbols!.path))).toBe(true)
    expect((await walk(dir)).some((item) => item.endsWith(".tmp"))).toBe(false)
  })

  test("resumes a checkpointed full scan in a replacement storage instance", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    await storage.beginFullScan()
    for (let index = 0; index < 64; index += 1) {
      const file = path.join(workspacePath, `src/unit-${index}.c`)
      const graph = sample(workspacePath, file, `int unit_${index}(void) { return ${index}; }\n`)
      await storage.upsertFileGraph(file, graph.fileHash, graph)
    }

    const resumed = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    await resumed.beginFullScan()
    expect((await resumed.getFileGraph(path.join(workspacePath, "src/unit-63.c")))?.functions[0]?.name).toBe("unit_63")
  })

  test("keeps same-hash upsert idempotent and updates changed files", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const filePath = path.join(workspacePath, "main.c")
    let tick = 0
    const storage = new CodeGraphJsonStorage({
      workspacePath,
      cacheDirectory,
      clock: () => new Date(`2026-06-10T00:00:0${tick++}.000Z`),
    })
    const first = sample(workspacePath, filePath, "int first(void) { return 1; }\n")
    await storage.upsertFileGraph(filePath, first.fileHash, first)
    const manifestPath = path.join(graphDir(cacheDirectory), "manifest.json")
    const before = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest

    await storage.upsertFileGraph(filePath, first.fileHash, first)
    const same = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    expect(same.records["main.c"]?.updatedAt).toBe(before.records["main.c"]?.updatedAt)

    const second = sample(workspacePath, filePath, "int second(void) { return 2; }\n")
    await storage.upsertFileGraph(filePath, second.fileHash, second)
    expect((await storage.getFileGraph(filePath))?.functions[0]?.name).toBe("second")
  })

  test("handles prototype-like file paths in graph manifests", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const filePath = path.join(workspacePath, "__proto__/constructor.c")
    const graph = sample(workspacePath, filePath, "int constructor(void) { return 1; }\n")

    await storage.beginFullScan()
    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFullScanComplete()

    expect(await storage.listFiles()).toEqual(["__proto__/constructor.c"])
    expect(await storage.getFileGraph(filePath)).toMatchObject({
      filePath: "__proto__/constructor.c",
      fileHash: graph.fileHash,
    })
    await storage.removeFileGraph(filePath)
    expect(storage.status()).toMatchObject({ validFileCount: 0, staleCount: 1 })
  })

  test("reuses current full scan records and prunes unseen files", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({
      workspacePath,
      cacheDirectory,
      clock: () => new Date("2026-06-10T00:00:00.000Z"),
    })
    const main = path.join(workspacePath, "main.c")
    const old = path.join(workspacePath, "old.c")
    const first = sample(workspacePath, main, "int first(void) { return 1; }\n")
    const stale = sample(workspacePath, old, "int stale(void) { return 0; }\n")

    await storage.beginFullScan()
    await storage.upsertFileGraph(main, first.fileHash, first)
    await storage.upsertFileGraph(old, stale.fileHash, stale)
    await storage.markFullScanComplete()

    const manifestPath = path.join(graphDir(cacheDirectory), "manifest.json")
    const before = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    const prior = before.records["main.c"]!

    await storage.beginFullScan()
    await storage.upsertFileGraph(main, first.fileHash, first)
    await storage.markFullScanComplete()

    const after = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    expect(Object.keys(after.records).sort()).toEqual(["main.c"])
    expect(after.records["main.c"]?.updatedAt).toBe(prior.updatedAt)
    expect(after.records["main.c"]?.fileHash).toBe(prior.fileHash)
    expect(await storage.listFiles()).toEqual(["main.c"])
  })

  test("tracks parse_error, unsupported, stale, and schema mismatch without deleting old sidecar", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const filePath = path.join(workspacePath, "main.c")
    const graph = sample(workspacePath, filePath)

    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFileGraphStatus(filePath, "parse_error", { fileHash: "bad", error: "parse failed" })
    await storage.markFileGraphStatus(path.join(workspacePath, "readme.md"), "unsupported", { fileHash: "md" })
    await storage.removeFileGraph(path.join(workspacePath, "old.c"))
    expect(storage.status()).toMatchObject({
      recordCount: 3,
      validFileCount: 0,
      parseErrorCount: 1,
      unsupportedCount: 1,
      staleCount: 1,
    })
    expect(await storage.getFileGraph(filePath)).toBeUndefined()

    const manifestPath = path.join(graphDir(cacheDirectory), "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION + 1,
        parserVersion: CODE_GRAPH_PARSER_VERSION + 1,
      }),
      "utf-8",
    )

    const mismatched = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    expect(mismatched.status()).toMatchObject({
      recordCount: 3,
      validFileCount: 0,
      schemaMismatch: true,
      needsRebuild: true,
      evidenceAvailable: false,
    })
    expect(await mismatched.getFileGraph(filePath)).toBeUndefined()
  })

  test("reuses compatible graph manifests", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const filePath = path.join(workspacePath, "main.c")
    const graph = sample(workspacePath, filePath)

    await storage.beginFullScan()
    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFullScanComplete()

    const decision = await storage.ensureCompatible()

    expect(decision).toEqual({ action: "reuse", reason: "compatible" })
    expect(await storage.listFiles()).toEqual(["main.c"])
  })

  test("rebuilds graph storage when manifest references missing graph data", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const filePath = path.join(workspacePath, "main.c")
    const graph = sample(workspacePath, filePath)

    await storage.beginFullScan()
    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFullScanComplete()

    const manifestPath = path.join(graphDir(cacheDirectory), "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    manifest.shards![0]!.parts[0]!.path = "shards/missing/missing.json"
    await writeFile(manifestPath, JSON.stringify(manifest), "utf-8")

    const decision = await new CodeGraphJsonStorage({ workspacePath, cacheDirectory }).ensureCompatible()

    expect(decision).toEqual({ action: "rebuild", reason: "missing graph shard" })
    expect(new CodeGraphJsonStorage({ workspacePath, cacheDirectory }).status()).toMatchObject({
      recordCount: 0,
      needsRebuild: false,
    })
  })

  test("rebuilds graph storage when manifest references missing derived sidecar data", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const filePath = path.join(workspacePath, "main.c")
    const graph = sample(workspacePath, filePath)

    await storage.beginFullScan()
    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFullScanComplete()

    const manifestPath = path.join(graphDir(cacheDirectory), "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    manifest.derived!.fields.symbolsByName[0]!.path = "derived/missing/symbolsByName/0000.json"
    await writeFile(manifestPath, JSON.stringify(manifest), "utf-8")

    const decision = await new CodeGraphJsonStorage({ workspacePath, cacheDirectory }).ensureCompatible()

    expect(decision).toEqual({ action: "rebuild", reason: "missing graph derived sidecar" })
  })

  test("ignores staged rebuild manifests from another workspace", async () => {
    const workspacePath = await root()
    const other = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const stage = path.join(graphDir(cacheDirectory), "manifest.rebuild.json")

    await mkdir(path.dirname(stage), { recursive: true })
    await writeFile(
      stage,
      JSON.stringify({
        workspacePath: other,
        graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
        parserVersion: CODE_GRAPH_PARSER_VERSION,
        dataGeneration: "foreign",
        records: {
          "foreign.c": {
            filePath: "foreign.c",
            graphFile: "shards/foreign/foreign",
            status: "ok",
            fileHash: "foreign",
            updatedAt: "2026-06-10T00:00:00.000Z",
          },
        },
        shards: [],
      }),
      "utf-8",
    )

    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    await storage.beginFullScan()
    await storage.markFullScanComplete()

    expect(storage.status()).toMatchObject({
      workspacePath,
      recordCount: 0,
      validFileCount: 0,
    })
    expect(await storage.listFiles()).toEqual([])
  })

  test("cleans only same-workspace abandoned graph artifacts", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const filePath = path.join(workspacePath, "main.c")
    const graph = sample(workspacePath, filePath)

    await storage.beginFullScan()
    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFullScanComplete()

    const dir = graphDir(cacheDirectory)
    const manifestPath = path.join(dir, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    const active = path.join(dir, manifest.shards![0]!.parts[0]!.path)
    const activeDerived = path.join(dir, manifest.derived!.fields.symbolsByName[0]!.path)
    const stage = path.join(dir, "manifest.rebuild.json")
    const stale = path.join(dir, "shards/orphan/dead.json")
    const staleDerived = path.join(dir, "derived/orphan/symbolsByName/dead.json")
    const extra = path.join(dir, "shards", manifest.dataGeneration!, "extra.json")
    const extraDerived = path.join(dir, "derived", manifest.dataGeneration!, "symbolsByName/extra.json")
    const linked = path.join(dir, "shards/linked")
    const outside = path.join(workspacePath, "outside.txt")
    const settings = path.join(cacheDirectory, "settings/keep.json")

    await mkdir(path.dirname(stale), { recursive: true })
    await mkdir(path.dirname(staleDerived), { recursive: true })
    await mkdir(path.dirname(extra), { recursive: true })
    await mkdir(path.dirname(extraDerived), { recursive: true })
    await mkdir(linked, { recursive: true })
    await mkdir(path.dirname(settings), { recursive: true })
    await writeFile(stage, JSON.stringify({ ...manifest, records: {} }), "utf-8")
    await writeFile(stale, "{}", "utf-8")
    await writeFile(staleDerived, "{}", "utf-8")
    await writeFile(extra, "{}", "utf-8")
    await writeFile(extraDerived, "{}", "utf-8")
    await writeFile(outside, "outside", "utf-8")
    await writeFile(settings, "{}", "utf-8")
    const linkedOutside = await maybeSymlink(outside, path.join(linked, "outside-link"))

    const stats = await storage.cleanupAbandonedArtifacts()

    expect(await exists(active)).toBe(true)
    expect(await exists(activeDerived)).toBe(true)
    expect(await exists(settings)).toBe(true)
    expect(await exists(stage)).toBe(true)
    expect(await exists(stale)).toBe(false)
    expect(await exists(staleDerived)).toBe(false)
    expect(await exists(extra)).toBe(false)
    expect(await exists(extraDerived)).toBe(false)
    if (linkedOutside) {
      expect(await exists(linked)).toBe(true)
      expect(stats.skipped.some((item) => item.includes("symlink"))).toBe(true)
    }
  })

  test("skips graph cleanup when active manifest belongs to another workspace", async () => {
    const workspacePath = await root()
    const other = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const dir = graphDir(cacheDirectory)
    const stale = path.join(dir, "shards/orphan/dead.json")

    await mkdir(path.dirname(stale), { recursive: true })
    await writeFile(stale, "{}", "utf-8")
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        workspacePath: other,
        graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION,
        parserVersion: CODE_GRAPH_PARSER_VERSION,
        dataGeneration: "foreign",
        records: {},
        shards: [],
      }),
      "utf-8",
    )

    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const stats = await storage.cleanupAbandonedArtifacts()

    expect(await exists(stale)).toBe(true)
    expect(stats.skipped).toContain("codegraph: active manifest workspace mismatch")
  })
})

function graphDir(cacheDirectory: string): string {
  return path.join(cacheDirectory, "codegraph", CODE_GRAPH_STORAGE_VERSION_DIR)
}

function digest(value: string): string {
  return `${fnv(value, 0x811c9dc5)}${fnv(value, 0x45d9f3b)}`
}

function fnv(value: string, seed: number): string {
  let hash = seed
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
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

async function maybeSymlink(target: string, file: string): Promise<boolean> {
  try {
    await symlink(target, file)
    return true
  } catch (err) {
    void err
    return false
  }
}
