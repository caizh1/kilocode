import type { IndexingConfig } from "@chipmate/chipmate-indexing/config"
import type { UiI18nParams } from "@chipmate/chipmate-ui/context"

export type IndexingScope = "global" | "project"
export type IndexingInheritance = "none" | "inherited" | "partial"
export type IndexingSource = "none" | "global" | "local" | "mixed" | "default"

type Translate = (key: string, params?: UiI18nParams) => string

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function mergeEffective(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (record(value) && record(result[key])) {
      result[key] = mergeEffective(result[key], value)
      continue
    }
    result[key] = value
  }
  return result
}

function mergeUpdate(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (record(value) && record(result[key])) {
      result[key] = mergeUpdate(result[key], value)
      continue
    }
    result[key] = value
  }
  return result
}

function get(input: IndexingConfig, path: readonly string[]) {
  return path.reduce<unknown>((value, key) => (record(value) ? value[key] : undefined), input)
}

export function indexingConfig(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  if (scope === "global") return global
  return mergeEffective(global, project) as IndexingConfig
}

export function indexingUpdate(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  patch: IndexingConfig,
) {
  return mergeUpdate(scope === "global" ? global : project, patch) as IndexingConfig
}

export function indexingSource(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  paths: readonly (readonly string[])[],
): IndexingSource {
  if (scope !== "project") return "none"
  const local = paths.filter((path) => get(project, path) !== undefined).length
  const inherited = paths.filter((path) => get(project, path) === undefined && get(global, path) !== undefined).length
  if (local > 0 && inherited > 0) return "mixed"
  if (local > 0) return "local"
  if (inherited > 0) return "global"
  return "default"
}

export function indexingInheritance(
  scope: IndexingScope,
  global: IndexingConfig,
  project: IndexingConfig,
  paths: readonly (readonly string[])[],
): IndexingInheritance {
  const source = indexingSource(scope, global, project, paths)
  if (source === "global") return "inherited"
  if (source === "mixed") return "partial"
  return "none"
}

export function indexingDescription(description: string, inheritance: IndexingInheritance, t?: Translate) {
  if (inheritance === "inherited" && t) {
    return t("settings.indexing.inheritance.inherited", { description })
  }
  if (inheritance === "partial" && t) {
    return t("settings.indexing.inheritance.partial", { description })
  }
  if (inheritance === "inherited") return `${description} Inherited from global config.`
  if (inheritance === "partial") return `${description} Some values are inherited from global config.`
  return description
}

export function indexingEnabled(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  return indexingConfig(scope, global, project).enabled === true
}

export function indexingEnabledInherited(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  return indexingInheritance(scope, global, project, [["enabled"]]) === "inherited"
}

export function mergeExternalRoots(
  current: NonNullable<NonNullable<IndexingConfig["documents"]>["approvedExternalRoots"]>,
  next: NonNullable<NonNullable<IndexingConfig["documents"]>["approvedExternalRoots"]>,
) {
  return [...new Map([...current, ...next].map((item) => [`${item.workspace ?? "*"}\0${item.path}`, item])).values()]
}

export function documentRoots(paths: string[] = []) {
  const roots = paths.map((item) => item.trim()).filter((item) => item && item !== ".")
  return [".", ...new Set(roots)]
}

export function extraRoots(paths: string[] = []) {
  return documentRoots(paths).slice(1)
}
