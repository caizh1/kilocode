export type IndexingPressure = "normal" | "constrained" | "forced-low"

export function constrained(pressure: IndexingPressure): boolean {
  return pressure !== "normal"
}
