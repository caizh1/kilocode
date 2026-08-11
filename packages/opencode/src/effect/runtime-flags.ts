import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("CHIPMATE_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@opencode/RuntimeFlags", {
  autoShare: bool("CHIPMATE_AUTO_SHARE"),
  pure: bool("CHIPMATE_PURE"),
  disableDefaultPlugins: bool("CHIPMATE_DISABLE_DEFAULT_PLUGINS"),
  disableChannelDb: bool("CHIPMATE_DISABLE_CHANNEL_DB"), // chipmate_change
  disableEmbeddedWebUi: bool("CHIPMATE_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("CHIPMATE_DISABLE_EXTERNAL_SKILLS"),
  disableSkillMarketTools: bool("CHIPMATE_DISABLE_SKILL_MARKET_TOOLS"), // chipmate_change
  disableSkillShell: bool("CHIPMATE_DISABLE_SKILL_SHELL"), // chipmate_change - disable shell injection in skill bodies
  disableLspDownload: bool("CHIPMATE_DISABLE_LSP_DOWNLOAD"),
  skipMigrations: bool("CHIPMATE_SKIP_MIGRATIONS"), // chipmate_change
  disableClaudeCodePrompt: Config.all({
    broad: bool("CHIPMATE_DISABLE_CLAUDE_CODE"),
    direct: bool("CHIPMATE_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("CHIPMATE_DISABLE_CLAUDE_CODE"),
    direct: bool("CHIPMATE_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("CHIPMATE_ENABLE_EXA"),
    legacy: bool("CHIPMATE_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("CHIPMATE_ENABLE_PARALLEL"),
    legacy: bool("CHIPMATE_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("CHIPMATE_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("CHIPMATE_ENABLE_QUESTION_TOOL"),
  experimentalScout: enabledByExperimental("CHIPMATE_EXPERIMENTAL_SCOUT"), // chipmate_change
  experimentalReferences: enabledByExperimental("CHIPMATE_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("CHIPMATE_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("CHIPMATE_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("CHIPMATE_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("CHIPMATE_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("CHIPMATE_EXPERIMENTAL_PLAN_MODE"),
  experimentalEventSystem: enabledByExperimental("CHIPMATE_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalSessionSwitcher: enabledByExperimental("CHIPMATE_EXPERIMENTAL_SESSION_SWITCHER"), // chipmate_change
  experimentalWorkspaces: enabledByExperimental("CHIPMATE_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("CHIPMATE_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("CHIPMATE_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("CHIPMATE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("CHIPMATE_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("CHIPMATE_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("CHIPMATE_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const node = LayerNode.make({ service: Service, layer: Service.layer.pipe(Layer.orDie), deps: [] })

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
