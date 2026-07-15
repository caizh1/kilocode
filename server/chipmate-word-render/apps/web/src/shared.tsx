import { ShieldCheck } from "@phosphor-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"

export const icon = "/assets/chipmate-icon.png"

export function Skeleton(props: { label: string }) {
  return (
    <div className="skeleton" role="status">
      <span />
      <span />
      <span />
      <span className="sr-only">{props.label}</span>
    </div>
  )
}

export function InlineError(props: { message: string }) {
  return (
    <div className="inline-error" role="alert">
      <ShieldCheck />
      <span>
        <strong>暂时无法载入</strong>
        {props.message}
      </span>
    </div>
  )
}

export function useApi<T>(path: string) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError("")
    request<T>(path, abort.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [path, revision])
  return useMemo(() => ({ data, error, loading, refresh }), [data, error, loading, refresh])
}

export async function request<T>(path: string, signal?: AbortSignal) {
  const response = await fetch(path, { ...(signal ? { signal } : {}), headers: { accept: "application/json" } })
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as { message?: string } | undefined
    throw new Error(payload?.message ?? `请求失败（HTTP ${response.status}）`)
  }
  return (await response.json()) as T
}

export async function mutate<T>(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown, csrf?: string) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as { message?: string } | undefined
    throw new Error(payload?.message ?? `请求失败（HTTP ${response.status}）`)
  }
  return (await response.json()) as T
}

export function compact(value: number) {
  return Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function bytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function date(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value))
}

export function status(value: string) {
  return value === "ready" ? "正常" : value === "degraded" ? "降级" : "不可用"
}
