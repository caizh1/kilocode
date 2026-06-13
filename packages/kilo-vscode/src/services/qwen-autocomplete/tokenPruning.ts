import { encodingForModel } from "js-tiktoken"

export type QwenApproximateTokenPruningOptions = {
  maxPromptTokens: number
  prefixPercentage: number
  maxSuffixPercentage: number
}

export const QWEN_APPROXIMATE_TOKEN_PRUNING_DEFAULTS: QwenApproximateTokenPruningOptions = {
  maxPromptTokens: 1024,
  prefixPercentage: 0.3,
  maxSuffixPercentage: 0.2,
}

const encoding = encodingForModel("gpt-4")

// Approximation notice:
// Continue commit eaa23c5a9de86049dff765f635c18f61d1d043bb counts
// qwen-coder-like models with its llama tokenizer path. This isolated
// qwen-direct phase avoids importing the old continuedev runtime or copying a
// large tokenizer, so token counts use existing js-tiktoken gpt-4 encoding.
export function countTokensApproximation(text: string): number {
  return encoding.encode(text, "all", []).length
}

export function pruneLinesFromTopApproximation(text: string, max: number): string {
  const lines = text.split("\n")
  const tokens = lines.map((line) => countTokensApproximation(line))
  let total = tokens.reduce((sum, token) => sum + token, 0)
  let start = 0
  const count = lines.length

  total += Math.max(0, count - 1)

  while (total > max && start < count) {
    total -= tokens[start] ?? 0
    if (count - start > 1) {
      total--
    }
    start++
  }

  return lines.slice(start).join("\n")
}

export function pruneLinesFromBottomApproximation(text: string, max: number): string {
  const lines = text.split("\n")
  const tokens = lines.map((line) => countTokensApproximation(line))
  let total = tokens.reduce((sum, token) => sum + token, 0)
  let end = lines.length

  total += Math.max(0, end - 1)

  while (total > max && end > 0) {
    end--
    total -= tokens[end] ?? 0
    if (end > 0) {
      total--
    }
  }

  return lines.slice(0, end).join("\n")
}

export function prunePrefixSuffixWithApproximateTokens(
  prefix: string,
  suffix: string,
  opts: QwenApproximateTokenPruningOptions = QWEN_APPROXIMATE_TOKEN_PRUNING_DEFAULTS,
): { prunedPrefix: string; prunedSuffix: string } {
  const maxPrefix = opts.maxPromptTokens * opts.prefixPercentage
  const prunedPrefix = pruneLinesFromTopApproximation(prefix, maxPrefix)
  const maxSuffix = Math.min(
    opts.maxPromptTokens - countTokensApproximation(prunedPrefix),
    opts.maxSuffixPercentage * opts.maxPromptTokens,
  )
  const prunedSuffix = pruneLinesFromBottomApproximation(suffix, maxSuffix)
  return { prunedPrefix, prunedSuffix }
}
