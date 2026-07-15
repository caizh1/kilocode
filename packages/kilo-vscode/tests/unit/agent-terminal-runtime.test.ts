import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  classifyCommand,
  planNaturalLanguageCommand,
  projectContextSummary,
  summarizeOutput,
  suggestFailureFix,
  writeLogArtifact,
} from "../../src/services/agent-terminal/runtime"

describe("agent terminal runtime", () => {
  test("classifies safe, review, and dangerous commands", () => {
    expect(classifyCommand("git status --short")).toMatchObject({
      level: "safe",
      requiresConfirmation: false,
    })
    expect(classifyCommand("git push origin main")).toMatchObject({
      level: "review",
      requiresConfirmation: true,
    })
    expect(classifyCommand("rm -rf /tmp/example")).toMatchObject({
      level: "danger",
      requiresConfirmation: true,
    })
  })

  test("plans common natural language prompts without replacing the native shell loop", () => {
    const plan = planNaturalLanguageCommand("show current branch")

    expect(plan.command).toBe("git branch --show-current")
    expect(plan.risk.level).toBe("safe")
    expect(plan.notes.join("\n")).toContain("does not replace Kilo's native shell/tool loop")
  })

  test("summarizes long output with head and tail slices", () => {
    const output = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join("\n")
    const summary = summarizeOutput(output, 8)

    expect(summary.truncated).toBe(true)
    expect(summary.head).toEqual(["line-1", "line-2", "line-3", "line-4"])
    expect(summary.tail).toEqual(["line-17", "line-18", "line-19", "line-20"])
  })

  test("suggests narrow fixes from failure output", () => {
    const suggestions = suggestFailureFix(127, "command not found: bun")

    expect(suggestions.some((suggestion) => suggestion.includes("PATH"))).toBe(true)
    expect(suggestions.some((suggestion) => suggestion.includes("127"))).toBe(true)
  })

  test("creates workspace-scoped context summaries and log artifacts", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-agent-terminal-"))
    await fs.writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({ name: "demo", version: "1.2.3", scripts: { test: "bun test" } }),
    )
    await fs.writeFile(path.join(workspace, "README.md"), "# Demo\n")
    await fs.writeFile(path.join(workspace, "AGENTS.md"), "Use careful local commands.\n")
    await fs.writeFile(path.join(workspace, "meson.build"), "project('demo', 'c')\n")
    await fs.writeFile(path.join(workspace, "compile_commands.json"), `${"x".repeat(2_000)}tail`)
    await fs.writeFile(path.join(workspace, "terminal.log"), "TypeScript error\n")

    const context = await projectContextSummary(workspace)
    expect(context).toContain("Package: demo")
    expect(context).toContain("Scripts: test")
    expect(context).toContain("## Build-system excerpts")
    expect(context).toContain("### meson.build")
    expect(context).toContain("project('demo', 'c')")
    expect(context).not.toContain("tail")

    const logPath = await writeLogArtifact(workspace, "terminal.log", "Build Log")
    expect(logPath).toMatch(/^\.kilo\/artifacts\/.*\/terminal\.log$/)
    const manifestPath = path.join(workspace, path.dirname(logPath), "artifact.json")
    expect(await fs.readFile(manifestPath, "utf8")).toContain('"kind": "agent-terminal-log"')

    await expect(writeLogArtifact(workspace, "../outside.log")).rejects.toThrow("Path must stay inside workspace")
  })
})
