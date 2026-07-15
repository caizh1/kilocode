import fs from "fs/promises"
import type { FileHandle } from "fs/promises"
import path from "path"
import { classifyCommand, type CommandRisk } from "../../shared/command-risk"

export { classifyCommand }
export type { CommandRisk }

export type PlannedCommand = {
  prompt: string
  command: string
  risk: CommandRisk
  notes: string[]
}

export type OutputSummary = {
  lineCount: number
  charCount: number
  truncated: boolean
  head: string[]
  tail: string[]
}

const BUILD_CONTEXT_FILES = [
  "Makefile",
  "makefile",
  "CMakeLists.txt",
  "meson.build",
  "configure",
  "configure.ac",
  "compile_commands.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "settings.gradle",
  "package-lock.json",
  "bun.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
]

export function planNaturalLanguageCommand(prompt: string): PlannedCommand {
  const text = prompt.trim().toLowerCase()
  const command = (() => {
    if (/git\s+status|status/.test(text)) return "git status --short"
    if (/current\s+branch|branch/.test(text)) return "git branch --show-current"
    if (/list|files|目录|文件/.test(text)) return "ls -la"
    if (/disk|space|磁盘/.test(text)) return "df -h ."
    if (/large|big|大文件/.test(text)) return "find . -type f -size +50M -print"
    if (/test|测试/.test(text)) return "bun test"
    if (/compile|typecheck|编译/.test(text)) return "bun run compile"
    if (/lint/.test(text)) return "bun run lint"
    return prompt.trim()
  })()
  const risk = classifyCommand(command)
  return {
    prompt,
    command,
    risk,
    notes: [
      "Agent Terminal only plans and checks commands; it does not replace Kilo's native shell/tool loop.",
      risk.requiresConfirmation
        ? "Review the command before running it."
        : "This command is classified as safe by local heuristics.",
    ],
  }
}

export function suggestFailureFix(exitCode: number | undefined, output: string): string[] {
  const text = output.toLowerCase()
  const suggestions: string[] = []
  if (/command not found|not recognized/.test(text))
    suggestions.push("Check whether the executable is installed and available in PATH.")
  if (/permission denied|eacces/.test(text))
    suggestions.push("Check file permissions; avoid sudo unless you explicitly understand the target path.")
  if (/enoent|no such file or directory/.test(text))
    suggestions.push("Verify the current working directory and file path.")
  if (/typescript|tsc|type error|cannot find module/.test(text))
    suggestions.push("Inspect TypeScript/module resolution errors before retrying.")
  if (/network|econnrefused|etimedout|timeout/.test(text))
    suggestions.push("Check network/proxy/service availability and retry with a smaller scoped command.")
  if (/test failed|failing|assert/.test(text))
    suggestions.push("Open the first failing test and fix the root assertion before rerunning the full suite.")
  if (exitCode && exitCode !== 0)
    suggestions.push(
      `Command exited with ${exitCode}; rerun the narrowest failing command after addressing the first error.`,
    )
  return suggestions.length
    ? suggestions
    : ["No specific pattern matched; inspect the first error line and rerun a narrower command."]
}

export function summarizeOutput(output: string, maxLines = 80): OutputSummary {
  const lines = output.split(/\r?\n/)
  const keep = Math.max(4, Math.floor(maxLines / 2))
  return {
    lineCount: lines.length,
    charCount: output.length,
    truncated: lines.length > maxLines,
    head: lines.slice(0, keep),
    tail: lines.length > maxLines ? lines.slice(-keep) : [],
  }
}

export async function projectContextSummary(workspaceRoot: string): Promise<string> {
  const files = await Promise.all([
    readJson(path.join(workspaceRoot, "package.json")),
    readTextIfExists(path.join(workspaceRoot, "README.md"), 2_000),
    readTextIfExists(path.join(workspaceRoot, "AGENTS.md"), 2_000),
    buildFileSummaries(workspaceRoot),
  ])
  const pkg = files[0] as Record<string, unknown> | undefined
  const buildFiles = files[3] as string[]
  const lines = [
    "# Kilo Agent Terminal Context",
    "",
    `Workspace: ${workspaceRoot}`,
    pkg?.name ? `Package: ${String(pkg.name)}` : undefined,
    pkg?.version ? `Version: ${String(pkg.version)}` : undefined,
    pkg?.scripts && typeof pkg.scripts === "object"
      ? `Scripts: ${Object.keys(pkg.scripts).slice(0, 20).join(", ")}`
      : undefined,
    "",
    "## README excerpt",
    String(files[1] ?? "(not found)"),
    "",
    "## AGENTS excerpt",
    String(files[2] ?? "(not found)"),
    "",
    "## Build-system excerpts",
    buildFiles.length ? buildFiles.join("\n\n") : "(none found)",
  ].filter((line): line is string => line !== undefined)
  return `${lines.join("\n")}\n`
}

export async function writeLogArtifact(
  workspaceRoot: string,
  sourceFile: string,
  title = "Agent Terminal Log",
): Promise<string> {
  const absolute = path.resolve(workspaceRoot, sourceFile)
  assertInside(workspaceRoot, absolute)
  const bytes = await fs.readFile(absolute)
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent-terminal-log"
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")
  const dir = path.join(workspaceRoot, ".kilo", "artifacts", `${stamp}-${slug}`)
  await fs.mkdir(dir, { recursive: true })
  const logPath = path.join(dir, "terminal.log")
  await fs.writeFile(logPath, bytes)
  await fs.writeFile(
    path.join(dir, "artifact.json"),
    `${JSON.stringify(
      {
        kind: "agent-terminal-log",
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        primaryFile: "terminal.log",
        derivedFiles: [],
        sourceFiles: [path.relative(workspaceRoot, absolute).split(path.sep).join("/")],
        warnings: [],
        quality: { status: "unknown" },
      },
      null,
      2,
    )}\n`,
  )
  return path.relative(workspaceRoot, logPath).split(path.sep).join("/")
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`Path must stay inside workspace: ${target}`)
}

async function readTextIfExists(file: string, maxChars: number): Promise<string | undefined> {
  let handle: FileHandle | undefined
  try {
    handle = await fs.open(file, "r")
    const buffer = Buffer.alloc(Math.max(0, maxChars))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.toString("utf8", 0, bytesRead)
  } catch {
    return undefined
  } finally {
    await handle?.close()
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
}

async function buildFileSummaries(workspaceRoot: string): Promise<string[]> {
  const summaries = await Promise.all(
    BUILD_CONTEXT_FILES.map(async (relativePath) => {
      const text = await readTextIfExists(path.join(workspaceRoot, relativePath), 1_000)
      if (text === undefined) return undefined
      const trimmed = text.trim()
      return `### ${relativePath}\n${trimmed || "(empty file)"}`
    }),
  )
  return summaries.filter((item): item is string => item !== undefined)
}
