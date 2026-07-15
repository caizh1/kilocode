export type Theme = "system" | "light" | "dark"

export function next(value: Theme): Theme {
  if (value === "system") return "dark"
  if (value === "dark") return "light"
  return "system"
}

export function query(url: URL, sort: string, limit = 24) {
  const params = new URLSearchParams({ limit: String(limit), sort })
  for (const key of ["q", "category", "cursor"] as const) {
    const value = url.searchParams.get(key)
    if (value) params.set(key, value)
  }
  return params
}

export function previous(cursor: string, limit = 24) {
  const value = Math.max(0, Number(cursor) - limit)
  return value ? String(value) : ""
}
