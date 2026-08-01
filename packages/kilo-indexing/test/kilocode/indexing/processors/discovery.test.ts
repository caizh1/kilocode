import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import ignore from "ignore"
import { describe, expect, test } from "bun:test"
import { CODE_GRAPH_SUPPORTED_EXTENSIONS } from "../../../../src/indexing/codegraph/constants"
import { discoverScanFiles } from "../../../../src/indexing/processors/discovery"

function rel(root: string, files: string[]): string[] {
  return files.map((file) => path.relative(root, file).replaceAll("\\", "/")).sort()
}

async function root(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "discovery-test-"))
}

describe("discoverScanFiles", () => {
  test("uses git for Code Graph exact extension discovery", async () => {
    const dir = await root()
    const seen: Array<{ cwd: string; patterns: string[] }> = []
    const result = await discoverScanFiles({
      directoryPath: dir,
      workspacePath: dir,
      target: "codeGraph",
      ignoreInstance: ignore(),
      runGit: async (input) => {
        seen.push({ cwd: input.cwd, patterns: input.patterns })
        return ["main.c", "include/driver.H", "app.ts", ".kilo/worktrees/feature/copy.c", "node_modules/pkg/native.c"]
      },
    })

    expect(result.engine).toBe("git")
    expect(result.patterns).toEqual(CODE_GRAPH_SUPPORTED_EXTENSIONS.map((ext) => `*${ext}`))
    expect(seen).toEqual([{ cwd: dir, patterns: result.patterns }])
    expect(result.rawFiles).toBe(5)
    expect(result.supportedFiles).toBe(2)
    expect(rel(dir, result.paths)).toEqual(["include/driver.H", "main.c"])
  })

  test("falls back to rg when git fails", async () => {
    const dir = await root()
    const result = await discoverScanFiles({
      directoryPath: dir,
      workspacePath: dir,
      target: "codeGraph",
      ignoreInstance: ignore(),
      runGit: async () => {
        throw new Error("not a git repo")
      },
      runRg: async () => ["main.c", "app.ts"],
    })

    expect(result.engine).toBe("rg")
    expect(result.fallbackReason).toContain("not a git repo")
    expect(result.rawFiles).toBe(2)
    expect(result.supportedFiles).toBe(1)
    expect(rel(dir, result.paths)).toEqual(["main.c"])
  })

  test("skips test and tests directories for Code Graph discovery only", async () => {
    const dir = await root()
    const result = await discoverScanFiles({
      directoryPath: dir,
      workspacePath: dir,
      target: "codeGraph",
      ignoreInstance: ignore(),
      runGit: async () => [
        "src/main.c",
        "src/test/helper.c",
        "tests/a.c",
        "drivers/net/tests/x.h",
        "contest/keep.c",
        "testdata/keep.c",
        "SRC/TEST/upper.c",
      ],
    })

    expect(result.engine).toBe("git")
    expect(result.rawFiles).toBe(7)
    expect(result.supportedFiles).toBe(3)
    expect(rel(dir, result.paths)).toEqual(["contest/keep.c", "src/main.c", "testdata/keep.c"])
  })

  test("falls back to extension-scoped glob when git and rg fail", async () => {
    const dir = await root()
    await mkdir(path.join(dir, "include"), { recursive: true })
    await mkdir(path.join(dir, ".kilo", "worktrees", "feature"), { recursive: true })
    await Bun.write(path.join(dir, "main.c"), "int main(void) { return 0; }\n")
    await Bun.write(path.join(dir, "include", "driver.H"), "int driver(void);\n")
    await Bun.write(path.join(dir, "app.ts"), "export const app = 1\n")
    await Bun.write(path.join(dir, ".kilo", "worktrees", "feature", "copy.c"), "int copy(void) { return 0; }\n")

    const result = await discoverScanFiles({
      directoryPath: dir,
      workspacePath: dir,
      target: "codeGraph",
      ignoreInstance: ignore(),
      runGit: async () => {
        throw new Error("not a git repo")
      },
      runRg: async () => {
        throw new Error("rg missing")
      },
    })

    expect(result.engine).toBe("glob")
    expect(result.fallbackReason).toContain("not a git repo")
    expect(result.fallbackReason).toContain("rg missing")
    expect(result.rawFiles).toBe(2)
    expect(result.supportedFiles).toBe(2)
    expect(rel(dir, result.paths)).toEqual(["include/driver.H", "main.c"])
  })

  test("uses rg for broad RAG discovery", async () => {
    const dir = await root()
    let called = false

    const result = await discoverScanFiles({
      directoryPath: dir,
      workspacePath: dir,
      target: "rag",
      ignoreInstance: ignore(),
      runRg: async (input) => {
        called = true
        expect(input.patterns).toEqual(["**/*"])
        return ["main.c", "app.ts", "test/fixture.c", "README.md", "guide.markdown"]
      },
    })

    expect(called).toBe(true)
    expect(result.engine).toBe("rg")
    expect(result.patterns).toEqual(["**/*"])
    expect(rel(dir, result.paths)).toEqual(["app.ts", "main.c", "test/fixture.c"])
  })

  test("falls back to broad glob when RAG rg discovery fails", async () => {
    const dir = await root()
    await mkdir(path.join(dir, "test"), { recursive: true })
    await Bun.write(path.join(dir, "main.c"), "int main(void) { return 0; }\n")
    await Bun.write(path.join(dir, "app.ts"), "export const app = 1\n")
    await Bun.write(path.join(dir, "test", "fixture.c"), "int fixture(void) { return 0; }\n")
    await Bun.write(path.join(dir, "README.md"), "# Documentation\n")
    await Bun.write(path.join(dir, "guide.markdown"), "# Guide\n")

    const result = await discoverScanFiles({
      directoryPath: dir,
      workspacePath: dir,
      target: "rag",
      ignoreInstance: ignore(),
      runRg: async () => {
        throw new Error("rg missing")
      },
    })

    expect(result.engine).toBe("glob")
    expect(result.fallbackReason).toContain("rg missing")
    expect(rel(dir, result.paths)).toEqual(["app.ts", "main.c", "test/fixture.c"])
  })
})
