import * as vscode from "vscode"
import { QWEN_FIM_MODEL_ID, isQwenFimTarget } from "../../shared/qwen-autocomplete"
import { QWEN_AUTOCOMPLETE_CACHE_DEFAULT_MAX_ENTRIES, clampMaxEntries } from "./autocompleteLruCache"
import type { QwenAutocompleteConfig, QwenAutocompleteLogLevel } from "./types"

export const QWEN_CONFIG_SECTION = "kilo.autocomplete"

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function logLevel(value: unknown): QwenAutocompleteLogLevel {
  if (value === "info" || value === "debug") return value
  return "off"
}

export function readQwenAutocompleteConfig(resource?: vscode.Uri): QwenAutocompleteConfig {
  const cfg = vscode.workspace.getConfiguration(QWEN_CONFIG_SECTION, resource)
  const autocomplete = vscode.workspace.getConfiguration("kilo-code.new.autocomplete", resource)
  const providerID = str(autocomplete.get("provider"), "")
  const selected = isQwenFimTarget(providerID, autocomplete.get<string>("model"))
  return {
    enabled: selected,
    autoTrigger: bool(autocomplete.get("enableAutoTrigger"), true),
    provider: selected ? "qwen-direct" : "none",
    providerID,
    model: QWEN_FIM_MODEL_ID,
    debounceMs: num(cfg.get("qwen.debounceMs"), 350, 0, 5_000),
    maxTokens: num(cfg.get("qwen.maxTokens"), 128, 1, 2_048),
    maxPromptTokens: num(cfg.get("qwen.maxPromptTokens"), 1024, 1, 200_000),
    modelTimeout: num(cfg.get("qwen.modelTimeout"), 150, 1, 600_000),
    maxSuffixPercentage: num(cfg.get("qwen.maxSuffixPercentage"), 0.2, 0, 1),
    prefixPercentage: num(cfg.get("qwen.prefixPercentage"), 0.3, 0, 1),
    temperature: num(cfg.get("qwen.temperature"), 0.01, 0, 2),
    cacheEnabled: bool(cfg.get("qwen.cache.enabled"), true),
    cacheMaxEntries: clampMaxEntries(cfg.get("qwen.cache.maxEntries") ?? QWEN_AUTOCOMPLETE_CACHE_DEFAULT_MAX_ENTRIES),
    prefixChars: num(cfg.get("qwen.prefixChars"), 12_000, 0, 200_000),
    suffixChars: num(cfg.get("qwen.suffixChars"), 6_000, 0, 200_000),
    multifileContextEnabled: bool(cfg.get("qwen.multifileContext.enabled"), false),
    contextLength: num(cfg.get("qwen.contextLength"), 0, 0, 1_000_000),
    recentlyEditedEnabled: bool(cfg.get("qwen.context.recentlyEdited.enabled"), false),
    recentlyEditedInjectIntoPrompt: bool(cfg.get("qwen.context.recentlyEdited.injectIntoPrompt"), false),
    recentlyEditedMaxRanges: num(cfg.get("qwen.context.recentlyEdited.maxRanges"), 3, 1, 20),
    recentlyEditedMaxRangeLines: num(cfg.get("qwen.context.recentlyEdited.maxRangeLines"), 20, 1, 200),
    recentlyOpenedEnabled: bool(cfg.get("qwen.context.recentlyOpened.enabled"), false),
    recentlyOpenedInjectIntoPrompt: bool(cfg.get("qwen.context.recentlyOpened.injectIntoPrompt"), false),
    recentlyOpenedMaxFiles: num(cfg.get("qwen.context.recentlyOpened.maxFiles"), 20, 1, 20),
    recentlyOpenedFileReadTimeoutMs: num(cfg.get("qwen.context.recentlyOpened.fileReadTimeoutMs"), 80, 1, 5_000),
    importDefinitionsEnabled: bool(cfg.get("qwen.context.importDefinitions.enabled"), false),
    importDefinitionsInjectIntoPrompt: bool(cfg.get("qwen.context.importDefinitions.injectIntoPrompt"), false),
    importDefinitionsTimeoutMs: num(cfg.get("qwen.context.importDefinitions.timeoutMs"), 100, 1, 5_000),
    importDefinitionsCacheSize: num(cfg.get("qwen.context.importDefinitions.cacheSize"), 10, 1, 10),
    rootPathEnabled: bool(cfg.get("qwen.context.rootPath.enabled"), false),
    rootPathInjectIntoPrompt: bool(cfg.get("qwen.context.rootPath.injectIntoPrompt"), false),
    rootPathTimeoutMs: num(cfg.get("qwen.context.rootPath.timeoutMs"), 100, 1, 5_000),
    rootPathCacheSize: num(cfg.get("qwen.context.rootPath.cacheSize"), 100, 1, 100),
    trace: bool(cfg.get("qwen.trace"), false),
    logLevel: logLevel(cfg.get("qwen.logLevel")),
    logPromptPreview: bool(cfg.get("qwen.logPromptPreview"), false),
    logCompletionPreview: bool(cfg.get("qwen.logCompletionPreview"), true),
  }
}

export function qwenAutocompleteEnabled(cfg: QwenAutocompleteConfig): boolean {
  return cfg.enabled && cfg.provider === "qwen-direct" && cfg.providerID.length > 0 && cfg.model === QWEN_FIM_MODEL_ID
}
