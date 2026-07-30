import { createHash } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
import path from "node:path"
import { Process } from "@/util/process"
import { requestedScope, EmbeddedReviewScopeError } from "./scope"
import type { ChangeFile, ChangeHunk, ChangeSet, EmbeddedReviewScope } from "./types"

const EXTENSIONS = new Set([".c", ".h", ".cc", ".hh", ".cpp", ".hpp", ".cxx", ".hxx", ".inc", ".inl"])
const MAX_FILES = 40
const MAX_HUNKS = 80
const MAX_FILE_BYTES = 1024 * 1024
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024

type Entry = {
  code: string
  path: string
  previousPath?: string
  untracked?: boolean
}

export class EmbeddedReviewChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmbeddedReviewChangeError"
  }
}

export async function loadChangeSet(input: {
  root: string
  arguments: string
  abort?: AbortSignal
}): Promise<ChangeSet> {
  const requestedRoot = path.resolve(input.root)
  const requested = requestedScope(input.arguments)
  const root = path.resolve((await git(requestedRoot, ["rev-parse", "--show-toplevel"], input.abort)).trim())
  if (requestedRoot !== root && !requestedRoot.startsWith(`${root}${path.sep}`)) {
    throw new EmbeddedReviewChangeError("所选目录位于解析出的 Git 工作树之外。")
  }
  const scope = await resolve(root, requested, input.abort)
  const entries =
    scope.kind === "uncommitted"
      ? await uncommitted(root, input.abort)
      : await committed(root, scope.parent, scope.commit, input.abort)
  const files: ChangeFile[] = []
  const skipped: ChangeSet["skipped"] = []
  const unique = new Map(entries.map((entry) => [entry.path, entry]))
  let bytes = 0
  let hunks = 0

  for (const entry of unique.values()) {
    if (files.length >= MAX_FILES) {
      skipped.push({ path: entry.path, reason: `已达到 ${MAX_FILES} 个证据文件上限` })
      continue
    }
    if (!safe(entry.path)) {
      skipped.push({ path: entry.path, reason: "仓库路径不安全" })
      continue
    }
    if (!EXTENSIONS.has(path.extname(entry.path).toLowerCase())) {
      skipped.push({ path: entry.path, reason: "Embedded Review V1 仅支持 C/C++ 文件" })
      continue
    }
    const loaded = await load(root, scope, entry, input.abort)
    if (loaded instanceof Error) {
      skipped.push({ path: entry.path, reason: loaded.message })
      continue
    }
    const size = Buffer.byteLength(loaded.before) + Buffer.byteLength(loaded.after) + Buffer.byteLength(loaded.patch)
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path: entry.path, reason: `单文件证据超过 ${MAX_FILE_BYTES} 字节` })
      continue
    }
    if (bytes + size > MAX_EVIDENCE_BYTES) {
      skipped.push({ path: entry.path, reason: `已达到 ${MAX_EVIDENCE_BYTES} 字节的证据总量上限` })
      continue
    }
    if (hunks + loaded.hunks.length > MAX_HUNKS) {
      skipped.push({ path: entry.path, reason: `已达到 ${MAX_HUNKS} 个 hunk 的证据上限` })
      continue
    }
    bytes += size
    hunks += loaded.hunks.length
    files.push(loaded)
  }

  return {
    schemaVersion: 1,
    scope,
    root,
    files,
    skipped,
    generatedAt: new Date().toISOString(),
    limits: {
      maxFiles: MAX_FILES,
      maxHunks: MAX_HUNKS,
      maxFileBytes: MAX_FILE_BYTES,
      maxEvidenceBytes: MAX_EVIDENCE_BYTES,
    },
  }
}

async function resolve(
  root: string,
  requested: ReturnType<typeof requestedScope>,
  abort?: AbortSignal,
): Promise<EmbeddedReviewScope> {
  if (requested.kind === "uncommitted") return requested
  const commit = (
    await git(root, ["rev-parse", "--verify", "--end-of-options", `${requested.requested}^{commit}`], abort)
  ).trim()
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) throw new EmbeddedReviewScopeError("无法安全解析该 commit。")
  const parents = (await git(root, ["rev-list", "--parents", "-n", "1", commit], abort)).trim().split(/\s+/)
  if (parents.length > 2) throw new EmbeddedReviewScopeError("Embedded Review V1 不支持 merge commit。")
  if (parents.length !== 2) throw new EmbeddedReviewScopeError("Embedded Review V1 不支持根 commit。")
  return { kind: "commit", requested: requested.requested, commit, parent: parents[1] }
}

async function uncommitted(root: string, abort?: AbortSignal) {
  const tracked = parseNames(await gitBuffer(root, ["diff", "--name-status", "-z", "--find-renames", "HEAD"], abort))
  const raw = await gitBuffer(root, ["ls-files", "--others", "--exclude-standard", "-z"], abort)
  const extras = raw
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((file): Entry => ({ code: "A", path: file, untracked: true }))
  return [...tracked, ...extras]
}

async function committed(root: string, parent: string, commit: string, abort?: AbortSignal) {
  return parseNames(await gitBuffer(root, ["diff", "--name-status", "-z", "--find-renames", parent, commit], abort))
}

function parseNames(raw: Buffer): Entry[] {
  const parts = raw.toString().split("\0").filter(Boolean)
  const result: Entry[] = []
  for (let index = 0; index < parts.length; ) {
    const code = parts[index++]
    if (!code) break
    if (code.startsWith("R") || code.startsWith("C")) {
      const previousPath = parts[index++]
      const next = parts[index++]
      if (previousPath && next) result.push({ code, path: next, previousPath })
      continue
    }
    const file = parts[index++]
    if (file) result.push({ code, path: file })
  }
  return result
}

async function load(
  root: string,
  scope: EmbeddedReviewScope,
  entry: Entry,
  abort?: AbortSignal,
): Promise<ChangeFile | Error> {
  const status = entry.untracked
    ? "untracked"
    : entry.code.startsWith("A")
      ? "added"
      : entry.code.startsWith("D")
        ? "deleted"
        : entry.code.startsWith("R")
          ? "renamed"
          : "modified"
  const previous = entry.previousPath ?? entry.path
  const before =
    status === "added" || status === "untracked"
      ? ""
      : await show(root, scope.kind === "commit" ? scope.parent : "HEAD", previous, abort)
  const after =
    status === "deleted"
      ? ""
      : scope.kind === "commit"
        ? await show(root, scope.commit, entry.path, abort)
        : await local(root, entry.path)
  if (before instanceof Error) return before
  if (after instanceof Error) return after
  const patch =
    status === "untracked" ? addedPatch(entry.path, after) : await diff(root, scope, previous, entry.path, abort)
  const hunks = parseHunks(patch)
  return {
    path: entry.path,
    ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
    status,
    before,
    after,
    patch,
    hunks,
    changedLines: [
      ...new Set(hunks.flatMap((hunk) => hunk.changed.flatMap((line) => (line.next ? [line.next] : [])))),
    ].sort((left, right) => left - right),
  }
}

async function local(root: string, file: string): Promise<string | Error> {
  const target = path.resolve(root, file)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return new Error("路径越出工作树")
  const info = await lstat(target).catch((err: unknown): Error => (err instanceof Error ? err : new Error(String(err))))
  if (info instanceof Error) return info
  if (info.isSymbolicLink()) return new Error("不会跟随未提交的符号链接")
  if (!info.isFile()) return new Error("变更路径不是普通文件")
  if (info.size > MAX_FILE_BYTES) return new Error(`文件超过 ${MAX_FILE_BYTES} 字节`)
  return readFile(target, "utf8").catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
}

async function show(root: string, commit: string, file: string, abort?: AbortSignal): Promise<string | Error> {
  const out = await Process.run(["git", "-c", "core.quotepath=false", "show", `${commit}:${file}`], {
    cwd: root,
    abort,
    nothrow: true,
  })
  if (out.code === 0) return out.stdout.toString()
  return new Error(out.stderr.toString().trim() || "无法读取 Git 对象")
}

async function diff(root: string, scope: EmbeddedReviewScope, previous: string, next: string, abort?: AbortSignal) {
  const range = scope.kind === "commit" ? [scope.parent, scope.commit] : ["HEAD"]
  const paths = previous === next ? [next] : [previous, next]
  return git(root, ["diff", "--no-ext-diff", "--unified=3", "--find-renames", ...range, "--", ...paths], abort)
}

function addedPatch(file: string, content: string) {
  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n")
}

export function parseHunks(patch: string): ChangeHunk[] {
  const lines = patch.split(/\r?\n/)
  const result: ChangeHunk[] = []
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!match) continue
    const header = lines[index]
    const body: string[] = []
    for (index += 1; index < lines.length && !lines[index].startsWith("@@ "); index++) {
      if (lines[index].startsWith("diff --git ")) {
        index--
        break
      }
      body.push(lines[index])
    }
    index--
    const oldStart = Number(match[1])
    const oldCount = Number(match[2] ?? 1)
    const nextStart = Number(match[3])
    const nextCount = Number(match[4] ?? 1)
    let old = oldStart
    let next = nextStart
    const changed: ChangeHunk["changed"] = []
    for (const line of body) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        changed.push({ next: next++ })
        continue
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        changed.push({ old: old++ })
        continue
      }
      if (!line.startsWith("\\")) {
        old++
        next++
      }
    }
    result.push({
      header,
      oldStart,
      oldCount,
      nextStart,
      nextCount,
      lines: body,
      changed,
    })
  }
  return result
}

function safe(file: string) {
  if (!file || file.includes("\0") || path.isAbsolute(file)) return false
  const normalized = path.normalize(file)
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`)
}

async function git(root: string, args: string[], abort?: AbortSignal) {
  return (await Process.text(["git", "-c", "core.quotepath=false", ...args], { cwd: root, abort })).text
}

async function gitBuffer(root: string, args: string[], abort?: AbortSignal) {
  return (await Process.run(["git", "-c", "core.quotepath=false", ...args], { cwd: root, abort })).stdout
}

export function contentHash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
