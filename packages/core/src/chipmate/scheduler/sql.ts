import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const ScheduledTaskTable = sqliteTable(
  "chipmate_scheduled_task",
  {
    id: text().primaryKey(),
    scope: text().notNull(),
    directory: text().notNull(),
    version: integer().notNull(),
    status: text().notNull(),
    definition: text().notNull(),
    next_at: integer(),
    created_at: integer().notNull(),
    request_key: text().notNull(),
  },
  (table) => [
    uniqueIndex("scheduled_task_request").on(table.scope, table.request_key),
    index("scheduled_task_due").on(table.scope, table.directory, table.next_at),
  ],
)

export const ScheduledRunTable = sqliteTable(
  "chipmate_scheduled_run",
  {
    id: text().primaryKey(),
    scope: text().notNull(),
    directory: text().notNull(),
    task_id: text().notNull(),
    occurrence: text().notNull(),
    data: text().notNull(),
    status: text().notNull(),
    owner: text().notNull(),
    lease_until: integer().notNull(),
    cancel_requested: integer().notNull().default(0),
  },
  (table) => [
    uniqueIndex("scheduled_run_occurrence").on(table.task_id, table.occurrence),
    index("scheduled_run_scope").on(table.scope, table.directory, table.status),
  ],
)

export const SchedulerClientTable = sqliteTable(
  "chipmate_scheduler_client",
  {
    id: text().primaryKey(),
    scope: text().notNull(),
    directory: text().notNull(),
    lease_until: integer().notNull(),
  },
  (table) => [index("scheduler_client_scope").on(table.scope, table.directory)],
)
