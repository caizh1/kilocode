import * as vscode from "vscode"
import type { QwenAutocompleteConfig, QwenAutocompleteProvider } from "./types"

export const QWEN_CONFIG_SECTION = "kilo.autocomplete"

const DEFAULT_ENDPOINT = "http://company-qwen-coder.example.com/v1/completions"
const DEFAULT_MODEL = "qwen-coder-30b0"

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

function provider(value: unknown): QwenAutocompleteProvider {
  if (value === "qwen-direct" || value === "none") return value
  return "none"
}

export function readQwenAutocompleteConfig(): QwenAutocompleteConfig {
  const cfg = vscode.workspace.getConfiguration(QWEN_CONFIG_SECTION)
  return {
    enabled: bool(cfg.get("enabled"), false),
    provider: provider(cfg.get("provider")),
    endpoint: str(cfg.get("qwen.endpoint"), DEFAULT_ENDPOINT).trim(),
    model: str(cfg.get("qwen.model"), DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    // TODO: move qwen autocomplete API keys to VS Code SecretStorage after Phase 1.
    apiKey: str(cfg.get("qwen.apiKey"), ""),
    debounceMs: num(cfg.get("qwen.debounceMs"), 350, 0, 5_000),
    maxTokens: num(cfg.get("qwen.maxTokens"), 128, 1, 2_048),
    temperature: num(cfg.get("qwen.temperature"), 0.1, 0, 2),
    prefixChars: num(cfg.get("qwen.prefixChars"), 12_000, 0, 200_000),
    suffixChars: num(cfg.get("qwen.suffixChars"), 6_000, 0, 200_000),
    multifileContextEnabled: bool(cfg.get("qwen.multifileContext.enabled"), false),
  }
}

export function qwenAutocompleteEnabled(cfg: QwenAutocompleteConfig): boolean {
  return cfg.enabled && cfg.provider === "qwen-direct"
}
