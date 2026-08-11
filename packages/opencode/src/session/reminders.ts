
import { Effect } from "effect"
import { ChipMateSessionPrompt } from "@/chipmate/session/prompt" // chipmate_change
import { Agent } from "@/agent/agent"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import CODE_SWITCH from "./prompt/code-switch.txt" // chipmate_change

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const flags = yield* RuntimeFlags.Service
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  // chipmate_change start - shared planning reminder path
  // No-op unless the active agent is plan-like.
  yield* Effect.promise(() =>
    ChipMateSessionPrompt.insertPlanReminders({
      agent: input.agent,
      session: input.session,
      userMessage,
      messages: input.messages,
    }),
  )
  // chipmate_change end

  if (!flags.experimentalPlanMode) {
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "code") {
      // chipmate_change - renamed from "build" to "code"
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: CODE_SWITCH, // chipmate_change - renamed from BUILD_SWITCH to CODE_SWITCH
        synthetic: true,
      })
    }
    return input.messages
  }

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const ctx = yield* InstanceState.context
    const plan = Session.plan(input.session, ctx)
    const exists = yield* fsys.existsSafe(plan)
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: exists
        ? `${CODE_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it` // chipmate_change - renamed from BUILD_SWITCH to CODE_SWITCH
        : CODE_SWITCH, // chipmate_change - renamed from BUILD_SWITCH to CODE_SWITCH
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  // chipmate_change start - replace native Plan's separate prompt with the shared reminder above
  return input.messages
  // chipmate_change end
})

export * as SessionReminders from "./reminders"
