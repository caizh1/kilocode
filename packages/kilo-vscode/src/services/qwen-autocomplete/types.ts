export type QwenAutocompleteProvider = "qwen-direct" | "none"

export type QwenMultilineCompletions = "always" | "never" | "auto"

export type QwenAutocompleteLogLevel = "off" | "info" | "debug"

export type QwenPromptRendererMode = "single-file-qwen-fim" | "qwen-multifile-fim" | "disabled" | "blocked"

export type QwenRootPathBlockedReason =
  | "none"
  | "disabled"
  | "missing-tree-path"
  | "missing-ast-infrastructure"
  | "timeout"
  | "guard-blocked"
  | "error"

export type QwenSnippetInjectionBlockedReason =
  | "none"
  | "disabled"
  | "no-selected-snippets"
  | "unknown-context-length"
  | "insufficient-context-length"
  | "unsupported-model"
  | "unsafe"
  | "error"

export type QwenAutocompleteConfig = {
  enabled: boolean
  autoTrigger: boolean
  provider: QwenAutocompleteProvider
  providerID: string
  model: string
  debounceMs: number
  maxTokens: number
  maxPromptTokens: number
  modelTimeout: number
  maxSuffixPercentage: number
  prefixPercentage: number
  temperature: number
  cacheEnabled: boolean
  cacheMaxEntries: number
  prefixChars: number
  suffixChars: number
  multifileContextEnabled: boolean
  contextLength: number
  recentlyEditedEnabled: boolean
  recentlyEditedInjectIntoPrompt: boolean
  recentlyEditedMaxRanges: number
  recentlyEditedMaxRangeLines: number
  recentlyOpenedEnabled: boolean
  recentlyOpenedInjectIntoPrompt: boolean
  recentlyOpenedMaxFiles: number
  recentlyOpenedFileReadTimeoutMs: number
  importDefinitionsEnabled: boolean
  importDefinitionsInjectIntoPrompt: boolean
  importDefinitionsTimeoutMs: number
  importDefinitionsCacheSize: number
  rootPathEnabled: boolean
  rootPathInjectIntoPrompt: boolean
  rootPathTimeoutMs: number
  rootPathCacheSize: number
  trace: boolean
  logLevel: QwenAutocompleteLogLevel
  logPromptPreview: boolean
  logCompletionPreview: boolean
}

export type QwenFimParts = {
  prefix: string
  suffix: string
}

export type QwenFimCompleteInput = {
  providerID: string
  modelID: string
  prompt: string
  directory?: string
  maxTokens: number
  temperature: number
  stop: string[]
  signal?: AbortSignal
  onResponse?: (info: {
    status: number
    endpointSource?: "provider-options" | "model-api" | "missing"
    serverPhase?: string
  }) => void
}

export type QwenRequestInfo = {
  id: string
  path: string
  line: number
  character: number
  version: number
}
