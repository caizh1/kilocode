import * as vscode from "vscode"
import { PREFIX, STORAGE } from "./identity"

const ROOT = `${PREFIX}.`

function scope(value: string): string {
  return value.startsWith(ROOT) ? value : `${ROOT}${value}`
}

function unScope(value: string): string {
  return value.slice(ROOT.length)
}

function memento(source: vscode.Memento): vscode.Memento {
  return {
    keys: () =>
      source
        .keys()
        .filter((item) => item.startsWith(ROOT))
        .map(unScope),
    get: <T>(value: string, fallback?: T) => {
      const key = scope(value)
      return fallback === undefined ? source.get<T>(key) : source.get(key, fallback)
    },
    update: (value, data) => source.update(scope(value), data),
  }
}

function secrets(source: vscode.SecretStorage): vscode.SecretStorage {
  return {
    get: (value) => source.get(scope(value)),
    store: (value, data) => source.store(scope(value), data),
    delete: (value) => source.delete(scope(value)),
    onDidChange: (listener, self, disposables) =>
      source.onDidChange(
        (event) => {
          if (!event.key.startsWith(ROOT)) return
          listener.call(self, { key: unScope(event.key) })
        },
        undefined,
        disposables,
      ),
  }
}

export function isolate(source: vscode.ExtensionContext): vscode.ExtensionContext {
  const global = Object.assign(memento(source.globalState), {
    setKeysForSync: (keys: readonly string[]) => source.globalState.setKeysForSync(keys.map(scope)),
  })
  const workspace = memento(source.workspaceState)
  const secret = secrets(source.secrets)
  const root = vscode.Uri.joinPath(source.globalStorageUri, STORAGE)
  const local = source.storageUri ? vscode.Uri.joinPath(source.storageUri, STORAGE) : undefined
  const desc = Object.getOwnPropertyDescriptors(source)
  const set = (key: string, value: unknown) => {
    const item = desc[key]
    desc[key] = {
      configurable: item?.configurable ?? false,
      enumerable: item?.enumerable ?? true,
      value,
      writable: item && "writable" in item ? item.writable : false,
    }
  }
  set("globalState", global)
  set("workspaceState", workspace)
  set("secrets", secret)
  set("globalStorageUri", root)
  set("globalStoragePath", root.fsPath)
  set("storageUri", local)
  set("storagePath", local?.fsPath)
  return Object.create(Object.getPrototypeOf(source), desc) as vscode.ExtensionContext
}
