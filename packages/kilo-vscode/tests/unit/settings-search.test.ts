import { describe, expect, it } from "bun:test"
import { fields, match, type SettingSearchItem } from "../../webview-ui/src/components/settings/settings-search"

const items: SettingSearchItem[] = [
  {
    id: "field:indexing:dimension",
    kind: "field",
    page: "indexing",
    title: "向量维度",
    description: "向量维度必须与嵌入模型输出一致。",
    path: "知识库与索引 › 索引",
    aliases: ["Vector dimension", "embedding dimension", "嵌入维度"],
    keys: ["settings.indexing.dimension.title", "indexing.dimension"],
  },
  {
    id: "page:indexing",
    kind: "page",
    page: "indexing",
    title: "索引",
    path: "知识库与索引",
    aliases: ["Indexing"],
    keys: ["indexing"],
  },
  {
    id: "field:models:default",
    kind: "field",
    page: "models",
    title: "默认模型",
    description: "所有对话与任务的默认使用模型。",
    path: "连接与模型 › 模型",
    aliases: ["Default model"],
    keys: ["default_model"],
  },
]

describe("settings search", () => {
  it("keeps catalog ids unique and points every field at a real settings page", () => {
    expect(new Set(fields.map((item) => item.id)).size).toBe(fields.length)
    const pages = new Set([
      "models",
      "chipmateServer",
      "autocomplete",
      "context",
      "indexing",
      "checkpoints",
      "agentBehaviour",
      "autoApprove",
      "browser",
      "sandboxing",
      "commitMessage",
      "experimental",
      "display",
      "notifications",
    ])
    expect(fields.every((item) => pages.has(item.page))).toBeTrue()
  })

  it("finds a child setting by current title, bilingual alias and config key", () => {
    expect(match("向量维度", items)[0]?.id).toBe("field:indexing:dimension")
    expect(match("embedding dimension", items)[0]?.id).toBe("field:indexing:dimension")
    expect(match("indexing.dimension", items)[0]?.id).toBe("field:indexing:dimension")
  })

  it("ranks a child title above its containing page", () => {
    expect(match("索引", items).map((item) => item.id)).toEqual(["page:indexing", "field:indexing:dimension"])
  })

  it("supports multi-word description matching without fuzzy guesses", () => {
    expect(match("对话 默认", items)[0]?.id).toBe("field:models:default")
    expect(match("不存在的设置", items)).toEqual([])
    expect(match("", items)).toEqual([])
  })
})
