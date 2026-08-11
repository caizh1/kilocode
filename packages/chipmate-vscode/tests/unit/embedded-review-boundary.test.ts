import { describe, expect, test } from "bun:test"
import { isEmbeddedReviewPrompt } from "../../webview-ui/src/components/chat/embedded-review-boundary"

describe("embedded review boundary", () => {
  test("recognizes supported embedded review commands", () => {
    expect(isEmbeddedReviewPrompt("/embedded-review")).toBe(true)
    expect(isEmbeddedReviewPrompt("/embedded-review uncommitted")).toBe(true)
    expect(isEmbeddedReviewPrompt("  /embedded-review 08c5a2f")).toBe(true)
    expect(isEmbeddedReviewPrompt("/EMBEDDED-REVIEW uncommitted")).toBe(true)
  })

  test("rejects partial commands and prose mentions", () => {
    expect(isEmbeddedReviewPrompt("/embedded-revie")).toBe(false)
    expect(isEmbeddedReviewPrompt("/embedded-reviewer")).toBe(false)
    expect(isEmbeddedReviewPrompt("Explain /embedded-review")).toBe(false)
    expect(isEmbeddedReviewPrompt("embedded-review uncommitted")).toBe(false)
  })
})
