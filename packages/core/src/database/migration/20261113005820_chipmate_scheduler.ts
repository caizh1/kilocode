import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261113005820_chipmate_scheduler",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`chipmate_scheduled_run\` (
          \`id\` text PRIMARY KEY,
          \`scope\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`task_id\` text NOT NULL,
          \`occurrence\` text NOT NULL,
          \`data\` text NOT NULL,
          \`status\` text NOT NULL,
          \`owner\` text NOT NULL,
          \`lease_until\` integer NOT NULL,
          \`cancel_requested\` integer DEFAULT 0 NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`chipmate_scheduled_task\` (
          \`id\` text PRIMARY KEY,
          \`scope\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`definition\` text NOT NULL,
          \`next_at\` integer,
          \`created_at\` integer NOT NULL,
          \`request_key\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`chipmate_scheduler_client\` (
          \`id\` text PRIMARY KEY,
          \`scope\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`lease_until\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`scheduled_run_occurrence\` ON \`chipmate_scheduled_run\` (\`task_id\`,\`occurrence\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`scheduled_run_scope\` ON \`chipmate_scheduled_run\` (\`scope\`,\`directory\`,\`status\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`scheduled_task_request\` ON \`chipmate_scheduled_task\` (\`scope\`,\`request_key\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`scheduled_task_due\` ON \`chipmate_scheduled_task\` (\`scope\`,\`directory\`,\`next_at\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`scheduler_client_scope\` ON \`chipmate_scheduler_client\` (\`scope\`,\`directory\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
