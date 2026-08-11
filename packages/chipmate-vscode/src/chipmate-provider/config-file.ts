import { existsSync } from "fs"
import * as path from "path"

export type Scope = "global" | "local"

export type Source =
  | "sourceXdg"
  | "sourceHomeChipMate"
  | "sourceHomeChipMate"
  | "sourceHomeOpencode"
  | "sourceEnvFile"
  | "sourceEnvDir"
  | "sourceEnvContent"
  | "sourceProjectChipMate"
  | "sourceProjectRoot"
  | "sourceProjectChipMate"
  | "sourceProjectOpencode"

export interface Entry {
  file?: string
  name: string
  source: Source
  exists: boolean
  loaded: boolean
  legacy?: boolean
  recommended?: boolean
  virtual?: boolean
}

const SCHEMA = "https://app.chipmate.ai/config.json"

function row(file: string, source: Source, loaded = true, recommended = false): Entry {
  const name = path.basename(file)
  return {
    file,
    name,
    source,
    exists: existsSync(file),
    loaded: loaded && existsSync(file),
    legacy: name.startsWith("opencode") || name === "config.json" || file.includes(`${path.sep}.chipmate${path.sep}`),
    recommended,
  }
}

function ensure(list: Entry[], file: string, source: Source) {
  if (list.some((item) => item.file === file)) return list
  return [...list, row(file, source, true, true)]
}

export function globalFiles(storage?: string) {
  const root = path.join(storage ?? path.join(process.env.HOME ?? "", ".chipmate-v2"), "config")
  return [row(path.join(root, "chipmate.jsonc"), "sourceXdg", true, true)]
}

export function localFiles(root: string) {
  const enabled = !process.env.CHIPMATE_DISABLE_PROJECT_CONFIG
  const file = path.join(root, ".chipmate-v2", "chipmate.jsonc")
  const item = row(file, "sourceProjectChipMate", enabled, true)
  return [enabled ? item : { ...item, loaded: false }]
}

export function content() {
  return `{
  "$schema": "${SCHEMA}"
}
`
}
