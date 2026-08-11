export function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

export function own<T>(items: Record<string, T> | undefined, key: string): T | undefined {
  if (!items || !Object.prototype.hasOwnProperty.call(items, key)) return undefined
  return items[key]
}

export function copy<T>(items: Record<string, T> | undefined): Record<string, T> {
  const out = dict<T>()
  if (!items || typeof items !== "object" || Array.isArray(items)) return out
  for (const [key, value] of Object.entries(items)) {
    out[key] = value
  }
  return out
}
