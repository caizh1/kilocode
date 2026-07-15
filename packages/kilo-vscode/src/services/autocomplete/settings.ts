import * as vscode from "vscode"
import { validAutocompleteModel, validAutocompleteProvider } from "../../shared/autocomplete-models"
import { QWEN_FIM_MODEL_ID } from "../../shared/qwen-autocomplete"
import { autocompleteResource } from "./workspace"

export const QWEN_DEFAULT_STATE = "kilo.autocomplete.qwenDefault"

export type AutocompleteScope = "global" | "workspace" | "workspace-folder" | "none"

export type AutocompleteSelection = {
  providerID?: string
  modelID?: string
  automatic: boolean
  scope?: AutocompleteScope
}

type SelectionEvent = AutocompleteSelection & { scope: AutocompleteScope }

const selections = new vscode.EventEmitter<SelectionEvent>()
let selecting = 0

export const onDidUpdateAutocompleteSelection = selections.event

export function autocompleteSelectionUpdating(): boolean {
  return selecting > 0
}

type Message = {
  type: string
}

type Post = (msg: unknown) => void

export async function routeAutocompleteMessage(
  message: Message,
  post: Post,
  context?: vscode.ExtensionContext,
): Promise<boolean> {
  if (message.type === "requestAutocompleteSettings") {
    post(buildAutocompleteSettingsMessage(context))
    return true
  }

  return false
}

export function buildAutocompleteSettingsMessage(context?: vscode.ExtensionContext) {
  const config = autocompleteConfig()
  const provider = config.get<string>("provider") ?? null
  const model = config.get<string>("model") ?? null
  const automatic = context?.globalState.get<boolean>(QWEN_DEFAULT_STATE, !provider && !model) ?? (!provider && !model)
  // Pass through provider/model as-is (null when unset) so the webview can
  // distinguish "user hasn't picked" from "user picked the current default."
  // The runtime resolves null → DEFAULT_AUTOCOMPLETE_MODEL via getAutocompleteModel().
  return {
    type: "autocompleteSettingsLoaded" as const,
    settings: {
      enableAutoTrigger: config.get<boolean>("enableAutoTrigger", true),
      enableSmartInlineTaskKeybinding: config.get<boolean>("enableSmartInlineTaskKeybinding", false),
      enableChatAutocomplete: config.get<boolean>("enableChatAutocomplete", false),
      provider,
      model,
      automatic,
      scope: autocompleteScope(config),
    },
  }
}

/** Push autocomplete settings to the webview whenever VS Code config changes. */
export function watchAutocompleteConfig(post: Post, context?: vscode.ExtensionContext): vscode.Disposable {
  const config = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("kilo-code.new.autocomplete")) {
      if (autocompleteSelectionUpdating()) return
      post(buildAutocompleteSettingsMessage(context))
    }
  })
  const selection = onDidUpdateAutocompleteSelection(() => post(buildAutocompleteSettingsMessage(context)))
  return vscode.Disposable.from(config, selection)
}

export function autocompleteConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("kilo-code.new.autocomplete", autocompleteResource())
}

export function autocompleteScope(config = autocompleteConfig()): AutocompleteScope {
  const provider = config.inspect?.<string>("provider")
  const model = config.inspect?.<string>("model")
  if (provider?.workspaceFolderValue !== undefined || model?.workspaceFolderValue !== undefined)
    return "workspace-folder"
  if (provider?.workspaceValue !== undefined || model?.workspaceValue !== undefined) return "workspace"
  if (provider?.globalValue !== undefined || model?.globalValue !== undefined) return "global"
  return "none"
}

export function autocompleteTarget(
  config = autocompleteConfig(),
  scope = autocompleteScope(config),
): vscode.ConfigurationTarget {
  if (scope === "workspace-folder") return vscode.ConfigurationTarget.WorkspaceFolder
  if (scope === "workspace") return vscode.ConfigurationTarget.Workspace
  return vscode.ConfigurationTarget.Global
}

export async function updateAutocompleteSelection(
  context: vscode.ExtensionContext,
  selection: AutocompleteSelection,
): Promise<SelectionEvent> {
  const providerID = selection.providerID?.trim() || undefined
  const modelID = selection.modelID?.trim() || undefined
  if (!selection.automatic && (!providerID || !modelID))
    throw new Error("Autocomplete provider and model are required.")
  if (selection.automatic && Boolean(providerID) !== Boolean(modelID))
    throw new Error("Automatic autocomplete target must contain both provider and model.")

  const config = autocompleteConfig()
  const scope = selection.scope ?? autocompleteScope(config)
  const target = autocompleteTarget(config, scope)
  selecting++
  try {
    await context.globalState.update(QWEN_DEFAULT_STATE, selection.automatic)
    if (config.get<string>("provider") !== providerID) await config.update("provider", providerID, target)
    if (config.get<string>("model") !== modelID) await config.update("model", modelID, target)
  } finally {
    selecting--
  }
  const event = { providerID, modelID, automatic: selection.automatic, scope }
  selections.fire(event)
  return event
}

export async function resetAutocompleteAfterProviderRemoval(
  context: vscode.ExtensionContext,
  providerID: string,
): Promise<boolean> {
  if (autocompleteConfig().get<string>("provider") !== providerID) return false
  await updateAutocompleteSelection(context, { automatic: true })
  return true
}

export function validAutocompleteSetting(key: string, value: unknown) {
  if (key === "model") {
    // Allow clearing back to the server-side default.
    if (value === null || value === undefined) return true
    return validAutocompleteModel(value) || value === QWEN_FIM_MODEL_ID
  }

  if (key === "provider") {
    if (value === null || value === undefined) return true
    return validAutocompleteProvider(value) || typeof value === "string"
  }

  if (key === "enableAutoTrigger") return typeof value === "boolean"
  if (key === "enableSmartInlineTaskKeybinding") return typeof value === "boolean"
  if (key === "enableChatAutocomplete") return typeof value === "boolean"

  return false
}
