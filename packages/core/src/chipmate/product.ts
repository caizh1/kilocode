import path from "path"

export namespace Product {
  export const CHIPMATE = "chipmate-v2"
  export const value = process.env.CHIPMATE_PRODUCT_PROFILE

  if (value && value !== CHIPMATE) {
    throw new Error(`Unsupported CHIPMATE_PRODUCT_PROFILE: ${value}`)
  }

  export const chipmate = value === CHIPMATE

  export function root(): string | undefined {
    if (!chipmate) return
    const value = process.env.CHIPMATE_STORAGE_ROOT
    if (!value || !path.isAbsolute(value)) {
      throw new Error("CHIPMATE_STORAGE_ROOT must be an absolute path for chipmate-v2")
    }
    return path.resolve(value)
  }
}
