import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import path from "node:path"
import type { Ignore } from "ignore"
import { glob } from "glob"
import { CODE_GRAPH_SUPPORTED_EXTENSIONS } from "../codegraph/constants"
import { shouldIndexCodeGraphPath } from "../codegraph/path-policy"
import type { IndexingScanTarget } from "../interfaces"
import { generateRelativeIgnorePath } from "../shared/get-relative-path"
import { scannerExtensions } from "../shared/supported-extensions"
import { FileIgnore } from "../../file/ignore"

const timeout = 30_000

export type DiscoveryEngine = "git" | "rg" | "glob"

export type DiscoveryResult = {
  paths: string[]
  rawFiles: number
  supportedFiles: number
  discoveryMs: number
  engine: DiscoveryEngine
  patterns: string[]
  fallbackReason?: string
}

export type RgRunner = (input: { cwd: string; patterns: string[]; timeoutMs: number }) => Promise<string[]>
export type GitRunner = (input: { cwd: string; patterns: string[]; timeoutMs: number }) => Promise<string[]>

type Raw = {
  paths: string[]
  engine: DiscoveryEngine
  fallbackReason?: string
}

export async function discoverScanFiles(input: {
  directoryPath: string
  workspacePath: string
  target: IndexingScanTarget
  ignoreInstance: Ignore
  runGit?: GitRunner
  runRg?: RgRunner
  timeoutMs?: number
}): Promise<DiscoveryResult> {
  const started = Date.now()
  const patterns = input.target === "codeGraph" ? graphPatterns() : ["**/*"]
  const raw = input.target === "codeGraph" ? await graph(input, patterns) : await wide(input.directoryPath)
  const paths = filter({
    paths: raw.paths,
    directoryPath: input.directoryPath,
    workspacePath: input.workspacePath,
    target: input.target,
    ignoreInstance: input.ignoreInstance,
  })

  return {
    paths,
    rawFiles: raw.paths.length,
    supportedFiles: paths.length,
    discoveryMs: Date.now() - started,
    engine: raw.engine,
    patterns,
    ...(raw.fallbackReason ? { fallbackReason: raw.fallbackReason } : {}),
  }
}

async function graph(
  input: {
    directoryPath: string
    runGit?: GitRunner
    runRg?: RgRunner
    timeoutMs?: number
  },
  patterns: string[],
): Promise<Raw> {
  const runGitFiles = input.runGit ?? runGit
  try {
    return {
      paths: absolutize(
        input.directoryPath,
        await runGitFiles({
          cwd: input.directoryPath,
          patterns,
          timeoutMs: input.timeoutMs ?? timeout,
        }),
      ),
      engine: "git",
    }
  } catch (git) {
    const run = input.runRg ?? runRg
    try {
      return {
        paths: absolutize(
          input.directoryPath,
          await run({
            cwd: input.directoryPath,
            patterns,
            timeoutMs: input.timeoutMs ?? timeout,
          }),
        ),
        engine: "rg",
        fallbackReason: `git: ${message(git)}`,
      }
    } catch (err) {
      return {
        paths: await narrow(input.directoryPath, patterns),
        engine: "glob",
        fallbackReason: `git: ${message(git)}; rg: ${message(err)}`,
      }
    }
  }
}

export async function runGit(input: { cwd: string; patterns: string[]; timeoutMs: number }): Promise<string[]> {
  const args = ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...input.patterns]
  const result = await proc("git", args, input.cwd, input.timeoutMs, "git ls-files")
  if (result.code === 0) return nul(result.stdout)
  throw new Error(result.stderr.trim() || `git ls-files failed with code ${result.code}`)
}

async function wide(root: string): Promise<Raw> {
  return {
    paths: await glob("**/*", {
      cwd: root,
      absolute: true,
      nodir: true,
      dot: false,
      ignore: FileIgnore.PATTERNS,
      maxDepth: Infinity,
    }),
    engine: "glob",
  }
}

async function narrow(root: string, patterns: string[]): Promise<string[]> {
  return glob(
    patterns.map((item) => `**/${item}`),
    {
      cwd: root,
      absolute: true,
      nodir: true,
      dot: false,
      nocase: true,
      ignore: FileIgnore.PATTERNS,
      maxDepth: Infinity,
    },
  )
}

export async function runRg(input: { cwd: string; patterns: string[]; timeoutMs: number }): Promise<string[]> {
  const bin = process.env.KILO_RIPGREP_PATH?.trim() || (process.platform === "win32" ? "rg.exe" : "rg")
  const args = [
    "--files",
    "--null",
    ...input.patterns.flatMap((item) => ["--iglob", item]),
    ...FileIgnore.FOLDERS.flatMap((item) => ["--glob", `!${item}/**`, "--glob", `!**/${item}/**`]),
  ]
  const result = await proc(bin, args, input.cwd, input.timeoutMs, "rg --files")
  if (result.code === 0 || result.code === 1) return nul(result.stdout)
  throw new Error(result.stderr.trim() || `rg --files failed with code ${result.code}`)
}

function proc(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  label = bin,
): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
    child.on("error", (cause) => {
      clearTimeout(timer)
      reject(cause)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
      })
    })
  })
}

function filter(input: {
  paths: string[]
  directoryPath: string
  workspacePath: string
  target: IndexingScanTarget
  ignoreInstance: Ignore
}): string[] {
  const out = new Set<string>()
  for (const item of input.paths) {
    const file = path.isAbsolute(item) ? item : path.resolve(input.directoryPath, item)
    const ext = path.extname(file).toLowerCase()
    const rel = generateRelativeIgnorePath(file, input.workspacePath)
    if (!rel) continue
    if (FileIgnore.match(rel)) continue
    if (input.target === "codeGraph" && !shouldIndexCodeGraphPath(rel)) continue
    const supported = input.target === "codeGraph" ? graphExt(ext) : scannerExtensions.includes(ext)
    if (!supported || input.ignoreInstance.ignores(rel)) continue
    out.add(file)
  }
  return [...out].sort()
}

function graphExt(ext: string): boolean {
  return CODE_GRAPH_SUPPORTED_EXTENSIONS.includes(ext as never)
}

function graphPatterns(): string[] {
  return CODE_GRAPH_SUPPORTED_EXTENSIONS.map((ext) => `*${ext}`)
}

function absolutize(root: string, paths: string[]): string[] {
  return paths.map((item) => (path.isAbsolute(item) ? item : path.resolve(root, item)))
}

function nul(buf: Buffer): string[] {
  return buf.toString("utf8").split("\0").filter(Boolean)
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
