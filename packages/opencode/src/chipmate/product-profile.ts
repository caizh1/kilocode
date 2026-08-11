import path from "path"

export namespace ProductProfile {
  export const CHIPMATE = "chipmate-v2"
  export const value = process.env.CHIPMATE_PRODUCT_PROFILE

  if (value && value !== CHIPMATE) {
    throw new Error(`Unsupported CHIPMATE_PRODUCT_PROFILE: ${value}`)
  }

  export const chipmate = value === CHIPMATE
  export const dirs = chipmate ? ([".chipmate-v2"] as const) : ([".chipmate"] as const)
  export const root = chipmate ? ".chipmate-v2" : ".chipmate"

  export function storage(): string | undefined {
    if (!chipmate) return
    const value = process.env.CHIPMATE_VSCODE_GLOBAL_STORAGE
    if (!value || !path.isAbsolute(value)) {
      throw new Error("CHIPMATE_VSCODE_GLOBAL_STORAGE must be an absolute path for chipmate-v2")
    }
    return path.resolve(value)
  }

  export function config(): string | undefined {
    const root = storage()
    return root ? path.join(root, "config") : undefined
  }

  export function project(directory: string, ...parts: string[]): string {
    return path.join(directory, root, ...parts)
  }

  export function label(): string {
    return root
  }

  export function allowsLegacyAuthMigration(): boolean {
    return !chipmate
  }

  export function isDir(dir: string, flag?: string): boolean {
    if (!chipmate) return dir.endsWith(".chipmate") || dir === flag
    const global = config()
    return path.basename(dir) === ".chipmate-v2" || dir === global
  }
}
