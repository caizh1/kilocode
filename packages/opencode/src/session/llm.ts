import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Provider } from "@/provider/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Log } from "@opencode-ai/core/util/log" // chipmate_change
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import { LLMEvent, ToolRuntime } from "@opencode-ai/llm" // chipmate_change
import { LLMClient } from "@opencode-ai/llm/route"
import type { LLMClientService } from "@opencode-ai/llm/route"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { usable } from "./overflow" // chipmate_change
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
// chipmate_change start
import { InstanceState } from "@/effect/instance-state"
import { ChipMateSession } from "@/chipmate/session"
import { ChipMateLLM } from "@/chipmate/session/llm"
import { ChipMateSessionOverflow } from "@/chipmate/session/overflow"
import { ChipMateCompactionDiagnostics } from "@/chipmate/session/compaction-diagnostics"
import { ChipMateToolSchema } from "@/chipmate/session/tool-schema"
import { DSML } from "@/chipmate/session/dsml"
import { SessionExport } from "@/chipmate/session-export"
import { getActiveOrg } from "@/chipmate/session-export/eligibility"
import { normalizeUsageForExport, observeFullStreamForExport } from "@/chipmate/session-export/llm"
import { DocumentAgentScope } from "@/chipmate/document-agent/scope"
// chipmate_change end
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LLMAISDK } from "./llm/ai-sdk"
import { LLMNativeRuntime } from "./llm/native-runtime"
import { LLMRequestPrep } from "./llm/request"

const log = Log.create({ service: "llm" }) // chipmate_change

export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

export type StreamInput = {
  user: SessionV1.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: PermissionV1.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  preflight?: boolean // chipmate_change - enable proactive threshold compaction for normal session turns
  reportedContextTokens?: number // chipmate_change - provider-reported context size from the last finished turn, source of truth for the output cap
  runtimeToolCall?: RuntimeToolCall // chipmate_change - trusted local dispatch before any provider request
}

// chipmate_change start - internal tool dispatch is runtime-owned and never model-generated
export type RuntimeToolCall = {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

export function runtimeToolStream(input: {
  readonly call: RuntimeToolCall
  readonly tools: Record<string, Tool>
  readonly messages: ModelMessage[]
  readonly abort: AbortSignal
}) {
  const call = LLMEvent.toolCall(input.call)
  const tools = LLMNativeRuntime.nativeTools(input.tools, { messages: input.messages, abort: input.abort })
  const settled = Stream.fromEffect(ToolRuntime.dispatch(tools, call)).pipe(
    Stream.flatMap((result) => {
      const reason = result.result.type === "error" ? ("stop" as const) : ("tool-calls" as const)
      return Stream.fromIterable([
        ...result.events,
        LLMEvent.stepFinish({ index: 0, reason }),
        LLMEvent.finish({ reason }),
      ])
    }),
  )
  return Stream.make(LLMEvent.stepStart({ index: 0 }), call).pipe(Stream.concat(settled))
}
// chipmate_change end

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

export const use = serviceUse(Service)

const live: Layer.Layer<
  Service,
  never,
  | Auth.Service
  | Config.Service
  | Provider.Service
  | Plugin.Service
  | Permission.Service
  | EventV2Bridge.Service
  | LLMClientService
  | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const events = yield* EventV2Bridge.Service
    const llmClient = yield* LLMClient.Service
    const flags = yield* RuntimeFlags.Service

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const l = log.clone().tag("providerID", input.model.providerID).tag("modelID", input.model.id) // chipmate_change
      yield* Effect.logInfo("stream", {
        providerID: input.model.providerID,
        modelID: input.model.id,
        "session.id": input.sessionID,
        small: (input.small ?? false).toString(),
        agent: input.agent.name,
        mode: input.agent.mode,
      })

      // chipmate_change start - Ultra startup is a trusted local tool call. This branch must stay
      // before provider/config/auth lookup so the parent model receives exactly zero requests.
      if (input.runtimeToolCall) {
        yield* Effect.logInfo("llm runtime selected", {
          "llm.runtime": "local-tool",
          "llm.tool": input.runtimeToolCall.name,
          "session.id": input.sessionID,
        })
        return {
          type: "native" as const,
          stream: runtimeToolStream({
            call: input.runtimeToolCall,
            tools: input.tools,
            messages: input.messages,
            abort: input.abort,
          }),
        }
      }
      // chipmate_change end

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )
      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const base = yield* LLMRequestPrep.prepare({
        ...input,
        provider: item,
        auth: info,
        plugin,
        flags,
        isWorkflow,
      })

      // chipmate_change start - compact at the configured threshold before contacting the provider
      const tools = yield* Effect.promise(() => ChipMateToolSchema.sanitize(base.tools))
      const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"
      const estimated: ModelMessage[] =
        isOpenaiOauth || isWorkflow
          ? [
              {
                role: "system",
                content: isOpenaiOauth ? String(base.params.options.instructions ?? "") : base.system.join("\n"),
              },
              ...base.messages,
            ]
          : base.messages
      const preflight = input.preflight === true && ChipMateSessionOverflow.enabled({ cfg, model: input.model })
      const cap = ChipMateLLM.needsEstimate({ model: input.model, configured: base.params.maxOutputTokens })
      const usage = cap || preflight ? ChipMateSessionOverflow.measure({ messages: estimated, tools }) : undefined
      const maxOutputTokens = ChipMateLLM.capOutputTokens({
        model: input.model,
        messages: estimated,
        tools,
        configured: base.params.maxOutputTokens,
        usage,
        reported: input.reportedContextTokens,
      })
      const usableTokens = usable({ cfg, model: input.model, outputTokenMax: flags.outputTokenMax })
      const preflightTriggered =
        preflight &&
        !!usage &&
        ChipMateSessionOverflow.shouldCompact({
          cfg,
          model: input.model,
          usable: usableTokens,
          tokens: usage.normalized,
          continuation: usage.continuation,
        })
      if (preflight && usage) {
        yield* Effect.logInfo(
          "compaction_diag",
          ChipMateCompactionDiagnostics.preflight({
            sessionID: input.sessionID,
            providerID: input.model.providerID,
            modelID: input.model.id,
            messageCount: estimated.length,
            toolCount: Object.keys(tools).length,
            normalizedTokens: usage.normalized,
            rawTokens: usage.raw,
            continuation: usage.continuation,
            reportedContextTokens: input.reportedContextTokens,
            contextLimit: input.model.limit.context,
            inputLimit: input.model.limit.input,
            outputLimit: input.model.limit.output,
            usableTokens,
            thresholdTokens: ChipMateSessionOverflow.limit({ cfg, model: input.model, usable: usableTokens }),
            triggered: preflightTriggered,
          }),
        )
      }
      if (preflightTriggered) {
        return yield* Effect.fail(new ChipMateSessionOverflow.PreflightError())
      }
      const prepared = { ...base, tools, params: { ...base.params, maxOutputTokens } }
      // chipmate_change end
      // chipmate_change start - keep a trusted no-side-effect invalid executor only for targeted DSML repair
      const repair =
        input.agent.name !== DocumentAgentScope.AGENT &&
        DSML.enabled({ cfg, model: input.model, tools: prepared.tools, toolChoice: input.toolChoice })
      const runtime: Record<string, Tool> = repair ? { ...prepared.tools, invalid: DSML.invalid } : prepared.tools
      // chipmate_change end

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      const bridge = yield* EffectBridge.make()
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = prepared.system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = prepared.tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(prepared.tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = bridge.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionV1.ID.ascending()
          let unsub: EventV2.Unsubscribe | undefined
          try {
            unsub = await bridge.promise(
              events.listen((event) => {
                if (event.type !== Permission.Event.Replied.type) return Effect.void
                const data = event.data as EventV2.Data<typeof Permission.Event.Replied>
                if (data.requestID !== id) return Effect.void
                void data.reply
                return Effect.void
              }),
            )
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            if (unsub) await bridge.promise(unsub)
          }
        })
      }

      const instance = yield* InstanceState.context
      // chipmate_change start - capture eligible session export request start
      const isChipMate = input.model.api.npm === "@chipmate/chipmate-gateway"
      const exporting = SessionExport.enabled
      const org = yield* exporting && isChipMate && input.model.isFree === true
        ? Effect.promise(() => getActiveOrg())
        : Effect.succeed({ type: "unknown" as const })
      const started = Date.now()
      const parent = input.parentSessionID ?? ChipMateSession.resolveParent(input.sessionID)
      const found = ChipMateSession.resolveRoot(input.sessionID)
      const root = parent ? (found === input.sessionID ? parent : found) : input.sessionID
      const exportable =
        exporting &&
        isChipMate &&
        input.model.isFree === true &&
        org.type === "personal" &&
        input.agent.name !== "title"
      if (exportable) {
        SessionExport.beforeRequest({
          input: { model: input.model, org },
          requestMeta: {
            sessionId: input.sessionID,
            rootSessionId: root,
            parentSessionId: parent,
            requestId: input.user.id,
            userMessageId: input.user.id,
            agent: input.agent.name,
            modeId: input.agent.mode,
            workspaceKey: instance.directory,
            agentInfo: SessionExport.agentInfo(input.agent),
          },
          assembled: {
            system: prepared.system,
            messages: prepared.messages,
            tools: prepared.tools,
            permissions: input.permission ?? [],
            toolChoice: input.toolChoice,
            params: prepared.params,
          },
        })
      }
      // chipmate_change end

      // Runtime seam: native is an opt-in adapter over @opencode-ai/llm. It
      // either returns a ready LLMEvent stream or a concrete fallback reason.
      // chipmate_change start - targeted DSML repair requires the AI SDK stream middleware
      if (flags.experimentalNativeLlm && !repair) {
        // chipmate_change end
        const native = LLMNativeRuntime.stream({
          model: input.model,
          provider: item,
          auth: info,
          llmClient,
          messages: prepared.messages,
          tools: prepared.tools,
          toolChoice: input.toolChoice,
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          maxOutputTokens: prepared.params.maxOutputTokens,
          providerOptions: prepared.params.options,
          headers: prepared.headers,
          abort: input.abort,
        })
        if (native.type === "supported") {
          yield* Effect.logInfo("llm runtime selected", {
            "llm.runtime": "native",
            "llm.provider": input.model.providerID,
            "llm.model": input.model.id,
          })
          return {
            type: "native" as const,
            stream: native.stream,
          }
        }
        yield* Effect.logInfo("llm runtime selected", {
          "llm.runtime": "ai-sdk",
          "llm.provider": input.model.providerID,
          "llm.model": input.model.id,
          "llm.native_unsupported_reason": native.reason,
        })
        yield* Effect.logInfo("native runtime unavailable; falling back to ai-sdk", {
          providerID: input.model.providerID,
          modelID: input.model.id,
          "session.id": input.sessionID,
          small: (input.small ?? false).toString(),
          agent: input.agent.name,
          mode: input.agent.mode,
          reason: native.reason,
        })
      }

      yield* Effect.logInfo("llm runtime selected", {
        "llm.runtime": "ai-sdk",
        "llm.provider": input.model.providerID,
        "llm.model": input.model.id,
      })
      // Default runtime path: AI SDK owns provider execution and tool dispatch;
      // LLMAISDK.toLLMEvents below normalizes fullStream parts for the processor.
      const result = streamText({
        onError(error) {
          bridge.fork(
            Effect.logError("stream error", {
              providerID: input.model.providerID,
              modelID: input.model.id,
              "session.id": input.sessionID,
              small: (input.small ?? false).toString(),
              agent: input.agent.name,
              mode: input.agent.mode,
              error,
            }),
          )
        },
        // Copilot returns the authoritative billed amount only in provider-specific response fields.
        includeRawChunks: input.model.providerID.includes("github-copilot"),
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.trim().toLowerCase() // chipmate_change
          if (lower !== failed.toolCall.toolName && prepared.tools[lower]) {
            l.info("repairing tool call", { tool: failed.toolCall.toolName, repaired: lower }) // chipmate_change
            return { ...failed.toolCall, toolName: lower }
          }
          // chipmate_change start - a document-only model may hallucinate a hidden code tool. Convert it
          // to the visible no-op scope guard so no code executes and the turn can recover without `invalid`.
          const guarded = DocumentAgentScope.repairUnavailableTool({
            agent: input.agent.name,
            toolName: failed.toolCall.toolName,
            available: new Set(Object.keys(prepared.tools)),
          })
          if (guarded) return { ...failed.toolCall, ...guarded }
          if (!repair) return null
          // chipmate_change end
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        temperature: prepared.params.temperature,
        topP: prepared.params.topP,
        topK: prepared.params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, prepared.params.options),
        // chipmate_change start - invalid remains executable for repair but hidden from the model
        activeTools: Object.keys(runtime).filter((x) => x !== "invalid"),
        tools: runtime,
        // chipmate_change end
        toolChoice: input.toolChoice,
        maxOutputTokens: prepared.params.maxOutputTokens,
        abortSignal: input.abort,
        ...ChipMateLLM.timeout({ options: prepared.params.options, fallback: item.options, log: l }), // chipmate_change
        headers: prepared.headers,
        maxRetries: input.retries ?? 0,
        allowSystemInMessages: true, // chipmate_change - system prompts are trusted and intentionally included in messages
        messages: prepared.messages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(
                    args.params.prompt,
                    input.model,
                    prepared.messageTransformOptions,
                  )
                }
                return args.params
              },
            },
            ...(repair ? [DSML.middleware({ tools: runtime, messages: prepared.messages })] : []), // chipmate_change
          ],
        }),
        // chipmate_change start - disable AI SDK span recording (ai.* / gen_ai.*)
        experimental_telemetry: { isEnabled: false },
      })
      // chipmate_change end
      // chipmate_change start - capture eligible session export request completion off the stream path
      // chipmate_change - keep model-visible tools separate from the DSML runtime-only invalid executor.
      // Document Agent has no invalid executor and suppresses unavailable code previews.
      const visibleTools = Object.keys(prepared.tools)
      const runtimeTools = Object.keys(runtime)
      if (!exportable) return { type: "ai-sdk" as const, result, visibleTools, runtimeTools }
      return {
        type: "ai-sdk" as const,
        visibleTools,
        runtimeTools,
        result: {
          fullStream: observeFullStreamForExport(result.fullStream, {
            sessionId: input.sessionID,
            rootSessionId: root,
            parentSessionId: parent,
            requestId: input.user.id,
            workspaceKey: instance.directory,
            started,
            retries: input.retries ?? 0,
          }),
        },
      }
      // chipmate_change end
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal })

            if (result.type === "native") return result.stream

            // Adapter seam: both runtimes expose the same LLMEvent stream. Native
            // already returns one; AI SDK streams are converted here.
            const state = LLMAISDK.adapterState(result.visibleTools, result.runtimeTools) // chipmate_change
            return Stream.fromAsyncIterable(result.result.fullStream, (e) =>
              e instanceof Error ? e : new Error(String(e)),
            ).pipe(
              Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event)),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            )
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

// chipmate_change start - session export stream observer
export { normalizeUsageForExport, observeFullStreamForExport }
// chipmate_change end
export const hasToolCalls = LLMRequestPrep.hasToolCalls

export const node = LayerNode.make({
  service: Service,
  layer: live,
  deps: [
    Auth.node,
    Config.node,
    Provider.node,
    Plugin.node,
    Permission.node,
    EventV2Bridge.node,
    llmClient,
    RuntimeFlags.node,
  ],
})

export * as LLM from "./llm"
