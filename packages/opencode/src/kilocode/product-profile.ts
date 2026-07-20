import path from "path"

export namespace ProductProfile {
  export const CHIPMATE = "chipmate-v2"
  export const value = process.env.KILO_PRODUCT_PROFILE

  if (value && value !== CHIPMATE) {
    throw new Error(`Unsupported KILO_PRODUCT_PROFILE: ${value}`)
  }

  export const chipmate = value === CHIPMATE
  export const dirs = chipmate ? ([".chipmate-v2"] as const) : ([".kilocode", ".kilo"] as const)
  export const root = chipmate ? ".chipmate-v2" : ".kilo"

  export function storage(): string | undefined {
    if (!chipmate) return
    const value = process.env.KILO_VSCODE_GLOBAL_STORAGE
    if (!value || !path.isAbsolute(value)) {
      throw new Error("KILO_VSCODE_GLOBAL_STORAGE must be an absolute path for chipmate-v2")
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
    if (!chipmate) return dir.endsWith(".kilo") || dir.endsWith(".kilocode") || dir === flag
    const global = config()
    return path.basename(dir) === ".chipmate-v2" || dir === global
  }
}
