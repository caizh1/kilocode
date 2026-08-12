import * as vscode from "vscode"

const LEGACY_PROVIDER = "kilo"
const CURRENT_PROVIDER = "chipmate"
const CURRENT_STATUS = "chipmate.legacyMigrationStatus"
const LEGACY_STATUS = "kilo.legacyMigrationStatus"

type Ref = { providerID: string; modelID: string }

export async function migrateLegacyProductState(context: vscode.ExtensionContext): Promise<void> {
  await attempt("settings", migrateSettings)
  await attempt("global state", () => migrateGlobalState(context))
}

/** @internal Exported for focused migration tests. */
export function migrateModelRef(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const ref = value as Partial<Ref>
  if (typeof ref.providerID !== "string" || typeof ref.modelID !== "string") return value
  return { ...value, providerID: provider(ref.providerID) }
}

/** @internal Exported for focused migration tests. */
export function migrateVariantKeys(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [reference(key), item]),
  )
}

async function migrateGlobalState(context: vscode.ExtensionContext) {
  for (const key of ["recentModels", "favoriteModels"] as const) {
    const current = context.globalState.get<unknown>(key)
    if (!Array.isArray(current)) continue
    const next = current.map(migrateModelRef)
    if (JSON.stringify(next) !== JSON.stringify(current)) await context.globalState.update(key, next)
  }

  const variants = context.globalState.get<unknown>("variantSelections")
  const next = migrateVariantKeys(variants)
  if (JSON.stringify(next) !== JSON.stringify(variants)) await context.globalState.update("variantSelections", next)

  if (context.globalState.get(CURRENT_STATUS) !== undefined) return
  const status = context.globalState.get(LEGACY_STATUS)
  if (status !== undefined) await context.globalState.update(CURRENT_STATUS, status)
}

async function migrateSettings() {
  const folders = vscode.workspace.workspaceFolders ?? []
  await migrateSetting("chipmate.v2.model", "providerID", provider)
  await migrateSetting("chipmate.v2.autocomplete", "provider", provider)
  await migrateSetting("chipmate.v2.comments", "model", reference)
  for (const folder of folders) {
    await migrateSetting("chipmate.v2.model", "providerID", provider, folder.uri, true)
    await migrateSetting("chipmate.v2.autocomplete", "provider", provider, folder.uri, true)
    await migrateSetting("chipmate.v2.comments", "model", reference, folder.uri, true)
  }
}

async function migrateSetting(
  section: string,
  key: string,
  transform: (value: string) => string,
  scope?: vscode.Uri,
  folderOnly = false,
) {
  const config = vscode.workspace.getConfiguration(section, scope)
  const inspected = config.inspect<string>(key)
  if (!inspected) return
  const targets = folderOnly
    ? ([[vscode.ConfigurationTarget.WorkspaceFolder, inspected.workspaceFolderValue]] as const)
    : ([
        [vscode.ConfigurationTarget.Global, inspected.globalValue],
        [vscode.ConfigurationTarget.Workspace, inspected.workspaceValue],
      ] as const)
  for (const [target, value] of targets) {
    if (typeof value !== "string") continue
    const next = transform(value)
    if (next !== value) await config.update(key, next, target)
  }
}

function provider(value: string) {
  return value === LEGACY_PROVIDER ? CURRENT_PROVIDER : value
}

function reference(value: string) {
  if (value === LEGACY_PROVIDER) return CURRENT_PROVIDER
  if (value.startsWith(`${LEGACY_PROVIDER}/`)) return `${CURRENT_PROVIDER}/${value.slice(LEGACY_PROVIDER.length + 1)}`
  return value.replaceAll(`/${LEGACY_PROVIDER}/`, `/${CURRENT_PROVIDER}/`)
}

async function attempt(stage: string, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    const category = error instanceof Error ? error.name : typeof error
    console.warn(`[ChipMate] legacy product state migration deferred (${stage}, ${category})`)
  }
}
