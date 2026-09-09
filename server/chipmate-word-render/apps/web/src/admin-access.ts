import { useCallback, useEffect, useRef, useState } from "react"

export interface AdminAccess {
  mode: "ldap" | "break-glass"
  expiresAt?: string
  subject?: string
  userId?: string
  csrf: string
}

export function adminChanged() { dispatchEvent(new Event("chipmate-admin-changed")) }

export function useAdminAccess(userId: string | undefined, csrf: string, path: string) {
  const [access, setAccess] = useState<AdminAccess>()
  const [loading, setLoading] = useState(true)
  const sequence = useRef(0)
  const clear = useCallback(() => {
    sequence.current++
    setAccess(undefined)
    setLoading(false)
    sessionStorage.removeItem("chipmate-auth-admin-csrf")
  }, [])
  const refresh = useCallback(async () => {
    const current = ++sequence.current
    try {
      const response = await fetch("/api/v1/admin/auth/session", { credentials: "same-origin", cache: "no-store" })
      if (current !== sequence.current) return
      if (!response.ok) { clear(); return }
      const data = await response.json() as Omit<AdminAccess, "csrf">
      if (current !== sequence.current) return
      const token = data.mode === "break-glass" ? response.headers.get("x-csrf-token") ?? "" : csrf
      setAccess({ ...data, csrf: token })
      setLoading(false)
    } catch {
      if (current === sequence.current) clear()
    }
  }, [csrf, clear])
  useEffect(() => {
    clear()
    setLoading(true)
    void refresh()
    const update = () => { void refresh() }
    const interval = setInterval(update, 30_000)
    addEventListener("focus", update)
    addEventListener("chipmate-admin-changed", update)
    addEventListener("chipmate-admin-invalid", clear)
    return () => {
      sequence.current++
      clearInterval(interval)
      removeEventListener("focus", update)
      removeEventListener("chipmate-admin-changed", update)
      removeEventListener("chipmate-admin-invalid", clear)
    }
  }, [userId, path, refresh, clear])
  useEffect(() => {
    if (!access?.expiresAt) return
    const timer = setTimeout(clear, Math.max(0, Date.parse(access.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [access?.expiresAt, clear])
  return { access, loading, refresh, clear }
}

export async function adminRequest<T = unknown>(path: string, options: { method?: string; csrf?: string; body?: unknown } = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET", credentials: "same-origin", cache: "no-store",
    headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.csrf ? { "x-csrf-token": options.csrf } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const payload = await response.json()
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) dispatchEvent(new Event("chipmate-admin-invalid"))
    throw new Error(payload.message ?? `请求失败（HTTP ${response.status}）`)
  }
  return payload as T
}
