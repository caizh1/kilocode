import { Effect, Semaphore } from "effect"
import type { Agent } from "@/agent/agent"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import type { SessionProcessor } from "@/session/processor"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@opencode-ai/core/database/database"
import { ChipMateCompactionDiagnostics } from "./compaction-diagnostics"

type Update = <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
type UpdateMessage = <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>

const log = Log.create({ service: "chipmate.compaction.chunks" })
const TOOL_OUTPUT_MAX_CHARS = 2_000
const TRANSCRIPT_FRAGMENT_CHARS = 8_000
const RATIO = 0.6
const CHUNK_TOKENS = 48_000
const CONCURRENCY = 3
const DEPTH = 3
const ESTIMATE_RATIO = 1.3
const OUTPUT_SAFETY = 2_048
const MIN_OUTPUT = 1_024

export namespace ChipMateCompactionChunks {
  export type Stage = "full" | "chunk" | "reduce" | "replay"
  export type AttemptMode = "selected" | "none"

  export type Attempt = {
    attempt: 1 | 2
    mode: AttemptMode
    selectedVariant?: string
    effectiveVariant?: string
  }

  export type Progress = {
    attempt: 1 | 2
    attemptMode: AttemptMode
    phase: "chunk" | "reduce" | "replay"
    completedUnits: number
    totalUnits: number
    reduceDepth?: number
    activity?: "splitting"
  }

  export type AttemptResult<T = string> =
    | { kind: "success"; value: T }
    | {
        kind: "reasoning_exhausted"
        stage: Stage
        finish: "length"
        textChars: number
        reasoningChars: number
      }
    | {
        kind: "context_overflow"
        stage?: Stage
        rejectionReason?: "input_limit" | "unknown_capacity_cap" | "insufficient_headroom" | "minimal_unit"
        error?: MessageV2.Assistant["error"]
      }
    | { kind: "incomplete"; error: MessageV2.Assistant["error"] }
    | { kind: "failure"; error: MessageV2.Assistant["error"] }

  export function retryWithoutThinking(input: AttemptResult<unknown>) {
    return input.kind === "reasoning_exhausted" || input.kind === "context_overflow" || input.kind === "incomplete"
  }

  type Chunk = {
    index: number
    messages: MessageV2.WithParts[]
  }

  type Atom = {
    prefix: string
    content: string
    suffix: string
    splitDepth: number
  }

  type Prepared = {
    kind: "prepared"
    atoms: Atom[]
    data: LLM.StreamInput["messages"]
    text: string
    estimatedInputTokens: number
    inputBudget: number
    requestedOutputTokenLimit: number
    effectiveOutputTokenLimit: number
    capacityKnown: boolean
    splitDepth: number
  }

  type Output = AttemptResult

  type Deps = {
    processors: SessionProcessor.Interface
    session: Pick<Session.Interface, "updateMessage" | "updatePart" | "removeMessage">
  }

  type Input = Deps & {
    user: MessageV2.User
    agent: Agent.Info
    sessionID: SessionID
    model: Provider.Model
    cfg: Config.Info
    messages: MessageV2.WithParts[]
    prompt: string
    target: MessageV2.Assistant
    outputTokenMax?: number
    billing?: { baseURL: unknown; apiKey: unknown }
    attempt: Attempt
    updateMessage: UpdateMessage
    updatePart: Update
    onProgress?: (progress: Progress) => Effect.Effect<void>
  }

  export type Replay = {
    info: MessageV2.User
    parts: MessageV2.Part[]
  }

  export function eligible(input: { result: SessionProcessor.Result; error: MessageV2.Assistant["error"] }) {
    if (input.result === "compact") return true
    return input.result === "stop" && input.error?.name === "ContextOverflowError"
  }

  export function needed(input: { cfg: Config.Info; model: Provider.Model; tokens: number; outputTokenMax?: number }) {
    const estimated = adjustedTokens(input.tokens)
    const requested = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
    const context = input.model.limit.context
    const limit = input.model.limit.input
    if (limit && estimated > limit) return true
    if (!context) return estimated > budget(input)
    return estimated + requested + OUTPUT_SAFETY > context
  }

  export function replay(
    input: Input & { replay: Replay },
  ): Effect.Effect<AttemptResult<Replay>, never, Database.Service> {
    return Effect.gen(function* () {
      const messages = [{ info: input.replay.info, parts: input.replay.parts }]
      const size = budget({ cfg: input.cfg, model: input.model, outputTokenMax: input.outputTokenMax })
      if (!(yield* large({ messages, model: input.model, size }))) {
        return { kind: "success", value: input.replay } as const
      }
      const planned = yield* plan({
        ...input,
        atoms: atoms({ messages }),
        stage: "replay",
        final: "Create one compact representation of the replayed user request. Preserve every concrete requirement.",
      })
      if (planned.kind !== "success") return planned
      const partial = yield* execute({ ...input, prepared: planned.value, stage: "replay" })
      if (partial.kind !== "success") return partial
      const result = yield* reduce({
        ...input,
        summaries: partial.value,
        depth: 0,
        final: "Create one compact representation of the replayed user request. Preserve every concrete requirement.",
      })
      if (result.kind !== "success") return result
      return {
        kind: "success",
        value: {
          info: input.replay.info,
          parts: [
            {
              id: PartID.ascending(),
              messageID: input.replay.info.id,
              sessionID: input.sessionID,
              type: "text" as const,
              synthetic: true,
              text: [
                "The original replayed request was too large to send after compaction.",
                "Use this compacted representation of that request instead:",
                result.value,
              ].join("\n\n"),
            },
          ],
        },
      } as const
    })
  }

  export function budget(input: { cfg: Config.Info; model: Provider.Model; outputTokenMax?: number }) {
    const windows = [input.model.limit.context, input.model.limit.input].filter(
      (value): value is number => typeof value === "number" && value > 0,
    )
    if (windows.length === 0) return CHUNK_TOKENS
    return Math.max(1, Math.min(Math.floor(Math.min(...windows) * RATIO), CHUNK_TOKENS))
  }

  function model(input: Provider.Model, output: number) {
    return {
      ...input,
      limit: {
        ...input.limit,
        output,
      },
    } satisfies Provider.Model
  }

  export function adjustedTokens(tokens: number) {
    return Math.ceil(tokens * ESTIMATE_RATIO)
  }

  export function outputBudget(input: {
    model: Provider.Model
    estimatedInputTokens: number
    outputTokenMax?: number
  }) {
    const requestedOutputTokenLimit = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
    const context = input.model.limit.context
    const limit = input.model.limit.input
    const capacityKnown = context > 0 || !!limit
    if (limit && input.estimatedInputTokens > limit) {
      return {
        kind: "context_overflow" as const,
        requestedOutputTokenLimit,
        capacityKnown,
        rejectionReason: "input_limit" as const,
      }
    }
    if (!context) {
      if (!limit && input.estimatedInputTokens > CHUNK_TOKENS) {
        return {
          kind: "context_overflow" as const,
          requestedOutputTokenLimit,
          capacityKnown,
          rejectionReason: "unknown_capacity_cap" as const,
        }
      }
      return {
        kind: "available" as const,
        requestedOutputTokenLimit,
        effectiveOutputTokenLimit: requestedOutputTokenLimit,
        capacityKnown,
      }
    }
    const available = context - input.estimatedInputTokens - OUTPUT_SAFETY
    if (available < Math.min(MIN_OUTPUT, requestedOutputTokenLimit)) {
      return {
        kind: "context_overflow" as const,
        requestedOutputTokenLimit,
        capacityKnown,
        rejectionReason: "insufficient_headroom" as const,
      }
    }
    return {
      kind: "available" as const,
      requestedOutputTokenLimit,
      effectiveOutputTokenLimit: Math.min(requestedOutputTokenLimit, available),
      capacityKnown,
    }
  }

  function large(input: { messages: MessageV2.WithParts[]; model: Provider.Model; size: number }) {
    return estimate({ messages: input.messages, model: input.model }).pipe(Effect.map((count) => count > input.size))
  }

  function estimate(input: { messages: MessageV2.WithParts[]; model: Provider.Model }) {
    return Effect.gen(function* () {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model, {
        stripMedia: true,
        toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
      })
      return adjustedTokens(Token.estimate(JSON.stringify(msgs)))
    })
  }

  export function split(input: { messages: MessageV2.WithParts[]; model: Provider.Model; size: number }) {
    return Effect.gen(function* () {
      const chunks: Chunk[] = []
      let buf: MessageV2.WithParts[] = []
      for (const msg of input.messages) {
        const next = [...buf, msg]
        const size = yield* estimate({ messages: next, model: input.model })
        if (buf.length && size > input.size) {
          chunks.push({ index: chunks.length, messages: buf })
          buf = [msg]
          continue
        }
        buf = next
      }
      if (buf.length) chunks.push({ index: chunks.length, messages: buf })
      return chunks
    })
  }

  function text(msg: MessageV2.Assistant, parts: MessageV2.Part[]) {
    return parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && part.messageID === msg.id)
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim()
  }

  function reasoning(parts: MessageV2.Part[]) {
    return parts
      .filter((part): part is MessageV2.ReasoningPart => part.type === "reasoning")
      .reduce((total, part) => total + part.text.length, 0)
  }

  export function inspect(input: {
    result: SessionProcessor.Result
    message: MessageV2.Assistant
    parts: MessageV2.Part[]
    error?: MessageV2.Assistant["error"]
    stage: Stage
  }): AttemptResult {
    const output = text(input.message, input.parts)
    const reasoningChars = reasoning(input.parts)
    const error = input.error
    if (error && error.name !== "ContextOverflowError") return { kind: "failure", error }
    if (input.message.finish === "length") {
      if (reasoningChars > 0) {
        return {
          kind: "reasoning_exhausted",
          stage: input.stage,
          finish: "length",
          textChars: output.length,
          reasoningChars,
        }
      }
      return {
        kind: "incomplete",
        error: new MessageV2.APIError({
          message: "Compaction response reached the output limit; incomplete summary was discarded",
          isRetryable: false,
        }).toObject(),
      }
    }
    if (input.result === "compact" || error?.name === "ContextOverflowError") {
      return { kind: "context_overflow", error }
    }
    if (input.result !== "continue") {
      return {
        kind: "incomplete",
        error:
          error ??
          new MessageV2.APIError({
            message: "Compaction worker stopped without a usable response",
            isRetryable: false,
          }).toObject(),
      }
    }
    if (!input.message.finish) {
      return {
        kind: "incomplete",
        error: new MessageV2.APIError({
          message: "Compaction worker returned without a finish reason",
          isRetryable: false,
        }).toObject(),
      }
    }
    if (!output) {
      return {
        kind: "incomplete",
        error: new MessageV2.APIError({
          message: "Compaction worker returned an empty response",
          isRetryable: false,
        }).toObject(),
      }
    }
    return { kind: "success", value: output }
  }

  function clip(input: { text: string; chars: number; label: string }) {
    if (input.text.length <= input.chars) return input.text
    const cut = input.text.length - input.chars
    return `${input.text.slice(0, input.chars)}\n[${input.label} truncated for compaction: omitted ${cut} chars]`
  }

  function serialize(part: MessageV2.Part) {
    if (part.type === "text" || part.type === "reasoning") return part.text
    if (part.type === "file") return `[File attachment]: ${part.filename ?? "attachment"} (${part.mime})`
    if (part.type === "agent") return `[Agent]: ${part.name}`
    if (part.type === "subtask") return `[Subtask ${part.agent}]: ${part.description}\n${part.prompt}`
    if (part.type === "tool") {
      const head = `[Tool ${part.tool} ${part.state.status}]`
      if (part.state.status === "completed") {
        return [
          head,
          `input: ${clip({ text: JSON.stringify(part.state.input), chars: TOOL_OUTPUT_MAX_CHARS, label: "Tool input" })}`,
          `output: ${clip({ text: part.state.output, chars: TOOL_OUTPUT_MAX_CHARS, label: "Tool output" })}`,
        ].join("\n")
      }
      if (part.state.status === "error")
        return `${head}\n${clip({ text: part.state.error, chars: TOOL_OUTPUT_MAX_CHARS, label: "Tool error" })}`
      return `${head}\ninput: ${clip({ text: JSON.stringify(part.state.input), chars: TOOL_OUTPUT_MAX_CHARS, label: "Tool input" })}`
    }
    if (part.type === "step-finish") return `[Step finished]: ${part.reason}`
    if (part.type === "compaction") return "[Compaction requested]"
    return `[${part.type}]`
  }

  function fragments(value: string, chars = TRANSCRIPT_FRAGMENT_CHARS) {
    if (!value) return [""]
    const points = Array.from(value)
    if (points.length <= chars) return [value]
    const result: string[] = []
    let offset = 0
    while (points.length - offset > chars) {
      const candidate = points.slice(offset, offset + chars).join("")
      const paragraph = candidate.lastIndexOf("\n\n")
      const newline = candidate.lastIndexOf("\n")
      const boundary =
        paragraph >= candidate.length / 2 ? paragraph + 2 : newline >= candidate.length / 2 ? newline + 1 : -1
      const head = boundary > 0 ? candidate.slice(0, boundary) : candidate
      result.push(head)
      offset += Array.from(head).length
    }
    result.push(points.slice(offset).join(""))
    return result
  }

  function atoms(input: { messages: MessageV2.WithParts[] }) {
    return input.messages.flatMap((message, messageIndex) => {
      if (!message.parts.length) {
        return [
          {
            prefix: `<message index="${messageIndex + 1}" role="${message.info.role}">`,
            content: "[no content]",
            suffix: "</message>",
            splitDepth: 0,
          },
        ]
      }
      return message.parts.flatMap((value, partIndex) => {
        const pieces = fragments(serialize(value))
        return pieces.map((piece, fragmentIndex) => ({
          prefix: [
            `<message index="${messageIndex + 1}" role="${message.info.role}" continuation="${fragmentIndex + 1}/${pieces.length}">`,
            `<part index="${partIndex + 1}" type="${value.type}">`,
          ].join("\n"),
          content: piece,
          suffix: ["</part>", "</message>"].join("\n"),
          splitDepth: 0,
        }))
      })
    })
  }

  function prompt(input: { chunk: Chunk; total: number }) {
    return [
      `Summarize conversation chunk ${input.chunk.index + 1} of ${input.total}.`,
      "Only summarize facts present in this chunk.",
      "Preserve concrete file paths, commands, errors, decisions, and unresolved tasks.",
      "Use terse Markdown bullets. Do not mention chunking or compaction.",
    ].join("\n")
  }

  function summaryAtoms(input: { summaries: string[] }) {
    return input.summaries.flatMap((summary, index) =>
      fragments(summary).map((piece, fragmentIndex, pieces) => ({
        prefix: `<partial-summary index="${index + 1}" continuation="${fragmentIndex + 1}/${pieces.length}">`,
        content: piece,
        suffix: "</partial-summary>",
        splitDepth: 0,
      })),
    )
  }

  function data(input: { atoms: Atom[] }) {
    return [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: [
              "The following transcript fragments preserve the original order and continuation markers.",
              "Summarize only facts present in these fragments.",
              "<conversation>",
              input.atoms.map((atom) => [atom.prefix, atom.content, atom.suffix].join("\n")).join("\n\n"),
              "</conversation>",
            ].join("\n"),
          },
        ],
      },
    ] satisfies LLM.StreamInput["messages"]
  }

  function requestText(input: { stage: "chunk" | "reduce" | "replay"; index: number; total: number; final: string }) {
    if (input.stage === "reduce") return input.final
    return prompt({ chunk: { index: input.index, messages: [] }, total: input.total })
  }

  function prepare(
    input: Input & {
      atoms: Atom[]
      stage: "chunk" | "reduce" | "replay"
      index: number
      total: number
      final: string
    },
  ):
    | Prepared
    | {
        kind: "context_overflow"
        estimatedInputTokens: number
        requestedOutputTokenLimit: number
        capacityKnown: boolean
        rejectionReason: "input_limit" | "unknown_capacity_cap" | "insufficient_headroom"
      } {
    const value = data({ atoms: input.atoms })
    const text = requestText(input)
    const request = [...value, { role: "user" as const, content: [{ type: "text" as const, text }] }]
    const estimatedInputTokens = adjustedTokens(Token.estimate(JSON.stringify(request)))
    const inputBudget = budget(input)
    const available = outputBudget({ model: input.model, estimatedInputTokens, outputTokenMax: input.outputTokenMax })
    if (available.kind === "context_overflow") {
      return {
        kind: "context_overflow",
        estimatedInputTokens,
        requestedOutputTokenLimit: available.requestedOutputTokenLimit,
        capacityKnown: available.capacityKnown,
        rejectionReason: available.rejectionReason,
      }
    }
    if (estimatedInputTokens > inputBudget) {
      return {
        kind: "context_overflow",
        estimatedInputTokens,
        requestedOutputTokenLimit: available.requestedOutputTokenLimit,
        capacityKnown: available.capacityKnown,
        rejectionReason: available.capacityKnown ? "input_limit" : "unknown_capacity_cap",
      }
    }
    return {
      kind: "prepared",
      atoms: input.atoms,
      data: value,
      text,
      estimatedInputTokens,
      inputBudget,
      requestedOutputTokenLimit: available.requestedOutputTokenLimit,
      effectiveOutputTokenLimit: available.effectiveOutputTokenLimit,
      capacityKnown: available.capacityKnown,
      splitDepth: Math.max(0, ...input.atoms.map((atom) => atom.splitDepth)),
    }
  }

  function divide(atom: Atom) {
    const points = Array.from(atom.content)
    if (points.length <= 1) return undefined
    const middle = Math.ceil(points.length / 2)
    return [
      {
        prefix: `${atom.prefix}\n<subfragment continuation="1/2">`,
        content: points.slice(0, middle).join(""),
        suffix: `</subfragment>\n${atom.suffix}`,
        splitDepth: atom.splitDepth + 1,
      },
      {
        prefix: `${atom.prefix}\n<subfragment continuation="2/2">`,
        content: points.slice(middle).join(""),
        suffix: `</subfragment>\n${atom.suffix}`,
        splitDepth: atom.splitDepth + 1,
      },
    ] satisfies Atom[]
  }

  function preflight(
    input: Input & {
      stage: "chunk" | "reduce" | "replay"
      index?: number
      total?: number
      depth?: number
      splitDepth: number
      estimatedInputTokens: number
      inputBudget: number
      requestedOutputTokenLimit: number
      effectiveOutputTokenLimit?: number
      capacityKnown: boolean
      requestDispatched: boolean
      splitReason?: "local_preflight" | "provider_context_overflow"
      rejectionReason?: "input_limit" | "unknown_capacity_cap" | "insufficient_headroom" | "minimal_unit"
    },
  ) {
    return ChipMateCompactionDiagnostics.workerPreflight({
      sessionID: input.sessionID,
      compactionMessageID: input.target.id,
      providerID: input.model.providerID,
      modelID: input.model.id,
      stage: input.stage,
      chunkIndex: input.index,
      chunkCount: input.total,
      depth: input.depth,
      splitDepth: input.splitDepth,
      attempt: input.attempt.attempt,
      attemptMode: input.attempt.mode,
      estimatedInputTokens: input.estimatedInputTokens,
      inputBudget: input.inputBudget,
      requestedOutputTokenLimit: input.requestedOutputTokenLimit,
      effectiveOutputTokenLimit: input.effectiveOutputTokenLimit,
      capacityKnown: input.capacityKnown,
      requestDispatched: input.requestDispatched,
      splitReason: input.splitReason,
      rejectionReason: input.rejectionReason,
    })
  }

  function plan(input: Input & { atoms: Atom[]; stage: "chunk" | "reduce" | "replay"; final: string; depth?: number }) {
    return Effect.sync(() => {
      const source = [...input.atoms]
      const groups: Atom[][] = []
      let group: Atom[] = []
      for (let index = 0; index < source.length; ) {
        const atom = source[index]!
        const candidate = [...group, atom]
        const checked = prepare({ ...input, atoms: candidate, index: source.length - 1, total: source.length })
        if (checked.kind === "prepared") {
          group = candidate
          index++
          continue
        }
        if (group.length) {
          groups.push(group)
          group = []
          continue
        }
        const parts = divide(atom)
        log.warn(
          "compaction_diag",
          preflight({
            ...input,
            index: groups.length,
            total: source.length,
            splitDepth: atom.splitDepth,
            estimatedInputTokens: checked.estimatedInputTokens,
            inputBudget: budget(input),
            requestedOutputTokenLimit: checked.requestedOutputTokenLimit,
            capacityKnown: checked.capacityKnown,
            requestDispatched: false,
            splitReason: "local_preflight",
            rejectionReason: parts ? checked.rejectionReason : "minimal_unit",
          }),
        )
        if (!parts) {
          return { kind: "context_overflow" as const, stage: input.stage, rejectionReason: "minimal_unit" as const }
        }
        source.splice(index, 1, ...parts)
      }
      if (group.length) groups.push(group)

      for (;;) {
        const prepared = groups.map((atoms, index) => prepare({ ...input, atoms, index, total: groups.length }))
        const rejected = prepared.findIndex((item) => item.kind === "context_overflow")
        if (rejected < 0) return { kind: "success" as const, value: prepared as Prepared[] }
        const value = prepared[rejected]!
        if (value.kind !== "context_overflow") continue
        const atoms = groups[rejected]!
        log.warn(
          "compaction_diag",
          preflight({
            ...input,
            index: rejected,
            total: groups.length,
            splitDepth: Math.max(0, ...atoms.map((atom) => atom.splitDepth)),
            estimatedInputTokens: value.estimatedInputTokens,
            inputBudget: budget(input),
            requestedOutputTokenLimit: value.requestedOutputTokenLimit,
            capacityKnown: value.capacityKnown,
            requestDispatched: false,
            splitReason: "local_preflight",
            rejectionReason: value.rejectionReason,
          }),
        )
        if (atoms.length > 1) {
          const middle = Math.ceil(atoms.length / 2)
          groups.splice(rejected, 1, atoms.slice(0, middle), atoms.slice(middle))
          continue
        }
        const parts = divide(atoms[0]!)
        if (!parts)
          return { kind: "context_overflow" as const, stage: input.stage, rejectionReason: "minimal_unit" as const }
        groups.splice(rejected, 1, parts)
      }
    })
  }

  function assistant(input: { base: MessageV2.Assistant; sessionID: SessionID }) {
    return {
      ...input.base,
      id: MessageID.ascending(),
      parentID: input.base.parentID,
      sessionID: input.sessionID,
      cost: 0,
      tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
      finish: undefined,
      error: undefined,
    } satisfies MessageV2.Assistant
  }

  function run(
    input: Input & {
      prepared: Prepared
      diagnostic: { stage: "chunk" | "reduce" | "replay"; chunkIndex?: number; chunkCount?: number; depth?: number }
    },
  ) {
    return Effect.gen(function* () {
      const messages = [
        ...input.prepared.data,
        { role: "user" as const, content: [{ type: "text" as const, text: input.prepared.text }] },
      ]
      log.info(
        "compaction_diag",
        preflight({
          ...input,
          stage: input.diagnostic.stage,
          index: input.diagnostic.chunkIndex,
          total: input.diagnostic.chunkCount,
          depth: input.diagnostic.depth,
          splitDepth: input.prepared.splitDepth,
          estimatedInputTokens: input.prepared.estimatedInputTokens,
          inputBudget: input.prepared.inputBudget,
          requestedOutputTokenLimit: input.prepared.requestedOutputTokenLimit,
          effectiveOutputTokenLimit: input.prepared.effectiveOutputTokenLimit,
          capacityKnown: input.prepared.capacityKnown,
          requestDispatched: true,
        }),
      )
      const msg = yield* input.session.updateMessage(assistant({ base: input.target, sessionID: input.sessionID }))
      const mdl = model(input.model, input.prepared.effectiveOutputTokenLimit)
      const worker = yield* input.processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model: mdl,
        billing: input.billing,
      })
      const opts = input.agent.options
      // agent.options feeds into providerOptions; strip maxOutputTokens
      // so it does not leak into the wire body. The output cap is enforced
      // independently via the constrained model and llm.ts re-cap.
      const agent = {
        ...input.agent,
        options: Object.fromEntries(Object.entries(opts ?? {}).filter(([key]) => key !== "maxOutputTokens")),
      }
      const out = yield* Effect.gen(function* () {
        const result = yield* worker.process({
          user: input.user,
          agent,
          sessionID: input.sessionID,
          tools: {},
          system: [],
          messages,
          model: mdl,
        })
        const parts = yield* MessageV2.parts(worker.message.id)
        const output = text(worker.message, parts)
        const error = worker.message.error ?? worker.compactError?.()
        const inspected = inspect({
          result,
          message: worker.message,
          parts,
          error,
          stage: input.diagnostic.stage,
        })
        const diagnostic = ChipMateCompactionDiagnostics.worker({
          sessionID: input.sessionID,
          compactionMessageID: input.target.id,
          workerMessageID: worker.message.id,
          providerID: mdl.providerID,
          modelID: mdl.id,
          stage: input.diagnostic.stage,
          chunkIndex: input.diagnostic.chunkIndex,
          chunkCount: input.diagnostic.chunkCount,
          depth: input.diagnostic.depth,
          attempt: input.attempt.attempt,
          attemptMode: input.attempt.mode,
          selectedVariant: input.attempt.selectedVariant,
          effectiveVariant: input.attempt.effectiveVariant,
          estimatedInputTokens: input.prepared.estimatedInputTokens,
          requestedOutputTokenLimit: input.prepared.requestedOutputTokenLimit,
          effectiveOutputTokenLimit: mdl.limit.output,
          capacityKnown: input.prepared.capacityKnown,
          fallbackReason: input.attempt.mode === "none" ? "selected_attempt_failed" : undefined,
          pipelineRestarted: input.attempt.attempt === 2,
          result,
          finish: worker.message.finish,
          textChars: output.length,
          reasoningChars: reasoning(parts),
          tokens: worker.message.tokens,
          error,
        })
        if (inspected.kind !== "success") log.warn("compaction_diag", diagnostic)
        else log.info("compaction_diag", diagnostic)
        return inspected.kind === "context_overflow" ? { ...inspected, stage: input.diagnostic.stage } : inspected
      }).pipe(
        Effect.ensuring(
          input.session.removeMessage({ sessionID: input.sessionID, messageID: worker.message.id }).pipe(Effect.ignore),
        ),
      )
      return out
    })
  }

  function failed<T>(outputs: AttemptResult<T>[]) {
    return (
      outputs.find((output) => output.kind === "failure") ??
      outputs.find((output) => output.kind === "reasoning_exhausted") ??
      outputs.find((output) => output.kind === "incomplete") ??
      outputs.find((output) => output.kind === "context_overflow")
    )
  }

  function recover(
    input: Input & {
      prepared: Prepared
      stage: "chunk" | "reduce" | "replay"
      index: number
      total: number
      depth?: number
      onSplit?: () => Effect.Effect<void>
    },
  ): Effect.Effect<AttemptResult<string[]>, never, Database.Service> {
    return Effect.gen(function* () {
      const result = yield* run({
        ...input,
        prepared: input.prepared,
        diagnostic: { stage: input.stage, chunkIndex: input.index, chunkCount: input.total, depth: input.depth },
      })
      if (result.kind === "success") return { kind: "success", value: [result.value] } as const
      if (result.kind !== "context_overflow" || input.prepared.capacityKnown) return result
      const groups =
        input.prepared.atoms.length > 1
          ? [
              input.prepared.atoms.slice(0, Math.ceil(input.prepared.atoms.length / 2)),
              input.prepared.atoms.slice(Math.ceil(input.prepared.atoms.length / 2)),
            ]
          : divide(input.prepared.atoms[0]!)?.map((atom) => [atom])
      if (!groups) {
        log.warn(
          "compaction_diag",
          preflight({
            ...input,
            splitDepth: input.prepared.splitDepth,
            estimatedInputTokens: input.prepared.estimatedInputTokens,
            inputBudget: input.prepared.inputBudget,
            requestedOutputTokenLimit: input.prepared.requestedOutputTokenLimit,
            effectiveOutputTokenLimit: input.prepared.effectiveOutputTokenLimit,
            capacityKnown: false,
            requestDispatched: false,
            splitReason: "provider_context_overflow",
            rejectionReason: "minimal_unit",
          }),
        )
        return {
          kind: "context_overflow",
          stage: input.stage,
          rejectionReason: "minimal_unit",
          error: result.error,
        } as const
      }
      const children: Prepared[] = []
      for (let index = 0; index < groups.length; index++) {
        const value = prepare({
          ...input,
          atoms: groups[index]!,
          index,
          total: groups.length,
          final: input.prepared.text,
        })
        if (value.kind === "context_overflow")
          return {
            kind: "context_overflow",
            stage: input.stage,
            rejectionReason: value.rejectionReason,
            error: result.error,
          }
        children.push({ ...value, splitDepth: input.prepared.splitDepth + 1 })
      }
      log.warn(
        "compaction_diag",
        preflight({
          ...input,
          splitDepth: input.prepared.splitDepth,
          estimatedInputTokens: input.prepared.estimatedInputTokens,
          inputBudget: input.prepared.inputBudget,
          requestedOutputTokenLimit: input.prepared.requestedOutputTokenLimit,
          effectiveOutputTokenLimit: input.prepared.effectiveOutputTokenLimit,
          capacityKnown: false,
          requestDispatched: false,
          splitReason: "provider_context_overflow",
        }),
      )
      yield* input.onSplit?.() ?? Effect.void
      const outputs = yield* Effect.forEach(
        children,
        (prepared, index) => recover({ ...input, prepared, index, total: children.length }),
        { concurrency: 1 },
      )
      const failure = failed(outputs)
      if (failure) return failure
      return {
        kind: "success",
        value: outputs.flatMap((output) => (output.kind === "success" ? output.value : [])),
      } as const
    })
  }

  function execute(input: Input & { prepared: Prepared[]; stage: "chunk" | "reduce" | "replay"; depth?: number }) {
    return Effect.gen(function* () {
      let completed = 0
      const lock = Semaphore.makeUnsafe(1)
      const report = (activity?: Progress["activity"]) =>
        input.onProgress?.({
          attempt: input.attempt.attempt,
          attemptMode: input.attempt.mode,
          phase: input.stage,
          completedUnits: completed,
          totalUnits: input.prepared.length,
          reduceDepth: input.depth,
          activity,
        }) ?? Effect.void
      yield* report()
      const outputs = yield* Effect.forEach(
        input.prepared,
        (prepared, index) =>
          recover({
            ...input,
            prepared,
            index,
            total: input.prepared.length,
            onSplit: () => lock.withPermits(1)(report("splitting")),
          }).pipe(
            Effect.tap(() =>
              lock.withPermits(1)(
                Effect.gen(function* () {
                  completed++
                  yield* report()
                }),
              ),
            ),
          ),
        { concurrency: Math.min(CONCURRENCY, input.prepared.length) },
      )
      const failure = failed(outputs)
      if (failure) return failure
      return {
        kind: "success",
        value: outputs.flatMap((output) => (output.kind === "success" ? output.value : [])),
      } as const
    })
  }

  function reduce(
    input: Input & { summaries: string[]; depth: number; final: string },
  ): Effect.Effect<Output, never, Database.Service> {
    return Effect.gen(function* () {
      if (!input.summaries.length) {
        return {
          kind: "incomplete",
          error: new MessageV2.APIError({
            message: "Compaction reduce produced no summaries",
            isRetryable: false,
          }).toObject(),
        } as const
      }
      const planned = yield* plan({
        ...input,
        atoms: summaryAtoms(input),
        stage: "reduce",
        final: input.final,
        depth: input.depth,
      })
      if (planned.kind !== "success") return planned
      const result = yield* execute({ ...input, prepared: planned.value, stage: "reduce", depth: input.depth })
      if (result.kind !== "success") return result
      if (result.value.length === 1) return { kind: "success", value: result.value[0]! } as const
      if (input.depth >= DEPTH) return { kind: "context_overflow", stage: "reduce" } as const
      return yield* reduce({ ...input, summaries: result.value, depth: input.depth + 1, final: input.final })
    })
  }

  export function process(input: Input) {
    return Effect.gen(function* () {
      const source = atoms(input)
      if (!source.length) {
        return {
          kind: "incomplete" as const,
          error: new MessageV2.APIError({
            message: "Compaction input contains no summarizable content",
            isRetryable: false,
          }).toObject(),
        }
      }
      const planned = yield* plan({ ...input, atoms: source, stage: "chunk", final: input.prompt })
      if (planned.kind !== "success") return planned
      log.info("fallback", { chunks: planned.value.length, concurrency: CONCURRENCY })
      const partial = yield* execute({ ...input, prepared: planned.value, stage: "chunk" })
      if (partial.kind !== "success") return partial
      return yield* reduce({ ...input, summaries: partial.value, depth: 0, final: input.prompt })
    })
  }
}
