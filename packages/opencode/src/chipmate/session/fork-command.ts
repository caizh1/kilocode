import { fn } from "@/chipmate/fn"
import { MessageID, SessionID } from "@/session/schema"
import { zod as toZod } from "@opencode-ai/core/effect-zod"
import z from "zod"

export const chipmateSessionFork = fn(
  z
    .object({
      sessionID: toZod(SessionID),
      messageID: toZod(MessageID).optional(),
      afterMessageID: toZod(MessageID).optional(),
      operationID: z.string().uuid().optional(),
    })
    .refine((input) => !(input.messageID && input.afterMessageID), {
      message: "messageID 与 afterMessageID 不能同时提供",
    }),
  async (input) => {
    const [{ AppRuntime }, { Session }] = await Promise.all([
      import("@/effect/app-runtime"),
      import("@/session/session"),
    ])
    return AppRuntime.runPromise(Session.Service.use((sessions) => sessions.fork(input)))
  },
)
