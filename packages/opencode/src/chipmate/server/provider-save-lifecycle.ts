export const DEFER_HEADER = "x-chipmate-defer-instance-dispose"

export function deferred(headers: Headers | Record<string, string | undefined>) {
  const value = headers instanceof Headers ? headers.get(DEFER_HEADER) : headers[DEFER_HEADER]
  return value === "1"
}

export function options(hot: boolean, defer: boolean) {
  if (!hot && !defer) return
  return { dispose: false, deferred: defer }
}
