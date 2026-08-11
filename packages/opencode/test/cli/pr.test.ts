// chipmate_change - new file
import { expect, test } from "bun:test"
import { cliCommand } from "../../src/cli/cmd/pr"

test("cliCommand uses the current script when argv[1] is a file path", () => {
  const result = cliCommand({
    execPath: "/usr/bin/node",
    argv: ["/usr/bin/node", "/tmp/chipmate.js", "pr", "1"],
    exists: (file) => file === "/tmp/chipmate.js",
  })

  expect(result).toEqual(["/usr/bin/node", "/tmp/chipmate.js"])
})

test("cliCommand falls back to execPath when argv[1] is a subcommand", () => {
  const result = cliCommand({
    execPath: "/usr/local/bin/chipmate",
    argv: ["/usr/local/bin/chipmate", "pr", "1"],
    exists: () => false,
  })

  expect(result).toEqual(["/usr/local/bin/chipmate"])
})

test("cliCommand ignores subcommand token even when it exists on disk", () => {
  const result = cliCommand({
    execPath: "/usr/local/bin/chipmate",
    argv: ["/usr/local/bin/chipmate", "pr", "1"],
    exists: (file) => file === "pr",
  })

  expect(result).toEqual(["/usr/local/bin/chipmate"])
})

test("cliCommand falls back to execPath when argv[1] is missing", () => {
  const result = cliCommand({
    execPath: "/usr/local/bin/chipmate",
    argv: ["/usr/local/bin/chipmate"],
    exists: () => false,
  })

  expect(result).toEqual(["/usr/local/bin/chipmate"])
})

test("cliCommand falls back to execPath for bun virtual script paths", () => {
  const unix = cliCommand({
    execPath: "/tmp/chipmate",
    argv: ["/tmp/chipmate", "/$bunfs/root/src/index.js", "pr", "1"],
    exists: () => true,
  })

  const win = cliCommand({
    execPath: "C:/tmp/chipmate.exe",
    argv: ["C:/tmp/chipmate.exe", "B:/~BUN/root/src/index.js", "pr", "1"],
    exists: () => true,
  })

  expect(unix).toEqual(["/tmp/chipmate"])
  expect(win).toEqual(["C:/tmp/chipmate.exe"])
})
