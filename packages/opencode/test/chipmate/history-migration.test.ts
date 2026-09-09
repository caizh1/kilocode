import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, rm } from "fs/promises"
import { hostname, tmpdir } from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { BlobReader, TextReader, TextWriter, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { Hash } from "@opencode-ai/core/util/hash"
import { ChatHistoryMigration } from "@/chipmate/history"

const cleanup: string[] = []

async function database(file: string) {
  await Effect.runPromise(Effect.scoped(Layer.build(CoreDatabase.layerFromPath(file))).pipe(Effect.orDie))
  return new Database(file)
}

function seed(db: Database, suffix = "", text = "旧聊天") {
  db.query("INSERT INTO project(id,worktree,time_created,time_updated,sandboxes) VALUES (?,?,?,?,?)").run(
    `pro_test${suffix}`,
    "/project",
    1,
    1,
    "[]",
  )
  db.query(
    "INSERT INTO session(id,project_id,slug,directory,title,version,cost,tokens_input,tokens_output,tokens_reasoning,tokens_cache_read,tokens_cache_write,time_created,time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(`ses_test${suffix}`, `pro_test${suffix}`, "slug", "/project", "旧会话", "1.0.19", 0, 0, 0, 0, 0, 0, 1, 1)
  db.query("INSERT INTO message(id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?)").run(
    `msg_test${suffix}`,
    `ses_test${suffix}`,
    1,
    1,
    JSON.stringify({ role: "user" }),
  )
  db.query("INSERT INTO part(id,message_id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?,?)").run(
    `prt_test${suffix}`,
    `msg_test${suffix}`,
    `ses_test${suffix}`,
    1,
    1,
    JSON.stringify({ type: "text", text }),
  )
}

function addMessage(db: Database, suffix: string, index: number, text: string) {
  db.query("INSERT INTO message(id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?)").run(
    `msg_test${suffix}_${index}`,
    `ses_test${suffix}`,
    index,
    index,
    JSON.stringify({ role: "user" }),
  )
  db.query("INSERT INTO part(id,message_id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?,?)").run(
    `prt_test${suffix}_${index}`,
    `msg_test${suffix}_${index}`,
    `ses_test${suffix}`,
    index,
    index,
    JSON.stringify({ type: "text", text }),
  )
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe("ChipMate 聊天历史统一迁移", () => {
  test("迁移前备份、合并旧库且重复执行不产生重复聊天", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-history-test-"))
    cleanup.push(root)
    const old = await database(path.join(root, "kilo.db"))
    seed(old)
    old.close()

    const first = await ChatHistoryMigration.migrate({ data: root })
    expect(first.imported).toBe(1)
    expect(await Bun.file(first.backup).exists()).toBe(true)
    await expect(ChatHistoryMigration.verify(first.backup)).resolves.toMatchObject({
      format: "chipmate-chat-history-backup",
      version: 1,
    })

    const target = new Database(path.join(root, "chipmate.db"))
    expect(target.query<{ count: number }, []>("SELECT count(*) count FROM session").get()?.count).toBe(1)
    expect(target.query<{ count: number }, []>("SELECT count(*) count FROM part").get()?.count).toBe(1)
    target.close()

    const second = await ChatHistoryMigration.migrate({ data: root })
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(1)
    const reopened = new Database(path.join(root, "chipmate.db"))
    expect(reopened.query<{ count: number }, []>("SELECT count(*) count FROM session").get()?.count).toBe(1)
    reopened.close()
  })

  test("进程中断后立即回收失主锁并继续迁移", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-history-orphan-lock-"))
    cleanup.push(root)
    const old = await database(path.join(root, "kilo.db"))
    seed(old)
    old.close()
    const lock = path.join(root, "migration-locks", `${Hash.fast("chat-history-migration")}.lock`)
    await mkdir(lock, { recursive: true })
    await Bun.write(path.join(lock, "heartbeat"), "")
    await Bun.write(
      path.join(lock, "meta.json"),
      JSON.stringify({ token: "orphaned-test-lock", pid: 2_147_483_647, hostname: hostname() }),
    )

    const result = await ChatHistoryMigration.migrate({ data: root })
    expect(result.imported).toBe(1)
    expect(await Bun.file(lock).exists()).toBe(false)
  })

  test("同 ID 内容冲突时确定性保留两棵会话树", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-history-conflict-"))
    cleanup.push(root)
    const current = await database(path.join(root, "chipmate.db"))
    seed(current, "", "当前聊天")
    current.close()
    const old = await database(path.join(root, "kilo.db"))
    seed(old, "", "旧版聊天")
    old.close()

    const result = await ChatHistoryMigration.migrate({ data: root })
    expect(result.imported).toBe(1)
    const target = new Database(path.join(root, "chipmate.db"))
    const sessions = target.query<{ id: string; title: string }, []>("SELECT id,title FROM session ORDER BY id").all()
    expect(sessions).toHaveLength(2)
    expect(
      sessions.some((session) => session.id.startsWith("ses_migrated_") && session.title.endsWith("（从旧版恢复）")),
    ).toBe(true)
    expect(target.query<{ count: number }, []>("PRAGMA foreign_key_check").all()).toHaveLength(0)
    target.close()
  })

  test("部分重叠只补缺失消息，旧库降级新增聊天后可再次补迁移", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-history-overlap-"))
    cleanup.push(root)
    const current = await database(path.join(root, "chipmate.db"))
    seed(current)
    current.close()
    const old = await database(path.join(root, "kilo.db"))
    seed(old)
    addMessage(old, "", 2, "旧库遗漏消息")
    old.close()

    const first = await ChatHistoryMigration.migrate({ data: root })
    expect(first.imported).toBe(1)
    const downgrade = new Database(path.join(root, "kilo.db"))
    addMessage(downgrade, "", 3, "降级后新增消息")
    downgrade.close()
    const second = await ChatHistoryMigration.migrate({ data: root })
    expect(second.imported).toBe(1)

    const target = new Database(path.join(root, "chipmate.db"))
    expect(target.query<{ count: number }, []>("SELECT count(*) count FROM session").get()?.count).toBe(1)
    expect(target.query<{ count: number }, []>("SELECT count(*) count FROM message").get()?.count).toBe(3)
    expect(target.query<{ count: number }, []>("SELECT count(*) count FROM part").get()?.count).toBe(3)
    target.close()
  })

  test("手动迁移链路导入旧 JSON 聊天", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-history-json-"))
    cleanup.push(root)
    const storage = path.join(root, "storage")
    await mkdir(path.join(storage, "project"), { recursive: true })
    await mkdir(path.join(storage, "session", "pro_json"), { recursive: true })
    await mkdir(path.join(storage, "message", "ses_json"), { recursive: true })
    await mkdir(path.join(storage, "part", "msg_json"), { recursive: true })
    await Bun.write(
      path.join(storage, "project", "pro_json.json"),
      JSON.stringify({ id: "pro_json", worktree: "/json", name: "JSON 项目", sandboxes: [] }),
    )
    await Bun.write(
      path.join(storage, "session", "pro_json", "ses_json.json"),
      JSON.stringify({
        id: "ses_json",
        projectID: "pro_json",
        slug: "json-session",
        directory: "/json",
        title: "JSON 会话",
        version: "1.0.0",
        time: { created: 1, updated: 1 },
        share: { url: "https://secret.invalid/json-share" },
        permission: [{ permission: "*", action: "allow", pattern: "*" }],
        revert: { messageID: "msg_json" },
      }),
    )
    await Bun.write(
      path.join(storage, "message", "ses_json", "msg_json.json"),
      JSON.stringify({ id: "msg_json", sessionID: "ses_json", role: "user", time: { created: 1 } }),
    )
    await Bun.write(
      path.join(storage, "part", "msg_json", "prt_json.json"),
      JSON.stringify({
        id: "prt_json",
        messageID: "msg_json",
        sessionID: "ses_json",
        type: "text",
        text: "JSON 聊天",
      }),
    )
    await Bun.write(path.join(storage, "project", "broken.json"), "{")

    const result = await ChatHistoryMigration.migrate({ data: root })
    expect(result.imported).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(["旧 JSON 记录 1 无法解析或导入"])
    const target = new Database(path.join(root, "chipmate.db"))
    expect(target.query<{ count: number }, []>("SELECT count(*) count FROM session").get()?.count).toBe(1)
    expect(target.query<{ text: string }, []>("SELECT json_extract(data,'$.text') text FROM part").get()?.text).toBe(
      "JSON 聊天",
    )
    target.close()
    const reader = new ZipReader(new BlobReader(Bun.file(result.backup)), { checkSignature: true })
    const entries = await reader.getEntries()
    const session = entries.find((entry) => entry.filename === "storage/session/pro_json/ses_json.json")
    const archived = JSON.parse((await session?.getData?.(new TextWriter())) as string) as Record<string, unknown>
    expect(archived.share).toBeUndefined()
    expect(archived.permission).toBeUndefined()
    expect(archived.revert).toBeUndefined()
    expect(entries.some((entry) => entry.filename === "storage/project/broken.json")).toBe(false)
    await reader.close()
  })

  test("恢复拒绝被修改的备份", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-history-restore-"))
    cleanup.push(root)
    const old = await database(path.join(root, "kilo.db"))
    seed(old)
    old.close()
    const backup = await ChatHistoryMigration.backup({ data: root })
    const bytes = new Uint8Array(await Bun.file(backup.archive).arrayBuffer())
    bytes[Math.floor(bytes.length / 2)]! ^= 0xff
    const broken = path.join(root, "broken.zip")
    await Bun.write(broken, bytes)
    await expect(ChatHistoryMigration.restore({ data: root, archive: broken })).rejects.toThrow()
  })

  test("一致性快照包含尚未 checkpoint 的 WAL 内容且不恢复敏感会话状态", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-history-wal-"))
    cleanup.push(root)
    const old = await database(path.join(root, "kilo.db"))
    old.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0")
    seed(old)
    old
      .query("UPDATE session SET share_url=?,metadata=?,revert=?,permission=?,workspace_id=? WHERE id=?")
      .run(
        "https://secret.invalid/share",
        JSON.stringify({ secret: "不得恢复" }),
        JSON.stringify({ messageID: "msg_test" }),
        JSON.stringify([{ permission: "*", action: "allow", pattern: "*" }]),
        "ws_secret",
        "ses_test",
      )
    old
      .query("INSERT INTO credential(id,label,value,time_created,time_updated) VALUES (?,?,?,?,?)")
      .run("cred_test", "旧凭据", "credential-secret-must-not-enter-backup", 1, 1)

    const result = await ChatHistoryMigration.migrate({ data: root })
    expect(old.query<{ count: number }, []>("SELECT count(*) count FROM credential").get()?.count).toBe(1)
    old.close()
    expect(result.imported).toBe(1)
    const target = new Database(path.join(root, "chipmate.db"))
    expect(target.query<{ text: string }, []>("SELECT json_extract(data,'$.text') text FROM part").get()?.text).toBe(
      "旧聊天",
    )
    expect(
      target
        .query<
          { share_url: string | null; metadata: string | null; revert: string | null; permission: string | null },
          []
        >("SELECT share_url,metadata,revert,permission FROM session")
        .get(),
    ).toEqual({ share_url: null, metadata: null, revert: null, permission: null })
    target.close()

    const reader = new ZipReader(new BlobReader(Bun.file(result.backup)), { checkSignature: true })
    const entry = (await reader.getEntries()).find((item) => item.filename === "databases/kilo.db")
    const bytes = await entry?.getData?.(new Uint8ArrayWriter())
    await reader.close()
    expect(bytes).toBeDefined()
    expect(new TextDecoder().decode(bytes).includes("credential-secret-must-not-enter-backup")).toBe(false)
    const snapshot = path.join(root, "sanitized-kilo.db")
    await Bun.write(snapshot, bytes!)
    const sanitized = new Database(snapshot, { readonly: true })
    expect(
      sanitized
        .query<{ count: number }, []>("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='credential'")
        .get()?.count,
    ).toBe(0)
    sanitized.close()
  })

  test("拒绝包含路径穿越条目的恶意恢复包", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-history-malicious-"))
    cleanup.push(root)
    const writer = new ZipWriter(new Uint8ArrayWriter())
    await writer.add("../escape.db", new TextReader("unsafe"))
    await writer.add(
      "manifest.json",
      new TextReader(
        JSON.stringify({
          format: "chipmate-chat-history-backup",
          version: 1,
          createdAt: new Date().toISOString(),
          files: [],
          statistics: {},
        }),
      ),
    )
    const archive = path.join(root, "malicious.zip")
    await Bun.write(archive, await writer.close())
    await expect(ChatHistoryMigration.restore({ data: root, archive })).rejects.toThrow("不安全路径")
    expect(await Bun.file(path.join(root, "escape.db")).exists()).toBe(false)
  })

  test("安全恢复只补充缺失聊天并保留恢复后的新聊天", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "chipmate-history-archive-source-"))
    const targetRoot = await mkdtemp(path.join(tmpdir(), "chipmate-history-archive-target-"))
    cleanup.push(source, targetRoot)
    const old = await database(path.join(source, "kilo.db"))
    seed(old)
    old.close()
    const backup = await ChatHistoryMigration.backup({ data: source })

    const current = await database(path.join(targetRoot, "chipmate.db"))
    seed(current, "_new", "恢复后新增聊天")
    current.close()
    const result = await ChatHistoryMigration.restore({ data: targetRoot, archive: backup.archive })
    expect(result.imported).toBe(1)
    expect(await Bun.file(result.backup).exists()).toBe(true)
    const target = new Database(path.join(targetRoot, "chipmate.db"))
    expect(target.query<{ count: number }, []>("SELECT count(*) count FROM session").get()?.count).toBe(2)
    expect(
      target
        .query<
          { count: number },
          []
        >("SELECT count(*) count FROM part WHERE json_extract(data,'$.text')='恢复后新增聊天'")
        .get()?.count,
    ).toBe(1)
    target.close()
  })
})
