type ModelsSnapshot = Record<string, unknown>

const LEGACY_PRODUCT_PROVIDER = "kilo"

/** Build-time compatibility filter: legacy product catalogs must never enter a ChipMate runtime package. */
export function filterPackagedModelsSnapshot(input: ModelsSnapshot, configured = ""): ModelsSnapshot {
  const excluded = new Set([
    LEGACY_PRODUCT_PROVIDER,
    ...configured
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ])
  return Object.fromEntries(Object.entries(input).filter(([provider]) => !excluded.has(provider)))
}
