export type QwenAutocompleteProvider = "qwen-direct" | "none"

export type QwenMultilineCompletions = "always" | "never" | "auto"

export type QwenAutocompleteConfig = {
  enabled: boolean
  provider: QwenAutocompleteProvider
  endpoint: string
  model: string
  apiKey: string
  debounceMs: number
  maxTokens: number
  temperature: number
  prefixChars: number
  suffixChars: number
  multifileContextEnabled: boolean
}

export type QwenFimParts = {
  prefix: string
  suffix: string
}

export type QwenFimCompleteInput = {
  endpoint: string
  model: string
  apiKey: string
  prompt: string
  maxTokens: number
  temperature: number
  signal?: AbortSignal
}

export type QwenRequestInfo = {
  id: string
  path: string
  line: number
  character: number
  version: number
}
