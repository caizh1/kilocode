import { Process } from "@/util/process"
import path from "node:path"
import fs from "node:fs/promises"
import { Glob } from "@opencode-ai/core/util/glob"
import type { ResolvedRequest, Scope } from "./types"

export type File = {
  path: string
  hash: string
  bytes: number
  lines: number
  exists: boolean
}

export type ContentSource = { kind: "worktree" } | { kind: "index" } | { kind: "tree"; ref: string }

export type Snapshot = {
  root: string
  scope: Scope
  scopeLabel: string
  source: ContentSource
  files: File[]
  configuration: File[]
  additions: number
  deletions: number
  head: string
  fingerprint: string
  workspaceFingerprint: string
  diff: string
  diffCommand?: string
}

const configurationCandidates = [
  "CMakeLists.txt",
  "Makefile",
  "Kconfig",
  ".config",
  "meson.build",
  "platformio.ini",
  "compile_commands.json",
]

export class ScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UfsReviewScopeError"
  }
}

async function command(root: string, argv: string[], abort?: AbortSignal) {
  const result = await Process.text(argv, { cwd: root, abort, nothrow: true })
  if (result.code !== 0) {
    const detail = result.stderr.toString().trim()
    throw new ScopeError(detail || `命令执行失败：${argv.join(" ")}`)
  }
  return result.text
}

async function git(root: string, args: string[], abort?: AbortSignal) {
  return command(root, ["git", ...args], abort)
}

async function gitOptional(root: string, args: string[], abort?: AbortSignal) {
  const result = await Process.text(["git", ...args], { cwd: root, abort, nothrow: true })
  return result.code === 0 ? result.text.trim() : ""
}

function split0(value: string) {
  return value
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.replaceAll("\\", "/")).filter(Boolean))].toSorted()
}

function inside(root: string, value: string) {
  const absolute = path.resolve(root, value)
  const relative = path.relative(root, absolute)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)))
    return { absolute, relative: relative || "." }
  throw new ScopeError(`模块路径超出当前工作区：${value}`)
}

async function moduleFiles(root: string, value: string, abort?: AbortSignal) {
  const target = inside(root, value)
  const stat = await fs.stat(target.absolute).catch(() => undefined)
  if (!stat) throw new ScopeError(`模块路径不存在：${value}`)
  if (stat.isFile()) return [target.relative]
  if (!stat.isDirectory()) throw new ScopeError(`模块路径不是文件或目录：${value}`)
  abort?.throwIfAborted()
  const files = await Glob.scan("**/*", {
    cwd: target.absolute,
    absolute: true,
    include: "file",
    dot: true,
  })
  return files
    .map((file) => path.relative(root, file).replaceAll("\\", "/"))
    .filter((file) => !/(?:^|\/)(?:\.git|node_modules|dist|build|out)(?:\/|$)/.test(file))
}

type GitPlan = {
  label: string
  files: string[]
  diff: string
  diffCommand: string
  source: ContentSource
}

async function changed(
  root: string,
  args: string[],
  label: string,
  source: GitPlan["source"],
  abort?: AbortSignal,
): Promise<GitPlan> {
  const files = split0(await git(root, ["-c", "core.quotepath=false", "diff", "--name-only", "-z", ...args], abort))
  const diff = await git(root, ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-renames", ...args], abort)
  return {
    label,
    files,
    diff,
    diffCommand: `git -c core.quotepath=false diff --no-ext-diff --no-renames ${args.join(" ")}`.trim(),
    source,
  }
}

async function uncommitted(root: string, abort?: AbortSignal) {
  const head = await gitOptional(root, ["rev-parse", "--verify", "HEAD"], abort)
  const plan = head
    ? await changed(root, ["HEAD", "--"], "当前未提交修改", { kind: "worktree" }, abort)
    : {
        label: "当前未提交修改",
        files: [],
        diff: "",
        diffCommand: "git diff --no-ext-diff --no-renames",
        source: { kind: "worktree" } as const,
      }
  const untracked = split0(await git(root, ["ls-files", "--others", "--exclude-standard", "-z"], abort))
  return { ...plan, files: unique([...plan.files, ...untracked]) }
}

async function gitPlan(root: string, scope: Scope, abort?: AbortSignal): Promise<GitPlan> {
  if (!(await gitOptional(root, ["rev-parse", "--is-inside-work-tree"], abort)))
    throw new ScopeError(`${scope.kind} 范围需要 Git 工作区；请改用 module 范围。`)
  if (scope.kind === "uncommitted") return uncommitted(root, abort)
  if (scope.kind === "staged") return changed(root, ["--cached", "--"], "当前已暂存修改", { kind: "index" }, abort)
  if (scope.kind === "unpushed") {
    const upstream = await gitOptional(root, ["rev-parse", "--abbrev-ref", "@{upstream}"], abort)
    if (!upstream) throw new ScopeError("当前分支没有可用的 upstream；请明确指定 branch 范围。")
    return changed(
      root,
      [`${upstream}...HEAD`, "--"],
      `未推送提交（相对 ${upstream}）`,
      { kind: "tree", ref: "HEAD" },
      abort,
    )
  }
  if (scope.kind === "branch") {
    const base = scope.base.trim()
    if (!base) throw new ScopeError("branch 范围缺少 base。")
    const ancestor = await gitOptional(root, ["merge-base", "HEAD", base], abort)
    if (!ancestor) throw new ScopeError(`无法解析与 ${base} 的共同祖先。`)
    return changed(root, [ancestor, "HEAD", "--"], `相对分支 ${base}`, { kind: "tree", ref: "HEAD" }, abort)
  }
  if (scope.kind === "commit") {
    const sha = await gitOptional(root, ["rev-parse", "--verify", `${scope.sha}^{commit}`], abort)
    if (!sha) throw new ScopeError(`无法解析 Commit：${scope.sha}`)
    const parent = await gitOptional(root, ["rev-parse", "--verify", `${sha}^`], abort)
    if (parent) return changed(root, [parent, sha, "--"], `Commit ${scope.sha}`, { kind: "tree", ref: sha }, abort)
    const empty = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    return changed(root, [empty, sha, "--"], `Commit ${scope.sha}`, { kind: "tree", ref: sha }, abort)
  }
  if (scope.kind === "pr") {
    const target = await gitOptional(root, ["rev-parse", "--verify", `${scope.target}^{commit}`], abort)
    if (!target)
      throw new ScopeError(`无法在本地解析 PR/变更集引用：${scope.target}。请先获取对应引用或提供可用 Commit。`)
    const parent = await gitOptional(root, ["rev-parse", "--verify", `${target}^`], abort)
    if (!parent) throw new ScopeError(`PR/变更集引用没有可比较父提交：${scope.target}`)
    return changed(root, [parent, target, "--"], `PR/变更集 ${scope.target}`, { kind: "tree", ref: target }, abort)
  }
  throw new ScopeError(`不支持的 Git 范围：${scope.kind}`)
}

async function hash(file: string) {
  const hasher = new Bun.CryptoHasher("sha256")
  const reader = Bun.file(file).stream().getReader()
  while (true) {
    const item = await reader.read()
    if (item.done) break
    hasher.update(item.value)
  }
  return hasher.digest("hex")
}

async function inspectWorktree(root: string, value: string): Promise<File> {
  const safe = inside(root, value)
  const stat = await fs.stat(safe.absolute).catch(() => undefined)
  if (!stat?.isFile())
    return { path: safe.relative.replaceAll("\\", "/"), hash: "missing", bytes: 0, lines: 0, exists: false }
  const data = await Bun.file(safe.absolute)
    .text()
    .catch(() => "")
  const lines = data ? data.split(/\r?\n/).length : 0
  return {
    path: safe.relative.replaceAll("\\", "/"),
    hash: await hash(safe.absolute),
    bytes: stat.size,
    lines,
    exists: true,
  }
}

async function inspectGit(
  root: string,
  value: string,
  source: Extract<GitPlan["source"], { kind: "index" | "tree" }>,
  abort?: AbortSignal,
): Promise<File> {
  const safe = inside(root, value)
  const spec = source.kind === "index" ? `:${safe.relative}` : `${source.ref}:${safe.relative}`
  const result = await Process.text(["git", "show", spec], { cwd: root, abort, nothrow: true })
  if (result.code !== 0)
    return { path: safe.relative.replaceAll("\\", "/"), hash: "missing", bytes: 0, lines: 0, exists: false }
  const data = result.text
  return {
    path: safe.relative.replaceAll("\\", "/"),
    hash: digest(data),
    bytes: new TextEncoder().encode(data).byteLength,
    lines: data ? data.split(/\r?\n/).length : 0,
    exists: true,
  }
}

async function inspect(root: string, value: string, source: GitPlan["source"], abort?: AbortSignal) {
  if (source.kind === "worktree") return inspectWorktree(root, value)
  return inspectGit(root, value, source, abort)
}

function changes(diff: string) {
  let additions = 0
  let deletions = 0
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++
    if (line.startsWith("-") && !line.startsWith("---")) deletions++
  }
  return { additions, deletions }
}

function diffFiles(diff: string) {
  return new Set(
    [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) =>
      (match[2] ?? match[1] ?? "").replaceAll("\\", "/"),
    ),
  )
}

function digest(input: string) {
  return new Bun.CryptoHasher("sha256").update(input).digest("hex")
}

export async function prepare(root: string, request: ResolvedRequest, abort?: AbortSignal): Promise<Snapshot> {
  const scope = request.scope
  const head = await gitOptional(root, ["rev-parse", "HEAD"], abort)
  const workspaceState = await gitOptional(
    root,
    ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z"],
    abort,
  )
  const plan =
    scope.kind === "module"
      ? {
          label: `模块 ${scope.path}`,
          files: unique(await moduleFiles(root, scope.path, abort)),
          diff: "",
          diffCommand: undefined,
          source: { kind: "worktree" } as const,
        }
      : await gitPlan(root, scope, abort)
  const files = await Promise.all(plan.files.map((file) => inspect(root, file, plan.source, abort)))
  const configuration = (
    await Promise.all(configurationCandidates.map((file) => inspect(root, file, plan.source, abort)))
  ).filter((file) => file.exists)
  const counted = changes(plan.diff)
  const patched = diffFiles(plan.diff)
  const uncovered = files
    .filter((file) => file.exists && !patched.has(file.path))
    .reduce((sum, file) => sum + file.lines, 0)
  const additions = plan.diff ? counted.additions + uncovered : files.reduce((sum, file) => sum + file.lines, 0)
  const deletions = plan.diff ? counted.deletions : 0
  const fingerprint = digest(
    JSON.stringify({
      scope,
      head,
      files: files.map((file) => [file.path, file.hash, file.bytes]),
      configuration: configuration.map((file) => [file.path, file.hash, file.bytes]),
    }),
  )
  return {
    root,
    scope,
    scopeLabel: plan.label,
    source: plan.source,
    files,
    configuration,
    additions,
    deletions,
    head,
    fingerprint,
    workspaceFingerprint: digest(workspaceState),
    diff: plan.diff,
    diffCommand: plan.diffCommand,
  }
}

export async function refresh(snapshot: Snapshot, abort?: AbortSignal) {
  return prepare(snapshot.root, { scope: snapshot.scope, effort: "standard" }, abort)
}
