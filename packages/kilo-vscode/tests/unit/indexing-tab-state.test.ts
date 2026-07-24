import { describe, expect, it } from "bun:test"
import {
  documentRoots,
  extraRoots,
  indexingConfig,
  indexingDescription,
  indexingEnabled,
  indexingEnabledInherited,
  indexingInheritance,
  indexingSource,
  indexingUpdate,
  mergeExternalRoots,
} from "../../webview-ui/src/components/settings/indexing-tab-state"
import { dict as zh } from "../../webview-ui/src/i18n/zh"

const t = (key: string, params?: Record<string, string | number | boolean | undefined>) =>
  (zh[key] ?? key).replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, name: string) => String(params?.[name] ?? ""))

describe("indexing tab scope state", () => {
  it("keeps the workspace root fixed before deduplicated additional roots", () => {
    expect(documentRoots([])).toEqual(["."])
    expect(documentRoots(["/shared", ".", " /manuals ", "/shared"])).toEqual([".", "/shared", "/manuals"])
    expect(extraRoots([".", "/shared", "/manuals"])).toEqual(["/shared", "/manuals"])
  })

  it("deduplicates external approvals without merging project scopes", () => {
    expect(
      mergeExternalRoots(
        [{ path: "/shared" }, { path: "/manuals", workspace: "/repo-a" }],
        [{ path: "/shared" }, { path: "/manuals", workspace: "/repo-b" }],
      ),
    ).toEqual([
      { path: "/shared" },
      { path: "/manuals", workspace: "/repo-a" },
      { path: "/manuals", workspace: "/repo-b" },
    ])
  })

  it("uses the global value when project enablement is inherited", () => {
    expect(indexingEnabled("project", { enabled: true }, {})).toBe(true)
    expect(indexingEnabled("project", { enabled: false }, {})).toBe(false)
    expect(indexingEnabledInherited("project", { enabled: true }, {})).toBe(true)
    expect(indexingEnabledInherited("project", { enabled: false }, {})).toBe(true)
  })

  it("uses explicit project overrides", () => {
    expect(indexingEnabled("project", { enabled: true }, { enabled: false })).toBe(false)
    expect(indexingEnabled("project", { enabled: false }, { enabled: true })).toBe(true)
    expect(indexingEnabledInherited("project", { enabled: true }, { enabled: false })).toBe(false)
  })

  it("ignores project values in global scope", () => {
    const global = { enabled: false, provider: "openai" as const, openai: { apiKey: "global" } }
    const project = { enabled: true, provider: "ollama" as const, ollama: { baseUrl: "http://project" } }

    expect(indexingEnabled("global", global, project)).toBe(false)
    expect(indexingEnabledInherited("global", global, {})).toBe(false)
    expect(indexingConfig("global", global, project)).toEqual(global)
  })

  it("keeps inherited values out of project updates", () => {
    expect(
      indexingUpdate(
        "project",
        { enabled: true, provider: "openai", openai: { apiKey: "global" } },
        { qdrant: { url: "http://project" } },
        { enabled: false },
      ),
    ).toEqual({ enabled: false, qdrant: { url: "http://project" } })
  })

  it("preserves explicit null overrides and recursively inherits undefined leaves", () => {
    expect(
      indexingConfig(
        "project",
        {
          model: "global-model",
          dimension: 1024,
          qdrant: { url: "http://global", apiKey: "global-secret" },
        },
        {
          model: null,
          dimension: null,
          qdrant: { url: "http://project", apiKey: undefined },
        },
      ),
    ).toEqual({
      model: null,
      dimension: null,
      qdrant: { url: "http://project", apiKey: "global-secret" },
    })
  })

  it("classifies inherited and partially inherited fields", () => {
    const global = {
      provider: "openai-compatible" as const,
      model: "global-model",
      dimension: 1024,
      "openai-compatible": { baseUrl: "https://global.test", apiKey: "secret" },
    }
    const project = {
      model: null,
      "openai-compatible": { baseUrl: "https://project.test" },
    }

    expect(indexingInheritance("project", global, project, [["provider"]])).toBe("inherited")
    expect(indexingInheritance("project", global, project, [["model"]])).toBe("none")
    expect(indexingInheritance("project", global, project, [["dimension"]])).toBe("inherited")
    expect(
      indexingInheritance("project", global, project, [
        ["openai-compatible", "baseUrl"],
        ["openai-compatible", "apiKey"],
      ]),
    ).toBe("partial")
    expect(indexingInheritance("global", global, project, [["provider"]])).toBe("none")
    expect(indexingInheritance("project", {}, {}, [["vectorStore"]])).toBe("none")
    expect(indexingSource("project", global, project, [["provider"]])).toBe("global")
    expect(indexingSource("project", global, project, [["model"]])).toBe("local")
    expect(
      indexingSource("project", global, project, [
        ["openai-compatible", "baseUrl"],
        ["openai-compatible", "apiKey"],
      ]),
    ).toBe("mixed")
    expect(indexingSource("project", {}, {}, [["vectorStore"]])).toBe("default")
    expect(indexingSource("global", global, project, [["provider"]])).toBe("none")
    expect(indexingDescription("Configure this value.", "inherited")).toBe(
      "Configure this value. Inherited from global config.",
    )
    expect(indexingDescription("配置此值。", "inherited", t)).toBe("配置此值。 当前继承自全局配置。")
    expect(indexingDescription("配置此值。", "partial", t)).toBe("配置此值。 部分值继承自全局配置。")
  })

  it("merges inherited values with project overrides", () => {
    expect(
      indexingConfig(
        "project",
        {
          enabled: true,
          provider: "openai",
          model: "global-model",
          vectorStore: "qdrant",
          openai: { apiKey: "global" },
          qdrant: { url: "http://global", apiKey: "global-secret" },
        },
        { provider: "ollama", qdrant: { url: "http://project" } },
      ),
    ).toEqual({
      enabled: true,
      provider: "ollama",
      model: "global-model",
      vectorStore: "qdrant",
      openai: { apiKey: "global" },
      qdrant: { url: "http://project", apiKey: "global-secret" },
    })
  })
})
