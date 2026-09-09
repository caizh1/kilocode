import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import path from "node:path"
import { Process } from "@/util/process"
import * as Encoding from "@/chipmate/encoding"
import { applyPatch, formatPatch, reversePatch, structuredPatch } from "diff"

export const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex")
export type Content = { data: string; mode: number } | null
export const equal = (left: Content, right: Content) => left?.data === right?.data && left?.mode === right?.mode

export async function atomic(file: string, bytes: string | Buffer, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temporary, "wx", mode)
    try {
      await handle.writeFile(bytes)
      await handle.chmod(mode)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporary, file)
    await sync(path.dirname(file))
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function sync(directory: string) {
  // Windows 不支持通过目录句柄 fsync；文件内容在原子替换前已经刷盘。
  if (process.platform === "win32") return
  const handle = await fs.open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function resolve(root: string, file: string) {
  if (
    !file ||
    path.isAbsolute(file) ||
    file.includes("\\") ||
    file.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  )
    throw new Error("文件路径超出可撤销范围")
  const target = path.resolve(root, file)
  for (const segment of file.split("/")) {
    // 每一级均检查，不能通过符号链接修改工作区外文件。
    root = path.join(root, segment)
    const stat = await fs.lstat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (stat?.isSymbolicLink()) throw new Error("符号链接文件暂不支持安全撤销")
  }
  return target
}

export async function read(root: string, file: string): Promise<Content> {
  const target = await resolve(root, file)
  const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!stat) return null
  if (!stat.isFile()) throw new Error(`目标不是普通文件：${file}`)
  return { data: (await fs.readFile(target)).toString("base64"), mode: stat.mode & 0o777 }
}

export async function write(root: string, file: string, content: Content) {
  const target = await resolve(root, file)
  if (!content) {
    await fs.rm(target, { force: true })
    await sync(path.dirname(target))
    return
  }
  await atomic(target, Buffer.from(content.data, "base64"), content.mode)
}

export function text(content: Content) {
  if (!content) return undefined
  const bytes = Buffer.from(content.data, "base64")
  const encoding = Encoding.detect(bytes)
  const decoded = Encoding.decode(bytes, encoding)
  if (decoded.includes("\0") || !Encoding.encode(decoded, encoding).equals(bytes)) return undefined
  return { text: decoded, encoding }
}

export function patch(file: string, before: Content, after: Content) {
  // 大文件仍允许按文件精确撤销，差异块不解析超大全文。
  if ((before?.data.length ?? 0) + (after?.data.length ?? 0) > 4 * 1024 * 1024) return undefined
  const left = text(before)
  const right = text(after)
  if ((before && !left) || (after && !right)) return undefined
  return structuredPatch(file, file, left?.text ?? "", right?.text ?? "", "", "", { context: 3 })
}

export function hunks(file: string, before: Content, after: Content) {
  const diff = patch(file, before, after)
  if (!diff || !before || !after || text(before)?.encoding !== text(after)?.encoding) return []
  return diff.hunks.map((hunk, index) => ({
    id: hash(JSON.stringify([file, index, hunk])),
    patch: formatPatch({ ...diff, hunks: [hunk] }),
    line: hunk.newStart,
    hunk,
  }))
}

export function virtual(file: string, before: Content, after: Content, undone: readonly string[]): Content {
  if (!undone.length) return after
  if (undone.includes("file")) return before
  const all = hunks(file, before, after)
  if (!all.length || undone.some((id) => !all.some((hunk) => hunk.id === id))) throw new Error("差异块记录不完整")
  if (all.every((hunk) => undone.includes(hunk.id))) return before
  const diff = patch(file, before, after)!
  const decoded = text(after)!
  const output = applyPatch(
    decoded.text,
    reversePatch({ ...diff, hunks: all.filter((hunk) => undone.includes(hunk.id)).map((item) => item.hunk) }),
  )
  if (output === false) throw new Error("无法定位原始差异块")
  return { data: Encoding.encode(output, decoded.encoding).toString("base64"), mode: after!.mode }
}

export async function merge(storage: string, current: Content, base: Content, target: Content): Promise<Content> {
  if (equal(current, base)) return target
  if (equal(base, target)) return current
  if (!current || !base || !target) throw new Error("文件的新增、删除或重命名与后续修改冲突")
  const a = text(current),
    b = text(base),
    c = text(target)
  if (!a || !b || !c || a.encoding !== b.encoding || b.encoding !== c.encoding)
    throw new Error("文件编码或二进制内容与后续修改冲突")
  if (base.mode !== target.mode && current.mode !== base.mode) throw new Error("文件权限与后续修改冲突")
  const directory = await fs.mkdtemp(path.join(storage, "merge-"))
  try {
    await Promise.all([
      fs.writeFile(path.join(directory, "current"), a.text),
      fs.writeFile(path.join(directory, "base"), b.text),
      fs.writeFile(path.join(directory, "target"), c.text),
    ])
    const result = await Process.run(["git", "merge-file", "-p", "--", "current", "base", "target"], {
      cwd: directory,
      nothrow: true,
    })
    if (result.code !== 0) throw new Error("所选修改与后续内容重叠，未写入任何文件")
    return {
      data: Encoding.encode(result.stdout.toString("utf8"), a.encoding).toString("base64"),
      mode: base.mode === target.mode ? current.mode : target.mode,
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
