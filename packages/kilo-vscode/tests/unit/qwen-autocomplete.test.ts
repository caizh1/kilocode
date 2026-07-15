import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it, expect, afterEach } from "bun:test"
import * as vscode from "vscode"
import { AutocompleteDebouncer, type DebounceTimers } from "../../src/services/qwen-autocomplete/AutocompleteDebouncer"
import {
  buildQwenFimPrompt,
  getContinueAutocompleteStopTokens,
  QWEN_FIM_STOP,
} from "../../src/services/qwen-autocomplete/fimTemplates"
import { constructInitialPrefixSuffix } from "../../src/services/qwen-autocomplete/constructPrefixSuffix"
import { createQwenAutocompleteHelper, QWEN_HELPER_DEFAULTS } from "../../src/services/qwen-autocomplete/helperVars"
import { resetQwenSafetyGuardsForTests } from "../../src/services/qwen-autocomplete/guard"
import { shouldCompleteMultilineQwen } from "../../src/services/qwen-autocomplete/multiline"
import { QwenFimClient, QwenFimRequestError } from "../../src/services/qwen-autocomplete/QwenFimClient"
import {
  KiloQwenInlineCompletionProvider,
  QWEN_DOCUMENT_SELECTOR,
  isQwenSupportedDocument,
} from "../../src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider"
import { shouldPrefilterQwenDocument } from "../../src/services/qwen-autocomplete/prefilter"
import { processSingleLineCompletion } from "../../src/services/qwen-autocomplete/processSingleLineCompletion"
import { postprocessQwenCompletion } from "../../src/services/qwen-autocomplete/postprocess"
import { renderQwenInlineCompletionItem } from "../../src/services/qwen-autocomplete/range"
import {
  filterQwenCompletion,
  lineIsRepeated,
  PREFIXES_TO_SKIP,
} from "../../src/services/qwen-autocomplete/streamFilters"
import { tokenizerSourceForModel } from "../../src/services/qwen-autocomplete/tokenPruning"
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
  temperature: 0.01,
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

const originalConfig = vscode.workspace.getConfiguration
const originalChange = vscode.workspace.onDidChangeConfiguration
const originalInline = vscode.languages.registerInlineCompletionItemProvider
const originalFolders = vscode.workspace.workspaceFolders
const originalInfo = vscode.window.showInformationMessage
const originalError = vscode.window.showErrorMessage
const originalEditor = vscode.window.activeTextEditor
const dirs: string[] = []
const qwenTemplateLocalStops = [
  "<|endoftext|>",
  "<|fim_prefix|>",
  "<|fim_middle|>",
  "<|fim_suffix|>",
  "<|fim_pad|>",
  "<|repo_name|>",
  "<|file_sep|>",
  "<|im_start|>",
  "<|im_end|>",
]
const continueCommonStops = ["/src/", "#- coding: utf-8", "```"]
const continueQwenCoderEffectiveStops = [...qwenTemplateLocalStops, ...continueCommonStops]

afterEach(async () => {
  ;(
    vscode.workspace as unknown as {
      getConfiguration: typeof originalConfig
      onDidChangeConfiguration: typeof originalChange
      workspaceFolders: typeof originalFolders
    }
  ).getConfiguration = originalConfig
  ;(
    vscode.workspace as unknown as {
      getConfiguration: typeof originalConfig
      onDidChangeConfiguration: typeof originalChange
      workspaceFolders: typeof originalFolders
    }
  ).onDidChangeConfiguration = originalChange
  ;(
    vscode.workspace as unknown as {
      getConfiguration: typeof originalConfig
      onDidChangeConfiguration: typeof originalChange
      workspaceFolders: typeof originalFolders
    }
  ).workspaceFolders = originalFolders
  ;(
    vscode.languages as unknown as { registerInlineCompletionItemProvider: typeof originalInline }
  ).registerInlineCompletionItemProvider = originalInline
  ;(vscode.window as unknown as { showInformationMessage: typeof originalInfo }).showInformationMessage = originalInfo
  ;(vscode.window as unknown as { showErrorMessage: typeof originalError }).showErrorMessage = originalError
  ;(vscode.window as unknown as { activeTextEditor: typeof originalEditor }).activeTextEditor = originalEditor
  resetQwenSafetyGuardsForTests()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
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

function post(completion: string, input: { model?: string; prefix?: string; suffix?: string } = {}) {
  return postprocessQwenCompletion({
    completion,
    model: input.model ?? "qwen-coder-30b0",
    prefix: input.prefix ?? "",
    suffix: input.suffix ?? "",
  })
}

function helper(text: string, position: vscode.Position) {
  return createQwenAutocompleteHelper(doc(text), position)
}

function filtered(
  completion: string,
  input: {
    text?: string
    position?: vscode.Position
    suffix?: string
    stops?: string[]
    multiline?: boolean
  } = {},
) {
  const position = input.position ?? new vscode.Position(0, 0)
  const state = helper(input.text ?? "", position)
  return filterQwenCompletion({
    completion,
    suffix: input.suffix ?? state.prunedSuffix,
    stopTokens: input.stops ?? [],
    helper: state,
    position,
    multiline: input.multiline ?? true,
  })
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

function offset(lines: string[], pos: Pos): number {
  return lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.character
}

function stubConfig(values: Record<string, unknown>) {
  ;(vscode.workspace as unknown as { getConfiguration: typeof originalConfig }).getConfiguration = (
    section?: string,
  ) => {
    if (section === "kilo-code.new.autocomplete") {
      return {
        get: (key: string, fallback?: unknown) =>
          ({
            provider: values.providerID,
            model: values.model,
            enableAutoTrigger: values.enableAutoTrigger ?? values.enabled,
          })[key] ?? fallback,
        update: async () => {},
      } as unknown as ReturnType<typeof originalConfig>
    }
    if (section !== "kilo.autocomplete") return originalConfig(section)
    return {
      get: (key: string, fallback?: unknown) => values[key] ?? fallback,
      update: async () => {},
    } as unknown as ReturnType<typeof originalConfig>
  }
}

function stubRegistration(calls: Array<{ selector: vscode.DocumentSelector; provider: unknown }>) {
  let callback: ((event: { affectsConfiguration: (section: string) => boolean }) => void) | undefined
  let disposed = 0
  ;(vscode.workspace as unknown as { onDidChangeConfiguration: typeof originalChange }).onDidChangeConfiguration = (
    listener,
  ) => {
    callback = listener as (event: { affectsConfiguration: (section: string) => boolean }) => void
    return { dispose: () => {} }
  }
  ;(
    vscode.languages as unknown as { registerInlineCompletionItemProvider: typeof originalInline }
  ).registerInlineCompletionItemProvider = (selector, provider) => {
    calls.push({ selector, provider })
    return { dispose: () => disposed++ }
  }
  return {
    disposed: () => disposed,
    fire: (target: string) => callback?.({ affectsConfiguration: (section) => section === target }),
  }
}

function connection() {
  return {
    getConnectionState: () => "connected",
  } as never
}

async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qwen-autocomplete-"))
  dirs.push(dir)
  ;(vscode.workspace as unknown as { workspaceFolders: typeof originalFolders }).workspaceFolders = [
    { uri: { fsPath: dir } },
  ] as typeof originalFolders
  resetQwenSafetyGuardsForTests()
  return dir
}

describe("qwen autocomplete config and prompt", () => {
  it("reads defaults from the kilo.autocomplete namespace", async () => {
    stubConfig({})
    const { readQwenAutocompleteConfig } = await import("../../src/services/qwen-autocomplete/config")

    expect(readQwenAutocompleteConfig()).toMatchObject({
      enabled: false,
      autoTrigger: true,
      provider: "none",
      providerID: "",
      model: "qwen-coder-30b0",
      debounceMs: 350,
      maxTokens: 128,
      maxPromptTokens: 1024,
      modelTimeout: 150,
      maxSuffixPercentage: 0.2,
      prefixPercentage: 0.3,
      temperature: 0.01,
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
    })
  })

  it("preserves debounceMs user overrides", async () => {
    stubConfig({ "qwen.debounceMs": 42 })
    const { readQwenAutocompleteConfig } = await import("../../src/services/qwen-autocomplete/config")

    expect(readQwenAutocompleteConfig().debounceMs).toBe(42)
  })

  it("uses only the canonical target and requires the exact Qwen model", async () => {
    const { readQwenAutocompleteConfig, qwenAutocompleteEnabled } = await import(
      "../../src/services/qwen-autocomplete/config"
    )

    stubConfig({ enabled: true, provider: "qwen-direct" })
    expect(qwenAutocompleteEnabled(readQwenAutocompleteConfig())).toBe(false)

    stubConfig({ enabled: true, providerID: "qwen", model: "qwen3-coder-30b" })
    expect(qwenAutocompleteEnabled(readQwenAutocompleteConfig())).toBe(false)

    stubConfig({ enabled: true, providerID: "qwen", model: "qwen-coder-30b0" })
    expect(qwenAutocompleteEnabled(readQwenAutocompleteConfig())).toBe(true)

    stubConfig({ enableAutoTrigger: false, providerID: "qwen", model: "qwen-coder-30b0" })
    expect(readQwenAutocompleteConfig()).toMatchObject({ enabled: true, autoTrigger: false })
    expect(qwenAutocompleteEnabled(readQwenAutocompleteConfig())).toBe(true)
  })

  it("maps Continue-style prompt budget settings separately from output maxTokens", async () => {
    stubConfig({
      "qwen.maxTokens": 9,
      "qwen.maxPromptTokens": 512,
      "qwen.prefixPercentage": 0.4,
      "qwen.maxSuffixPercentage": 0.1,
      "qwen.modelTimeout": 250,
      "qwen.cache.enabled": false,
      "qwen.cache.maxEntries": 12,
      "qwen.contextLength": 8192,
      "qwen.context.recentlyEdited.enabled": true,
      "qwen.context.recentlyEdited.injectIntoPrompt": true,
      "qwen.context.recentlyEdited.maxRanges": 6,
      "qwen.context.recentlyEdited.maxRangeLines": 40,
      "qwen.context.recentlyOpened.enabled": true,
      "qwen.context.recentlyOpened.injectIntoPrompt": true,
      "qwen.context.recentlyOpened.maxFiles": 12,
      "qwen.context.recentlyOpened.fileReadTimeoutMs": 40,
      "qwen.context.importDefinitions.enabled": true,
      "qwen.context.importDefinitions.injectIntoPrompt": true,
      "qwen.context.importDefinitions.timeoutMs": 90,
      "qwen.context.importDefinitions.cacheSize": 7,
      "qwen.context.rootPath.enabled": true,
      "qwen.context.rootPath.injectIntoPrompt": true,
      "qwen.context.rootPath.timeoutMs": 91,
      "qwen.context.rootPath.cacheSize": 77,
    })
    const { readQwenAutocompleteConfig } = await import("../../src/services/qwen-autocomplete/config")

    expect(readQwenAutocompleteConfig()).toMatchObject({
      maxTokens: 9,
      maxPromptTokens: 512,
      prefixPercentage: 0.4,
      maxSuffixPercentage: 0.1,
      modelTimeout: 250,
      cacheEnabled: false,
      cacheMaxEntries: 12,
      contextLength: 8192,
      recentlyEditedEnabled: true,
      recentlyEditedInjectIntoPrompt: true,
      recentlyEditedMaxRanges: 6,
      recentlyEditedMaxRangeLines: 40,
      recentlyOpenedEnabled: true,
      recentlyOpenedInjectIntoPrompt: true,
      recentlyOpenedMaxFiles: 12,
      recentlyOpenedFileReadTimeoutMs: 40,
      importDefinitionsEnabled: true,
      importDefinitionsInjectIntoPrompt: true,
      importDefinitionsTimeoutMs: 90,
      importDefinitionsCacheSize: 7,
      rootPathEnabled: true,
      rootPathInjectIntoPrompt: true,
      rootPathTimeoutMs: 91,
      rootPathCacheSize: 77,
    })
  })

  it("clamps invalid qwen cache maxEntries settings safely", async () => {
    stubConfig({ "qwen.cache.maxEntries": -1 })
    const { readQwenAutocompleteConfig } = await import("../../src/services/qwen-autocomplete/config")

    expect(readQwenAutocompleteConfig().cacheMaxEntries).toBe(1)
  })

  it("constructs initial prefix and suffix from the current file", () => {
    const document = doc("abc\ndef\nghi")
    const parts = constructInitialPrefixSuffix({ document, position: new vscode.Position(1, 1) })

    expect(parts).toEqual({ prefix: "abc\nd", suffix: "ef\nghi" })
    expect(buildQwenFimPrompt(parts)).toBe("<|fim_prefix|>abc\nd<|fim_suffix|>ef\nghi<|fim_middle|>")
  })

  it("constructs selectedCompletionInfo prefix like Continue", () => {
    const document = doc("abcd_rest")
    const selected = {
      text: "abcdef",
      range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 4)),
    }
    const parts = constructInitialPrefixSuffix({ document, position: new vscode.Position(0, 4), selected })

    expect(parts).toEqual({ prefix: "abcdef", suffix: "_rest" })
  })

  it("builds Continue-style HelperVars and token-budget pruned prefix/suffix", () => {
    const prefix = Array.from(
      { length: 40 },
      (_, index) => `int pre_${index.toString().padStart(4, "0")}_marker = ${index};`,
    ).join("\n")
    const suffix = Array.from(
      { length: 40 },
      (_, index) => `int suf_${index.toString().padStart(4, "0")}_marker = ${index};`,
    ).join("\n")
    const document = doc(`${prefix}\nHERE\n${suffix}`)
    const helper = createQwenAutocompleteHelper(document, new vscode.Position(40, 4), undefined, {
      maxPromptTokens: 80,
      prefixPercentage: 0.3,
      maxSuffixPercentage: 0.2,
    })

    expect(QWEN_HELPER_DEFAULTS).toEqual({
      maxPromptTokens: 1024,
      prefixPercentage: 0.3,
      maxSuffixPercentage: 0.2,
    })
    expect(helper.fileContents).toBe(document.getText())
    expect(helper.fileLines).toHaveLength(81)
    expect(helper.helperParityMode).toBe("continue-helpervars-token-budget")
    expect(helper.tokenizerSource).toBe("llama")
    expect(tokenizerSourceForModel("qwen-coder-30b0")).toBe("llama")
    expect(helper.prunedCaretWindow).toBe(helper.prunedPrefix + helper.prunedSuffix)
    expect(helper.fullPrefix).toContain("pre_0000_marker")
    expect(helper.fullSuffix).toContain("suf_0039_marker")
    expect(helper.prunedPrefix).not.toContain("pre_0000_marker")
    expect(helper.prunedPrefix).toContain("HERE")
    expect(helper.prunedSuffix).toContain("suf_0000_marker")
    expect(helper.prunedSuffix).not.toContain("suf_0039_marker")
  })

  it("uses flattened qwen template-local and Continue common stop tokens in exact order", () => {
    const stops = getContinueAutocompleteStopTokens("qwen-coder-30b0")

    expect(stops).toEqual(continueQwenCoderEffectiveStops)
    expect(QWEN_FIM_STOP).toEqual(continueQwenCoderEffectiveStops)
    for (const stop of qwenTemplateLocalStops) {
      expect(stops).toContain(stop)
    }
    for (const stop of continueCommonStops) {
      expect(stops).toContain(stop)
    }
    expect(new Set(stops).size).toBe(stops.length)
    expect(stops).not.toContain("t.")
    expect(stops).not.toContain("\nt")
    expect(stops).not.toContain("<file_sep>")
  })
})

describe("qwen autocomplete registration", () => {
  it("does not register an inline completion provider by default", async () => {
    const calls: Array<{ selector: vscode.DocumentSelector; provider: unknown }> = []
    stubConfig({})
    stubRegistration(calls)
    const { registerQwenAutocompleteProvider } = await import("../../src/services/qwen-autocomplete")

    const reg = registerQwenAutocompleteProvider(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      connection(),
    )

    expect(calls).toHaveLength(0)
    reg.dispose()
  })

  it("registers only the qwen provider when qwen-direct is enabled", async () => {
    const calls: Array<{ selector: vscode.DocumentSelector; provider: unknown }> = []
    stubConfig({ enabled: true, providerID: "qwen", model: "qwen-coder-30b0" })
    stubRegistration(calls)
    const { registerQwenAutocompleteProvider } = await import("../../src/services/qwen-autocomplete")

    const reg = registerQwenAutocompleteProvider(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      connection(),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.selector).toEqual(QWEN_DOCUMENT_SELECTOR)
    expect(calls[0]!.provider).toBeInstanceOf(KiloQwenInlineCompletionProvider)
    reg.dispose()
  })

  it("does not register the incorrect 0.0.48 and 0.0.49 Qwen model before coordinator migration", async () => {
    const calls: Array<{ selector: vscode.DocumentSelector; provider: unknown }> = []
    stubConfig({ enabled: true, providerID: "qwen", model: "qwen3-coder-30b0" })
    stubRegistration(calls)
    const { registerQwenAutocompleteProvider } = await import("../../src/services/qwen-autocomplete")

    const reg = registerQwenAutocompleteProvider(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      connection(),
    )

    expect(calls).toHaveLength(0)
    reg.dispose()
  })

  it("registers immediately after the canonical provider and model writes settle", async () => {
    const calls: Array<{ selector: vscode.DocumentSelector; provider: unknown }> = []
    const values: Record<string, unknown> = { enabled: true }
    stubConfig(values)
    const events = stubRegistration(calls)
    const { registerQwenAutocompleteProvider } = await import("../../src/services/qwen-autocomplete")
    const reg = registerQwenAutocompleteProvider(
      { subscriptions: [] } as unknown as vscode.ExtensionContext,
      connection(),
    )

    values.providerID = "qwen"
    events.fire("kilo-code.new.autocomplete")
    expect(calls).toHaveLength(0)

    values.model = "qwen-coder-30b0"
    events.fire("kilo-code.new.autocomplete")
    expect(calls).toHaveLength(1)

    events.fire("kilo.autocomplete")
    expect(calls).toHaveLength(1)

    values.enabled = false
    events.fire("kilo-code.new.autocomplete")
    expect(calls).toHaveLength(1)
    expect(events.disposed()).toBe(0)

    values.model = undefined
    events.fire("kilo-code.new.autocomplete")
    expect(events.disposed()).toBe(1)
    reg.dispose()
  })
})

describe("qwen autocomplete debouncer", () => {
  it("allows a single latest request after the debounce delay", async () => {
    const clock = manualTimers()
    const debouncer = new AutocompleteDebouncer(clock.timers)
    const request = debouncer.delayAndShouldDebounce(350)

    expect(clock.size()).toBe(1)
    clock.run()

    expect(await request).toBe(false)
  })

  it("resolves superseded requests true as a qwen-direct lifecycle safety adaptation", async () => {
    const clock = manualTimers()
    const debouncer = new AutocompleteDebouncer(clock.timers)
    const first = debouncer.delayAndShouldDebounce(350)
    const second = debouncer.delayAndShouldDebounce(350)

    expect(await first).toBe(true)
    expect(clock.size()).toBe(1)
    clock.run()
    expect(await second).toBe(false)
  })
})

describe("QwenFimClient", () => {
  it("uses the local CLI qwen FIM endpoint", async () => {
    const seen: Record<string, unknown> = {}
    const client = new QwenFimClient({
      getClientAsync: async () => ({
        kilo: {
          qwenFim: async (input: Record<string, unknown>, options: { signal?: AbortSignal }) => {
            Object.assign(seen, input, { signal: options.signal })
            return { data: { text: "return ok;" }, response: new Response() }
          },
        },
      }),
    } as never)
    const abort = new AbortController()

    const text = await client.complete({
      directory: "/repo",
      providerID: "qwen",
      modelID: "qwen-coder-30b0",
      prompt: "<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>",
      maxTokens: 64,
      temperature: 0.2,
      stop: continueQwenCoderEffectiveStops,
      signal: abort.signal,
    })

    expect(text).toBe("return ok;")
    expect(seen).toEqual({
      directory: "/repo",
      providerID: "qwen",
      modelID: "qwen-coder-30b0",
      prefix: "<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>",
      suffix: "",
      maxTokens: 64,
      temperature: 0.2,
      stop: continueQwenCoderEffectiveStops,
      signal: abort.signal,
    })
  })

  it("rejects an empty CLI response without chat fallback", async () => {
    const client = new QwenFimClient({
      getClientAsync: async () => ({
        kilo: {
          qwenFim: async () => ({ data: undefined, response: new Response() }),
        },
      }),
    } as never)

    await expect(
      client.complete({
        providerID: "qwen",
        modelID: "qwen-coder-30b0",
        prompt: "fim",
        maxTokens: 1,
        temperature: 0,
        stop: continueQwenCoderEffectiveStops,
      }),
    ).rejects.toThrow(QwenFimRequestError)
  })
})

describe("qwen smoke diagnostics", () => {
  it("sends the synthetic C completion through the shared CLI connection", async () => {
    const dir = await tempWorkspace()
    let message = ""
    ;(vscode.window as unknown as { showInformationMessage: typeof originalInfo }).showInformationMessage = async (
      value,
    ) => {
      message = String(value)
      return undefined
    }
    stubConfig({
      enabled: true,
      providerID: "qwen",
      model: "qwen-coder-30b0",
      "qwen.trace": true,
      "qwen.logLevel": "debug",
    })
    const seen: Record<string, unknown> = {}
    const shared = {
      getConnectionState: () => "connected",
      getClientAsync: async () => ({
        kilo: {
          qwenFim: async (input: Record<string, unknown>) => {
            Object.assign(seen, input)
            return { data: { text: "return 0;" }, response: new Response(undefined, { status: 200 }) }
          },
        },
      }),
    }
    const { qwenDiagnosticSmoke } = await import("../../src/services/qwen-autocomplete/smoke")

    await qwenDiagnosticSmoke(shared as never)

    expect(seen).toMatchObject({
      directory: dir,
      providerID: "qwen",
      modelID: "qwen-coder-30b0",
      suffix: "",
    })
    expect(String(seen.prefix)).toContain("<|fim_prefix|>")
    expect(message).toContain("provider=qwen")
    expect(message).toContain("status=200")
    expect(message).toContain("items=1")
    expect(message).toContain("tests transport only")
    const { qwenDiagnosticsForTests } = await import("../../src/services/qwen-autocomplete/diagnostics")
    expect(qwenDiagnosticsForTests().some((line) => line.includes('"requestSource":"smoke"'))).toBe(true)
  })

  it("reports a safe status and phase when the transport test fails", async () => {
    await tempWorkspace()
    stubConfig({
      enabled: true,
      providerID: "qwen",
      model: "qwen-coder-30b0",
      "qwen.trace": true,
      "qwen.logLevel": "debug",
    })
    let message = ""
    ;(vscode.window as unknown as { showErrorMessage: typeof originalError }).showErrorMessage = async (value) => {
      message = String(value)
      return undefined
    }
    const shared = {
      getConnectionState: () => "connected",
      getClientAsync: async () => ({
        kilo: {
          qwenFim: async () => ({ data: undefined, response: new Response(undefined, { status: 401 }) }),
        },
      }),
    }
    const { qwenDiagnosticSmoke } = await import("../../src/services/qwen-autocomplete/smoke")

    await qwenDiagnosticSmoke(shared as never)

    expect(message).toContain("status=401")
    expect(message).toContain("phase=auth-missing")
    expect(message).not.toContain("Authorization")
  })
})

describe("qwen document gating and postprocess", () => {
  it("allows C/C++ headers by extension even when languageId is unstable", () => {
    expect(isQwenSupportedDocument(doc("", { path: "/repo/include/device.h", languageId: "plaintext" }))).toBe(true)
    expect(isQwenSupportedDocument(doc("", { path: "/repo/include/device.hpp", languageId: "cpp" }))).toBe(true)
  })

  it("blocks non-file schemes, unsupported extensions, and clear non-code language ids", () => {
    expect(
      isQwenSupportedDocument(doc("", { path: "/repo/src/main.c", languageId: "markdown", scheme: "untitled" })),
    ).toBe(false)
    expect(isQwenSupportedDocument(doc("", { path: "/repo/src/readme.md", languageId: "markdown" }))).toBe(false)
    expect(isQwenSupportedDocument(doc("", { path: "/repo/src/main.c", languageId: "json" }))).toBe(false)
    expect(isQwenSupportedDocument(doc("", { path: "/repo/src/main.c", languageId: "plaintext" }))).toBe(false)
  })

  it("prefilters empty documents across supported file scopes", () => {
    expect(
      shouldPrefilterQwenDocument(doc("", { path: "/repo/src/main.c", languageId: "c", scheme: "untitled" })),
    ).toBe(true)
    expect(shouldPrefilterQwenDocument(doc("", { path: "/repo/include/device.h", languageId: "plaintext" }))).toBe(true)
    expect(
      shouldPrefilterQwenDocument(doc("int device;", { path: "/repo/include/device.h", languageId: "plaintext" })),
    ).toBe(false)
    expect(shouldPrefilterQwenDocument(doc("", { path: "/repo/src/main.py", languageId: "python" }))).toBe(true)
    expect(
      shouldPrefilterQwenDocument(doc("name: build", { path: "/repo/.gitea/workflows/build.yml", languageId: "yaml" })),
    ).toBe(false)
    expect(shouldPrefilterQwenDocument(doc("", { path: "/repo/src/readme.md", languageId: "markdown" }))).toBe(true)
  })

  it("filters blank, whitespace-only, repeated-line, and extreme repetition completions like Continue", () => {
    expect(post("")).toBeUndefined()
    expect(post("   \n\t")).toBeUndefined()
    expect(post("int value = 1;", { prefix: "int value = 1;\n" })).toBeUndefined()
    expect(post("repeat-value\n".repeat(9).trimEnd())).toBeUndefined()
  })

  it("uses Continue lineIsRepeated original length check before trimming", () => {
    expect(post(" abcd ", { prefix: "  abcd  \n" })).toBeUndefined()
    expect(post("abc ", { prefix: "abc\n" })).toBe("abc ")
  })

  it("removes markdown fences exactly like Continue without stripping inline backticks", () => {
    expect(post("```c\nreturn ok;\n```")).toBe("return ok;")
    expect(post("return `ok`;")).toBe("return `ok`;")
    expect(post("```c\nreturn ok;\n``` trailing")).toBe("return ok;\n``` trailing")
  })

  it("applies Continue generic leading-space postprocess", () => {
    expect(post(" value", { prefix: "return " })).toBe("value")
  })

  it("applies qwen3 think marker cleanup only for lowercase qwen3 model matches", () => {
    expect(post("\n<think>secret</think>\nreturn ok;\n", { model: "qwen3-coder" })).toBe("return ok;")
    expect(post("</think>\nreturn ok;\n", { model: "qwen3-coder" })).toBe("return ok;")
    expect(post("\n<think>secret</think>\nreturn ok;\n", { model: "qwen-coder-30b0" })).toBe(
      "\n<think>secret</think>\nreturn ok;\n",
    )
    expect(post("\n<think>secret</think>\nreturn ok;\n", { model: "QWEN3-CODER" })).toBe(
      "\n<think>secret</think>\nreturn ok;\n",
    )
  })

  it("applies Continue model-specific codestral, granite, mercury, and gemini/gemma branches", () => {
    expect(post(" value", { model: "codestral", prefix: "return ", suffix: "\n}" })).toBe("value")
    expect(post("\nnext", { model: "codestral", prefix: "\n\n" })).toBe("next")
    expect(post("  epr_done();", { model: "granite", prefix: "  epr_" })).toBe("done();")
    expect(post(" status", { model: "mercury", prefix: "ctx->", suffix: "\n}" })).toBe("\n status")
    expect(post("return ok;<|file_separator|>", { model: "gemini" })).toBe("return ok;")
    expect(post("return ok;<|file_separator|>", { model: "gemma" })).toBe("return ok;")
  })

  it("does not keep Phase 1B bootstrap-only postprocess gates", () => {
    const long = "x".repeat(8_001)

    expect(post("return ok;<|fim_middle|>")).toBe("return ok;<|fim_middle|>")
    expect(post("epr_done();", { prefix: "  epr_" })).toBe("epr_done();")
    expect(post("return ok;", { suffix: "return ok;\n}" })).toBe("return ok;")
    expect(post(long)).toBe(long)
  })
})

describe("qwen multiline classification and non-streaming filters", () => {
  it("matches Continue multiline option branches", () => {
    const state = helper("int main() {\n  ", new vscode.Position(1, 2))

    expect(
      shouldCompleteMultilineQwen({
        helper: state,
        position: new vscode.Position(1, 2),
        multilineCompletions: "always",
      }),
    ).toBe(true)
    expect(
      shouldCompleteMultilineQwen({
        helper: state,
        position: new vscode.Position(1, 2),
        multilineCompletions: "never",
      }),
    ).toBe(false)
  })

  it("returns true for selectedCompletionInfo like Continue source", () => {
    const selected = {
      text: "abcdef",
      range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 4)),
    }
    const state = createQwenAutocompleteHelper(doc("// abcd"), new vscode.Position(0, 7), selected)

    expect(shouldCompleteMultilineQwen({ helper: state, position: new vscode.Position(0, 7), selected })).toBe(true)
  })

  it("blocks multiline in C/C++ single-line comments and allows normal code fallback", () => {
    const comment = helper("// comment", new vscode.Position(0, 10))
    const code = helper("int main() {\n  ", new vscode.Position(1, 2))

    expect(shouldCompleteMultilineQwen({ helper: comment, position: new vscode.Position(0, 10) })).toBe(false)
    expect(shouldCompleteMultilineQwen({ helper: code, position: new vscode.Position(1, 2) })).toBe(true)
  })

  it("truncates at Continue stop tokens and diff pattern", () => {
    expect(filtered("return ok;<|fim_prefix|>bad", { stops: QWEN_FIM_STOP })).toBe("return ok;")
    expect(filtered("return ok;\ndiff --git a b\nbad")).toBe("return ok;")
  })

  it("uses Continue stopAtStartOf suffix-start approximation", () => {
    const suffix = "const data = await response.json();\nreturn data.items;"

    expect(filtered("return ok;const data = await response.json();\nreturn data.items;", { suffix })).toBe("return ok;")
  })

  it("truncates at Continue lines-to-stop markers without stopping inside quotes or identifiers", () => {
    expect(filtered("int a;\n# End of file. done\nint b;")).toBe("int a;")
    expect(filtered('int a;\nprintf("# End of file. not really");\nint b;')).toBe(
      'int a;\nprintf("# End of file. not really");\nint b;',
    )
    expect(filtered("int a;\nkeep# End of file.\nint b;")).toBe("int a;\nkeep# End of file.\nint b;")
  })

  it("truncates at exact and similar line below cursor", () => {
    const text = "int main() {\n  \n  finish_long_value_1234();\n}"

    expect(
      filtered("step();\n  finish_long_value_1234();\nafter();", { text, position: new vscode.Position(1, 2) }),
    ).toBe("step();")
    expect(
      filtered("step();\n  finish_long_value_1235();\nafter();", { text, position: new vscode.Position(1, 2) }),
    ).toBe("step();")
  })

  it("keeps Continue lineIsRepeated length and ratio behavior", () => {
    expect(lineIsRepeated(" abcd ", "  abcd  ")).toBe(true)
    expect(lineIsRepeated("abc ", "abc")).toBe(false)
  })

  it("stops at the third consecutive repeated line and yields only the first repeat", () => {
    expect(filtered("a();\nb();\nb();\nb();\nc();")).toBe("a();\nb();")
  })

  it("filters empty comments, path lines, and actual Continue skipPrefixes values", () => {
    const marker = PREFIXES_TO_SKIP[0] ?? ""

    expect(filtered("// Path: src/main.c\nint a;\n//\nint b;")).toBe("int a;\nint b;")
    expect(filtered(`${marker}int a;\nint b;`)).toBe("int a;\nint b;")
    expect(filtered("<|updated_code|>int a;")).toBe("")
  })

  it("stops at double newlines and preserves valid completions", () => {
    expect(filtered("int a;\n\nint b;")).toBe("int a;")
    expect(filtered("int a;")).toBe("int a;")
    expect(filtered("int a;\nint b;")).toBe("int a;\nint b;")
  })

  it("limits completions to one line when multiline is false", () => {
    expect(filtered("int a;\nint b;", { multiline: false })).toBe("int a;")
  })
})

describe("processSingleLineCompletion", () => {
  it("matches Continue simple insert behavior", () => {
    expect(processSingleLineCompletion("status", "", 4)).toEqual({ completionText: "status" })
  })

  it("matches Continue repeated suffix replacement behavior", () => {
    expect(processSingleLineCompletion("hello world", " world", 2)).toEqual({
      completionText: "hello world",
      range: { start: 2, end: 8 },
    })
    expect(processSingleLineCompletion("foo bar baz", " bar", 2)).toEqual({
      completionText: "foo bar baz",
      range: { start: 2, end: 6 },
    })
  })

  it("matches Continue midline insertion behavior", () => {
    expect(processSingleLineCompletion("new", "old", 3)).toEqual({ completionText: "new" })
  })

  it("matches Continue first-added fallback behavior", () => {
    expect(processSingleLineCompletion("new bar", "bar old", 1)).toEqual({ completionText: "new " })
  })

  it("matches Continue default insertion fallback behavior", () => {
    expect(processSingleLineCompletion("foo", "foo bar", 2)).toEqual({ completionText: "foo" })
  })
})

describe("KiloQwenInlineCompletionProvider", () => {
  it("records an ordinary editor request and passes the selected target, workspace, and cancellation signal", async () => {
    const dir = await tempWorkspace()
    let seen: QwenFimCompleteInput | undefined
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, cacheEnabled: false, trace: true, logLevel: "debug" }),
      guard: () => false,
      client: {
        complete: async (input: QwenFimCompleteInput) => {
          seen = input
          input.onResponse?.({ status: 200, endpointSource: "provider-options", serverPhase: "success" })
          return "return editor_ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}", { path: path.join(dir, "main.c") })

    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(seen).toMatchObject({
      directory: dir,
      providerID: "qwen",
      modelID: "qwen-coder-30b0",
      stop: continueQwenCoderEffectiveStops,
    })
    expect(seen?.signal).toBeInstanceOf(AbortSignal)
    const { qwenDiagnosticsForTests } = await import("../../src/services/qwen-autocomplete/diagnostics")
    const lines = qwenDiagnosticsForTests()
    expect(lines.some((line) => line.includes('"requestSource":"editor"'))).toBe(true)
    expect(lines.some((line) => line.includes('"selectionOrigin":"explicit"'))).toBe(true)
    expect(lines.some((line) => line.includes('"endpointSource":"provider-options"'))).toBe(true)
  })

  it("debounces superseded provider requests before calling Qwen", async () => {
    const clock = manualTimers()
    let calls = 0
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, debounceMs: 350 }),
      guard: () => false,
      debouncer: new AutocompleteDebouncer(clock.timers),
      client: {
        complete: async () => {
          calls++
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}")
    const first = provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )
    const second = provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(await first).toEqual([])
    expect(calls).toBe(0)
    clock.run()

    const items = await second
    expect(calls).toBe(1)
    expect(items).toHaveLength(1)
    expect(items[0]!.insertText).toBe("return ok;")
  })

  it("keeps manual invoke available when automatic triggers are disabled and bypasses debounce", async () => {
    const clock = manualTimers()
    let calls = 0
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, autoTrigger: false, debounceMs: 350 }),
      guard: () => false,
      debouncer: new AutocompleteDebouncer(clock.timers),
      client: {
        complete: async () => {
          calls++
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}")

    const automatic = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      { triggerKind: vscode.InlineCompletionTriggerKind.Automatic } as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )
    const manual = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      { triggerKind: vscode.InlineCompletionTriggerKind.Invoke } as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(automatic).toEqual([])
    expect(manual).toHaveLength(1)
    expect(calls).toBe(1)
    expect(clock.size()).toBe(0)
  })

  it("rejects multi-cursor requests before calling Qwen", async () => {
    let calls = 0
    const document = doc("int main() {\n  \n}")
    ;(vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = {
      document,
      selections: [{}, {}],
    }
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: {
        complete: async () => {
          calls++
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })

    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      { triggerKind: vscode.InlineCompletionTriggerKind.Invoke } as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toEqual([])
    expect(calls).toBe(0)
  })

  it("does not call Qwen when cancelled before debounce", async () => {
    let calls = 0
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, debounceMs: 350 }),
      client: {
        complete: async () => {
          calls++
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const cancel = token()
    cancel.cancel()

    const items = await provider.provideInlineCompletionItems(
      doc("int main() {\n  \n}"),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      cancel.value as vscode.CancellationToken,
    )

    expect(items).toEqual([])
    expect(calls).toBe(0)
  })

  it("does not call Qwen when cancelled while waiting for debounce", async () => {
    const clock = manualTimers()
    let calls = 0
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, debounceMs: 350 }),
      debouncer: new AutocompleteDebouncer(clock.timers),
      client: {
        complete: async () => {
          calls++
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const cancel = token()
    const pending = provider.provideInlineCompletionItems(
      doc("int main() {\n  \n}"),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      cancel.value as vscode.CancellationToken,
    )

    cancel.cancel()
    clock.run()

    expect(await pending).toEqual([])
    expect(calls).toBe(0)
  })

  it("does not call Qwen or construct a prompt for .kilocodeignore matches", async () => {
    const root = await tempWorkspace()
    await writeFile(path.join(root, ".kilocodeignore"), "ignored/**\n")
    let calls = 0
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      client: {
        complete: async () => {
          calls++
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}", {
      path: path.join(root, "ignored/main.cpp"),
      languageId: "cpp",
    }) as vscode.TextDocument & { getText: () => string }
    document.getText = () => {
      throw new Error("prompt should not be constructed")
    }

    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toEqual([])
    expect(calls).toBe(0)
  })

  it("blocks lightweight sensitive env patterns before Qwen", async () => {
    const root = await tempWorkspace()
    let calls = 0
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      client: {
        complete: async () => {
          calls++
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })

    const items = await provider.provideInlineCompletionItems(
      doc("int main() {\n  \n}", { path: path.join(root, ".env.cpp"), languageId: "cpp" }),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toEqual([])
    expect(calls).toBe(0)
  })

  it("renders simple fresh qwen responses with Continue item properties", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: { complete: async () => "return ok;" } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}")
    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(items[0]!.insertText).toBe("return ok;")
    expect((items[0]!.range as Range).start).toEqual({ line: 1, character: 2 })
    expect((items[0]!.range as Range).end).toEqual({ line: 1, character: 2 })
    expect((items[0] as unknown as { completeBracketPairs?: boolean }).completeBracketPairs).toBe(true)
  })

  it("filters raw output before applying postprocess", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: { complete: async () => "\n return ok;" } as unknown as QwenFimClient,
      log: () => {},
    })
    const items = await provider.provideInlineCompletionItems(
      doc("int main() {\n  \n}"),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(items[0]!.insertText).toBe("return ok;")
  })

  it("does not render or cache rejected filter results", async () => {
    let puts = 0
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      cache: {
        get: () => undefined,
        put: () => {
          puts++
        },
        setMaxEntries: () => {},
        size: () => 0,
      },
      client: { complete: async () => "<|fim_prefix|>bad" } as unknown as QwenFimClient,
      log: () => {},
    })
    const items = await provider.provideInlineCompletionItems(
      doc("int main() {\n  \n}"),
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toEqual([])
    expect(puts).toBe(0)
  })

  it("uses Continue token-budget pruned prefix and suffix for the Qwen prompt", async () => {
    const seen: { maxTokens?: number; prompt?: string } = {}
    const prefix = Array.from(
      { length: 600 },
      (_, index) => `int pre_${index.toString().padStart(4, "0")}_marker = ${index};`,
    ).join("\n")
    const suffix = Array.from(
      { length: 600 },
      (_, index) => `int suf_${index.toString().padStart(4, "0")}_marker = ${index};`,
    ).join("\n")
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => ({ ...cfg, maxPromptTokens: 128, maxTokens: 7 }),
      guard: () => false,
      client: {
        complete: async (input: QwenFimCompleteInput) => {
          seen.maxTokens = input.maxTokens
          seen.prompt = input.prompt
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc(`${prefix}\nHERE\n${suffix}`)
    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(600, 4),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(seen.maxTokens).toBe(7)
    expect(seen.prompt).toContain("<|fim_prefix|>")
    expect(seen.prompt).toContain("<|fim_suffix|>")
    expect(seen.prompt).toContain("<|fim_middle|>")
    expect(seen.prompt).not.toContain("pre_0000_marker")
    expect(seen.prompt).toContain("pre_0599_marker")
    expect(seen.prompt).toContain("suf_0000_marker")
    expect(seen.prompt).not.toContain("suf_0599_marker")
  })

  it("uses pruned prefix and suffix for postprocess", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: { complete: async () => "\nnext" } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc(`\n\n${"suffix ".repeat(6_000)}`)
    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(2, 0),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(items[0]!.insertText).toBe("next")
  })

  it("renders single-line completions with Continue suffix replacement range", () => {
    const document = doc("int main() {\n   world\n}")
    const item = renderQwenInlineCompletionItem(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      "hello world",
    )

    expect(item?.insertText).toBe("hello world")
    expect((item?.range as Range).start).toEqual({ line: 1, character: 2 })
    expect((item?.range as Range).end).toEqual({ line: 1, character: 8 })
  })

  it("renders multiline completions through the current line end", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: { complete: async () => "hello\nworld" } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("int main() {\n  tail\n}")
    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(items[0]!.insertText).toBe("hello\nworld")
    expect((items[0]!.range as Range).start).toEqual({ line: 1, character: 2 })
    expect((items[0]!.range as Range).end).toEqual({ line: 1, character: 6 })
  })

  it("limits provider completions to one line when multiline classification is false", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: { complete: async () => "first\nsecond" } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("// ")
    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(0, 3),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toHaveLength(1)
    expect(items[0]!.insertText).toBe("first")
  })

  it("rejects invalid selectedCompletionInfo with Continue typed length behavior", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      client: { complete: async () => "should not run" } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("abc")
    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(0, 3),
      {
        selectedCompletionInfo: {
          text: "abcd",
          range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 3)),
        },
      } as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toEqual([])
  })

  it("rejects selectedCompletionInfo when selected text does not start with typed text", async () => {
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      client: { complete: async () => "should not run" } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("abcd")
    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(0, 4),
      {
        selectedCompletionInfo: {
          text: "wxyz",
          range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 4)),
        },
      } as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toEqual([])
  })

  it("uses valid selectedCompletionInfo for prefix construction and rendering", async () => {
    const seen: { prompt?: string } = {}
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: {
        complete: async (input: QwenFimCompleteInput) => {
          seen.prompt = input.prompt
          return "_tail"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("abcd_rest")
    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(0, 4),
      {
        selectedCompletionInfo: {
          text: "abcdef",
          range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 4)),
        },
      } as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(seen.prompt).toBe("<|fim_prefix|>abcdef<|fim_suffix|>_rest<|fim_middle|>")
    expect(items).toHaveLength(1)
    expect(items[0]!.insertText).toBe("abcdef_tail")
    expect((items[0]!.range as Range).start).toEqual({ line: 0, character: 0 })
    expect((items[0]!.range as Range).end).toEqual({ line: 0, character: 0 })
  })

  it("drops stale responses when document version changes", async () => {
    const document = doc("int main() {\n  \n}") as vscode.TextDocument & { version: number }
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      client: {
        complete: async () => {
          document.version = 2
          return "return ok;"
        },
      } as unknown as QwenFimClient,
      log: () => {},
    })

    const items = await provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )

    expect(items).toEqual([])
  })

  it("aborts the prior request when a newer request starts", async () => {
    const signals: AbortSignal[] = []
    const resolvers: Array<(value: string) => void> = []
    const provider = new KiloQwenInlineCompletionProvider({
      read: () => cfg,
      guard: () => false,
      client: {
        complete: (input: QwenFimCompleteInput) =>
          new Promise<string>((resolve) => {
            signals.push(input.signal!)
            resolvers.push(resolve)
          }),
      } as unknown as QwenFimClient,
      log: () => {},
    })
    const document = doc("int main() {\n  \n}")
    const first = provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )
    while (signals.length < 1) {
      await Promise.resolve()
    }
    const second = provider.provideInlineCompletionItems(
      document,
      new vscode.Position(1, 2),
      {} as vscode.InlineCompletionContext,
      token().value as vscode.CancellationToken,
    )
    while (signals.length < 2) {
      await Promise.resolve()
    }

    expect(signals[0]!.aborted).toBe(true)
    resolvers[0]!("return first;")
    resolvers[1]!("return second;")
    expect(await first).toEqual([])
    expect((await second)[0]!.insertText).toBe("return second;")
  })
})
