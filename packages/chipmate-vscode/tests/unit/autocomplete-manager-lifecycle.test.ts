import { describe, expect, it } from "bun:test"
import { AutocompleteLoadLifecycle } from "../../src/services/autocomplete/AutocompleteServiceManager"

describe("autocomplete manager load lifecycle", () => {
  it("keeps one active load and coalesces repeated reload requests", async () => {
    let active = 0
    let max = 0
    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const lifecycle = new AutocompleteLoadLifecycle(async () => {
      calls++
      active++
      max = Math.max(max, active)
      if (calls === 1) await gate
      active--
    })

    const first = lifecycle.load()
    const repeated = Array.from({ length: 20 }, () => lifecycle.load())
    expect(active).toBe(1)
    release?.()
    await Promise.all([first, ...repeated])

    expect(max).toBe(1)
    expect(calls).toBe(2)
  })

  it("invalidates an in-flight load before it can register after disposal", async () => {
    let release: (() => void) | undefined
    let registered = 0
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const lifecycle = new AutocompleteLoadLifecycle(async (generation, current) => {
      await gate
      if (current(generation)) registered++
    })

    const load = lifecycle.load()
    expect(lifecycle.dispose()).toBe(true)
    expect(lifecycle.dispose()).toBe(false)
    release?.()
    await load
    await lifecycle.load()

    expect(lifecycle.isDisposed).toBe(true)
    expect(lifecycle.allowsFatal("chipmate", "mistralai/codestral-2508")).toBe(false)
    expect(registered).toBe(0)
  })

  it("allows fatal warnings only for a live Classic runtime", () => {
    const lifecycle = new AutocompleteLoadLifecycle(async () => {})

    expect(lifecycle.allowsFatal("chipmate", "mistralai/codestral-2508")).toBe(true)
    expect(lifecycle.allowsFatal("qwen", "qwen-coder-30b0")).toBe(false)
    lifecycle.dispose()
    expect(lifecycle.allowsFatal("chipmate", "mistralai/codestral-2508")).toBe(false)
  })
})
