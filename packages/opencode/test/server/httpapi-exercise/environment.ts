import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"
import path from "path"

const preserveExerciseGlobalRoot = !!process.env.CHIPMATE_HTTPAPI_EXERCISE_GLOBAL
export const exerciseGlobalRoot =
  process.env.CHIPMATE_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `opencode-httpapi-global-${process.pid}`)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
process.env.CHIPMATE_DISABLE_SHARE = "true"
process.env.CHIPMATE_DISABLE_SESSION_INGEST = "true" // chipmate_change - isolate the exerciser from async ChipMate session sync
process.env.CHIPMATE_DISABLE_PRESENCE = "1" // chipmate_change - presence now has a default Event Service URL; never open real sockets from the exerciser
process.env.CHIPMATE_DISABLE_CODEBASE_INDEXING = "vscode-no-workspace" // chipmate_change - route scenarios do not need an indexing worker per temp project
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "opencode")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, "data", "chipmate") // chipmate_change

const preserveExerciseDatabase = !!process.env.CHIPMATE_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath =
  process.env.CHIPMATE_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `opencode-httpapi-exercise-${process.pid}.db`)
process.env.CHIPMATE_DB = exerciseDatabasePath
Flag.CHIPMATE_DB = exerciseDatabasePath

export const original = {
  CHIPMATE_SERVER_PASSWORD: Flag.CHIPMATE_SERVER_PASSWORD,
  CHIPMATE_SERVER_USERNAME: Flag.CHIPMATE_SERVER_USERNAME,
}

export const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
})
