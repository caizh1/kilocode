export type SettingSearchField = {
  id: string
  page: string
  title: string
  description?: string
  terms?: readonly string[]
}

export type SettingSearchItem = {
  id: string
  kind: "page" | "field"
  page: string
  title: string
  description?: string
  path: string
  aliases: readonly string[]
  keys: readonly string[]
}

const field = (
  page: string,
  title: string,
  terms: readonly string[] = [],
  description = title.endsWith(".title") ? title.replace(/\.title$/, ".description") : undefined,
): SettingSearchField => ({
  id: `${page}:${title}`,
  page,
  title,
  description,
  terms,
})

export const fields: readonly SettingSearchField[] = [
  field("models", "settings.providers.defaultModel.title", ["model", "default_model", "default model"]),
  field("models", "settings.providers.smallModel.title", ["small_model", "small model"]),
  field("models", "settings.providers.subagentModel.title", ["subagent_model", "subagent model"]),
  field("models", "settings.autocomplete.model.title", ["autocomplete.model", "autocomplete model"]),
  field("models", "settings.models.speechToTextModel.title", ["speech_to_text_model", "speech to text model"]),
  field("models", "settings.models.hidePromptTraining.title", ["hide_prompt_training_models"]),

  field("chipmateServer", "settings.chipmateServer.address.title", [
    "chipmate.server.baseUrl",
    "server address",
    "服务器地址",
  ]),
  field("chipmateServer", "settings.chipmateServer.autoUpdate.title", [
    "updateCheck.autoInstall",
    "automatic updates",
    "自动更新",
  ]),

  field("autocomplete", "settings.autocomplete.autoTrigger.title", ["autocomplete.autoTrigger"]),
  field("autocomplete", "settings.autocomplete.smartKeybinding.title", ["autocomplete.smartKeybinding"]),
  field("autocomplete", "settings.autocomplete.chatAutocomplete.title", ["autocomplete.chatAutocomplete"]),

  field("context", "settings.context.memory.project.title", ["memory", "project memory", "项目记忆"]),
  field("context", "settings.context.memory.autoSave.title", ["memory.autoSave"]),
  field("context", "settings.context.memory.storage.title", ["memory.storage"]),
  field("context", "settings.context.autoCompaction.title", ["compaction.auto", "automatic compaction"]),
  field("context", "settings.context.compactionLimit.title", ["compaction.limit"]),
  field("context", "settings.context.prune.title", ["compaction.prune"]),

  field("indexing", "settings.indexing.scope.title", ["indexing.scope", "index scope", "索引范围"]),
  field("indexing", "settings.indexing.showButton.title", ["indexing.showButton"]),
  field("indexing", "settings.indexing.provider.title", ["indexing.provider", "embedding provider", "嵌入提供商"]),
  field("indexing", "settings.indexing.dimension.title", [
    "indexing.dimension",
    "embedding dimension",
    "嵌入维度",
    "vector dimension",
  ]),
  field("indexing", "settings.indexing.vectorStore.title", ["indexing.vectorStore", "vector database", "向量数据库"]),
  field("indexing", "settings.indexing.documents.title", ["indexing.documents"]),
  field("indexing", "settings.indexing.documents.workspace.title", ["indexing.documents.workspace"]),
  field("indexing", "settings.indexing.documents.folders.title", ["indexing.documents.folders"]),
  field("indexing", "settings.indexing.documents.include.title", ["indexing.documents.include"]),
  field("indexing", "settings.indexing.documents.exclude.title", ["indexing.documents.exclude"]),
  field("indexing", "settings.indexing.documents.maxFileBytes.title", ["indexing.documents.maxFileBytes"]),
  field("indexing", "settings.indexing.documents.chunkChars.title", ["indexing.documents.chunkChars"]),
  field("indexing", "settings.indexing.documents.chunkOverlapChars.title", ["indexing.documents.chunkOverlapChars"]),
  field("indexing", "settings.indexing.documents.searchMaxResults.title", ["indexing.documents.searchMaxResults"]),
  field("indexing", "settings.indexing.tuning.searchMinScore", ["indexing.searchMinScore"], ""),
  field("indexing", "settings.indexing.tuning.searchMaxResults", ["indexing.searchMaxResults"], ""),
  field("indexing", "settings.indexing.tuning.embeddingBatchSize", ["indexing.embeddingBatchSize"], ""),
  field("indexing", "settings.indexing.tuning.scannerMaxBatchRetries", ["indexing.scannerMaxBatchRetries"], ""),

  field("checkpoints", "settings.checkpoints.enable.title", ["snapshot", "checkpoints.enabled"]),

  field("agentBehaviour", "settings.agentBehaviour.defaultAgent.title", ["default_agent", "default agent"]),
  field("agentBehaviour", "settings.agentBehaviour.claudeCompat.title", ["claude compatibility"]),

  field("autoApprove", "settings.autoApprove.maxCost.title", ["maxCost", "maximum cost"]),

  field("browser", "settings.browser.enable.title", ["browserAutomation.enabled"]),
  field("browser", "settings.browser.systemChrome.title", ["browserAutomation.useSystemChrome"]),
  field("browser", "settings.browser.headless.title", ["browserAutomation.headless"]),

  field("sandboxing", "settings.sandboxing.enabled.title", ["sandbox.enabled"]),
  field("sandboxing", "settings.sandboxing.network.title", ["sandbox.network"]),
  field("sandboxing", "settings.sandboxing.allowedHosts.title", ["sandbox.allowedHosts"]),
  field("sandboxing", "settings.sandboxing.writablePaths.title", ["sandbox.writablePaths"]),

  field("commitMessage", "settings.commitMessage.override.title", ["commitMessage.override"]),

  field("experimental", "settings.experimental.share.title", ["experimental.share"]),
  field("experimental", "settings.experimental.formatter.title", ["experimental.formatter"]),
  field("experimental", "settings.experimental.lsp.title", ["experimental.lsp"]),
  field("experimental", "settings.experimental.batch.title", ["experimental.batch"]),
  field("experimental", "settings.experimental.codebaseSearch.title", ["experimental.codebaseSearch"]),
  field("experimental", "settings.experimental.dsml.title", ["experimental.dsml"]),
  field("experimental", "settings.experimental.imageGeneration.title", ["experimental.imageGeneration"]),
  field("experimental", "settings.experimental.nativeNotebookTools.title", ["experimental.nativeNotebookTools"]),
  field("experimental", "settings.experimental.continueOnDeny.title", ["experimental.continueOnDeny"]),
  field("experimental", "settings.experimental.swePruner.title", ["experimental.swePruner"]),
  field("experimental", "settings.experimental.mcpTimeout.title", ["experimental.mcpTimeout"]),

  field("display", "settings.display.username.title", ["display.username"]),
  field("display", "settings.display.fontSize.title", ["display.fontSize"]),
  field("display", "settings.display.reasoningAutoCollapse.title", ["display.reasoningAutoCollapse"]),
  field("display", "settings.display.shiftTabCycle.title", ["display.shiftTabCycle"]),
  field("display", "settings.display.tokenThroughput.title", ["display.tokenThroughput"]),
  field("display", "settings.display.terminalCommand.title", ["display.terminalCommand"]),
  field("display", "settings.display.codeEdit.title", ["display.codeEdit"]),

  field("notifications", "settings.notifications.enable.title", ["attention.enabled"]),
  field(
    "notifications",
    "settings.notifications.sounds",
    ["attention.sound", "notification sound"],
    "settings.notifications.sound.description",
  ),
]

const norm = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[._/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const score = (term: string, values: readonly string[], base: number) => {
  const query = norm(term)
  const words = query.split(" ").filter(Boolean)
  const hay = values.map(norm).filter(Boolean)
  if (words.some((word) => !hay.some((value) => value.includes(word)))) return 0
  if (hay.some((value) => value === query)) return base + 80
  if (hay.some((value) => value.startsWith(query))) return base + 50
  if (hay.some((value) => value.includes(query))) return base + 30
  return base
}

export const match = (term: string, items: readonly SettingSearchItem[]) => {
  const query = norm(term)
  if (!query) return []
  return items
    .map((item, index) => {
      const rank = Math.max(
        score(query, [item.title], 500),
        score(query, item.aliases, 420),
        score(query, item.keys, 360),
        score(query, [item.path], 260),
        score(query, item.description ? [item.description] : [], 180),
      )
      return { item, rank, index }
    })
    .filter((result) => result.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((result) => result.item)
}
