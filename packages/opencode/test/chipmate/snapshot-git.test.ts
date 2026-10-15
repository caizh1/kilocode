import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { SnapshotGit } from "../../src/chipmate/snapshot/git"
import { tmpdir } from "../fixture/fixture"

describe("snapshot Git compatibility", () => {
  test("stages and removes literal paths, bounds legacy argv, and caches command capabilities", async () => {
    await using dir = await tmpdir({ git: true })
    const calls: string[][] = []
    const git = (args: string[], options?: { stdin?: string }) =>
      Effect.promise(async () => {
        calls.push(args)
        const child = Bun.spawn(["git", ...args], {
          cwd: dir.path,
          stdin: options?.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
          stdout: "pipe",
          stderr: "pipe",
        })
        const [code, text, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        return { code, text, stderr }
      })
    const update = SnapshotGit.make(git)
    const files = Array.from({ length: 160 }, (_, index) => `${index}-文件 [literal] ${"a".repeat(80)}.txt`)
    if (process.platform !== "win32") files.push(":literal*.txt", "line\nbreak.txt")
    await Promise.all(files.map((file) => fs.writeFile(path.join(dir.path, file), "before\n")))
    await fs.writeFile(path.join(dir.path, "unrelated.txt"), "leave untracked\n")

    expect((await Effect.runPromise(update("add", files))).code).toBe(0)
    const tracked = await Effect.runPromise(git(["ls-files", "-z"]))
    expect(tracked.text.split("\0").filter(Boolean).sort()).toEqual([...files].sort())

    await fs.writeFile(path.join(dir.path, files[0]), "after\n")
    expect((await Effect.runPromise(update("add", [files[0]]))).code).toBe(0)
    expect((await Effect.runPromise(git(["show", `:${files[0]}`]))).text).toBe("after\n")

    expect((await Effect.runPromise(update("rm", files))).code).toBe(0)
    expect((await Effect.runPromise(update("rm", files))).code).toBe(0)
    expect((await Effect.runPromise(git(["ls-files", "-z"]))).text).toBe("")
    expect(await fs.readFile(path.join(dir.path, files[0]), "utf8")).toBe("after\n")
    expect(calls.filter((args) => args[0] === "add" && args[1] === "-h").length).toBe(1)
    expect(calls.filter((args) => args[0] === "rm" && args[1] === "-h").length).toBe(1)
    for (const args of calls.filter(
      (args) => args.includes("--") && args.some((arg) => arg.startsWith(":(top,literal)")),
    ))
      expect(Buffer.byteLength(args.join(" "))).toBeLessThan(8300)

    // Check capability selection against real dry runs, independently of help formatting.
    const adds = calls.filter((args) => args[0] === "add" && args[1] !== "-h")
    const removes = calls.filter((args) => args[0] === "rm" && args[1] !== "-h")
    const sparse = await Effect.runPromise(git(["add", "--dry-run", "--sparse", "--", files[0]]))
    const stdin = `:(top,literal)${files[0]}\0`
    const add = await Effect.runPromise(
      git(["add", "--dry-run", "--pathspec-from-file=-", "--pathspec-file-nul"], { stdin }),
    )
    const remove = await Effect.runPromise(
      git(["rm", "--dry-run", "--cached", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        stdin,
      }),
    )
    expect(adds.every((args) => args.includes("--sparse"))).toBe(sparse.code === 0)
    expect(adds.every((args) => args.includes("--pathspec-from-file=-"))).toBe(add.code === 0)
    expect(removes.every((args) => args.includes("--pathspec-from-file=-"))).toBe(remove.code === 0)
  })

  test("preserves root initialization and real git failures", async () => {
    await using dir = await tmpdir({ git: true })
    const git = (args: string[], options?: { stdin?: string }) =>
      Effect.promise(async () => {
        const child = Bun.spawn(["git", ...args], {
          cwd: dir.path,
          stdin: options?.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
          stdout: "pipe",
          stderr: "pipe",
        })
        const [code, text, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        return { code, text, stderr }
      })
    const update = SnapshotGit.make(git)
    await fs.writeFile(path.join(dir.path, "root.txt"), "root\n")
    expect((await Effect.runPromise(update("add", ["root.txt"], { root: true }))).code).toBe(0)
    expect((await Effect.runPromise(git(["ls-files"]))).text.trim()).toBe("root.txt")
    const failed = await Effect.runPromise(update("add", ["missing.txt"]))
    expect(failed.code).not.toBe(0)
    expect(failed.stderr).toContain("missing.txt")
  })
})
