import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable, SessionTable, TodoTable } from "@opencode-ai/core/session/sql"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionStatus } from "@/session/status"
import type { SessionID } from "@/session/schema"

export namespace SessionAuditExport {
  type SessionRow = typeof SessionTable.$inferSelect
  type MessageRow = typeof MessageTable.$inferSelect
  type PartRow = typeof PartTable.$inferSelect
  type TodoRow = typeof TodoTable.$inferSelect

  export type Snapshot = {
    schemaVersion: 1
    rootSessionID: SessionID
    sessions: SessionRow[]
    messages: MessageRow[]
    parts: PartRow[]
    todos: TodoRow[]
    integrityWarnings: string[]
  }

  export type Result =
    | { type: "not-found" }
    | { type: "busy"; sessionIDs: SessionID[] }
    | { type: "success"; markdown: string; snapshot: Snapshot }

  export const get = Effect.fn("SessionAuditExport.get")(function* (rootSessionID: SessionID) {
    const { db } = yield* Database.Service
    const status = yield* SessionStatus.Service
    const instance = yield* InstanceState.context

    const read = () =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            const root = yield* tx
              .select()
              .from(SessionTable)
              .where(
                and(
                  eq(SessionTable.id, rootSessionID),
                  eq(SessionTable.project_id, instance.project.id),
                  eq(SessionTable.directory, instance.directory),
                ),
              )
              .get()
            if (!root) return undefined

            const family = yield* tx.all<{ id: SessionID }>(sql`
              WITH RECURSIVE descendants(id) AS (
                SELECT id
                FROM session
                WHERE id = ${rootSessionID}
                  AND project_id = ${instance.project.id}
                  AND directory = ${instance.directory}

                UNION

                SELECT child.id
                FROM session AS child
                JOIN descendants AS parent ON child.parent_id = parent.id
                WHERE child.project_id = ${instance.project.id}
                  AND child.directory = ${instance.directory}
              )
              SELECT id FROM descendants
            `)
            const ids = family.map((item) => item.id)
            const sessions = yield* tx
              .select()
              .from(SessionTable)
              .where(inArray(SessionTable.id, ids))
              .orderBy(asc(SessionTable.time_created), asc(SessionTable.id))
              .all()
            const ordered = orderSessions(rootSessionID, sessions)
            const messages = yield* tx
              .select()
              .from(MessageTable)
              .where(inArray(MessageTable.session_id, ids))
              .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
              .all()
            const parts = yield* tx
              .select()
              .from(PartTable)
              .where(inArray(PartTable.session_id, ids))
              .orderBy(asc(PartTable.time_created), asc(PartTable.id))
              .all()
            const todos = yield* tx
              .select()
              .from(TodoTable)
              .where(inArray(TodoTable.session_id, ids))
              .orderBy(asc(TodoTable.position), asc(TodoTable.session_id))
              .all()

            return {
              schemaVersion: 1,
              rootSessionID,
              sessions: ordered.sessions,
              messages: orderByOwner(ordered.sessions, messages, (row) => row.session_id),
              parts: orderParts(ordered.sessions, messages, parts),
              todos: orderByOwner(ordered.sessions, todos, (row) => row.session_id),
              integrityWarnings: ordered.warnings,
            } satisfies Snapshot
          }),
        )
        .pipe(Effect.orDie)

    const before = yield* read()
    if (!before) return { type: "not-found" } satisfies Result
    const firstBusy = activeSessionIDs(yield* status.list(), before.sessions)
    if (firstBusy.length > 0) return { type: "busy", sessionIDs: firstBusy } satisfies Result

    const after = yield* read()
    if (!after) return { type: "busy", sessionIDs: [] } satisfies Result
    const secondBusy = activeSessionIDs(yield* status.list(), after.sessions)
    if (secondBusy.length > 0) return { type: "busy", sessionIDs: secondBusy } satisfies Result
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      return { type: "busy", sessionIDs: [] } satisfies Result
    }

    return {
      type: "success",
      snapshot: before,
      markdown: render(before, Date.now()),
    } satisfies Result
  })

  export function render(snapshot: Snapshot, exportedAt: number): string {
    const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]))
    const children = new Map<SessionID, SessionID[]>()
    for (const session of snapshot.sessions) {
      if (!session.parent_id || !sessions.has(session.parent_id) || session.id === snapshot.rootSessionID) continue
      const items = children.get(session.parent_id) ?? []
      items.push(session.id)
      children.set(session.parent_id, items)
    }
    const messages = groupBy(snapshot.messages, (message) => message.session_id)
    const parts = groupBy(snapshot.parts, (part) => part.message_id)
    const todos = groupBy(snapshot.todos, (todo) => todo.session_id)
    const lines = [
      "# ChipMate QA 原始会话导出",
      "",
      "> 警告：本文件包含未经脱敏的原始会话记录，可能含源码、提示词、工具输入输出、路径和错误信息。",
      "> “思考过程”仅包含 provider 返回且已持久化的 reasoning；未返回、已清理或从未持久化的内容无法恢复。",
      "> 附件与临时输出只保留会话中已有的引用，不会追读或复制引用目标。",
      "",
      `- 根会话 ID：${snapshot.rootSessionID}`,
      `- 导出时间：${new Date(exportedAt).toISOString()}`,
      `- 会话数量：${snapshot.sessions.length}`,
      `- 消息数量：${snapshot.messages.length}`,
      `- Part 数量：${snapshot.parts.length}`,
      `- Todo 数量：${snapshot.todos.length}`,
      "",
    ]
    if (snapshot.integrityWarnings.length > 0) {
      lines.push("## 完整性警告", "", ...snapshot.integrityWarnings.map((item) => `- ${item}`), "")
    }

    const visit = (sessionID: SessionID, depth: number) => {
      const session = sessions.get(sessionID)
      if (!session) return
      const number = snapshot.sessions.findIndex((item) => item.id === sessionID) + 1
      lines.push(
        `${"#".repeat(Math.min(6, depth + 2))} 会话 ${number}：${heading(session.title)}`,
        "",
        `- 会话 ID：${session.id}`,
        `- 父会话 ID：${session.parent_id ?? "无"}`,
        `- Agent：${session.agent ?? "未记录"}`,
        `- 模型：${session.model ? `${session.model.providerID}/${session.model.id}` : "未记录"}`,
        `- 创建时间：${iso(session.time_created)}`,
        `- 更新时间：${iso(session.time_updated)}`,
        `- 费用：${session.cost}`,
        `- Token：input=${session.tokens_input}, output=${session.tokens_output}, reasoning=${session.tokens_reasoning}, cache.read=${session.tokens_cache_read}, cache.write=${session.tokens_cache_write}`,
        "",
        "会话原始记录：",
        "",
        block(JSON.stringify(session, null, 2), "json"),
        "",
      )
      const sessionTodos = todos.get(sessionID) ?? []
      if (sessionTodos.length > 0) {
        lines.push(`${"#".repeat(Math.min(6, depth + 3))} Todo`, "")
        for (const todo of sessionTodos) lines.push(block(JSON.stringify(todo, null, 2), "json"), "")
      }
      for (const [index, message] of (messages.get(sessionID) ?? []).entries()) {
        const data = record(message.data)
        const role = data.role === "user" ? "用户" : data.role === "assistant" ? "助手" : String(data.role ?? "未知")
        lines.push(
          `${"#".repeat(Math.min(6, depth + 3))} 消息 ${index + 1}：${role}`,
          "",
          `- 消息 ID：${message.id}`,
          `- 创建时间：${iso(message.time_created)}`,
          `- 更新时间：${iso(message.time_updated)}`,
          "",
          "消息原始记录：",
          "",
          block(JSON.stringify(message, null, 2), "json"),
          "",
        )
        for (const [partIndex, part] of (parts.get(message.id) ?? []).entries()) {
          lines.push(...renderPart(part, partIndex + 1, depth))
        }
      }
      for (const childID of children.get(sessionID) ?? []) visit(childID, depth + 1)
    }
    visit(snapshot.rootSessionID, 0)
    lines.push(
      "## 完整原始 JSON 附录",
      "",
      "以下 JSON 是本次导出的完整持久化快照；未知或未来新增的字段与 Part 类型仍会保留。",
      "",
      "<!-- CHIPMATE_RAW_JSON_BEGIN -->",
      block(JSON.stringify(snapshot, null, 2), "json"),
      "<!-- CHIPMATE_RAW_JSON_END -->",
      "",
    )
    return lines.join("\n")
  }

  function renderPart(part: PartRow, index: number, depth: number): string[] {
    const data = record(part.data)
    const type = typeof data.type === "string" ? data.type : "未知"
    const prefix = "#".repeat(Math.min(6, depth + 4))
    const lines = [
      `${prefix} Part ${index}：${partTitle(type, data)}`,
      "",
      `- Part ID：${part.id}`,
      `- 类型：${type}`,
      `- 创建时间：${iso(part.time_created)}`,
      `- 更新时间：${iso(part.time_updated)}`,
      "",
    ]
    if ((type === "text" || type === "reasoning") && typeof data.text === "string") {
      lines.push(type === "reasoning" ? "已持久化 reasoning 文本：" : "文本内容：", "", block(data.text, "text"), "")
    }
    if (type === "tool") {
      const state = record(data.state)
      if ("input" in state) lines.push("工具输入：", "", block(JSON.stringify(state.input, null, 2), "json"), "")
      if ("output" in state) lines.push("工具输出：", "", block(value(state.output)), "")
      if ("error" in state) lines.push("工具错误：", "", block(value(state.error)), "")
    }
    lines.push("Part 原始记录：", "", block(JSON.stringify(part, null, 2), "json"), "")
    return lines
  }

  function partTitle(type: string, data: Record<string, unknown>) {
    if (type === "tool")
      return `工具 ${String(data.tool ?? "未知")}（${String(record(data.state).status ?? "未知状态")}）`
    if (type === "reasoning") return "Reasoning"
    if (type === "file") return `附件引用 ${String(data.filename ?? data.url ?? "")}`.trim()
    return type
  }

  function block(content: string, language = "") {
    const runs = content.match(/`+/g) ?? []
    const size = Math.max(3, ...runs.map((item) => item.length + 1))
    const marker = "`".repeat(size)
    return `${marker}${language}\n${content}\n${marker}`
  }

  function value(input: unknown) {
    return typeof input === "string" ? input : JSON.stringify(input, null, 2)
  }

  function record(input: unknown): Record<string, unknown> {
    return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  }

  function heading(input: string) {
    return input.replace(/[\r\n]+/g, " ").trim() || "未命名会话"
  }

  function iso(input: number | null) {
    return input === null ? "未记录" : new Date(input).toISOString()
  }

  function groupBy<T, K>(items: T[], key: (item: T) => K) {
    const grouped = new Map<K, T[]>()
    for (const item of items) {
      const value = key(item)
      const list = grouped.get(value) ?? []
      list.push(item)
      grouped.set(value, list)
    }
    return grouped
  }

  function orderByOwner<T>(sessions: SessionRow[], items: T[], owner: (item: T) => SessionID) {
    const order = new Map(sessions.map((session, index) => [session.id, index]))
    return [...items].sort(
      (left, right) => (order.get(owner(left)) ?? Infinity) - (order.get(owner(right)) ?? Infinity),
    )
  }

  function orderParts(sessions: SessionRow[], messages: MessageRow[], parts: PartRow[]) {
    const sessionOrder = new Map(sessions.map((session, index) => [session.id, index]))
    const messageOrder = new Map(messages.map((message, index) => [message.id, index]))
    return [...parts].sort(
      (left, right) =>
        (sessionOrder.get(left.session_id) ?? Infinity) - (sessionOrder.get(right.session_id) ?? Infinity) ||
        (messageOrder.get(left.message_id) ?? Infinity) - (messageOrder.get(right.message_id) ?? Infinity) ||
        left.time_created - right.time_created ||
        left.id.localeCompare(right.id),
    )
  }

  function orderSessions(rootSessionID: SessionID, rows: SessionRow[]) {
    const sessions = new Map(rows.map((row) => [row.id, row]))
    const children = new Map<SessionID, SessionRow[]>()
    const warnings: string[] = []
    for (const row of rows) {
      if (row.id === rootSessionID) continue
      if (!row.parent_id || !sessions.has(row.parent_id)) {
        warnings.push(`会话 ${row.id} 的父会话 ${row.parent_id ?? "未记录"} 不在导出树中。`)
        continue
      }
      const list = children.get(row.parent_id) ?? []
      list.push(row)
      children.set(row.parent_id, list)
    }
    for (const list of children.values()) {
      list.sort((left, right) => left.time_created - right.time_created || left.id.localeCompare(right.id))
    }
    const root = sessions.get(rootSessionID)
    if (root?.parent_id && sessions.has(root.parent_id)) {
      warnings.push(`根会话 ${rootSessionID} 的父关系指向导出树内部，已按请求根会话截断。`)
    }
    const ordered: SessionRow[] = []
    const visited = new Set<SessionID>()
    const visiting = new Set<SessionID>()
    const visit = (row: SessionRow) => {
      if (visiting.has(row.id)) {
        warnings.push(`检测到包含会话 ${row.id} 的父子循环；每条记录仅导出一次。`)
        return
      }
      if (visited.has(row.id)) return
      visiting.add(row.id)
      visited.add(row.id)
      ordered.push(row)
      for (const child of children.get(row.id) ?? []) visit(child)
      visiting.delete(row.id)
    }
    if (root) visit(root)
    for (const row of rows) {
      if (visited.has(row.id)) continue
      warnings.push(`会话 ${row.id} 无法从根会话按父子关系到达，已保留在原始附录中。`)
      visit(row)
    }
    return { sessions: ordered, warnings: [...new Set(warnings)] }
  }

  function activeSessionIDs(statuses: Map<SessionID, SessionStatus.Info>, sessions: SessionRow[]) {
    return sessions
      .filter((session) => statuses.get(session.id)?.type !== undefined && statuses.get(session.id)?.type !== "idle")
      .map((session) => session.id)
      .sort()
  }
}
