import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { MessageTable, PartTable, SessionTable, TodoTable } from "@opencode-ai/core/session/sql"
import { describe, expect, test } from "bun:test"
import { eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { SessionAuditExport } from "@/chipmate/session/audit-export"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { PublicApi } from "@/server/routes/instance/httpapi/public"
import { seedProject } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Database.node, SessionStatus.node])))

function appendix(markdown: string): SessionAuditExport.Snapshot {
  const start = markdown.indexOf("<!-- CHIPMATE_RAW_JSON_BEGIN -->")
  const end = markdown.indexOf("<!-- CHIPMATE_RAW_JSON_END -->")
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  const fenced = markdown.slice(start + "<!-- CHIPMATE_RAW_JSON_BEGIN -->".length, end).trim()
  const first = fenced.indexOf("\n")
  const last = fenced.lastIndexOf("\n")
  return JSON.parse(fenced.slice(first + 1, last))
}

describe("SessionAuditExport", () => {
  test("公开 Markdown 端点声明 404 与 SessionExportBusyError 409", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const operation = spec.paths["/chipmate/session/{sessionID}/export"]?.get
    expect(operation).toBeDefined()
    expect(operation?.responses?.["200"]).toHaveProperty("content.text/markdown; charset=utf-8")
    expect(operation?.responses?.["404"]).toBeDefined()
    expect(operation?.responses?.["409"]).toBeDefined()
    expect(JSON.stringify(operation?.responses?.["409"])).toContain("SessionExportBusyError")
  })

  it.instance("完整导出原始字段、递归子孙、未知 Part 与确定性 JSON 附录", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const instance = yield* InstanceState.context
      yield* seedProject
      const root = { id: SessionID.make("ses_audit_root"), title: "根会话 中文" }
      const child = { id: SessionID.make("ses_audit_child"), title: "子 Agent" }
      const grandchild = { id: SessionID.make("ses_audit_grandchild"), title: "孙 Agent" }
      yield* db
        .insert(SessionTable)
        .values([
          sessionRow(root, null, instance.project.id, instance.directory, 1),
          sessionRow(child, root.id, instance.project.id, instance.directory, 2),
          sessionRow(grandchild, child.id, instance.project.id, instance.directory, 3),
        ])
        .run()
      const messageID = MessageID.ascending()
      const diff = `${"before\n".repeat(20_000)}\n${"`".repeat(3)}嵌套围栏${"`".repeat(3)}\n${"after\n".repeat(20_000)}`

      yield* db
        .insert(MessageTable)
        .values({
          id: messageID,
          session_id: root.id,
          time_created: 10,
          time_updated: 11,
          data: {
            role: "assistant",
            agent: "build",
            modelID: "deepseek-v4-flash",
            providerID: "internal",
            cost: 0.25,
            tokens: { input: 100, output: 50, reasoning: 25, cache: { read: 7, write: 3 } },
            error: { name: "ProviderError", data: { message: "保留错误" } },
          } as never,
        })
        .run()
      yield* db
        .insert(PartTable)
        .values([
          {
            id: PartID.ascending(),
            message_id: messageID,
            session_id: root.id,
            time_created: 12,
            time_updated: 13,
            data: {
              type: "reasoning",
              text: "已持久化思考：先检查工具。\n````reasoning````",
              metadata: { providerTrace: "trace-1", signature: "sig" },
            } as never,
          },
          {
            id: PartID.ascending(),
            message_id: messageID,
            session_id: root.id,
            time_created: 14,
            time_updated: 15,
            data: {
              type: "tool",
              tool: "apply_patch",
              callID: "call-1",
              state: {
                status: "completed",
                input: { patch: diff },
                output: "完成\n```output```",
                title: "应用补丁",
                metadata: { approved: true, approvalID: "approval-1", before: diff, after: diff },
                time: { start: 14, end: 15 },
                attachments: [{ filename: "result.txt", mime: "text/plain", url: "file:///tmp/result.txt" }],
              },
            } as never,
          },
          {
            id: PartID.ascending(),
            message_id: messageID,
            session_id: root.id,
            time_created: 16,
            time_updated: 17,
            data: { type: "future-part", payload: { preserved: true, value: "未来字段" } } as never,
          },
          {
            id: PartID.ascending(),
            message_id: messageID,
            session_id: root.id,
            time_created: 18,
            time_updated: 19,
            data: { type: "compaction", auto: true, reason: "上下文压缩" } as never,
          },
          {
            id: PartID.ascending(),
            message_id: messageID,
            session_id: root.id,
            time_created: 20,
            time_updated: 21,
            data: {
              type: "file",
              filename: "证据.txt",
              mime: "text/plain",
              url: "file:///tmp/evidence.txt",
            } as never,
          },
        ])
        .run()
      yield* db
        .insert(TodoTable)
        .values({ session_id: child.id, content: "验证导出", status: "pending", priority: "high", position: 0 })
        .run()
      yield* db.update(SessionTable).set({ parent_id: grandchild.id }).where(eq(SessionTable.id, root.id)).run()

      const result = yield* SessionAuditExport.get(root.id)
      expect(result.type).toBe("success")
      if (result.type !== "success") return
      expect(result.snapshot.sessions.map((item) => item.id)).toEqual([root.id, child.id, grandchild.id])
      expect(result.snapshot.integrityWarnings).not.toHaveLength(0)
      expect(result.markdown).toContain("已持久化思考：先检查工具")
      expect(result.markdown).toContain("approval-1")
      expect(result.markdown).toContain("future-part")
      expect(result.markdown).toContain("file:///tmp/evidence.txt")
      expect(result.markdown).toContain("`````text\n已持久化思考")

      const raw = appendix(result.markdown)
      const ids = [root.id, child.id, grandchild.id]
      const databaseRows = {
        sessions: yield* db.select().from(SessionTable).where(inArray(SessionTable.id, ids)).all(),
        messages: yield* db.select().from(MessageTable).where(inArray(MessageTable.session_id, ids)).all(),
        parts: yield* db.select().from(PartTable).where(inArray(PartTable.session_id, ids)).all(),
        todos: yield* db.select().from(TodoTable).where(inArray(TodoTable.session_id, ids)).all(),
      }
      expect(new Set(raw.sessions.map((item) => item.id))).toEqual(
        new Set(databaseRows.sessions.map((item) => item.id)),
      )
      expect(raw.messages).toEqual(databaseRows.messages)
      expect(raw.parts).toEqual(databaseRows.parts)
      expect(raw.todos).toEqual(databaseRows.todos)
      expect(raw.parts.find((item) => item.data.type === "tool")?.data as never).toHaveProperty(
        "state.metadata.before",
        diff,
      )
    }),
  )

  it.instance("对活动树返回 busy，并把越界或不存在的会话视为 not-found", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const instance = yield* InstanceState.context
      yield* seedProject
      const status = yield* SessionStatus.Service
      const root = { id: SessionID.make("ses_busy_root"), title: "忙碌根会话" }
      const child = { id: SessionID.make("ses_busy_child"), title: "忙碌子会话" }
      yield* db
        .insert(SessionTable)
        .values([
          sessionRow(root, null, instance.project.id, instance.directory, 1),
          sessionRow(child, root.id, instance.project.id, instance.directory, 2),
        ])
        .run()
      yield* status.set(child.id, { type: "busy" })

      expect(yield* SessionAuditExport.get(root.id)).toEqual({ type: "busy", sessionIDs: [child.id] })
      expect(yield* SessionAuditExport.get(SessionID.make("ses_missing"))).toEqual({ type: "not-found" })
    }),
  )
})

function sessionRow(
  session: { id: SessionID; title: string },
  parentID: SessionID | null,
  projectID: string,
  directory: string,
  time: number,
): typeof SessionTable.$inferInsert {
  return {
    id: session.id,
    project_id: projectID as never,
    parent_id: parentID,
    slug: session.id,
    directory: directory as never,
    title: session.title,
    version: "test",
    cost: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    time_created: time,
    time_updated: time,
  }
}
