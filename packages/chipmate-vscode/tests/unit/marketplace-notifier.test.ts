import { describe, expect, it } from "bun:test"
import { MarketplaceNotifier } from "../../src/services/marketplace/notifier"

type Internals = {
  generation: number
  project: () => string | undefined
  scan: () => Promise<void>
}

describe("MarketplaceNotifier", () => {
  it("does not start the CLI or scan the user home in an empty window", async () => {
    const notifier = Object.create(MarketplaceNotifier.prototype) as Internals
    notifier.generation = 0
    notifier.project = () => undefined
    Object.defineProperty(notifier, "ctx", {
      get: () => {
        throw new Error("empty-window scan reached the CLI-backed marketplace context")
      },
    })

    await notifier.scan()

    expect(notifier.generation).toBe(1)
  })
})
