export interface InstallLink {
  origin: string
  token: string
}

export interface RepairLink {
  origin: string
  runId: string
}

export function installLink(
  value: { scheme: string; authority: string; path: string; query: string },
  baseUrl: string,
): InstallLink | undefined {
  if (value.scheme !== "vscode" || value.authority !== "chipmate.chipmate" || value.path !== "/marketplace/install")
    return undefined
  const params = new URLSearchParams(value.query)
  const token = params.get("token") ?? ""
  const origin = params.get("origin") ?? ""
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return undefined
  try {
    const expected = new URL(baseUrl)
    const actual = new URL(origin)
    if (!/^https?:$/.test(actual.protocol) || actual.origin !== expected.origin || actual.origin !== origin)
      return undefined
    return { origin, token }
  } catch {
    return undefined
  }
}

export function archiveUrl(origin: string, value: string) {
  try {
    const url = new URL(value, origin)
    if (
      url.origin !== origin ||
      !/^\/api\/v1\/skills\/[A-Za-z0-9._-]+\/releases\/[1-9]\d*\/archive$/.test(url.pathname)
    )
      return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export function repairLink(
  value: { scheme: string; authority: string; path: string; query: string },
  baseUrl: string,
): RepairLink | undefined {
  if (value.scheme !== "vscode" || value.authority !== "chipmate.chipmate" || value.path !== "/marketplace/repair")
    return undefined
  const params = new URLSearchParams(value.query)
  const runId = params.get("runId") ?? ""
  const origin = params.get("origin") ?? ""
  if (!/^publication-[A-Za-z0-9-]{16,128}$/.test(runId)) return undefined
  try {
    const expected = new URL(baseUrl)
    const actual = new URL(origin)
    if (!/^https?:$/.test(actual.protocol) || actual.origin !== expected.origin || actual.origin !== origin)
      return undefined
    return { origin, runId }
  } catch {
    return undefined
  }
}
