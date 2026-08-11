export function isEmbeddedReviewPrompt(value: string) {
  return /^\/embedded-review(?:\s|$)/i.test(value.trimStart())
}
