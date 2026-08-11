import { describe, expect, test } from "bun:test"
import { ChipMatePtySelfCommand } from "../../src/chipmate/pty/self-command"

describe("pty self-command", () => {
  test("does not forward bundled bun entrypoints", () => {
    const proc = {
      argv: ["/tmp/chipmate", "/$bunfs/root/src/index.js"],
      execArgv: ["--user-agent=chipmate/test", "--use-system-ca", "--"],
      execPath: "/tmp/chipmate",
      cwd: "/tmp",
    }

    const cmd = ChipMatePtySelfCommand.command(proc)
    expect(cmd).toStrictEqual({ command: "/tmp/chipmate", args: [] })
    expect(ChipMatePtySelfCommand.resolve({ command: "chipmate", cwd: "/tmp/project" }, cmd)).toStrictEqual({
      command: "/tmp/chipmate",
      args: [],
      cwd: "/tmp/project",
      self: true,
    })
    expect(
      ChipMatePtySelfCommand.command({
        ...proc,
        argv: ["C:/tmp/chipmate.exe", "B:/~BUN/root/src/index.js"],
      }).args,
    ).toStrictEqual([])
    expect(
      ChipMatePtySelfCommand.command({
        ...proc,
        argv: ["C:/tmp/chipmate.exe", "b:\\~BUN\\root\\src\\index.js"],
      }).args,
    ).toStrictEqual([])
  })

  test("forwards source entrypoints", () => {
    const cmd = ChipMatePtySelfCommand.command({
      argv: ["/tmp/bun", "/tmp/chipmate/src/index.ts"],
      execArgv: ["--conditions=browser", "--cwd", "packages/opencode"],
      execPath: "/tmp/bun",
      cwd: "/tmp/chipmate",
    })
    expect(cmd).toStrictEqual({
      command: "/tmp/bun",
      args: ["--conditions=browser", "/tmp/chipmate/src/index.ts"],
      cwd: "/tmp/chipmate",
    })
    expect(ChipMatePtySelfCommand.resolve({ command: "chipmate", cwd: "/tmp/project" }, cmd)).toStrictEqual({
      command: "/tmp/bun",
      args: ["--conditions=browser", "/tmp/chipmate/src/index.ts", "/tmp/project"],
      cwd: "/tmp/chipmate",
      self: true,
    })
  })
})
