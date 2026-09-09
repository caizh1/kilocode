import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { TurnStore } from "../../../src/chipmate/turn-changes/store"
import * as Files from "../../../src/chipmate/turn-changes/files"
import { Process } from "../../../src/util/process"

const temporary: string[] = []
afterEach(async () => {
  for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})
async function setup(files: Record<string, string | Buffer>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-turn-test-"))
  temporary.push(directory)
  const root = path.join(directory, "项目")
  await fs.mkdir(root)
  await Process.run(["git", "init", "-q"], { cwd: root })
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(root, name), content)
  const snapshot = async () => {
    await Process.run(["git", "add", "-A"], { cwd: root })
    return (await Process.run(["git", "write-tree"], { cwd: root })).stdout.toString().trim()
  }
  const store = new TurnStore(root, path.join(directory, "记录"), path.join(root, ".git"))
  const begin = async (message = "第一轮") => store.begin("会话", message, await snapshot())
  const finish = async (message = "第一轮", outcome: "completed" | "interrupted" | "error" = "completed") =>
    store.capture("会话", message, await snapshot(), outcome)
  const get = (message = "第一轮") => store.get("会话", message).then((summary) => summary!)
  const edit = (file: string, text: string | Buffer) => fs.writeFile(path.join(root, file), text)
  const read = (file: string) => fs.readFile(path.join(root, file), "utf8")
  return { root, store, snapshot, begin, finish, get, edit, read }
}
const source = Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 行\n`).join("")

describe("按轮审阅和安全撤销", () => {
  test("没有 Git 或快照的只读记录仍可随会话删除", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-turn-test-"))
    temporary.push(directory)
    const store = new TurnStore(directory, path.join(directory, "记录"), path.join(directory, "不存在的快照"))
    await store.begin("会话", "第一轮", undefined, "需要 Git 工作区并开启快照")
    await store.capture("会话", "第一轮", undefined, "completed")
    expect((await store.get("会话", "第一轮"))?.canRevert).toBe(false)
    await store.remove("会话")
    expect(await store.get("会话", "第一轮")).toBeUndefined()
    expect(await Bun.file(path.join(directory, "不存在的快照")).exists()).toBe(false)
  })
  test("中断保留已写入文件，整轮撤销和恢复不修改聊天数据", async () => {
    const t = await setup({ "主文件.ts": source })
    await t.begin()
    await t.edit("主文件.ts", source.replace("第 2 行", "第一处修改"))
    await t.store.phase("会话", "第一轮", "stopping")
    expect((await t.get()).canRevert).toBe(false)
    await t.finish("第一轮", "interrupted")
    const before = await t.get()
    expect(before.outcome).toBe("interrupted")
    expect(before.files).toHaveLength(1)
    expect(before.canRevert).toBe(true)
    const result = await t.store.mutate("会话", "第一轮", {
      revision: before.revision,
      requestID: "撤销一",
      action: "revert",
    })
    expect(await t.read("主文件.ts")).toBe(source)
    expect(result.files[0]?.state).toBe("reverted")
    await t.store.mutate("会话", "第一轮", { revision: result.revision, requestID: "恢复一", action: "restore" })
    expect(await t.read("主文件.ts")).toContain("第一处修改")
  })
  test("历史轮次的差异块撤销保留后续不重叠修改", async () => {
    const t = await setup({ "主文件.cpp": source })
    await t.begin()
    await t.edit("主文件.cpp", source.replace("第 2 行", "第一处修改").replace("第 20 行", "第二处修改"))
    await t.finish()
    const first = await t.get()
    const detail = await t.store.detail("会话", "第一轮", first.files[0]!.id)
    expect(detail.hunks).toHaveLength(2)
    await t.begin("第二轮")
    await t.edit("主文件.cpp", (await t.read("主文件.cpp")).replace("第 38 行", "后续修改"))
    await t.finish("第二轮")
    const result = await t.store.mutate("会话", "第一轮", {
      action: "revert",
      revision: first.revision,
      requestID: "撤销块",
      fileID: first.files[0]!.id,
      hunkID: detail.hunks[0]!.id,
    })
    expect(result.files[0]!.state).toBe("partial")
    expect(await t.read("主文件.cpp")).toBe(source.replace("第 20 行", "第二处修改").replace("第 38 行", "后续修改"))
    const all = await t.store.mutate("会话", "第一轮", {
      action: "revert",
      revision: result.revision,
      requestID: "撤销余下",
    })
    expect(await t.read("主文件.cpp")).toBe(source.replace("第 38 行", "后续修改"))
    await t.store.mutate("会话", "第一轮", { action: "restore", revision: all.revision, requestID: "恢复余下" })
    expect(await t.read("主文件.cpp")).toBe(source.replace("第 20 行", "第二处修改").replace("第 38 行", "后续修改"))
  })
  test("整轮任一文件冲突时不改动其他文件", async () => {
    const t = await setup({ "a.ts": source, "b.ts": source })
    await t.begin()
    await t.edit("a.ts", "本轮 A")
    await t.edit("b.ts", "本轮 B")
    await t.finish()
    await t.edit("b.ts", "用户后续编辑")
    const summary = await t.get()
    await expect(
      t.store.mutate("会话", "第一轮", { revision: summary.revision, requestID: "冲突", action: "revert" }),
    ).rejects.toThrow()
    expect(await t.read("a.ts")).toBe("本轮 A")
    expect(await t.read("b.ts")).toBe("用户后续编辑")
    expect((await t.get()).revision).toBe(summary.revision)
  })
  test("新增、删除、重命名及二进制可按文件撤销", async () => {
    const binary = Buffer.from([0, 1, 2, 3, 4])
    const t = await setup({ "旧名称.ts": source, "删除.ts": "原始内容", "图像.bin": binary })
    await t.begin()
    await fs.rename(path.join(t.root, "旧名称.ts"), path.join(t.root, "新名称.ts"))
    await fs.rm(path.join(t.root, "删除.ts"))
    await t.edit("新增.ts", "新增内容")
    await t.edit("图像.bin", Buffer.from([0, 9, 8, 7]))
    await t.finish()
    const summary = await t.get()
    expect(summary.files.map((file) => file.status)).toContain("renamed")
    await t.store.mutate("会话", "第一轮", { revision: summary.revision, requestID: "撤销文件", action: "revert" })
    expect(await t.read("旧名称.ts")).toBe(source)
    expect(await t.read("删除.ts")).toBe("原始内容")
    expect(await fs.readFile(path.join(t.root, "图像.bin"))).toEqual(binary)
    expect(await fs.stat(path.join(t.root, "新增.ts")).catch(() => null)).toBeNull()
    expect(await fs.stat(path.join(t.root, "新名称.ts")).catch(() => null)).toBeNull()
  })
  test("保留 BOM、CRLF、无末尾换行及本轮前人工修改", async () => {
    const original = "\ufeff人工内容\r\n第二行\r\n末尾"
    const t = await setup({ "格式.ts": original })
    await t.begin()
    await t.edit("格式.ts", original.replace("第二行", "本轮修改"))
    await t.finish()
    const summary = await t.get()
    await t.store.mutate("会话", "第一轮", { revision: summary.revision, requestID: "编码", action: "revert" })
    expect(await t.read("格式.ts")).toBe(original)
  })
  test("拒绝过期版本、伪造差异块、运行中操作并使重复请求幂等", async () => {
    const t = await setup({ "a.ts": source })
    await t.begin()
    await t.edit("a.ts", "修改")
    const running = await t.get()
    await expect(
      t.store.mutate("会话", "第一轮", { revision: running.revision, requestID: "运行中", action: "revert" }),
    ).rejects.toThrow()
    await t.finish()
    const summary = await t.get()
    await expect(
      t.store.mutate("会话", "第一轮", { revision: summary.revision - 1, requestID: "过期", action: "revert" }),
    ).rejects.toThrow()
    await expect(
      t.store.mutate("会话", "第一轮", {
        revision: summary.revision,
        requestID: "伪造",
        action: "revert",
        fileID: summary.files[0]!.id,
        hunkID: "伪造",
      }),
    ).rejects.toThrow()
    const request = { revision: summary.revision, requestID: "幂等", action: "revert" as const }
    const first = await t.store.mutate("会话", "第一轮", request)
    expect((await t.store.mutate("会话", "第一轮", request)).revision).toBe(first.revision)
    await expect(t.store.mutate("会话", "第一轮", { ...request, action: "restore" })).rejects.toThrow()
  })
  test("崩溃期间的部分写入按日志恢复，不覆盖日志之外的新编辑", async () => {
    const t = await setup({ "a.ts": "原始", "b.ts": "原始" })
    await t.begin()
    await t.edit("a.ts", "修改 A")
    await t.edit("b.ts", "修改 B")
    await t.finish()
    const before = await Files.read(t.root, "a.ts")
    const after = { data: Buffer.from("原始").toString("base64"), mode: 0o644 }
    await Files.atomic(
      path.join(t.store.storage, "journal.json"),
      JSON.stringify({
        key: t.store.key("会话", "第一轮"),
        operation: "未提交",
        changes: [{ file: "a.ts", before, after }],
      }),
    )
    await Files.write(t.root, "a.ts", after)
    await t.store.get("会话", "第一轮")
    expect(await t.read("a.ts")).toBe("修改 A")
    await Files.atomic(
      path.join(t.store.storage, "journal.json"),
      JSON.stringify({
        key: t.store.key("会话", "第一轮"),
        operation: "未提交",
        changes: [{ file: "a.ts", before, after }],
      }),
    )
    await t.edit("a.ts", "崩溃后人工修改")
    await expect(t.get()).rejects.toThrow("后续编辑")
    expect(await t.read("a.ts")).toBe("崩溃后人工修改")
  })
  test("长期引用抵抗 Git 清理，删除会话才释放", async () => {
    const t = await setup({ "a.ts": "旧内容" })
    await t.begin()
    await t.edit("a.ts", "新内容")
    await t.finish()
    await Process.run(["git", "gc", "--prune=now"], { cwd: t.root })
    const summary = await t.get()
    expect((await t.store.detail("会话", "第一轮", summary.files[0]!.id)).patch).toContain("旧内容")
    await t.store.remove("会话")
    expect(await t.store.get("会话", "第一轮")).toBeUndefined()
    expect(
      (await Process.run(["git", "for-each-ref", "refs/chipmate/turn-changes"], { cwd: t.root })).stdout.length,
    ).toBe(0)
  })
  test("并发会话和执行期间人工编辑均保留清单并禁用撤销", async () => {
    const t = await setup({ "a.ts": source })
    await t.begin()
    await t.store.begin("另一会话", "另一轮", await t.snapshot())
    await t.edit("a.ts", "无法确定归属")
    await t.finish()
    expect((await t.get()).canRevert).toBe(false)
    expect((await t.get()).reason).toContain("并发")
    await t.store.external("a.ts")
    expect((await t.store.get("另一会话", "另一轮"))?.reason).toContain("人工编辑")
  })
  test("基线遗漏的已有文件不能被误认成新增后删除", async () => {
    const t = await setup({ "a.ts": "原文" })
    const baseline = await t.snapshot()
    await t.edit("未收录.ts", "原来就存在")
    await t.store.begin("会话", "第一轮", baseline)
    await t.edit("未收录.ts", "改小后的内容")
    await t.finish()
    expect((await t.get()).canRevert).toBe(false)
    expect((await t.get()).reason).toContain("未收录")
    expect(await t.read("未收录.ts")).toBe("改小后的内容")
  })
  test("移动基线遗漏文件不能绕过原始内容完整性检查", async () => {
    const t = await setup({ "a.ts": "原文" })
    const baseline = await t.snapshot()
    await t.edit("未收录.ts", "已有内容")
    await t.store.begin("会话", "第一轮", baseline)
    await fs.rename(path.join(t.root, "未收录.ts"), path.join(t.root, "新路径.ts"))
    await t.finish()
    expect((await t.get()).canRevert).toBe(false)
  })
  test("删除私有权限文件后恢复保留原始权限", async () => {
    if (process.platform === "win32") return
    const t = await setup({ "权限.txt": "权限验收" })
    await fs.chmod(path.join(t.root, "权限.txt"), 0o600)
    await t.begin()
    await fs.rm(path.join(t.root, "权限.txt"))
    await t.finish()
    await t.store.mutate("会话", "第一轮", {
      revision: (await t.get()).revision,
      requestID: "还原私有文件",
      action: "revert",
    })
    expect((await fs.stat(path.join(t.root, "权限.txt"))).mode & 0o777).toBe(0o600)
  })
  test("拒绝符号链接绕出工作区且整轮预检不改其他文件", async () => {
    const t = await setup({ "a.ts": "原文", "b.ts": "原文" })
    await t.begin()
    await t.edit("a.ts", "本轮")
    await t.edit("b.ts", "本轮")
    await t.finish()
    const external = path.join(t.store.storage, "外部文件")
    await fs.writeFile(external, "外部内容")
    await fs.rm(path.join(t.root, "b.ts"))
    await fs.symlink(external, path.join(t.root, "b.ts"))
    await expect(
      t.store.mutate("会话", "第一轮", { revision: (await t.get()).revision, requestID: "链接", action: "revert" }),
    ).rejects.toThrow("符号链接")
    expect(await t.read("a.ts")).toBe("本轮")
    expect(await fs.readFile(external, "utf8")).toBe("外部内容")
  })
  test("进程异常结束后的记录保持未结算并要求核对磁盘", async () => {
    const t = await setup({ "a.ts": "原文" })
    await t.begin()
    await t.edit("a.ts", "已写入但未收尾")
    const active = path.join(t.store.storage, "active.json")
    await Files.atomic(
      active,
      JSON.stringify({
        [t.store.key("会话", "第一轮")]: {
          sessionID: "会话",
          messageID: "第一轮",
          pid: 2_147_483_647,
          owner: "退出的进程",
        },
      }),
    )
    const reopened = new TurnStore(t.root, t.store.storage, t.store.gitdir)
    const summary = await reopened.get("会话", "第一轮")
    expect(summary?.phase).toBe("unavailable")
    expect(summary?.canRevert).toBe(false)
    expect(await reopened.needsReconcile("会话", "第一轮")).toBe(true)
    await reopened.capture("会话", "第一轮", await t.snapshot(), "interrupted")
    expect((await reopened.get("会话", "第一轮"))?.files).toHaveLength(1)
    expect(await reopened.needsReconcile("会话", "第一轮")).toBe(false)
  })
  test("同一会话标识在不同工作树互不修改", async () => {
    const left = await setup({ "a.ts": "左原文" })
    const right = await setup({ "a.ts": "右原文" })
    await left.begin()
    await right.begin()
    await left.edit("a.ts", "左修改")
    await right.edit("a.ts", "右修改")
    await left.finish()
    await right.finish()
    await left.store.mutate("会话", "第一轮", {
      revision: (await left.get()).revision,
      requestID: "只撤销左边",
      action: "revert",
    })
    expect(await left.read("a.ts")).toBe("左原文")
    expect(await right.read("a.ts")).toBe("右修改")
  })

  test("显式编辑忽略文件会保留不可撤销原因而不是显示没有修改", async () => {
    const t = await setup({ ".gitignore": "忽略.txt\n", "忽略.txt": "原始内容" })
    await t.begin()
    await t.store.prepare("会话", "第一轮", ["忽略.txt"])
    await t.edit("忽略.txt", "实际改动")
    await t.finish("第一轮", "interrupted")
    const summary = await t.get()
    expect(summary.phase).toBe("unavailable")
    expect(summary.reason).toContain("忽略.txt")
    expect(summary.canRevert).toBe(false)
    expect(await t.read("忽略.txt")).toBe("实际改动")
  })
  test("UTF-16 文本按真实行数审阅，差异块撤销保留编码和后续编辑", async () => {
    const encode = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])
    const t = await setup({ "宽字符.txt": encode(source) })
    await t.begin()
    await t.edit("宽字符.txt", encode(source.replace("第 2 行", "本轮修改")))
    await t.finish()
    const summary = await t.get()
    expect(summary.files[0]).toMatchObject({ binary: false, additions: 1, deletions: 1 })
    const detail = await t.store.detail("会话", "第一轮", summary.files[0]!.id)
    expect(detail.hunks).toHaveLength(1)
    await t.edit("宽字符.txt", encode(source.replace("第 2 行", "本轮修改").replace("第 38 行", "人工编辑")))
    await t.store.mutate("会话", "第一轮", {
      revision: summary.revision,
      requestID: "宽字符块",
      action: "revert",
      fileID: summary.files[0]!.id,
      hunkID: detail.hunks[0]!.id,
    })
    expect(await fs.readFile(path.join(t.root, "宽字符.txt"))).toEqual(encode(source.replace("第 38 行", "人工编辑")))
  })
})
