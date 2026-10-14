/** 内网发行包提供替换关系；此模块不包含任何私有模型或服务地址。 */
export type ModelReplacements = { providerID: string; models: Record<string, string> }
export type ModelReference = { providerID: string; modelID: string }

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function parseModelReplacements(source: string | undefined): ModelReplacements | undefined {
  if (!source?.trim()) return undefined
  const value: unknown = JSON.parse(source)
  if (
    !object(value) ||
    typeof value.providerID !== "string" ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(value.providerID) ||
    !object(value.models)
  )
    throw new Error("模型替换配置格式无效")
  const entries = Object.entries(value.models)
  if (
    !entries.length ||
    entries.length > 64 ||
    entries.some(
      ([before, after]) =>
        !before.trim() ||
        before !== before.trim() ||
        typeof after !== "string" ||
        !after.trim() ||
        after !== after.trim() ||
        before.length > 256 ||
        after.length > 256 ||
        before === after ||
        Object.hasOwn(value.models as object, after),
    )
  )
    throw new Error("模型替换必须指向最终模型，不能为空、自引用或包含替换链")
  return { providerID: value.providerID, models: Object.fromEntries(entries) as Record<string, string> }
}

export function replaceModelID(providerID: string, modelID: string, policy?: ModelReplacements): string {
  return policy?.providerID === providerID && Object.hasOwn(policy.models, modelID) ? policy.models[modelID]! : modelID
}

export function replaceModelReference<T extends ModelReference>(ref: T, policy?: ModelReplacements): T {
  const modelID = replaceModelID(ref.providerID, ref.modelID, policy)
  return modelID === ref.modelID ? ref : { ...ref, modelID }
}

export function replaceModelString(value: string, policy?: ModelReplacements): string {
  const slash = value.indexOf("/")
  if (slash < 1) return value
  const providerID = value.slice(0, slash)
  return `${providerID}/${replaceModelID(providerID, value.slice(slash + 1), policy)}`
}

export function replaceVariantKeys<T>(values: Record<string, T>, policy?: ModelReplacements): Record<string, T> {
  if (!policy) return values
  const result = { ...values }
  for (const [key, value] of Object.entries(values)) {
    for (const [before, after] of Object.entries(policy.models)) {
      const suffix = `${policy.providerID}/${before}`
      if (key !== suffix && !(/^(agent|session)\/[^/]+\//.test(key) && key.endsWith(`/${suffix}`))) continue
      const next = key.slice(0, key.length - suffix.length) + `${policy.providerID}/${after}`
      if (!Object.hasOwn(result, next)) result[next] = value
      delete result[key]
    }
  }
  return result
}

export function replaceModelKeys<T>(models: Record<string, T>, policy?: ModelReplacements): Record<string, T> {
  if (!policy) return models
  const result: Record<string, T> = { ...models }
  for (const [before, after] of Object.entries(policy.models)) {
    if (!Object.hasOwn(result, before)) continue
    const old = result[before]
    if (!Object.hasOwn(result, after)) {
      result[after] = (
        object(old)
          ? {
              ...old,
              ...(typeof old.id === "string" ? { id: after } : {}),
              ...(old.name === before ? { name: after } : {}),
            }
          : old
      ) as T
    }
    delete result[before]
  }
  for (const [key, model] of Object.entries(result)) {
    if (object(model) && typeof model.id === "string") {
      const id = replaceModelID(policy.providerID, model.id, policy)
      if (id !== model.id) result[key] = { ...model, id } as T
    }
  }
  return result
}

/** 只转换配置中有模型含义的字段；不遍历提示词、历史记录或任意字符串。 */
export function replaceConfigModels<T>(config: T, policy?: ModelReplacements): T {
  if (!policy || !object(config)) return config
  const result = { ...config }
  const record = result as Record<string, unknown>
  for (const key of ["model", "small_model"]) {
    if (typeof record[key] === "string") record[key] = replaceModelString(record[key], policy)
  }
  for (const key of ["agent", "command"]) {
    const items = record[key]
    if (object(items))
      record[key] = Object.fromEntries(
        Object.entries(items).map(([id, item]) => [
          id,
          object(item) && typeof item.model === "string"
            ? { ...item, model: replaceModelString(item.model, policy) }
            : item,
        ]),
      )
  }
  if (object(record.provider)) {
    const provider = record.provider[policy.providerID]
    if (object(provider)) {
      const next = { ...provider }
      if (object(next.models)) next.models = replaceModelKeys(next.models, policy)
      for (const key of ["whitelist", "blacklist"]) {
        const models = next[key]
        if (Array.isArray(models))
          next[key] = [
            ...new Set(
              models.map((id) => (typeof id === "string" ? replaceModelID(policy.providerID, id, policy) : id)),
            ),
          ]
      }
      record.provider = { ...record.provider, [policy.providerID]: next }
    }
  }
  return result
}
