import type { ExtensionMessage, WebviewMessage } from "../types/messages"

type Transport = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

type Selection = {
  providerID: string
  modelID: string
}

type Activation = "activated" | "preserved"

export function shouldActivateQuickAutocomplete(settings: Record<string, unknown>): boolean {
  if (settings["autocomplete.automatic"] === false) return false
  if (settings["autocomplete.automatic"] === true) return true
  const provider = settings["autocomplete.provider"]
  const model = settings["autocomplete.model"]
  return (provider === null || provider === undefined) && (model === null || model === undefined)
}

export function requestAutocompleteSelection(vscode: Transport, selection: Selection, timeout = 10_000) {
  return new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const pending = new Set(["autocomplete.provider", "autocomplete.model"])
    const timer = setTimeout(() => finish(new Error("Timed out while enabling autocomplete.")), timeout)
    const unsubscribe = vscode.onMessage((message) => {
      if (!("requestId" in message) || message.requestId !== requestId) return
      if (message.type === "settingUpdateFailed") {
        finish(new Error(message.message))
        return
      }
      if (message.type !== "settingUpdated" || !pending.has(message.key)) return
      pending.delete(message.key)
      if (pending.size === 0) finish()
    })

    function finish(error?: Error) {
      clearTimeout(timer)
      unsubscribe()
      if (error) {
        reject(error)
        return
      }
      resolve()
    }

    vscode.postMessage({
      type: "updateAutocompleteSelection",
      providerID: selection.providerID,
      modelID: selection.modelID,
      automatic: true,
      requestId,
    })
  })
}

export function activateQuickAutocomplete(vscode: Transport, selection: Selection, timeout = 10_000) {
  return requestAutocompleteSettings(vscode, timeout).then((settings): Promise<Activation> => {
    if (!shouldActivateQuickAutocomplete(settings)) return Promise.resolve("preserved")
    return requestAutocompleteSelection(vscode, selection, timeout).then(() => "activated")
  })
}

function requestAutocompleteSettings(vscode: Transport, timeout: number) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Timed out while reading autocomplete settings.")), timeout)
    const unsubscribe = vscode.onMessage((message) => {
      if (message.type !== "autocompleteSettingsLoaded") return
      finish(undefined, {
        "autocomplete.provider": message.settings.provider,
        "autocomplete.model": message.settings.model,
        "autocomplete.automatic": message.settings.automatic,
      })
    })

    function finish(error?: Error, settings?: Record<string, unknown>) {
      clearTimeout(timer)
      unsubscribe()
      if (error) {
        reject(error)
        return
      }
      resolve(settings ?? {})
    }

    vscode.postMessage({ type: "requestAutocompleteSettings" })
  })
}

export function buildAutocompleteSettingMessages(
  pending: Record<string, unknown>,
  current: Record<string, unknown>,
  requestId: string,
): WebviewMessage[] {
  const providerKey = "autocomplete.provider"
  const modelKey = "autocomplete.model"
  const selectionDirty = providerKey in pending || modelKey in pending
  const messages: WebviewMessage[] = []
  if (selectionDirty) {
    const provider = providerKey in pending ? pending[providerKey] : current[providerKey]
    const model = modelKey in pending ? pending[modelKey] : current[modelKey]
    messages.push({
      type: "updateAutocompleteSelection",
      providerID: typeof provider === "string" ? provider : null,
      modelID: typeof model === "string" ? model : null,
      automatic: (provider === null || provider === undefined) && (model === null || model === undefined),
      requestId,
    })
  }
  for (const [key, value] of Object.entries(pending)) {
    if (selectionDirty && (key === providerKey || key === modelKey)) continue
    messages.push({ type: "updateSetting", key, value, requestId })
  }
  return messages
}
