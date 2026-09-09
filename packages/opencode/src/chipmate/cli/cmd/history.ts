import type { Argv } from "yargs"
import { cmd } from "@/cli/cmd/cmd"
import { ChatHistoryMigration, type Progress } from "@/chipmate/history"
import path from "path"

function output(event: Progress) {
  const result = event.result
    ? {
        ...event.result,
        ...(typeof event.result.backup === "string" ? { backup: path.basename(event.result.backup) } : {}),
      }
    : null
  process.stdout.write(JSON.stringify({ ...event, result }) + "\n")
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[A-Za-z]:\\[^\s]+|\/(?:[^\s/:]+\/)+[^\s:]+/g, "<本地路径>")
}

function builder(yargs: Argv) {
  return yargs.option("format", {
    type: "string",
    choices: ["jsonl"],
    default: "jsonl",
    describe: "progress output format",
  })
}

const MigrateCommand = cmd({
  command: "migrate",
  describe: "back up and merge legacy local chat history",
  builder,
  handler: async () => {
    try {
      const result = await ChatHistoryMigration.migrate({ progress: output })
      if (result.failed > 0) process.exitCode = 2
    } catch (error) {
      output({
        phase: "error",
        current: 0,
        total: 1,
        message: safeError(error),
        result: null,
      })
      process.exitCode = 1
    }
  },
})

const RestoreCommand = cmd({
  command: "restore",
  describe: "safely merge local chat history from a ChipMate backup",
  builder: (yargs: Argv) =>
    builder(yargs).option("archive", {
      type: "string",
      demandOption: true,
      describe: "backup ZIP to restore",
    }),
  handler: async (args) => {
    try {
      const result = await ChatHistoryMigration.restore({ archive: args.archive, progress: output })
      if (result.failed > 0) process.exitCode = 2
    } catch (error) {
      output({
        phase: "error",
        current: 0,
        total: 1,
        message: safeError(error),
        result: null,
      })
      process.exitCode = 1
    }
  },
})

export const HistoryCommand = cmd({
  command: "history",
  describe: "migrate and restore local ChipMate chat history",
  builder: (yargs: Argv) => yargs.command(MigrateCommand).command(RestoreCommand).demandCommand(),
  handler: () => undefined,
})
