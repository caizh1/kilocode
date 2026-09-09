import * as fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { formatPatch } from "diff"
import { Process } from "@/util/process"
import * as Files from "./files"
import type { Detail, Mutation, Summary } from "./schema"

type Entry = { -readonly [K in keyof Summary["files"][number]]: Summary["files"][number][K] } & {
  undone: string[]
  before: string
  after: string
  beforeMode: string
  afterMode: string
  beforePermission?: number
  afterPermission?: number
}
type Change = { file: string; before: Files.Content; after: Files.Content }
type Operation = {
  id: string
  input: string
  previous: Record<string, string[]>
  changes: Change[]
  restored?: boolean
  restore?: boolean
}
type Stored = { -readonly [K in keyof Omit<Summary, "files" | "canRevert" | "canRestore">]: Summary[K] } & {
  before?: string
  after?: string
  excluded: string[]
  permissions: Record<string, number>
  observed: Record<string, string>
  reconcile?: boolean
  files: Entry[]
  operations: Operation[]
}
type Active = { sessionID: string; messageID: string; pid: number; owner: string }
type Journal = { key: string; operation: string; changes: Change[] }

async function json<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback
    throw error
  }
}

// 所有方法由运行时的工作区文件锁保护；独立测试也通过同一入口串行执行。
export class TurnStore {
  readonly owner = `${process.pid}:${randomUUID()}`
  constructor(
    readonly root: string,
    readonly storage: string,
    readonly gitdir: string,
  ) {}
  key(sessionID: string, messageID: string) {
    return Files.hash(`${sessionID}:${messageID}`)
  }
  private location(key: string) {
    return path.join(this.storage, `${key}.json`)
  }
  private activePath() {
    return path.join(this.storage, "active.json")
  }
  private active() {
    return json<Record<string, Active>>(this.activePath(), {})
  }
  private save(record: Stored) {
    return Files.atomic(this.location(this.key(record.sessionID, record.messageID)), JSON.stringify(record))
  }
  private load(sessionID: string, messageID: string) {
    return json<Stored | undefined>(this.location(this.key(sessionID, messageID)), undefined)
  }
  private git(args: string[]) {
    return Process.run(["git", "--literal-pathspecs", "--git-dir", this.gitdir, ...args], { cwd: this.root })
  }

  async begin(sessionID: string, messageID: string, before?: string, reason?: string) {
    await fs.mkdir(this.storage, { recursive: true })
    await this.recover()
    const key = this.key(sessionID, messageID)
    const existing = await this.load(sessionID, messageID)
    if (existing) {
      existing.phase = "running"
      existing.reason = "本轮发生恢复执行，原始修改记录仅供审阅"
      existing.revision++
      await this.save(existing)
      const active = await this.active()
      active[key] = { sessionID, messageID, pid: process.pid, owner: this.owner }
      await Files.atomic(this.activePath(), JSON.stringify(active))
      return
    }
    const active = await this.active()
    if (Object.keys(active).length) reason = "同一工作区有并发执行，无法可靠区分修改归属"
    for (const item of Object.values(active)) {
      const other = await this.load(item.sessionID, item.messageID)
      if (!other) continue
      other.reason = "同一工作区有并发执行，无法可靠区分修改归属"
      other.revision++
      await this.save(other)
    }
    const baseline = before ? await this.baseline(before) : { excluded: [], permissions: {} }
    const record: Stored = {
      directory: this.root,
      sessionID,
      messageID,
      revision: 1,
      phase: "running",
      outcome: "completed",
      reason,
      before,
      ...baseline,
      observed: {},
      files: [],
      operations: [],
    }
    if (before) await this.git(["update-ref", `refs/chipmate/turn-changes/${key}/before`, before])
    await this.save(record)
    active[key] = { sessionID, messageID, pid: process.pid, owner: this.owner }
    await Files.atomic(this.activePath(), JSON.stringify(active))
  }

  async prepare(sessionID: string, messageID: string, files: string[]) {
    const record = await this.require(sessionID, messageID)
    if (!record.before) return
    record.observed ??= {}
    for (const file of files) {
      if (Object.hasOwn(record.observed, file)) continue
      record.observed[file] = Files.hash(JSON.stringify(await Files.read(this.root, file)))
      if (record.excluded.some((item) => item === file || (item.endsWith("/") && file.startsWith(item))))
        record.reason = `工具涉及未被原始快照完整收录的文件，暂不能撤销：${file}`
    }
    await this.save(record)
  }

  async phase(sessionID: string, messageID: string, phase: Stored["phase"], reason?: string) {
    const record = await this.load(sessionID, messageID)
    if (!record) return
    record.phase = phase
    record.reason = reason ?? record.reason
    record.revision++
    await this.save(record)
  }

  async capture(sessionID: string, messageID: string, after: string | undefined, outcome?: Stored["outcome"]) {
    const record = await this.load(sessionID, messageID)
    if (!record) return
    if (record.before && after) {
      const key = this.key(sessionID, messageID)
      await this.git(["update-ref", `refs/chipmate/turn-changes/${key}/after`, after])
      record.after = after
      record.files = await this.entries(record.before, after)
      for (const file of record.files) {
        file.beforePermission = record.permissions?.[file.oldFile ?? file.file]
        file.afterPermission = (await fs.lstat(path.join(this.root, file.file)).catch(() => undefined))?.mode
        if (file.afterPermission !== undefined) file.afterPermission &= 0o777
        const regular = [file.beforeMode, file.afterMode].every((mode) => /^(000000|100644|100755)$/.test(mode))
        if (!regular) record.reason = "符号链接或子模块暂不支持按轮撤销"
        if (regular && file.binary) {
          const sizes = await Promise.all(
            [file.before, file.after].map(async (oid) =>
              /^0+$/.test(oid) ? 0 : Number((await this.git(["cat-file", "-s", oid])).stdout.toString()),
            ),
          )
          if (sizes.every((size) => size <= 1024 * 1024)) {
            const [before, after] = await this.contents(file)
            const diff = Files.patch(file.file, before, after)
            if (diff) {
              file.binary = false
              file.additions = diff.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.startsWith("+")).length
              file.deletions = diff.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.startsWith("-")).length
            }
          }
        }
        if (record.excluded.some((item) => item === file.file || (item.endsWith("/") && file.file.startsWith(item))))
          record.reason = "修改涉及基线快照未收录的已有文件，不能安全撤销"
        if (/^0+$/.test(file.after) && (await fs.lstat(path.join(this.root, file.file)).catch(() => undefined)))
          record.reason = "修改后文件未被完整快照收录，不能安全撤销"
      }
    } else record.reason ??= "缺少完整快照，请检查 Git 和快照设置"
    for (const file of record.excluded) {
      if (!file.endsWith("/") && !(await fs.lstat(path.join(this.root, file)).catch(() => undefined)))
        record.reason = "基线未收录的已有文件被删除或移动，不能安全撤销"
    }
    for (const [file, before] of Object.entries(record.observed ?? {})) {
      if (record.files.some((entry) => entry.file === file || entry.oldFile === file)) continue
      if (Files.hash(JSON.stringify(await Files.read(this.root, file))) !== before)
        record.reason = `文件已发生变化，但未被快照完整收录，暂不能撤销：${file}`
    }
    record.reconcile = false
    record.revision++
    if (outcome) {
      record.outcome = outcome
      record.phase = record.reason ? "unavailable" : "ready"
      const active = await this.active()
      delete active[this.key(sessionID, messageID)]
      await this.save(record)
      await Files.atomic(this.activePath(), JSON.stringify(active))
      return
    }
    await this.save(record)
  }

  async external(file: string) {
    for (const item of Object.values(await this.active())) {
      const record = await this.load(item.sessionID, item.messageID)
      if (!record) continue
      record.reason = `执行期间检测到人工编辑，修改归属需核对：${file}`
      record.revision++
      await this.save(record)
    }
  }

  async get(sessionID: string, messageID: string): Promise<Summary | undefined> {
    await this.recover()
    const record = await this.load(sessionID, messageID)
    if (!record) return undefined
    const active = await this.active()
    const current = active[this.key(sessionID, messageID)]
    const orphan = ["running", "stopping", "settling"].includes(record.phase) && current?.owner !== this.owner
    const reason = orphan ? "上次执行未完成收尾，已保存的修改可审阅，尚不能安全撤销" : record.reason
    return {
      directory: this.root,
      sessionID,
      messageID,
      revision: record.revision,
      phase: orphan ? "unavailable" : record.phase,
      outcome: orphan ? "interrupted" : record.outcome,
      reason,
      files: record.files.map(
        ({ before, after, beforeMode, afterMode, beforePermission, afterPermission, ...entry }) => entry,
      ),
      canRevert:
        !reason &&
        record.phase === "ready" &&
        !Object.keys(active).length &&
        record.files.some((file) => file.state !== "reverted"),
      canRestore:
        !reason &&
        record.phase === "ready" &&
        !Object.keys(active).length &&
        record.operations.some((operation) => !operation.restore && !operation.restored),
    }
  }

  async detail(sessionID: string, messageID: string, fileID: string): Promise<Detail> {
    const record = await this.require(sessionID, messageID)
    const entry = record.files.find((file) => file.id === fileID)
    if (!entry) throw new Error("文件不属于当前轮次")
    const [before, after] = await this.contents(entry)
    const patch = Files.patch(entry.file, before, after)
    const hunks = entry.status === "modified" ? Files.hunks(entry.file, before, after) : []
    return {
      fileID,
      revision: record.revision,
      patch: patch ? formatPatch(patch) : "",
      hunks: hunks.map(({ hunk, ...item }) => ({
        ...item,
        undone: entry.undone.includes("file") || entry.undone.includes(item.id),
      })),
      reason: patch ? undefined : "二进制或大文件仅支持按文件审阅和撤销",
    }
  }

  async mutate(sessionID: string, messageID: string, input: Mutation): Promise<Summary> {
    await this.recover()
    const record = await this.require(sessionID, messageID)
    const previous = record.operations.find((operation) => operation.id === input.requestID)
    if (previous) {
      if (previous.input !== JSON.stringify(input)) throw new Error("同一操作标识不能重复用于其他修改")
      return (await this.get(sessionID, messageID))!
    }
    if (record.revision !== input.revision) throw new Error("修改记录已更新，请重新审阅后操作")
    if (record.phase !== "ready" || record.reason) throw new Error(record.reason ?? "本轮尚未完成修改收尾")
    if (Object.keys(await this.active()).length) throw new Error("工作区仍有 Agent 执行，结束后才能撤销")
    if (!input.requestID || input.requestID.length > 128) throw new Error("无效的操作标识")
    const operation: Operation = {
      id: input.requestID,
      input: JSON.stringify(input),
      changes: [],
      previous: {},
      restore: input.action === "restore",
    }
    if (input.action === "restore") {
      if (input.fileID || input.hunkID) throw new Error("恢复操作只能作用于最近一次撤销")
      const latest = record.operations.findLast((item) => !item.restore && !item.restored)
      if (!latest) throw new Error("没有可恢复的撤销操作")
      for (const change of latest.changes) {
        const current = await Files.read(this.root, change.file)
        operation.changes.push({
          file: change.file,
          before: current,
          after: await Files.merge(this.storage, current, change.after, change.before),
        })
      }
      for (const [id, undone] of Object.entries(latest.previous)) {
        const entry = record.files.find((item) => item.id === id)!
        operation.previous[id] = [...entry.undone]
        entry.undone = undone
        await this.state(entry)
      }
      latest.restored = true
    } else {
      const entries = input.fileID ? record.files.filter((file) => file.id === input.fileID) : record.files
      if (!entries.length || (input.hunkID && !input.fileID)) throw new Error("请选择当前轮次的文件或差异块")
      for (const entry of entries) {
        if (entry.state === "reverted") continue
        const [before, after] = await this.contents(entry)
        const all = entry.status === "modified" ? Files.hunks(entry.file, before, after) : []
        if (input.hunkID && !all.some((hunk) => hunk.id === input.hunkID)) throw new Error("差异块不属于当前文件")
        const undone = input.hunkID ? [...new Set([...entry.undone, input.hunkID])] : ["file"]
        operation.previous[entry.id] = [...entry.undone]
        if (entry.status === "renamed") {
          if (input.hunkID) throw new Error("重命名仅支持按文件撤销")
          const current = await Files.read(this.root, entry.file)
          const old = await Files.read(this.root, entry.oldFile!)
          if (!Files.equal(current, after) || old) throw new Error("重命名文件与后续修改冲突")
          operation.changes.push(
            { file: entry.file, before: current, after: null },
            { file: entry.oldFile!, before: null, after: before },
          )
        } else {
          const base = Files.virtual(entry.file, before, after, entry.undone)
          const target = Files.virtual(entry.file, before, after, undone)
          const current = await Files.read(this.root, entry.file)
          operation.changes.push({
            file: entry.file,
            before: current,
            after: await Files.merge(this.storage, current, base, target),
          })
        }
        entry.undone = undone
        await this.state(entry)
      }
    }
    if (!operation.changes.length) throw new Error("所选修改已经撤销")
    if (new Set(operation.changes.map((change) => change.file)).size !== operation.changes.length)
      throw new Error("文件操作范围重复")
    // 预检所有文件及可写权限之后才产生第一笔写入。
    for (const change of operation.changes) {
      if (!Files.equal(await Files.read(this.root, change.file), change.before))
        throw new Error(`文件已变化，请重新审阅：${change.file}`)
      const target = await Files.resolve(this.root, change.file)
      if (change.before) await fs.access(target, fs.constants.W_OK)
      let directory = path.dirname(target)
      while (!(await fs.stat(directory).catch(() => undefined))) directory = path.dirname(directory)
      await fs.access(directory, fs.constants.W_OK)
    }
    const journal = path.join(this.storage, "journal.json")
    await Files.atomic(
      journal,
      JSON.stringify({
        key: this.key(sessionID, messageID),
        operation: input.requestID,
        changes: operation.changes,
      } satisfies Journal),
    )
    try {
      for (const change of operation.changes) {
        if (!Files.equal(await Files.read(this.root, change.file), change.before))
          throw new Error(`写入前文件已变化：${change.file}`)
        await Files.write(this.root, change.file, change.after)
      }
      for (const change of operation.changes)
        if (!Files.equal(await Files.read(this.root, change.file), change.after))
          throw new Error(`文件写入校验失败：${change.file}`)
      record.operations.push(operation)
      record.revision++
      await this.save(record)
    } catch (error) {
      await this.recover()
      throw error
    }
    await fs.rm(journal, { force: true })
    return (await this.get(sessionID, messageID))!
  }

  async needsReconcile(sessionID: string, messageID: string) {
    return (await this.load(sessionID, messageID))?.reconcile === true
  }

  async recover() {
    const active = await this.active()
    let expired = false
    for (const [key, item] of Object.entries(active)) {
      if (item.owner === this.owner) continue
      let alive = true
      try {
        process.kill(item.pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false
        else throw error
      }
      if (alive) continue
      const record = await this.load(item.sessionID, item.messageID)
      if (record) {
        record.reconcile = true
        record.phase = "unavailable"
        record.outcome = "interrupted"
        record.reason = "上次进程异常结束，已保留修改记录，需要核对实际文件后再处理"
        record.revision++
        await this.save(record)
      }
      delete active[key]
      expired = true
    }
    if (expired) await Files.atomic(this.activePath(), JSON.stringify(active))
    const file = path.join(this.storage, "journal.json")
    const journal = await json<Journal | undefined>(file, undefined)
    if (!journal) return
    const record = await json<Stored | undefined>(this.location(journal.key), undefined)
    if (!record?.operations.some((operation) => operation.id === journal.operation)) {
      for (const change of [...journal.changes].reverse()) {
        const current = await Files.read(this.root, change.file)
        if (Files.equal(current, change.before)) continue
        if (!Files.equal(current, change.after)) throw new Error(`未完成的撤销遇到后续编辑，已停止恢复：${change.file}`)
        await Files.write(this.root, change.file, change.before)
      }
    }
    await fs.rm(file, { force: true })
  }

  async remove(sessionID: string) {
    const active = await this.active()
    if (Object.values(active).some((item) => item.sessionID === sessionID))
      throw new Error("执行中的会话不能释放修改记录")
    for (const file of await fs.readdir(this.storage).catch(() => [])) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
      const record = await json<Stored | undefined>(path.join(this.storage, file), undefined)
      if (record?.sessionID !== sessionID) continue
      const key = this.key(sessionID, record.messageID)
      for (const side of ["before", "after"] as const)
        if (record[side]) await this.git(["update-ref", "-d", `refs/chipmate/turn-changes/${key}/${side}`])
      await fs.rm(path.join(this.storage, file))
    }
  }

  private async require(sessionID: string, messageID: string) {
    const record = await this.load(sessionID, messageID)
    if (!record) throw new Error("此历史轮次没有完整的修改记录")
    return record
  }
  private async contents(entry: Entry) {
    const content = async (oid: string, mode: string, permission?: number): Promise<Files.Content> => {
      if (/^0+$/.test(oid)) return null
      if (mode !== "100644" && mode !== "100755") throw new Error("符号链接或子模块暂不支持撤销")
      const bytes = await this.git(["cat-file", "blob", oid])
      return { data: bytes.stdout.toString("base64"), mode: permission ?? (mode === "100755" ? 0o755 : 0o644) }
    }
    return Promise.all([
      content(entry.before, entry.beforeMode, entry.beforePermission),
      content(entry.after, entry.afterMode, entry.afterPermission),
    ])
  }
  private async state(entry: Entry) {
    if (!entry.undone.length) {
      entry.state = "kept"
      return
    }
    if (entry.undone.includes("file")) {
      entry.state = "reverted"
      return
    }
    const [before, after] = await this.contents(entry)
    entry.state = Files.hunks(entry.file, before, after).every((hunk) => entry.undone.includes(hunk.id))
      ? "reverted"
      : "partial"
  }
  private async entries(before: string, after: string): Promise<Entry[]> {
    const [raw, stats] = await Promise.all([
      this.git(["diff-tree", "-r", "--no-commit-id", "--raw", "-z", "--no-abbrev", "-M", before, after]),
      this.git(["diff-tree", "-r", "--no-commit-id", "--numstat", "-z", "-M", before, after]),
    ])
    const counts = new Map<string, { additions: number; deletions: number; binary: boolean }>()
    const numbers = stats.stdout.toString("utf8").split("\0")
    for (let i = 0; i < numbers.length && numbers[i]; i++) {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(numbers[i]!)
      if (!match) throw new Error("无法读取快照差异统计")
      const file = match[3] || numbers[(i += 2)]!
      counts.set(file, { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0, binary: match[1] === "-" })
    }
    const parts = raw.stdout.toString("utf8").split("\0")
    if (!Buffer.from(raw.stdout.toString("utf8")).equals(raw.stdout))
      throw new Error("文件名编码无法可靠识别，不能安全撤销")
    const result: Entry[] = []
    for (let i = 0; i < parts.length && parts[i]; i++) {
      const match = /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])\d*$/.exec(parts[i]!)
      if (!match) throw new Error("无法读取快照文件记录")
      const old = parts[++i]!
      const renamed = match[5] === "R"
      const file = renamed ? parts[++i]! : old
      result.push({
        id: Files.hash(JSON.stringify([old, file, match[3], match[4]])),
        file,
        oldFile: renamed ? old : undefined,
        status: renamed ? "renamed" : match[5] === "A" ? "added" : match[5] === "D" ? "deleted" : "modified",
        beforeMode: match[1]!,
        afterMode: match[2]!,
        before: match[3]!,
        after: match[4]!,
        ...(counts.get(file) ?? { additions: 0, deletions: 0, binary: true }),
        undone: [],
        state: "kept",
      })
    }
    return result
  }

  private async baseline(snapshot: string) {
    const [tree, candidates, ignored] = await Promise.all([
      this.git(["ls-tree", "-r", "--name-only", "-z", snapshot]),
      Process.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: this.root }),
      Process.run(["git", "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], {
        cwd: this.root,
      }),
    ])
    const present = new Set(tree.stdout.toString("utf8").split("\0"))
    const excluded = [
      ...new Set([
        ...candidates.stdout
          .toString("utf8")
          .split("\0")
          .filter((file) => file && !present.has(file)),
        ...ignored.stdout.toString("utf8").split("\0").filter(Boolean),
      ]),
    ]
    const permissions: Record<string, number> = {}
    const existing = new Set<string>()
    const files = [...new Set([...present, ...excluded])].filter(Boolean)
    for (let index = 0; index < files.length; index += 128) {
      await Promise.all(
        files.slice(index, index + 128).map(async (file) => {
          const stat = await fs.lstat(path.join(this.root, file)).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined
            throw error
          })
          if (!stat) return
          existing.add(file)
          if (stat.isFile()) permissions[file] = stat.mode & 0o777
        }),
      )
    }
    return { excluded: excluded.filter((file) => existing.has(file)), permissions }
  }
}
