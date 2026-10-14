import * as vscode from "vscode"
import {
  replaceModelReference,
  replaceVariantKeys,
} from "@opencode-ai/core/chipmate/model-replacements"
import { internalModelReplacements } from "../shared/internal-offline"
import { diagnostic } from "../services/diagnostics/record"

/** 只升级当前发行包明确退休的模型；可重复执行，不用一次性标记跳过其他工作区。 */
export async function migratePackagedModelState(context: vscode.ExtensionContext) {
  const policy = internalModelReplacements()
  if (!policy) return
  const save = async (key: string, value: unknown, next: unknown) => {
    if (JSON.stringify(value) === JSON.stringify(next)) return
    await context.globalState.update(key, next)
    diagnostic("已升级退休模型的本地选择", { stage: key }, "INFO", "provider.models")
  }
  try {
    for (const key of ["recentModels", "favoriteModels"]) {
      const value = context.globalState.get<unknown>(key)
      if (!Array.isArray(value)) continue
      const seen = new Set<string>()
      const next = value
        .map((item: unknown) => {
          if (
            !item ||
            typeof item !== "object" ||
            !("providerID" in item) ||
            !("modelID" in item) ||
            typeof item.providerID !== "string" ||
            typeof item.modelID !== "string"
          )
            return item
          return replaceModelReference({ ...item, providerID: item.providerID, modelID: item.modelID }, policy)
        })
        .filter((item) => {
          const identity = JSON.stringify(item)
          if (seen.has(identity)) return false
          seen.add(identity)
          return true
        })
      await save(key, value, next)
    }
    const variants = context.globalState.get<Record<string, string>>("variantSelections")
    if (variants && typeof variants === "object" && !Array.isArray(variants))
      await save("variantSelections", variants, replaceVariantKeys(variants, policy))
    // VS Code 的模型与提供商可以跨作用域继承；在最终选择恢复时组合后转换，避免改写全局值影响其他提供商。
  } catch (error) {
    diagnostic(
      "退休模型选择持久化未完成，继续使用运行时兼容映射",
      { name: error instanceof Error ? error.name : typeof error },
      "WARN",
      "provider.models",
    )
  }
}
