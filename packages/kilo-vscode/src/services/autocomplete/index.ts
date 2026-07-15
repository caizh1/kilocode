import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import { AutocompleteServiceManager } from "./AutocompleteServiceManager"
import { registerQwenAutocompleteProvider } from "../qwen-autocomplete"
import { QWEN_FIM_MODEL_ID, isQwenFimTarget } from "../../shared/qwen-autocomplete"
import { AUTOCOMPLETE_MODELS, DEFAULT_AUTOCOMPLETE_MODEL } from "../../shared/autocomplete-models"
import { isInternalOfflineBuild } from "../../shared/internal-offline"
import {
  autocompleteConfig,
  type AutocompleteScope,
  autocompleteSelectionUpdating,
  onDidUpdateAutocompleteSelection,
  QWEN_DEFAULT_STATE,
  updateAutocompleteSelection,
} from "./settings"
import { autocompleteDirectory } from "./workspace"

const LAST_TARGET = "kilo.autocomplete.lastBuiltinTarget"
const LEGACY_QWEN_FIM_MODEL_ID = QWEN_FIM_MODEL_ID.replace(/^qwen-/, "qwen3-")

type Target = { providerID: string; modelID: string }

type ProviderList = {
  all?: Array<{
    id: string
    models: Record<string, { id: string; api?: { npm?: string } }>
  }>
  connected?: string[]
}

type Manager = Pick<AutocompleteServiceManager, "dispose" | "load">

type Options = {
  manager?: () => Manager
  qwen?: (providerID?: string, directory?: string) => Promise<Target | undefined>
  gateway?: () => Promise<boolean>
  directory?: () => string | undefined
  internal?: boolean
  notify?: (message: string) => void
  log?: (message: string, err?: unknown) => void
}

type Resolution = {
  ok: boolean
  target?: Target
}

function key(providerID: string | undefined, modelID: string | undefined): string {
  return `${providerID ?? ""}\u0000${modelID ?? ""}`
}

function builtin(providerID: string | undefined, modelID: string | undefined): Target | undefined {
  if (!providerID || !modelID) return undefined
  if (!AUTOCOMPLETE_MODELS.some((model) => model.providerID === providerID && model.modelID === modelID))
    return undefined
  return { providerID, modelID }
}

async function qwen(
  connection: KiloConnectionService,
  providerID?: string,
  directory?: string,
): Promise<Target | undefined> {
  if (!directory) return undefined
  const client = await connection.getClientAsync()
  const result = await client.provider.list({ directory }, { throwOnError: true })
  const data = result.data as unknown as ProviderList | undefined
  for (const provider of data?.all ?? []) {
    if (providerID && provider.id !== providerID) continue
    if (!(data?.connected ?? []).includes(provider.id)) continue
    if (
      Object.values(provider.models).some(
        (model) => model.id === QWEN_FIM_MODEL_ID && model.api?.npm === "@ai-sdk/openai-compatible",
      )
    ) {
      return { providerID: provider.id, modelID: QWEN_FIM_MODEL_ID }
    }
  }
  return undefined
}

async function gateway(connection: KiloConnectionService): Promise<boolean> {
  const client = await connection.getClientAsync()
  const result = await client.kilo.profile(undefined, { throwOnError: false })
  return result.response.ok && Boolean(result.data)
}

export class Coordinator implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext
  private readonly managerFactory: () => Manager
  private readonly resolver: (providerID?: string, directory?: string) => Promise<Target | undefined>
  private readonly gateway: () => Promise<boolean>
  private readonly directory: () => string | undefined
  private readonly internal: boolean
  private readonly notify: (message: string) => void
  private readonly log: (message: string, err?: unknown) => void
  private readonly selectionListener: vscode.Disposable
  private manager: Manager | undefined
  private active: Target | undefined
  private pending = false
  private task: Promise<void> | null = null
  private disposed = false
  private stateQueued = false
  private origin: boolean | undefined
  private scope: AutocompleteScope | undefined
  private notice: string | undefined

  constructor(context: vscode.ExtensionContext, connection: KiloConnectionService, options: Options = {}) {
    this.context = context
    this.managerFactory = options.manager ?? (() => new AutocompleteServiceManager(context, connection))
    this.directory = options.directory ?? autocompleteDirectory
    this.resolver = options.qwen ?? ((providerID, directory) => qwen(connection, providerID, directory))
    this.gateway = options.gateway ?? (() => gateway(connection))
    this.internal = options.internal ?? isInternalOfflineBuild()
    this.notify = options.notify ?? ((message) => void vscode.window.showInformationMessage?.(message))
    this.log = options.log ?? ((message, err) => console.warn(message, err ?? ""))
    this.selectionListener = onDidUpdateAutocompleteSelection((event) =>
      this.selection(event.automatic, event.scope),
    ) ?? {
      dispose: () => undefined,
    }
  }

  schedule(): void {
    if (this.disposed) return
    this.pending = true
    if (this.task) return
    this.task = Promise.resolve()
      .then(() => this.drain())
      .catch((err) => this.log("[Autocomplete] reconcile failed", err))
      .finally(() => {
        this.task = null
        this.stateQueued = false
        if (this.pending) this.schedule()
      })
  }

  change(): void {
    this.origin = false
    this.schedule()
  }

  selection(automatic: boolean, scope?: AutocompleteScope): void {
    this.origin = automatic
    this.scope = scope
    this.schedule()
  }

  state(): void {
    if (this.task) {
      if (this.stateQueued) return
      this.stateQueued = true
    }
    this.schedule()
  }

  async flush(): Promise<void> {
    while (this.task) await this.task
  }

  dispose(): void {
    this.disposed = true
    this.pending = false
    this.selectionListener.dispose()
    this.disposeManager()
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.disposed) {
      this.pending = false
      await this.reconcile()
    }
  }

  private async reconcile(): Promise<void> {
    const cfg = autocompleteConfig()
    const providerID = cfg.get<string>("provider")
    const modelID = cfg.get<string>("model")
    const automatic = this.origin ?? this.context.globalState.get<boolean>(QWEN_DEFAULT_STATE, !providerID && !modelID)
    this.origin = undefined
    const scope = this.scope
    this.scope = undefined
    if (await this.migrate(providerID, modelID, automatic, scope)) return
    const current = key(providerID, modelID)
    await this.context.globalState.update(QWEN_DEFAULT_STATE, automatic)

    if (isQwenFimTarget(providerID, modelID)) {
      this.disposeManager()
      const result = await this.resolve(providerID)
      if (!result.ok) return
      if (result.target) {
        this.notice = undefined
        return
      }
      if (!automatic) {
        this.tell("Selected Qwen Provider is temporarily unavailable")
        return
      }
      if (await this.canFallback()) {
        await this.write(DEFAULT_AUTOCOMPLETE_MODEL, true, scope)
        return
      }
      await this.clear()
      this.tell("No compatible Qwen Provider is currently available for autocomplete")
      return
    }

    const selected = builtin(providerID, modelID)
    if (selected) {
      if (automatic) {
        const result = await this.resolve()
        if (result.target) {
          await this.write(result.target, true, scope)
          return
        }
        if (!result.ok) return
        if (!(await this.canFallback())) {
          this.disposeManager()
          await this.clear()
          this.tell("No compatible Qwen Provider is currently available for autocomplete")
          return
        }
      }
      await this.activate(selected)
      this.notice = undefined
      return
    }

    if (current !== "\u0000") {
      this.disposeManager()
      this.log("[Autocomplete] incomplete or unsupported autocomplete target; waiting for a complete selection")
      return
    }

    if (!automatic) {
      this.disposeManager()
      this.log("[Autocomplete] no explicit autocomplete target is selected")
      return
    }
    const result = await this.resolve()
    if (!result.ok) return
    if (result.target) {
      await this.write(result.target, true, scope)
      return
    }
    if (await this.canFallback()) {
      await this.write(DEFAULT_AUTOCOMPLETE_MODEL, true, scope)
      return
    }
    this.disposeManager()
    this.tell("No compatible Qwen Provider is currently available for autocomplete")
  }

  private async migrate(
    providerID: string | undefined,
    modelID: string | undefined,
    automatic: boolean,
    scope?: AutocompleteScope,
  ): Promise<boolean> {
    if (!providerID || modelID !== LEGACY_QWEN_FIM_MODEL_ID) return false
    await this.write({ providerID, modelID: QWEN_FIM_MODEL_ID }, automatic, scope)
    return true
  }

  private async resolve(providerID?: string): Promise<Resolution> {
    try {
      return { ok: true, target: await this.resolver(providerID, this.directory()) }
    } catch (err) {
      this.log("[Autocomplete] unable to resolve Qwen autocomplete target", err)
      return { ok: false }
    }
  }

  private async canFallback(): Promise<boolean> {
    if (this.internal) return false
    try {
      return await this.gateway()
    } catch (err) {
      this.log("[Autocomplete] unable to verify ChipMate Gateway authentication", err)
      return false
    }
  }

  private async write(target: Target, automatic: boolean, scope?: AutocompleteScope): Promise<void> {
    await updateAutocompleteSelection(this.context, { ...target, automatic, scope })
    this.origin = automatic
    this.scope = scope
    this.schedule()
  }

  private async clear(): Promise<void> {
    const cfg = autocompleteConfig()
    if (cfg.get<string>("provider") === undefined && cfg.get<string>("model") === undefined) return
    await updateAutocompleteSelection(this.context, { automatic: true })
    this.origin = true
    this.schedule()
  }

  private tell(message: string): void {
    this.log(`[Autocomplete] ${message}`)
    if (this.notice === message) return
    this.notice = message
    this.notify(message)
  }

  private async activate(target: Target): Promise<void> {
    await this.context.globalState.update(LAST_TARGET, target)
    if (!this.manager) {
      this.manager = this.managerFactory()
      this.active = target
      return
    }
    if (this.active?.providerID === target.providerID && this.active.modelID === target.modelID) return
    this.active = target
    await this.manager.load()
  }

  private disposeManager(): void {
    this.manager?.dispose()
    this.manager = undefined
    this.active = undefined
  }
}

export const registerAutocompleteProvider = (context: vscode.ExtensionContext, connection: KiloConnectionService) => {
  registerQwenAutocompleteProvider(context, connection)
  const coordinator = new Coordinator(context, connection)
  const watcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("kilo-code.new.autocomplete")) return
    if (autocompleteSelectionUpdating()) return
    coordinator.change()
  })
  const state = connection.onStateChange(() => coordinator.state())
  coordinator.schedule()
  context.subscriptions.push(watcher, coordinator, { dispose: state })

  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.autocomplete.reload", () => {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.codeActionQuickFix", () => {
      return
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.cancelSuggestions", () => {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.hide")
      void vscode.commands.executeCommand("setContext", "kilo-code.new.autocomplete.hasSuggestions", false)
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.generateSuggestions", () => {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.showIncompatibilityExtensionPopup", () => {
      return
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.disable", () => {
      return
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.nextEdit.acceptOrJump", () => {
      return
    }),
    vscode.commands.registerCommand("kilo-code.new.autocomplete.nextEdit.dismiss", () => {
      return
    }),
  )
}
