import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const config = {
  enabled: true,
  name: "Microsoft Active Directory",
  host: "ad.internal",
  port: 389,
  security: "unencrypted",
  verifyCertificate: true,
  bindDn: "CN=ChipMate,OU=Service,DC=example,DC=local",
  userSearchBase: "DC=example,DC=local",
  userFilter: "(&(objectCategory=Person)(sAMAccountName=%s))",
  adminFilter: "(memberOf=CN=ChipMate Admins,OU=Groups,DC=example,DC=local)",
  restrictedFilter: "(userAccountControl:1.2.840.113556.1.4.803:=2)",
  usernameAttribute: "sAMAccountName",
  firstNameAttribute: "givenName",
  surnameAttribute: "sn",
  emailAttribute: "userPrincipalName",
  attributesInBindContext: false,
  insecureAcknowledged: true,
  group: { enabled: false, searchBase: "", filter: "", memberAttribute: "member", userAttribute: "dn" },
}

test("认证设置支持 break-glass、明文风险提示、配置测试和三种桌面尺寸", async ({ page }) => {
  let unlocked = false
  let tested = false
  await page.route("**/api/v1/admin/auth/session", (route) => {
    if (route.request().method() === "POST") unlocked = true
    if (!unlocked) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "需要管理员登录。" }) })
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-csrf-token": "admin-csrf" },
      body: JSON.stringify({ ok: true, mode: "break-glass", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }),
    })
  })
  await page.route("**/api/v1/admin/auth/ldap", (route) => {
    if (!unlocked) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "需要管理员登录。" }) })
    if (route.request().method() === "PUT") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ config: { ...config, revision: 2 }, sessionsRevoked: true }) })
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ config: { ...config, hasBindPassword: true, revision: 1 } }) })
  })
  await page.route("**/api/v1/admin/auth/ldap/test", (route) => {
    tested = true
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  })
  await page.route("**/api/v1/admin/auth/identity-mappings", (route) => {
    if (!unlocked) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "需要管理员登录。" }) })
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) })
  })

  await page.route("**/api/v1/admin/auth/admins", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) }))
  await page.goto("/admin/login")
  await page.getByLabel("Break-glass 密钥").fill("emergency-key")
  await page.getByRole("button", { name: "进入应急管理" }).click()
  await expect(page.getByRole("heading", { name: "LDAP 认证设置" })).toBeVisible()
  await expect(page.getByRole("alert")).toContainText("未加密 LDAP")
  await page.getByRole("button", { name: "测试连接" }).click()
  await expect.poll(() => tested).toBe(true)
  await expect(page.getByRole("status")).toContainText("测试通过")
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  for (const size of [{ width: 1_484, height: 1_060 }, { width: 1_440, height: 1_024 }, { width: 1_050, height: 1_024 }]) {
    await page.setViewportSize(size)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow, `${size.width}x${size.height} 不应横向溢出`).toBe(false)
  }
})

test("普通用户即使伪造本地管理员标记，也看不到入口或读取管理数据", async ({ page }) => {
  let reads = 0
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-auth-admin-csrf", "stale-token")
    sessionStorage.setItem("chipmate-market-session-active", "1")
  })
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "ordinary", displayName: "普通用户", isAdmin: true }) }))
  await page.route("**/api/v1/admin/auth/session", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "没有管理员权限" }) }))
  for (const path of ["ldap", "identity-mappings", "admins"]) await page.route(`**/api/v1/admin/auth/${path}`, (route) => {
    reads++
    return route.fulfill({ status: 403, contentType: "application/json", body: "{}" })
  })
  await page.goto("/admin/auth")
  await expect(page.getByRole("heading", { name: "需要管理员权限" })).toBeVisible()
  await expect(page.getByRole("button", { name: "认证设置", exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Bind DN", { exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Break-glass 密钥")).toHaveCount(0)
  expect(reads).toBe(0)
})

test("应急授权需要先确认唯一身份，名单展示 ID 并保护最后一位管理员", async ({ page }) => {
  const state = await adminFixture(page)
  await page.goto("/admin/login")
  await page.getByLabel("Break-glass 密钥").fill("emergency-key")
  await page.getByRole("button", { name: "进入应急管理" }).click()
  await page.getByLabel("待授权 LDAP 用户名").fill("alice")
  await page.getByRole("button", { name: "查询 LDAP 身份" }).click()
  await expect(page.getByText("guid-alice", { exact: true })).toBeVisible()
  await expect(page.getByText("market-historic-alice", { exact: true })).toBeVisible()
  expect(state.grants).toBe(0)
  await page.getByRole("button", { name: "确认授予管理员" }).click()
  await expect(page.getByRole("button", { name: "保留最后一位管理员" })).toBeDisabled()
  expect(state.grants).toBe(1)
  await expect(page.getByLabel("Admin Filter（旧配置，仅保留）")).toHaveAttribute("readonly", "")
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  for (const width of [1484, 1440, 1050]) {
    await page.setViewportSize({ width, height: width === 1484 ? 1060 : 1024 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
})

test("管理会话失效时移除入口和已加载的设置", async ({ page }) => {
  const state = await adminFixture(page)
  state.unlocked = true
  await page.goto("/admin/auth")
  await expect(page.getByLabel("Bind DN", { exact: true })).toHaveValue(config.bindDn)
  state.unlocked = false
  await page.evaluate(() => dispatchEvent(new Event("focus")))
  await expect(page.getByRole("heading", { name: "需要管理员权限" })).toBeVisible()
  await expect(page.getByLabel("Bind DN", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "认证设置", exact: true })).toHaveCount(0)
})

test("退出应急管理后不能继续展示设置", async ({ page }) => {
  const state = await adminFixture(page)
  state.unlocked = true
  await page.goto("/admin/auth")
  await page.getByRole("button", { name: "退出应急管理" }).click()
  await expect(page.getByRole("heading", { name: "需要管理员权限" })).toBeVisible()
  expect(state.unlocked).toBe(false)
})

async function adminFixture(page: Page) {
  const state = { unlocked: false, grants: 0 }
  const target = { subject: "guid-alice", username: "alice", displayName: "测试管理员", email: "alice@example.test", dn: "CN=Alice,OU=Users,DC=example,DC=test", userId: "market-historic-alice" }
  const items: Array<typeof target & { grantedAt: string; grantedBy: string }> = []
  await page.route("**/api/v1/admin/auth/session", (route) => {
    const method = route.request().method()
    if (method === "POST") state.unlocked = true
    if (method === "DELETE") { state.unlocked = false; return route.fulfill({ contentType: "application/json", body: "{}" }) }
    return route.fulfill({ status: state.unlocked ? 200 : 401, contentType: "application/json", headers: { "x-csrf-token": "admin-csrf" },
      body: JSON.stringify(state.unlocked ? { mode: "break-glass", expiresAt: new Date(Date.now() + 900_000).toISOString() } : { message: "会话失效" }) })
  })
  await page.route("**/api/v1/admin/auth/ldap", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ config }) }))
  await page.route("**/api/v1/admin/auth/identity-mappings", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) }))
  await page.route("**/api/v1/admin/auth/admins/resolve", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(target) }))
  await page.route("**/api/v1/admin/auth/admins", (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ username: target.username, subject: target.subject })
      state.grants++
      items.push({ ...target, grantedAt: new Date().toISOString(), grantedBy: "break-glass" })
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, changed: true, sessionsRevoked: true }) })
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items }) })
  })
  return state
}

test("设备授权页要求 LDAP 网页登录，密码不会进入设备码接口", async ({ page }) => {
  const approvals: unknown[] = []
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    headers: { "content-type": "application/json", "x-csrf-token": "device-csrf" },
    body: JSON.stringify({ id: "ldap-alice", displayName: "Alice", firstSeenAt: "2026-09-03T00:00:00.000Z", lastSeenAt: "2026-09-03T00:00:00.000Z", authSource: "ldap" }),
  }))
  await page.route("**/api/v1/auth/device/approve", (route) => {
    approvals.push(route.request().postDataJSON())
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  })
  await page.goto("/device?user_code=ABCD-EFGH")
  await page.getByRole("button", { name: "登录 LDAP" }).click()
  await page.getByLabel("用户名").fill("alice")
  await page.getByLabel("密码").fill("password")
  await page.getByRole("button", { name: "安全登录" }).click()
  await expect(page.getByText("当前用户：Alice")).toBeVisible()
  await page.getByRole("button", { name: "授权此设备" }).click()
  await expect(page.getByText("设备已获授权，可以返回 VS Code。", { exact: true })).toBeVisible()
  expect(approvals).toEqual([{ userCode: "ABCD-EFGH" }])
})
