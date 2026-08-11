import { readFileSync } from "node:fs"
import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { AutocompleteDebouncer, type DebounceTimers } from "../../src/services/qwen-autocomplete/AutocompleteDebouncer"
import {
  QwenAutocompleteLruCache,
  clampMaxEntries,
  truncateSqliteLikePattern,
} from "../../src/services/qwen-autocomplete/autocompleteLruCache"
import { resetQwenDiagnosticsForTests } from "../../src/services/qwen-autocomplete/diagnostics"
import { ChipMateQwenInlineCompletionProvider } from "../../src/services/qwen-autocomplete/ChipMateQwenInlineCompletionProvider"
import type { QwenFimClient } from "../../src/services/qwen-autocomplete/QwenFimClient"
import type { QwenAutocompleteConfig, QwenFimCompleteInput } from "../../src/services/qwen-autocomplete/types"

type Pos = { line: number; character: number }
type Range = { start: Pos; end: Pos }
type Manual = {
  timers: DebounceTimers
  run(): void
  size(): number
}

const cfg: QwenAutocompleteConfig = {
  enabled: true,
  autoTrigger: true,
  provider: "qwen-direct",
  providerID: "qwen",
  model: "qwen-coder-30b0",
  debounceMs: 0,
  maxTokens: 128,
  maxPromptTokens: 1024,
  modelTimeout: 150,
  maxSuffixPercentage: 0.2,
  prefixPercentage: 0.3,
  temperature: 0.1,
  cacheEnabled: true,
  cacheMaxEntries: 1000,
  prefixChars: 12_000,
  suffixChars: 6_000,
  multifileContextEnabled: false,
  contextLength: 0,
  recentlyEditedEnabled: false,
  recentlyEditedInjectIntoPrompt: false,
  recentlyEditedMaxRanges: 3,
  recentlyEditedMaxRangeLines: 20,
  recentlyOpenedEnabled: false,
  recentlyOpenedInjectIntoPrompt: false,
  recentlyOpenedMaxFiles: 20,
  recentlyOpenedFileReadTimeoutMs: 80,
  importDefinitionsEnabled: false,
  importDefinitionsInjectIntoPrompt: false,
  importDefinitionsTimeoutMs: 100,
  importDefinitionsCacheSize: 10,
  rootPathEnabled: false,
  rootPathInjectIntoPrompt: false,
  rootPathTimeoutMs: 100,
  rootPathCacheSize: 100,
  trace: false,
  logLevel: "off",
  logPromptPreview: false,
  logCompletionPreview: true,
}

describe("QwenAutocompleteLruCache", () => {
  it("returns exact and typed-prefix cache hits like Continue AutocompleteLruCache", () => {
    const cache = new QwenAutocompleteLruCache()

    cache.put("return ", "status;")

    expect(cache.get("return ")).toBe("status;")
    expect(cache.get("return s")).toBe("tatus;")
  })

  it("misses when cached completion does not start with the typed delta", () => {
    const cache = new QwenAutocompleteLruCache()

    cache.put("return ", "status;")

    expect(cache.get("return x")).toBeUndefined()
  })

  it("does not add backward-deletion reuse behavior", () => {
    const cache = new QwenAutocompleteLruCache()

    cache.put("return status", ";")

    expect(cache.get("return ")).toBeUndefined()
  })

  it("evicts the oldest entry by timestamp after LRU hits update recency", () => {
    let time = 0
    const cache = new QwenAutocompleteLruCache({ maxEntries: 2, now: () => ++time })

    cache.put("a", "1")
    cache.put("b", "2")
    expect(cache.get("a")).toBe("1")
    cache.put("c", "3")

    expect(cache.get("a")).toBe("1")
    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("c")).toBe("3")
  })

  it("ports truncateSqliteLikePattern without importing SQLite or indexing runtime", () => {
    const source = readFileSync(`${__dirname}/../../src/services/qwen-autocomplete/autocompleteLruCache.ts`, "utf8")
    const text = `${"a".repeat(10)}${"文".repeat(20_000)}`
    const truncated = truncateSqliteLikePattern(text)

    expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(49_900)
    expect(text.endsWith(truncated)).toBe(true)
    expect(source).not.toMatch(/from\s+["'][^"']*(?:sqlite|refreshIndex|indexing)/i)
    expect(source).not.toContain("node:fs")
  })

  it("clamps maxEntries to safe values", () => {
    expect(clampMaxEntries(undefined)).toBe(1000)
    expect(clampMaxEntries(Number.NaN)).toBe(1000)
    expect(clampMaxEntries(-4)).toBe(1)
    expect(clampMaxEntries(1.8)).toBe(1)
    expect(clampMaxEntries(99_999)).toBe(10_000)
  })
})

describe("ChipMateQwenInlineCompletionProvider cache integration", () => {
  it("cache disabled still calls qwen for repeated provider requests", async () => {
    const api = client(() => "return ok;")
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => ({ ...cfg, cacheEnabled: false }),
      guard: () => false,
      client: api.client,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}")

    await complete(provider, document, new vscode.Position(1, 2))
    await complete(provider, document, new vscode.Position(1, 2))

    expect(api.calls()).toBe(2)
  })

  it("cache miss calls qwen once and exact hit skips the second qwen request", async () => {
    const cache = new QwenAutocompleteLruCache()
    const api = client(() => "return ok;")
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: api.client,
      cache,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}")

    const first = await complete(provider, document, new vscode.Position(1, 2))
    const second = await complete(provider, document, new vscode.Position(1, 2))

    expect(api.calls()).toBe(1)
    expect(cache.size()).toBe(1)
    expect(first[0]!.insertText).toBe("return ok;")
    expect(second[0]!.insertText).toBe("return ok;")
  })

  it("typed-prefix longest match returns only the remaining suffix without qwen", async () => {
    const api = client(() => "status;")
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: api.client,
      log: () => {},
    })

    await complete(provider, doc("int main() {\n  return \n}"), new vscode.Position(1, 9))
    const items = await complete(provider, doc("int main() {\n  return s\n}"), new vscode.Position(1, 10))

    expect(api.calls()).toBe(1)
    expect(items[0]!.insertText).toBe("tatus;")
  })

  it("typed-prefix mismatch continues through the qwen request path", async () => {
    const values = ["status;", "fallback;"]
    const api = client(() => values.shift() ?? "unexpected;")
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: api.client,
      log: () => {},
    })

    await complete(provider, doc("int main() {\n  return \n}"), new vscode.Position(1, 9))
    const items = await complete(provider, doc("int main() {\n  return x\n}"), new vscode.Position(1, 10))

    expect(api.calls()).toBe(2)
    expect(items[0]!.insertText).toBe("fallback;")
  })

  it("cache hit waits for the existing debounce before lookup and return", async () => {
    const clock = manualTimers()
    const api = client(() => "return ok;")
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => ({ ...cfg, debounceMs: 350 }),
      debouncer: new AutocompleteDebouncer(clock.timers),
      guard: () => false,
      client: api.client,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}")

    const first = provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )
    while (clock.size() < 1) {
      await Promise.resolve()
    }
    clock.run()
    await first

    let done = false
    const second = provider
      .provideInlineCompletionItems(
        document,
        new vscode.Position(1, 2),
        {} as vscode.InlineCompletionContext,
        token().value as vscode.CancellationToken,
      )
      .then((items) => {
        done = true
        return items
      })

    for (const _ of Array.from({ length: 10 })) {
      if (done || clock.size() > 0) break
      await Promise.resolve()
    }
    expect(done).toBe(false)
    expect(clock.size()).toBe(1)
    expect(api.calls()).toBe(1)

    clock.run()
    const items = await second

    expect(items[0]!.insertText).toBe("return ok;")
    expect(api.calls()).toBe(1)
  })

  it("does not cache guard-blocked, qwen-error, empty, or stale results", async () => {
    const blocked = new QwenAutocompleteLruCache()
    const blockedApi = client(() => "return ok;")
    const blockedProvider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => true,
      client: blockedApi.client,
      cache: blocked,
      log: () => {},
    })

    await complete(blockedProvider, doc("int main() {\n  \n}"), new vscode.Position(1, 2))
    expect(blocked.size()).toBe(0)
    expect(blockedApi.calls()).toBe(0)

    const errors = new QwenAutocompleteLruCache()
    const errorProvider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: client(() => {
        throw new Error("boom")
      }).client,
      cache: errors,
      log: () => {},
    })

    await complete(errorProvider, doc("int main() {\n  \n}"), new vscode.Position(1, 2))
    expect(errors.size()).toBe(0)

    const empty = new QwenAutocompleteLruCache()
    const emptyProvider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: client(() => "").client,
      cache: empty,
      log: () => {},
    })

    await complete(emptyProvider, doc("int main() {\n  \n}"), new vscode.Position(1, 2))
    expect(empty.size()).toBe(0)

    const stale = new QwenAutocompleteLruCache()
    const versioned = doc("int main() {\n  \n}") as vscode.TextDocument & { version: number }
    const staleProvider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: client(() => {
        versioned.version = 2
        return "return ok;"
      }).client,
      cache: stale,
      log: () => {},
    })

    await complete(staleProvider, versioned, new vscode.Position(1, 2))
    expect(stale.size()).toBe(0)
  })

  it("does not return a cached completion when cached render throws", async () => {
    const render = new QwenAutocompleteLruCache()
    render.put("int main() {\n  ", "cached;")
    let throwOnce = true
    let lines = 0
    const api = client(() => "fresh;")
    const fragile = doc("int main() {\n  \n}") as vscode.TextDocument & {
      lineAt(value: number | Pos): { text: string; range: vscode.Range }
    }
    const original = fragile.lineAt.bind(fragile)
    fragile.lineAt = (value) => {
      lines++
      if (throwOnce && lines === 2) {
        throwOnce = false
        throw new Error("render failed")
      }
      return original(value)
    }
    const renderProvider = new ChipMateQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: api.client,
      cache: render,
      log: () => {},
    })

    const items = await complete(renderProvider, fragile, new vscode.Position(1, 2))

    expect(api.calls()).toBe(1)
    expect(items[0]!.insertText).toBe("fresh;")
  })

  it("cache diagnostics remain redacted and report the CLI transport", async () => {
    const logs: string[] = []
    resetQwenDiagnosticsForTests()
    const provider = new ChipMateQwenInlineCompletionProvider({
      read: () => ({
        ...cfg,
        trace: true,
        logLevel: "debug",
      }),
      guard: () => false,
      state: () => "connected",
      client: client(() => "return ok;").client,
      log: () => {},
    })
    const original = vscode.window.createOutputChannel
    ;(vscode.window as unknown as { createOutputChannel: typeof original }).createOutputChannel = () =>
      ({
        appendLine: (line: string) => logs.push(line),
        append: () => {},
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
      }) as unknown as vscode.OutputChannel

    try {
      await complete(provider, doc("int main() {\n  \n}"), new vscode.Position(1, 2))
    } finally {
      ;(vscode.window as unknown as { createOutputChannel: typeof original }).createOutputChannel = original
      resetQwenDiagnosticsForTests()
    }

    const text = logs.join("\n")
    expect(text).toContain('"cacheEnabled":true')
    expect(text).toContain('"cacheStatus":"miss"')
    expect(text).toContain('"cacheHit":false')
    expect(text).toContain('"providerID":"qwen"')
    expect(text).toContain('"transport":"cli-qwen-fim"')
    expect(text).toContain('"connectionState":"connected"')
    expect(text).not.toContain("<|fim_prefix|>")
    expect(text).not.toContain("int main")
  })

  it("does not reference legacy or chat endpoints from qwen cache code", () => {
    const root = `${__dirname}/../../src/services/qwen-autocomplete`
    const source = [
      readFileSync(`${root}/autocompleteLruCache.ts`, "utf8"),
      readFileSync(`${root}/ChipMateQwenInlineCompletionProvider.ts`, "utf8"),
    ].join("\n")

    expect(source).not.toContain("/chipmate/fim")
    expect(source).not.toContain("/chipmate/edit")
    expect(source).not.toContain("/v1/chat/completions")
  })
})

function doc(text: string, input: { path?: string; languageId?: string; version?: number; scheme?: string } = {}) {
  const lines = text.split("\n")
  const uri = {
    scheme: input.scheme ?? "file",
    fsPath: input.path ?? "/repo/src/main.c",
    path: input.path ?? "/repo/src/main.c",
  }
  return {
    uri,
    languageId: input.languageId ?? "c",
    version: input.version ?? 1,
    lineCount: lines.length,
    lineAt: (value: number | Pos) => {
      const line = typeof value === "number" ? value : value.line
      const current = lines[line] ?? ""
      return {
        text: current,
        range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, current.length)),
      }
    },
    getText: (range?: Range) => {
      if (!range) return text
      return text.slice(offset(lines, range.start), offset(lines, range.end))
    },
  } as unknown as vscode.TextDocument
}

function token() {
  const callbacks: Array<() => void> = []
  const value = {
    isCancellationRequested: false,
    onCancellationRequested: (cb: () => void) => {
      callbacks.push(cb)
      return { dispose: () => {} }
    },
  }
  return {
    value,
    cancel: () => {
      value.isCancellationRequested = true
      callbacks.forEach((cb) => cb())
    },
  }
}

function manualTimers(): Manual {
  let next = 0
  const tasks = new Map<number, () => void>()
  return {
    timers: {
      set: (callback) => {
        const id = ++next
        tasks.set(id, callback)
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clear: (timer) => {
        tasks.delete(timer as unknown as number)
      },
    },
    run: () => {
      const list = Array.from(tasks.values())
      tasks.clear()
      list.forEach((callback) => callback())
    },
    size: () => tasks.size,
  }
}

function client(next: (input: QwenFimCompleteInput) => string | Promise<string>): {
  client: QwenFimClient
  calls(): number
} {
  let calls = 0
  return {
    client: {
      complete: async (input: QwenFimCompleteInput) => {
        calls++
        return next(input)
      },
    } as unknown as QwenFimClient,
    calls: () => calls,
  }
}

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}

function complete(
  provider: ChipMateQwenInlineCompletionProvider,
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.InlineCompletionItem[]> {
  return provider.provideInlineCompletionItems(
    document,
    position,
    {} as vscode.InlineCompletionContext,
    token().value as vscode.CancellationToken,
  )
}
