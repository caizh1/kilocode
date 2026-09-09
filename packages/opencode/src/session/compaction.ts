import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder" // chipmate_change
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"

import { Cause, Effect, Layer, Context, Semaphore } from "effect"
import * as DateTime from "effect/DateTime" // chipmate_change
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
// chipmate_change start
import { ChipMateSessionPromptQueue } from "@/chipmate/session/prompt-queue"
import { ChipMateCompactionPayloadRecovery } from "@/chipmate/session/compaction-payload-recovery"
import { ChipMateCompactionChunks } from "@/chipmate/session/compaction-chunks"
import { ChipMateCompactionDiagnostics } from "@/chipmate/session/compaction-diagnostics"
import { ChipMateCompactionStatus } from "@/chipmate/session/compaction-status"
import { ChipMatePartLifecycle } from "@/chipmate/session/part-lifecycle"
import { SessionExport } from "@/chipmate/session-export"
import { ChipMateSession } from "@/chipmate/session"
// chipmate_change end
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@opencode-ai/core/session/event" // chipmate_change
import { SessionMessage } from "@opencode-ai/core/session/message" // chipmate_change
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Database } from "@opencode-ai/core/database/database" // chipmate_change
import { buildPrompt } from "@opencode-ai/core/session/compaction"
import { SessionCompactionEvent } from "@opencode-ai/schema/session-compaction-event"

export const Event = SessionCompactionEvent

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000
type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

// chipmate_change start - allow safe pruning at cache-invalidating boundaries
export type PruneReason = "normal" | "post-compaction" | "payload-limit"
// chipmate_change end

function summaryText(message: SessionV1.WithParts) {
  const text = message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function completedCompactions(messages: SessionV1.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

// chipmate_change start
function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}
// chipmate_change end

function turns(messages: SessionV1.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: SessionV1.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: SessionV1.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID; reason?: PruneReason }) => Effect.Effect<void> // chipmate_change
  readonly process: (input: {
    parentID: MessageID
    messages: SessionV1.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service // chipmate_change

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: SessionV1.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({
        cfg: yield* config.get(),
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: SessionV1.WithParts[]
      cfg: ConfigV1.Info
      model: Provider.Model
    }) {
      const limit = input.cfg.compaction?.tail_turns ?? DEFAULT_TAIL_TURNS
      if (limit <= 0) return { head: input.messages, tail_start_id: undefined }
      // chipmate_change start
      const budget = preserveRecentBudget({
        cfg: input.cfg,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
      // chipmate_change end
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = all.slice(-limit)
      const sizes = yield* Effect.forEach(
        recent,
        (turn) =>
          estimate({
            messages: input.messages.slice(turn.start, turn.end),
            model: input.model,
          }),
        { concurrency: 1 },
      )

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        const size = sizes[i]
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) {
          yield* Effect.logInfo("tail fallback", { budget, size, total })
        }
        break
      }

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    // chipmate_change start - preserve normal opt-in pruning, but allow payload/compaction cleanup by default
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: {
      sessionID: SessionID
      reason?: PruneReason
    }) {
      const cfg = yield* config.get()
      const reason = input.reason ?? "normal"
      if (cfg.compaction?.prune === false) return
      if (reason === "normal" && cfg.compaction?.prune !== true) return
      yield* Effect.logInfo("pruning", { reason })

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      yield* Effect.logInfo("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { reason, count: toPrune.length })
      }
    })
    // chipmate_change end

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: SessionV1.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")
      const compactionStatus = ChipMateCompactionStatus.find(parent.parts) // chipmate_change

      let messages = input.messages
      let replay:
        | {
            info: SessionV1.User
            parts: SessionV1.Part[]
          }
        | undefined
      // chipmate_change start - false is preflight replay; undefined disables replay
      if (input.overflow !== undefined) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }
      // chipmate_change end

      const agent = yield* agents.get("compaction")
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie)
      const cfg = yield* config.get()
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      // chipmate_change start - manual compaction markers omit variant; inherit only an exact supported variant
      const requestedVariant =
        userMessage.model.variant ??
        history.findLast(
          (message): message is SessionV1.WithParts & { info: SessionV1.User } =>
            message.info.role === "user" && !message.parts.some((part) => part.type === "compaction"),
        )?.info.model.variant
      const selectedVariant = requestedVariant && model.variants?.[requestedVariant] ? requestedVariant : undefined
      // chipmate_change end
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const selected = yield* select({
        messages: history.filter((_, index) => !hidden.has(index)),
        cfg,
        model,
      })
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const nextPrompt = compacting.prompt ?? buildPrompt({ previousSummary, context: compacting.context })
      const msgs = structuredClone(selected.head)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, {
        stripMedia: true,
        toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
      })
      const tokens = Token.estimate(JSON.stringify(modelMessages)) // chipmate_change
      const tailIndex = selected.tail_start_id
        ? history.findIndex((message) => message.info.id === selected.tail_start_id)
        : -1
      const recent =
        tailIndex < 0
          ? ""
          : JSON.stringify(
              yield* MessageV2.toModelMessagesEffect(history.slice(tailIndex), model, {
                stripMedia: true,
                toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
              }),
            )
      const ctx = yield* InstanceState.context
      const msg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: selectedVariant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
      }
      yield* session.updateMessage(msg)
      // chipmate_change start - dynamically budget compaction and retry the full transaction without thinking
      const billingProvider = yield* provider.getProvider(model.providerID) // chipmate_change
      const billing = {
        baseURL: billingProvider.options.baseURL ?? model.api.url,
        apiKey: billingProvider.key ?? billingProvider.options.apiKey,
      }
      const progressLock = Semaphore.makeUnsafe(1)
      const updateProgress = (value: ChipMateCompactionStatus.Progress) =>
        progressLock
          .withPermits(1)(
            ChipMateCompactionStatus.progress({ part: compactionStatus, value, store: session }).pipe(Effect.asVoid),
          )
          .pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logWarning("compaction progress status update failed"),
            ),
          )
      const clearAttempt = Effect.fn("SessionCompaction.clearAttempt")(function* (
        baseline: Set<string>,
        variant: string | undefined,
      ) {
        const parts = yield* MessageV2.parts(msg.id)
        for (const part of parts) {
          if (baseline.has(part.id)) continue
          if (!["text", "reasoning", "step-start", "retry"].includes(part.type)) continue
          yield* session.removePart({ sessionID: input.sessionID, messageID: msg.id, partID: part.id })
        }
        msg.variant = variant
        msg.error = undefined
        msg.finish = undefined
        delete msg.time.completed
        yield* session.updateMessage(msg)
      })
      const runPass = (attempt: ChipMateCompactionChunks.Attempt, baseline: Set<string>) =>
        Effect.gen(function* () {
          const effectiveVariant = attempt.effectiveVariant
          yield* updateProgress({
            attempt: attempt.attempt,
            attemptMode: attempt.mode,
            phase: "preparing",
          })
          const passUser = structuredClone(userMessage)
          passUser.model.variant = effectiveVariant
          const passHead = structuredClone(selected.head)
          msg.variant = effectiveVariant
          msg.error = undefined
          msg.finish = undefined
          delete msg.time.completed
          yield* session.updateMessage(msg)

          const initialResult = ChipMateCompactionChunks.needed({
            cfg,
            model,
            tokens,
            outputTokenMax: flags.outputTokenMax,
          })
            ? ("compact" as const)
            : undefined
          let outcome: ChipMateCompactionChunks.AttemptResult
          let fallbackUsed = initialResult === "compact"
          if (initialResult === "compact") {
            outcome = { kind: "context_overflow" }
          } else {
            const request = [
              ...modelMessages,
              { role: "user" as const, content: [{ type: "text" as const, text: nextPrompt }] },
            ]
            const estimatedInputTokens = ChipMateCompactionChunks.adjustedTokens(
              Token.estimate(JSON.stringify(request)),
            )
            const available = ChipMateCompactionChunks.outputBudget({
              model,
              estimatedInputTokens,
              outputTokenMax: flags.outputTokenMax,
            })
            if (available.kind === "context_overflow") {
              outcome = { kind: "context_overflow" }
              fallbackUsed = true
            } else {
              yield* updateProgress({
                attempt: attempt.attempt,
                attemptMode: attempt.mode,
                phase: "generating",
              })
              const passModel = {
                ...model,
                limit: { ...model.limit, output: available.effectiveOutputTokenLimit },
              }
              const processor = yield* processors.create({
                assistantMessage: msg,
                sessionID: input.sessionID,
                model: passModel,
                billing,
              })
              const result = yield* ChipMateCompactionPayloadRecovery.process({
                processor,
                user: passUser,
                agent,
                sessionID: input.sessionID,
                model: passModel,
                messages: modelMessages,
                prompt: nextPrompt,
                recovery: passHead,
                updateMessage: session.updateMessage,
              }).pipe(Effect.provideService(Database.Service, database))
              const parts = yield* MessageV2.parts(msg.id)
              const error = processor.message.error ?? processor.compactError?.()
              outcome = ChipMateCompactionChunks.inspect({
                result,
                message: processor.message,
                parts,
                error,
                stage: "full",
              })
              const output = parts
                .filter((part): part is MessageV2.TextPart => part.type === "text")
                .map((part) => part.text.trim())
                .filter(Boolean)
                .join("\n\n")
              const reasoningChars = parts
                .filter((part): part is MessageV2.ReasoningPart => part.type === "reasoning")
                .reduce((total, part) => total + part.text.length, 0)
              const diagnostic = ChipMateCompactionDiagnostics.worker({
                sessionID: input.sessionID,
                compactionMessageID: msg.id,
                workerMessageID: msg.id,
                providerID: model.providerID,
                modelID: model.id,
                stage: "full",
                attempt: attempt.attempt,
                attemptMode: attempt.mode,
                selectedVariant: attempt.selectedVariant,
                effectiveVariant,
                estimatedInputTokens,
                requestedOutputTokenLimit: available.requestedOutputTokenLimit,
                effectiveOutputTokenLimit: available.effectiveOutputTokenLimit,
                capacityKnown: available.capacityKnown,
                fallbackReason: attempt.mode === "none" ? "selected_attempt_failed" : undefined,
                pipelineRestarted: attempt.attempt === 2,
                result,
                finish: processor.message.finish,
                textChars: output.length,
                reasoningChars,
                tokens: processor.message.tokens,
                error,
              })
              if (outcome.kind === "success") yield* Effect.logInfo("compaction_diag", diagnostic)
              else yield* Effect.logWarning("compaction_diag", diagnostic)
              if (outcome.kind === "context_overflow") fallbackUsed = true
            }
          }

          if (outcome.kind === "context_overflow") {
            yield* clearAttempt(baseline, effectiveVariant)
            outcome = yield* ChipMateCompactionChunks.process({
              processors,
              session,
              user: passUser,
              agent,
              sessionID: input.sessionID,
              model,
              cfg,
              outputTokenMax: flags.outputTokenMax,
              messages: passHead,
              prompt: nextPrompt,
              target: msg,
              billing,
              attempt,
              updateMessage: session.updateMessage,
              updatePart: session.updatePart,
              onProgress: (progress) => updateProgress(progress),
            }).pipe(Effect.provideService(Database.Service, database))
          }

          if (outcome.kind !== "success")
            return { outcome, baseline, initialResult: initialResult ?? "continue", fallbackUsed }
          let replayResult = replay ? structuredClone(replay) : undefined
          if (input.auto && replayResult) {
            const compacted = yield* ChipMateCompactionChunks.replay({
              processors,
              session,
              user: passUser,
              agent,
              sessionID: input.sessionID,
              model,
              cfg,
              outputTokenMax: flags.outputTokenMax,
              messages: passHead,
              prompt: nextPrompt,
              target: msg,
              billing,
              attempt,
              updateMessage: session.updateMessage,
              updatePart: session.updatePart,
              onProgress: (progress) => updateProgress(progress),
              replay: replayResult,
            }).pipe(Effect.provideService(Database.Service, database))
            if (compacted.kind !== "success") {
              return { outcome: compacted, baseline, initialResult: initialResult ?? "continue", fallbackUsed }
            }
            replayResult = compacted.value
          }
          return {
            outcome: {
              kind: "success" as const,
              value: {
                summary: outcome.value,
                replay: replayResult,
                persisted: initialResult !== "compact" && !fallbackUsed,
              },
            },
            baseline,
            initialResult: initialResult ?? "continue",
            fallbackUsed,
          }
        })

      const firstAttempt: ChipMateCompactionChunks.Attempt = {
        attempt: 1,
        mode: "selected",
        selectedVariant,
        effectiveVariant: selectedVariant,
      }
      const firstBaseline = new Set((yield* MessageV2.parts(msg.id)).map((part) => part.id))
      let pass = yield* runPass(firstAttempt, firstBaseline).pipe(
        Effect.onInterrupt(() => clearAttempt(firstBaseline, selectedVariant)),
      )
      let finalAttempt = firstAttempt
      if (ChipMateCompactionChunks.retryWithoutThinking(pass.outcome)) {
        const none = model.variants?.none
        if (none && selectedVariant !== "none") {
          yield* clearAttempt(pass.baseline, selectedVariant)
          yield* updateProgress({
            attempt: 2,
            attemptMode: "none",
            phase: "retrying",
          })
          const status = yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: input.sessionID,
            type: "text",
            text: "",
            synthetic: true,
            ignored: true,
            metadata: {
              [ChipMatePartLifecycle.key]: "transient",
              "chipmate.compaction.status": "retrying-without-thinking",
            },
          })
          finalAttempt = {
            attempt: 2,
            mode: "none",
            selectedVariant,
            effectiveVariant: "none",
          }
          const secondBaseline = new Set((yield* MessageV2.parts(msg.id)).map((part) => part.id))
          pass = yield* runPass(finalAttempt, secondBaseline).pipe(
            Effect.onInterrupt(() => clearAttempt(secondBaseline, "none")),
            Effect.ensuring(
              session
                .removePart({ sessionID: input.sessionID, messageID: msg.id, partID: status.id })
                .pipe(Effect.ignore),
            ),
          )
        }
      }

      const diagnose = (outcome: { finalResult: string; summary?: string; compactedEvent: boolean }) => {
        const error = msg.error
        const diagnostic = ChipMateCompactionDiagnostics.result({
          sessionID: input.sessionID,
          compactionMessageID: msg.id,
          providerID: model.providerID,
          modelID: model.id,
          auto: input.auto,
          overflow: input.overflow,
          initialResult: pass.initialResult,
          fallbackUsed: pass.fallbackUsed,
          finalResult: outcome.finalResult,
          finish: msg.finish,
          summaryTextChars: outcome.summary?.length ?? 0,
          error,
          boundaryEligible:
            msg.summary === true && !!outcome.summary && !!msg.finish && msg.finish !== "length" && !error,
          compactedEvent: outcome.compactedEvent,
          attempt: finalAttempt.attempt,
          attemptMode: finalAttempt.mode,
          selectedVariant,
          effectiveVariant: finalAttempt.effectiveVariant,
          fallbackReason: finalAttempt.mode === "none" ? "selected_attempt_failed" : undefined,
          pipelineRestarted: finalAttempt.attempt === 2,
          finalCommitted: outcome.compactedEvent,
          durationMs: Math.max(0, Date.now() - msg.time.created),
        })
        if (error || !outcome.summary || !diagnostic.boundaryEligible) {
          return Effect.logWarning("compaction_diag", diagnostic)
        }
        return Effect.logInfo("compaction_diag", diagnostic)
      }
      if (pass.outcome.kind !== "success") {
        yield* clearAttempt(pass.baseline, finalAttempt.effectiveVariant)
        msg.error =
          pass.outcome.kind === "context_overflow"
            ? new SessionV1.ContextOverflowError({
                message:
                  pass.outcome.rejectionReason === "minimal_unit"
                    ? `Compaction ${pass.outcome.stage ?? (replay ? "replay" : "chunk")} input contains a minimal unit that still exceeds the model context limit`
                    : `Compaction ${pass.outcome.stage ?? (replay ? "replay" : "chunk")} input still exceeds the model context limit after deterministic splitting`,
              }).toObject()
            : pass.outcome.kind === "reasoning_exhausted"
              ? new MessageV2.APIError({
                  message:
                    finalAttempt.mode === "none"
                      ? "Compaction failed again after retrying with thinking disabled"
                      : selectedVariant === "none"
                        ? "Compaction reasoning exhausted the output budget while thinking was already disabled"
                        : "Compaction reasoning exhausted the output budget, but this model has no none variant",
                  isRetryable: false,
                }).toObject()
              : pass.outcome.error
        msg.finish = "error"
        msg.time.completed = Date.now()
        yield* session.updateMessage(msg)
        yield* ChipMateCompactionStatus.transition({
          part: compactionStatus,
          state: "failed",
          store: session,
        }) // chipmate_change
        yield* diagnose({ finalResult: pass.outcome.kind, compactedEvent: false })
        return "stop"
      }

      yield* updateProgress({
        attempt: finalAttempt.attempt,
        attemptMode: finalAttempt.mode,
        phase: "committing",
      })
      const result = pass.outcome.value
      replay = result.replay
      if (!result.persisted) {
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          text: result.summary,
        })
      }
      msg.variant = finalAttempt.effectiveVariant
      msg.finish = "stop"
      msg.error = undefined
      msg.time.completed = Date.now()
      yield* session.updateMessage(msg)
      const fallback = "continue" as const
      // chipmate_change end

      if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
        yield* session.updatePart({
          ...compactionPart,
          tail_start_id: selected.tail_start_id,
        })
      }

      // chipmate_change start
      if (fallback === "continue" && input.auto) {
        // chipmate_change end
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          ChipMateSessionPromptQueue.retarget(input.sessionID, replayMsg.id) // chipmate_change - expose replay to scope()
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            // chipmate_change start - preserve media for preflight replay but strip it after provider overflow
            const replayPart =
              input.overflow && part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
            // chipmate_change end
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider
                  .getModel(userMessage.model.providerID, userMessage.model.modelID)
                  .pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            ChipMateSessionPromptQueue.retarget(input.sessionID, continueMsg.id) // chipmate_change - expose auto-continue to scope()
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (fallback === "continue") {
        const summary = summaryText(
          (yield* session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)).find(
            (item) => item.info.id === msg.id,
          ) ?? {
            info: msg,
            parts: [],
          },
        )
        if (flags.experimentalEventSystem) {
          if (summary)
            yield* events.publish(SessionEvent.Compaction.Ended, {
              sessionID: input.sessionID,
              messageID: SessionMessage.ID.make(input.parentID),
              timestamp: DateTime.makeUnsafe(Date.now()),
              reason: input.auto ? "auto" : "manual",
              text: summary ?? "",
              recent,
              include: recent, // chipmate_change - released Core V2 readers recognize this field
            })
        }
        // chipmate_change start - export self-contained compaction capture
        const parent = ChipMateSession.resolveParent(input.sessionID)
        const found = ChipMateSession.resolveRoot(input.sessionID)
        const root = parent ? (found === input.sessionID ? parent : found) : input.sessionID
        const workspace = yield* InstanceState.context
        SessionExport.compaction({
          sessionId: input.sessionID,
          rootSessionId: root,
          parentSessionId: parent,
          requestId: msg.id,
          workspaceKey: workspace.directory,
          input: {
            inputMessagesSnapshot: modelMessages,
            selectedContext: selected.head,
            previousSummary,
            prompt: nextPrompt,
            tailStartId: selected.tail_start_id,
          },
          output: {
            summary: summary ?? "",
            assistantMessageId: msg.id,
          },
          modelId: model.id,
          durationMs: Math.max(0, Date.now() - msg.time.created),
          usage: {
            inputTokens: msg.tokens.input,
            outputTokens: msg.tokens.output,
          },
        })
        // chipmate_change end
        yield* prune({ sessionID: input.sessionID, reason: "post-compaction" })
        yield* events.publish(Event.Compacted, { sessionID: input.sessionID })
        yield* ChipMateCompactionStatus.transition({
          part: compactionStatus,
          state: "succeeded",
          store: session,
        }).pipe(Effect.uninterruptible) // chipmate_change - committed compaction must retain success across a later abort
        yield* diagnose({ finalResult: fallback, summary, compactedEvent: true }) // chipmate_change
      }
      if (fallback !== "continue") yield* diagnose({ finalResult: fallback, compactedEvent: false }) // chipmate_change
      return fallback
      // chipmate_change end
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
      // chipmate_change start - keep auto-compaction markers visible during queued turns
      yield* session.updatePart(
        ChipMateCompactionStatus.create({
          sessionID: msg.sessionID,
          messageID: msg.id,
          source: input.auto ? "auto" : "manual",
        }),
      )
      ChipMateSessionPromptQueue.retarget(input.sessionID, msg.id)
      // chipmate_change end
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Compaction.Started, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.make(msg.id),
          timestamp: DateTime.makeUnsafe(Date.now()),
          reason: input.auto ? "auto" : "manual",
        })
      }
    })

    return Service.of({
      isOverflow,
      prune,
      process: (input) => {
        // chipmate_change start - persist the real terminal outcome without changing official abort semantics
        const parent = input.messages.findLast((message) => message.info.id === input.parentID)
        const status = ChipMateCompactionStatus.find(parent?.parts ?? [])
        const transition = (state: "failed" | "interrupted") =>
          ChipMateCompactionStatus.transition({ part: status, state, store: session }).pipe(Effect.ignore)
        return processCompaction(input).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : transition("failed").pipe(Effect.andThen(Effect.failCause(cause))),
          ),
          Effect.onInterrupt(() => transition("interrupted")),
          Effect.provideService(Database.Service, database),
          Effect.orDie,
        )
        // chipmate_change end
      },
      create,
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() => AppNodeBuilder.build(node)) // chipmate_change - build from the LayerNode graph

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Config.node,
    Session.node,
    Agent.node,
    Plugin.node,
    SessionProcessor.node,
    Provider.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
    Database.node, // chipmate_change
  ],
})

export * as SessionCompaction from "./compaction"
