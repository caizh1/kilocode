import { BackgroundProcess } from "@/chipmate/background-process"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"

export namespace ChipMateTaskBackgroundProcess {
  export function finish(sessionID: SessionID) {
    return Effect.promise(() => BackgroundProcess.stopSession(sessionID)).pipe(Effect.ignore)
  }
}
