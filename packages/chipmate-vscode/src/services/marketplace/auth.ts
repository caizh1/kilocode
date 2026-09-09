import { createHash } from "node:crypto"
import * as vscode from "vscode"
import type { MarketplaceUser } from "./types"

interface StoredTokens {
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
  refreshExpiresAt: number
  user: MarketplaceUser
}

interface TokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
  user: { displayName: string }
}

interface DeviceResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export class MarketplaceAuth {
  private run: Promise<StoredTokens | undefined> | undefined
  private readonly activeOriginKey = "chipmate.v2.marketplace.ldap.active-origin"

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly serverBaseUrl: () => string,
  ) {}

  async access(interactive = false): Promise<string | undefined> {
    const tokens = await this.tokens(interactive)
    return tokens?.accessToken
  }

  async user(): Promise<MarketplaceUser | undefined> {
    return (await this.load())?.user
  }

  async logout() {
    await this.switchOrigin()
    const stored = await this.load()
    if (stored?.accessToken) {
      await fetch(`${this.base()}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${stored.accessToken}` },
      }).catch(() => undefined)
    }
    await this.secrets.delete(this.key())
  }

  async authorized<T>(task: (accessToken: string) => Promise<T>, interactive = true): Promise<T> {
    const first = await this.access(interactive)
    if (!first) throw new Error("marketplace-login-required")
    try {
      return await task(first)
    } catch (err) {
      if (!isUnauthorized(err)) throw err
    }
    const next = await this.refresh(true)
    if (!next) throw new Error("marketplace-session-expired")
    return task(next.accessToken)
  }

  private async tokens(interactive: boolean) {
    if (this.run) return this.run
    const run = this.resolve(interactive).finally(() => {
      if (this.run === run) this.run = undefined
    })
    this.run = run
    return run
  }

  private async resolve(interactive: boolean) {
    await this.switchOrigin()
    const stored = await this.load()
    if (stored && stored.accessExpiresAt > Date.now() + 30_000) return stored
    const refreshed = stored ? await this.refresh(false) : undefined
    if (refreshed) return refreshed
    if (!interactive) return undefined
    return this.deviceLogin()
  }

  private async refresh(clearOnFailure: boolean) {
    const stored = await this.load()
    if (!stored || stored.refreshExpiresAt <= Date.now()) {
      if (clearOnFailure || stored) await this.secrets.delete(this.key())
      return undefined
    }
    try {
      const response = await json<TokenResponse>(`${this.base()}/api/v1/auth/token/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      })
      return this.save(response)
    } catch (err) {
      if (clearOnFailure || isUnauthorized(err)) await this.secrets.delete(this.key())
      return undefined
    }
  }

  private async deviceLogin() {
    const device = await json<DeviceResponse>(`${this.base()}/api/v1/auth/device/code`, { method: "POST" })
    const opened = await vscode.env.openExternal(vscode.Uri.parse(device.verificationUriComplete))
    if (!opened) throw new Error("无法打开 LDAP 设备授权页面。")
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `请在浏览器登录 LDAP，并确认设备码 ${device.userCode}`,
        cancellable: true,
      },
      async (_progress, token) => {
        const expiresAt = Date.now() + device.expiresIn * 1_000
        const interval = { value: Math.max(5, device.interval) }
        while (!token.isCancellationRequested && Date.now() < expiresAt) {
          await wait(interval.value * 1_000, token)
          if (token.isCancellationRequested) return undefined
          const response = await fetch(`${this.base()}/api/v1/auth/device/token`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ deviceCode: device.deviceCode }),
          })
          const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
          if (response.ok) return this.save(payload as unknown as TokenResponse)
          if (payload.code === "AUTHORIZATION_PENDING") continue
          if (payload.code === "SLOW_DOWN") {
            interval.value = Math.max(interval.value + 5, Number(response.headers.get("retry-after")) || 10)
            continue
          }
          throw new Error(typeof payload.message === "string" ? payload.message : `设备登录失败（HTTP ${response.status}）`)
        }
        if (token.isCancellationRequested) return undefined
        throw new Error("设备码已过期，请重新登录。")
      },
    )
  }

  private async save(response: TokenResponse) {
    if (!response.accessToken || !response.refreshToken || !response.user?.displayName) {
      throw new Error("ChipMate Server 返回了无效的设备登录凭据。")
    }
    const stored: StoredTokens = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      accessExpiresAt: Date.now() + response.expiresIn * 1_000,
      refreshExpiresAt: Date.now() + response.refreshExpiresIn * 1_000,
      user: { name: response.user.displayName },
    }
    await this.secrets.store(this.key(), JSON.stringify(stored))
    await this.secrets.store(this.activeOriginKey, this.origin())
    return stored
  }

  private async load(): Promise<StoredTokens | undefined> {
    const raw = await this.secrets.get(this.key())
    if (!raw) return undefined
    try {
      const value = JSON.parse(raw) as StoredTokens
      if (!value.accessToken || !value.refreshToken || !value.user?.name) throw new Error("invalid")
      return value
    } catch {
      await this.secrets.delete(this.key())
      return undefined
    }
  }

  private base() {
    return this.serverBaseUrl().replace(/\/+$/, "")
  }

  private origin() {
    return new URL(this.base()).origin.toLocaleLowerCase()
  }

  private key(origin = this.origin()) {
    return `chipmate.v2.marketplace.ldap.${createHash("sha256").update(origin).digest("hex")}`
  }

  private async switchOrigin() {
    const current = this.origin()
    const previous = (await this.secrets.get(this.activeOriginKey))?.trim().toLocaleLowerCase()
    if (!previous || previous === current) {
      await this.secrets.store(this.activeOriginKey, current)
      return
    }
    const raw = await this.secrets.get(this.key(previous))
    if (raw) {
      try {
        const stored = JSON.parse(raw) as StoredTokens
        if (stored.accessToken) {
          await fetch(`${previous}/api/v1/auth/token/revoke`, {
            method: "POST",
            headers: { authorization: `Bearer ${stored.accessToken}` },
          }).catch(() => undefined)
        }
      } catch {
        // 损坏的旧 Origin 凭据会在下面直接清除，不能阻断新 Server 登录。
      }
      await this.secrets.delete(this.key(previous))
    }
    await this.secrets.store(this.activeOriginKey, current)
  }
}

async function json<T>(url: string, init: RequestInit) {
  const response = await fetch(url, init)
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const error = new Error(typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`) as Error & {
      status?: number
    }
    error.status = response.status
    throw error
  }
  return payload as T
}

function isUnauthorized(err: unknown) {
  return Boolean(err && typeof err === "object" && "status" in err && (err as { status?: unknown }).status === 401)
}

function wait(ms: number, token: vscode.CancellationToken) {
  return new Promise<void>((resolve) => {
    let subscription: vscode.Disposable | undefined
    const finish = () => {
      subscription?.dispose()
      resolve()
    }
    const timer = setTimeout(finish, ms)
    subscription = token.onCancellationRequested(() => {
      clearTimeout(timer)
      finish()
    })
  })
}

const shared = new WeakMap<vscode.SecretStorage, MarketplaceAuth>()
export function sharedMarketplaceAuth(secrets: vscode.SecretStorage, base: () => string) {
  const current = shared.get(secrets)
  if (current) return current
  const auth = new MarketplaceAuth(secrets, base)
  shared.set(secrets, auth)
  return auth
}
