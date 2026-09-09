import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"

const clean = new WeakMap<Page, string[]>()
const pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

async function insecure(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined })
  })
}

test.beforeEach(async ({ page }) => {
  const issues: string[] = []
  clean.set(page, issues)
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") issues.push(`${msg.type()}: ${msg.text()}`)
  })
  page.on("pageerror", (err) => issues.push(`pageerror: ${err.message}`))
})

test.afterEach(async ({ page }) => {
  expect(clean.get(page) ?? []).toEqual([])
})

test("home meets accessibility and performance gates", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Source-backed Detail Design", exact: true })).toBeVisible()

  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze()
  expect(scan.violations).toEqual([])

  const theme = page.getByRole("button", { name: "主题：跟随系统", exact: true })
  await theme.click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  const dark = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze()
  expect(dark.violations).toEqual([])
  const metrics = await page.locator("html").evaluate((node) => ({
    cls: Number(node.dataset.cls ?? "0"),
    inp: Number(node.dataset.inp ?? "0"),
    lcp: Number(node.dataset.lcp ?? "0"),
  }))
  expect(metrics.lcp).toBeGreaterThan(0)
  expect(metrics.lcp).toBeLessThanOrEqual(2_500)
  expect(metrics.inp).toBeLessThanOrEqual(200)
  expect(metrics.cls).toBeLessThanOrEqual(0.1)
})

test("home Top 10 carousel follows download order and supports every direct control", async ({ page }) => {
  const response = await page.request.get("/api/v1/skills?sort=downloads&limit=10")
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as { items: Array<{ id: string; category: string; downloads: number }> }
  expect(payload.items).toHaveLength(10)
  expect(payload.items.map((item) => item.downloads)).toEqual(
    payload.items.map((item) => item.downloads).toSorted((a, b) => b - a),
  )

  await page.clock.install()
  await page.goto("/")
  const carousel = page.getByRole("region", { name: "下载量最高的技能" })
  const heading = (name: string) => carousel.getByRole("heading", { name, exact: true })

  await expect(heading("Source-backed Detail Design")).toBeVisible()
  await expect(carousel.getByRole("button", { name: /^查看第 \d+ 名：/ })).toHaveCount(10)
  await expect(carousel.getByText("1 / 10", { exact: true })).toBeVisible()

  await page.clock.runFor(6_000)
  await expect(heading("API Contract Guardian")).toBeVisible()
  await expect(carousel.locator(".featured-card .skill-mark img")).toHaveAttribute(
    "src",
    /^\/assets\/skill-icons\/dev-/,
  )

  await carousel.getByRole("button", { name: "查看第 1 名：Source-backed Detail Design" }).click()
  await expect(carousel.locator(".featured-card .skill-mark img")).toHaveAttribute("src", "/assets/chipmate-icon.png")

  await carousel.getByRole("button", { name: "查看第 10 名：Repository Onboarding Guide" }).click()
  await expect(heading("Repository Onboarding Guide")).toBeVisible()
  await carousel.getByRole("button", { name: "下一个技能", exact: true }).click()
  await expect(heading("Source-backed Detail Design")).toBeVisible()
  await carousel.getByRole("button", { name: "上一个技能", exact: true }).click()
  await expect(heading("Repository Onboarding Guide")).toBeVisible()

  await carousel.getByRole("button", { name: "上一个技能", exact: true }).press("Home")
  await expect(heading("Source-backed Detail Design")).toBeVisible()
  await carousel.getByRole("button", { name: "上一个技能", exact: true }).press("End")
  await expect(heading("Repository Onboarding Guide")).toBeVisible()

  await carousel.getByRole("button", { name: "查看第 1 名：Source-backed Detail Design" }).click()
  await carousel.getByRole("button", { name: "切换到第 2 名：API Contract Guardian" }).click()
  await expect(heading("API Contract Guardian")).toBeVisible()

  await carousel.getByRole("button", { name: "查看第 1 名：Source-backed Detail Design" }).click()
  const stage = carousel.locator(".featured-stage")
  const box = await stage.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(heading("API Contract Guardian")).toBeVisible()

  await carousel.getByRole("button", { name: "查看第 1 名：Source-backed Detail Design" }).click()
  await carousel.getByRole("button", { name: "查看技能", exact: true }).click()
  await expect(page).toHaveURL(/\/skills\/source-backed-detail-design$/)
})

test("desktop carousel geometry stays safe for all Top 10 cards", async ({ page }) => {
  const res = await page.request.get("/api/v1/skills?sort=downloads&limit=10")
  expect(res.ok()).toBe(true)
  const data = (await res.json()) as { items: Array<{ id: string; name: string; category: string }> }
  expect(data.items).toHaveLength(10)
  const prefixes: Record<string, string> = {
    documents: "doc-",
    development: "dev-",
    testing: "test-",
    operations: "ops-",
  }
  const sizes = [
    { width: 1_484, height: 1_060 },
    { width: 1_440, height: 1_024 },
    { width: 1_131, height: 560 },
    { width: 1_050, height: 1_024 },
  ]

  for (const size of sizes) {
    await page.setViewportSize(size)
    await page.goto("/")
    const root = page.getByRole("region", { name: "下载量最高的技能" })
    await root.getByRole("button", { name: "暂停自动轮播" }).click()

    for (const [index, item] of data.items.entries()) {
      const rank = index + 1
      await root.getByRole("button", { name: `查看第 ${rank} 名：${item.name}`, exact: true }).click()
      await expect(root.getByRole("article", { name: `第 ${rank} 名：${item.name}`, exact: true })).toBeVisible()

      const icon = root.locator(".featured-card .skill-mark img")
      const art = root.locator(".featured-card .feature-art")
      await expect(icon).toBeVisible()
      await expect
        .poll(() => icon.getAttribute("src"))
        .toMatch(
          index === 0
            ? /^\/assets\/chipmate-icon\.png$/
            : new RegExp(`^/assets/skill-icons/${prefixes[item.category]}`),
        )
      await expect(art).toHaveAttribute("src", (await icon.getAttribute("src")) ?? "")

      const state = await root.evaluate((node) => {
        const rect = (target: Element | null) => {
          if (!target) return null
          const box = target.getBoundingClientRect()
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          }
        }
        const inside = (outer: ReturnType<typeof rect>, inner: ReturnType<typeof rect>) =>
          Boolean(
            outer &&
              inner &&
              inner.left >= outer.left - 1 &&
              inner.right <= outer.right + 1 &&
              inner.top >= outer.top - 1 &&
              inner.bottom <= outer.bottom + 1,
          )
        const overlap = (first: ReturnType<typeof rect>, second: ReturnType<typeof rect>) =>
          Boolean(
            first &&
              second &&
              first.left < second.right &&
              first.right > second.left &&
              first.top < second.bottom &&
              first.bottom > second.top,
          )
        const card = rect(node.querySelector(".featured-card"))
        const title = rect(node.querySelector(".featured-card .title-row h3"))
        const label = rect(node.querySelector(".featured-card .skill-risk-badge"))
        const copy = rect(node.querySelector(".featured-card .feature-copy > p"))
        const meta = node.querySelector<HTMLElement>(".featured-card .meta-row")
        const cta = rect(node.querySelector(".featured-card .primary-button"))
        const mark = rect(node.querySelector(".featured-card .skill-mark"))
        const art = rect(node.querySelector(".featured-card .feature-art"))
        const content = rect(node.querySelector(".featured-card .feature-content"))
        const controls = rect(node.querySelector(".carousel-controls"))
        const children = [...node.querySelectorAll(".carousel-controls > *")].map(rect)
        const rail = rect(node.querySelector(".rank-rail"))
        const buttons = [...node.querySelectorAll(".rank-rail button")].map(rect)
        return {
          root: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          card: [title, label, copy, meta ? rect(meta) : null, cta, mark, art].every((box) => inside(card, box)),
          overlap: overlap(title, label),
          visual: !overlap(content, art),
          meta: Boolean(meta && meta.scrollWidth <= meta.clientWidth + 1 && meta.scrollHeight <= meta.clientHeight + 1),
          cta: Boolean(cta && cta.width > 0 && cta.height > 0),
          controls: children.every((box) => inside(controls, box)),
          rail: buttons.every((box) => inside(rail, box)),
        }
      })
      const note = `${size.width}x${size.height} rank ${rank}`
      expect(state.root, note).toBe(false)
      expect(state.card, note).toBe(true)
      expect(state.overlap, note).toBe(false)
      expect(state.visual, note).toBe(true)
      expect(state.meta, note).toBe(true)
      expect(state.cta, note).toBe(true)
      expect(state.controls, note).toBe(true)
      expect(state.rail, note).toBe(true)
    }
  }
})

test("carousel pauses for explicit, focus, hover, and hidden states", async ({ page }) => {
  await page.clock.install()
  await page.goto("/")
  const carousel = page.getByRole("region", { name: "下载量最高的技能" })
  const heading = (name: string) => carousel.getByRole("heading", { name, exact: true })
  const search = page.getByRole("textbox", { name: "搜索技能" })

  await carousel.getByRole("button", { name: "暂停自动轮播" }).click()
  await search.focus()
  await expect(carousel).toHaveAttribute("data-autoplay", "paused")
  await page.clock.runFor(12_000)
  await expect(heading("Source-backed Detail Design")).toBeVisible()

  await carousel.getByRole("button", { name: "继续自动轮播" }).click()
  await page.locator(".hero-copy h1").hover()
  await search.focus()
  await expect(carousel).toHaveAttribute("data-autoplay", "running")
  await page.clock.runFor(6_000)
  await expect(heading("API Contract Guardian")).toBeVisible()

  await carousel.getByRole("button", { name: "下一个技能", exact: true }).focus()
  await expect(carousel).toHaveAttribute("data-autoplay", "paused")
  await page.clock.runFor(6_000)
  await expect(heading("API Contract Guardian")).toBeVisible()
  await search.focus()
  await expect(carousel).toHaveAttribute("data-autoplay", "running")
  await page.clock.runFor(6_000)
  await expect(heading("C/C++ Codebase Analysis")).toBeVisible()

  await carousel.hover()
  await expect(carousel).toHaveAttribute("data-autoplay", "paused")
  await page.clock.runFor(6_000)
  await expect(heading("C/C++ Codebase Analysis")).toBeVisible()
  await page.locator(".hero-copy h1").hover()
  await expect(carousel).toHaveAttribute("data-autoplay", "running")
  await page.clock.runFor(6_000)
  await expect(heading("Architecture Decision Writer")).toBeVisible()

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(carousel).toHaveAttribute("data-autoplay", "paused")
  await page.clock.runFor(6_000)
  await expect(heading("Architecture Decision Writer")).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(carousel).toHaveAttribute("data-autoplay", "running")
  await page.clock.runFor(6_000)
  await expect(heading("Test Evidence Builder")).toBeVisible()
})

test("carousel keeps empty, single, pair, loading, and error states usable", async ({ page }) => {
  const response = await page.request.get("/api/v1/skills?sort=downloads&limit=10")
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as { items: unknown[] }
  let size = 0
  await page.route("**/api/v1/skills?sort=downloads&limit=10", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...payload, items: payload.items.slice(0, size) }),
    }),
  )

  await page.goto("/")
  await expect(page.getByText("目录还是空的", { exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "下载量最高的技能" })).toHaveCount(0)

  size = 1
  await page.reload()
  const carousel = page.getByRole("region", { name: "下载量最高的技能" })
  await expect(carousel.getByRole("heading", { name: "Source-backed Detail Design", exact: true })).toBeVisible()
  await expect(carousel.locator(".carousel-controls")).toHaveCount(0)

  size = 2
  await page.reload()
  await expect(carousel.locator(".peek-card")).toHaveCount(1)
  await carousel.getByRole("button", { name: "切换到第 2 名：API Contract Guardian" }).click()
  await expect(carousel.getByRole("heading", { name: "API Contract Guardian", exact: true })).toBeVisible()

  await page.unroute("**/api/v1/skills?sort=downloads&limit=10")
  const gate = (() => {
    const state: { resolve(): void } = { resolve() {} }
    const promise = new Promise<void>((resolve) => {
      state.resolve = resolve
    })
    return { promise, resolve: () => state.resolve() }
  })()
  await page.route("**/api/v1/skills?sort=downloads&limit=10", async (route) => {
    await gate.promise
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) })
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByRole("status").filter({ hasText: "正在载入下载榜技能" })).toBeVisible()
  gate.resolve()
  await expect(page.getByRole("region", { name: "下载量最高的技能" })).toBeVisible()

  await page.unroute("**/api/v1/skills?sort=downloads&limit=10")
  await page.route("**/api/v1/skills?sort=downloads&limit=10", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "测试目录暂时不可用" }),
    }),
  )
  await page.reload()
  await expect(page.getByRole("alert")).toContainText("测试目录暂时不可用")
  const issues = clean.get(page) ?? []
  const failure = issues.findIndex((item) => item.includes("503 (Service Unavailable)"))
  if (failure >= 0) issues.splice(failure, 1)
})

test("search, filter, sort, detail, version, preview, and status form a read-only journey", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("textbox", { name: "搜索技能" }).fill("源码证据")
  await page.getByRole("button", { name: "搜索", exact: true }).click()
  await expect(page).toHaveURL(/\/skills\?q=/)
  await expect(page.getByText("1 个结果", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "筛选", exact: true }).click()
  await expect(page.getByRole("button", { name: "文档与知识 1", exact: true })).toBeVisible()
  await page.getByRole("combobox", { name: "排序" }).selectOption("downloads")
  await expect(page).toHaveURL(/sort=downloads/)

  await page.locator(".skill-card").click()
  await expect(page).toHaveURL(/\/skills\/source-backed-detail-design$/)
  await expect(page.getByRole("heading", { name: "Source-backed Detail Design", exact: true })).toBeVisible()
  await page.getByRole("combobox", { name: "选择版本" }).selectOption("1")
  await page.getByRole("button", { name: /^SKILL\.md \d+(\.\d+)? KB$/ }).click()
  await expect(page.getByRole("heading", { name: "SKILL.md", exact: true })).toBeVisible()

  await page.locator(".topbar").getByRole("button", { name: "服务状态", exact: true }).click()
  await expect(page).toHaveURL(/\/status$/)
  await page.getByRole("button", { name: "刷新", exact: true }).click()
  await expect(page.getByText("部分服务降级", { exact: true })).toBeVisible()
})

test("theme persists and narrow widths stay readable", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "主题：跟随系统", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme-choice", "dark")
  await page.reload()
  await expect(page.getByRole("button", { name: "主题：深色", exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("note")).toBeVisible()
  const overflow = await page.locator("html").evaluate((node) => node.scrollWidth > node.clientWidth)
  expect(overflow).toBe(false)
})

test("keyboard focus is visible and reduced motion is honored", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.clock.install()
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Source-backed Detail Design", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "系统已减少动态效果" })).toBeDisabled()
  await page.clock.runFor(12_000)
  await expect(page.getByRole("heading", { name: "Source-backed Detail Design", exact: true })).toBeVisible()
  await page.keyboard.press("Tab")
  const focus = page.locator(":focus")
  await expect(focus).toBeVisible()
  const style = await focus.evaluate((node) => {
    const value = getComputedStyle(node)
    return {
      outline: value.outlineStyle,
      width: Number.parseFloat(value.outlineWidth),
      transition: Number.parseFloat(value.transitionDuration),
    }
  })
  expect(style.outline).not.toBe("none")
  expect(style.width).toBeGreaterThanOrEqual(3)
  expect(style.transition).toBeLessThanOrEqual(0.001)
})

test("primary card motion sustains the frame budget", async ({ page }) => {
  await page.goto("/skills")
  const card = page.locator(".skill-card").first()
  await expect(card).toBeVisible()
  const sample = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const state = { frames: 0, start: 0 }
        const frame = (time: number) => {
          if (!state.start) state.start = time
          state.frames += 1
          const elapsed = time - state.start
          if (elapsed >= 600) {
            resolve((state.frames * 1_000) / elapsed)
            return
          }
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }),
  )
  await card.hover()
  expect(await sample).toBeGreaterThanOrEqual(55)
})

test("login keeps only a server session and clears the raw LDAP credentials", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "x-csrf-token": "csrf-for-browser-session" },
        body: JSON.stringify({
          id: "market-alice-123456",
          displayName: "Alice",
          firstSeenAt: "2026-07-12T00:00:00.000Z",
          lastSeenAt: "2026-07-12T00:00:00.000Z",
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  })
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "market-alice-123456",
        displayName: "Alice",
        firstSeenAt: "2026-07-12T00:00:00.000Z",
        lastSeenAt: "2026-07-12T00:00:00.000Z",
      }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/me/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
  await page.goto("/")
  await page.getByRole("button", { name: "登录", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByLabel("用户名").fill("alice")
  await dialog.getByLabel("密码").fill("raw-password-must-not-persist")
  await dialog.getByRole("button", { name: "安全登录", exact: true }).click()
  await expect(page.getByRole("button", { name: "Alice", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Alice", exact: true }).click()
  await page.getByRole("button", { name: "退出登录", exact: true }).click()
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page.getByRole("dialog").getByLabel("用户名")).toHaveValue("")
  await expect(page.getByRole("dialog").getByLabel("密码")).toHaveValue("")
  expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([])
})

test("publish page shows the shared validation report without changing local files", async ({ page }) => {
  await insecure(page)
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-csrf-token": "csrf-for-publication" },
      body: JSON.stringify({
        id: "market-alice-123456",
        displayName: "Alice",
        firstSeenAt: "2026-07-12T00:00:00.000Z",
        lastSeenAt: "2026-07-12T00:00:00.000Z",
      }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/publications", (route) => {
    expect(route.request().headers()["idempotency-key"]).toMatch(pattern)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "publication-12345678-1234-1234-1234-123456789012",
        skillId: "source-backed-detail-design",
        ownerId: "market-alice-123456",
        status: "PUBLISHED",
        stage: "complete",
        report: {
          valid: true,
          stage: "complete",
          issues: [],
          sourceSha256: "a".repeat(64),
          snapshotSha256: "b".repeat(64),
          changed: true,
        },
        patches: [
          {
            id: "det-1",
            runId: "publication-12345678-1234-1234-1234-123456789012",
            kind: "deterministic",
            files: [
              { path: "SKILL.md", beforeSha256: "a".repeat(64), afterSha256: "b".repeat(64), patch: "replace-base64:" },
            ],
            requiresConfirmation: false,
            expiresAt: "2026-07-13T00:00:00.000Z",
          },
        ],
        release: {
          skillId: "source-backed-detail-design",
          revision: 2,
          sha256: "b".repeat(64),
          archiveUrl: "/archive",
          report: { valid: true },
          publishedAt: "2026-07-12T00:00:00.000Z",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      }),
    })
  })
  await page.goto("/publish")
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined")
  await page.getByRole("button", { name: "先登录市场身份" }).click()
  await page.getByLabel("用户名").fill("alice")
  await page.getByLabel("密码").fill("password")
  await page.getByRole("button", { name: "安全登录" }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem("chipmate-market-client"))).toMatch(pattern)
  await page
    .getByLabel("Skill 归档")
    .setInputFiles(resolve("../../docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz"))
  await page.getByRole("button", { name: "校验并发布" }).click()
  await expect(page.locator(".publication-success").getByText("发布成功", { exact: true })).toBeVisible()
  await expect(page.getByText("上传完成，正在执行权威校验", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "发布成功", exact: true })).toBeDisabled()
  await expect(page.getByText(/确定性修复仅应用到上传快照/)).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test("publish report prioritizes blocking errors and groups repeated script warnings", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-market-csrf", "csrf-for-errors")
    sessionStorage.setItem("chipmate-market-session-active", "1")
  })
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "market-alice-123456",
        displayName: "Alice",
        firstSeenAt: "2026-07-12T00:00:00.000Z",
        lastSeenAt: "2026-07-12T00:00:00.000Z",
      }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/publications", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "publication-errors-12345678",
        ownerId: "market-alice-123456",
        status: "NEEDS_AUTHOR_FIX",
        stage: "format",
        report: {
          valid: false,
          stage: "format",
          issues: [
            ...Array.from({ length: 20 }, (_, index) => ({
              code: "scripts-present",
              severity: "warning",
              file: `scripts/tool-${index}.py`,
              message: "包含脚本文件；市场服务不会执行这些脚本，使用前请自行审查。",
              fixable: false,
              repairKind: "none",
              riskLevel: "medium",
            })),
            {
              code: "security-file-type",
              severity: "error",
              file: "scripts/__pycache__/tool.pyc",
              message: "归档包含不支持的文件类型。",
              fixable: false,
              repairKind: "none",
              riskLevel: "none",
            },
          ],
          sourceSha256: "a".repeat(64),
          snapshotSha256: "b".repeat(64),
          changed: false,
          policyVersion: "skill-risk-v3",
          risk: { level: "medium", issueCount: 1, policyVersion: "skill-risk-v3" },
        },
        patches: [],
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      }),
    }),
  )
  await page.goto("/publish")
  await page
    .getByLabel("Skill 归档")
    .setInputFiles(resolve("../../docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz"))
  await page.getByRole("button", { name: "校验并发布", exact: true }).click()
  const issues = page.locator(".issue-list article")
  await expect(issues).toHaveCount(2)
  await expect(issues.first()).toHaveClass(/issue-error/)
  await expect(issues.first().getByText("阻止发布", { exact: true })).toBeVisible()
  await expect(issues.first()).toContainText("scripts/__pycache__/tool.pyc")
  await expect(issues.nth(1)).toContainText("包含 20 个脚本文件")
  await issues.nth(1).getByText("查看 20 个文件", { exact: true }).click()
  await expect(issues.nth(1)).toContainText("scripts/tool-0.py")
  await expect(issues.nth(1)).toContainText("scripts/tool-19.py")
  await expect(page.getByText("1 类阻断错误", { exact: true })).toBeVisible()
  await expect(page.getByText("1 类警告", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "请重新选择修改后的 Skill", exact: true })).toBeDisabled()
})

test("publish retry reuses its idempotency key and a same-tick double click sends once", async ({ page }) => {
  const keys: string[] = []
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-market-csrf", "csrf-for-retry")
    sessionStorage.setItem("chipmate-market-session-active", "1")
  })
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "market-alice-123456",
        displayName: "Alice",
        firstSeenAt: "2026-07-12T00:00:00.000Z",
        lastSeenAt: "2026-07-12T00:00:00.000Z",
      }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/publications", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "")
    if (keys.length === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "服务暂不可用，请重试。" }),
      })
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "publication-retry-12345678",
        skillId: "source-backed-detail-design",
        ownerId: "market-alice-123456",
        status: "PUBLISHED",
        stage: "complete",
        report: {
          valid: true,
          stage: "complete",
          issues: [],
          sourceSha256: "a".repeat(64),
          snapshotSha256: "b".repeat(64),
          changed: false,
          policyVersion: "skill-risk-v2",
          risk: { level: "none", issueCount: 0, policyVersion: "skill-risk-v2" },
        },
        patches: [],
        release: {
          skillId: "source-backed-detail-design",
          revision: 1,
          sha256: "b".repeat(64),
          archiveUrl: "/archive",
          report: { valid: true },
          publishedAt: "2026-07-12T00:00:00.000Z",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      }),
    })
  })
  await page.goto("/publish")
  await page
    .getByLabel("Skill 归档")
    .setInputFiles(resolve("../../docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz"))
  const button = page.getByRole("button", { name: "校验并发布", exact: true })
  await button.click()
  await expect(page.getByRole("alert")).toContainText("服务暂不可用，请重试。")
  const logs = clean.get(page) ?? []
  const expected = logs.findIndex((item) => item.includes("status of 503"))
  if (expected >= 0) logs.splice(expected, 1)
  await button.evaluate((node) => {
    if (!(node instanceof HTMLButtonElement)) throw new Error("publish button is not an HTML button")
    node.click()
    node.click()
  })
  await expect(page.locator(".publication-success")).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
})

test("skill detail warns before downloading a medium-risk release", async ({ page }) => {
  const evidence = resolve(".runtime/design-qa/g11")
  await mkdir(evidence, { recursive: true })
  await page.route("**/api/v1/skills/source-backed-detail-design", async (route) => {
    const response = await route.fetch()
    const detail = (await response.json()) as {
      latestRevision: number
      releases: Array<{
        revision: number
        report: {
          issues: Array<Record<string, unknown>>
          risk?: Record<string, unknown>
          policyVersion?: string
        }
      }>
      risk?: Record<string, unknown>
    }
    const issue = {
      code: "security-secret",
      riskLevel: "medium",
      severity: "warning",
      message: "检测到可能的凭据或私钥，请在使用前确认内容和权限范围。",
      file: "README.md",
    }
    detail.risk = { level: "medium", issueCount: 1, policyVersion: "skill-risk-v2" }
    detail.releases = detail.releases.map((release) =>
      release.revision === detail.latestRevision
        ? {
            ...release,
            report: {
              ...release.report,
              issues: [issue],
              risk: { level: "medium", issueCount: 1, policyVersion: "skill-risk-v2" },
              policyVersion: "skill-risk-v2",
            },
          }
        : release,
    )
    await route.fulfill({ response, json: detail })
  })

  await page.goto("/skills/source-backed-detail-design")
  await expect(page.getByText("存在风险 · 1 类", { exact: true })).toBeVisible()
  await expect(page.getByText("检测到可能的凭据或私钥，请在使用前确认内容和权限范围。", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "下载归档", exact: true }).click()

  const dialog = page.getByRole("dialog", { name: "此 Skill 存在风险隐患" })
  await expect(dialog).toBeVisible()
  const action = dialog.getByRole("button", { name: "继续下载", exact: true })
  await expect(action).toBeDisabled()
  await dialog.getByLabel("我已了解上述风险，并决定继续").check()
  await expect(action).toBeEnabled()
  const backdrop = await page.locator(".dialog-backdrop").boundingBox()
  expect(backdrop?.width).toBe(1_440)
  expect(backdrop?.height).toBe(1_024)
  expect((await new AxeBuilder({ page }).include(".skill-risk-dialog").analyze()).violations).toEqual([])
  for (const size of [
    { width: 1_484, height: 1_060 },
    { width: 1_440, height: 1_024 },
    { width: 1_050, height: 1_024 },
  ]) {
    await page.setViewportSize(size)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true)
    await page.screenshot({ path: resolve(evidence, `risk-dialog-${size.width}x${size.height}-real-chrome.png`) })
  }
})

test("skill folder is packed locally before the existing publication request", async ({ page }) => {
  const root = resolve(".runtime/e2e-skill-folder")
  const folder = resolve(root, "folder-skill")
  await rm(root, { recursive: true, force: true })
  await mkdir(resolve(folder, "references"), { recursive: true })
  await writeFile(
    resolve(folder, "SKILL.md"),
    "---\nname: Folder Skill\ndescription: Browser packed\n---\n# Folder Skill\n",
  )
  await writeFile(resolve(folder, "references", "guide.md"), "# Guide\n")
  await writeFile(resolve(folder, ".DS_Store"), "ignored")
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-market-csrf", "csrf-for-folder")
    sessionStorage.setItem("chipmate-market-session-active", "1")
  })
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "market-alice-123456",
        displayName: "Alice",
        firstSeenAt: "2026-07-12T00:00:00.000Z",
        lastSeenAt: "2026-07-12T00:00:00.000Z",
      }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/publications", async (route) => {
    expect(route.request().headers()["content-type"]).toBe("application/gzip")
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-for-folder")
    const body = route.request().postDataBuffer()
    expect(body?.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]))
    const archive = gunzipSync(body!)
    expect(archive.includes(Buffer.from("SKILL.md"))).toBe(true)
    expect(archive.includes(Buffer.from("references/guide.md"))).toBe(true)
    expect(archive.includes(Buffer.from(".DS_Store"))).toBe(false)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "folder-publication-12345678-1234-1234-1234-123456789012",
        skillId: "folder-skill",
        ownerId: "market-alice-123456",
        status: "UNCHANGED",
        stage: "complete",
        report: {
          valid: true,
          stage: "complete",
          issues: [],
          sourceSha256: "c".repeat(64),
          snapshotSha256: "d".repeat(64),
          changed: false,
          policyVersion: "skill-risk-v2",
          risk: { level: "none", issueCount: 0, policyVersion: "skill-risk-v2" },
        },
        patches: [],
        release: {
          skillId: "folder-skill",
          revision: 1,
          sha256: "d".repeat(64),
          archiveUrl: "/api/v1/skills/folder-skill/archive?revision=1",
          report: { valid: true },
          publishedAt: "2026-07-17T00:00:00.000Z",
        },
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      }),
    })
  })

  try {
    await page.goto("/publish")
    await expect(page.getByRole("button", { name: "Alice", exact: true })).toBeVisible()
    await page.locator("input[webkitdirectory]").setInputFiles(folder)
    await expect(page.getByText("folder-skill", { exact: true })).toBeVisible()
    await expect(page.getByText(/2 个文件 .* 本地忽略 1 项/)).toBeVisible()
    await mkdir(resolve(".runtime/design-qa/g11"), { recursive: true })
    await page.screenshot({ path: resolve(".runtime/design-qa/g11/folder-upload-1440x1024-real-chrome.png") })
    await page.getByRole("button", { name: "校验并发布", exact: true }).click()
    await expect(page.locator(".publication-duplicate")).toContainText("内容未变化，已发布过")
    await expect(page.getByRole("button", { name: "已发布，无内容变化", exact: true })).toBeDisabled()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("authors can confirm unpublishing from their publication history", async ({ page }) => {
  type Run = {
    id: string
    skillId: string
    ownerId: string
    status: string
    stage: string
    patches: unknown[]
    release: {
      skillId: string
      revision: number
      sha256: string
      size: number
      report: Record<string, unknown>
      archiveUrl: string
      publishedAt: string
    }
    createdAt: string
    updatedAt: string
  }
  const runs: Run[] = [
    {
      id: "run-1",
      skillId: "documents",
      ownerId: "market-alice-123456",
      status: "PUBLISHED",
      stage: "complete",
      patches: [],
      release: {
        skillId: "documents",
        revision: 1,
        sha256: "a".repeat(64),
        size: 1024,
        report: {},
        archiveUrl: "/archive",
        publishedAt: "2026-07-12T00:00:00.000Z",
      },
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
  ]
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-csrf-token": "csrf-for-unpublish" },
      body: JSON.stringify({
        id: "market-alice-123456",
        displayName: "Alice",
        firstSeenAt: "2026-07-12T00:00:00.000Z",
        lastSeenAt: "2026-07-12T00:00:00.000Z",
      }),
    }),
  )
  await page.route("**/api/v1/me/favorites", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
  await page.route("**/api/v1/me/installations", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  )
  await page.route("**/api/v1/me/publications", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runs) }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/skills/documents/unpublish", async (route) => {
    expect(route.request().method()).toBe("POST")
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-for-unpublish")
    runs.unshift({ ...runs[0]!, id: "run-2", status: "UNPUBLISHED", updatedAt: "2026-07-12T01:00:00.000Z" })
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runs[0]) })
  })
  await page.goto("/me")
  await page.getByRole("button", { name: "登录市场身份" }).click()
  await page.getByLabel("用户名").fill("alice")
  await page.getByLabel("密码").fill("password")
  await page.getByRole("button", { name: "安全登录" }).click()
  await page.getByRole("button", { name: "下架", exact: true }).click()
  await expect(page.getByRole("group", { name: "确认下架 documents" })).toBeVisible()
  await page.getByRole("button", { name: "确认下架", exact: true }).click()
  await expect(page.getByText("documents 已下架；历史版本和审计记录仍然保留。", { exact: true })).toBeVisible()
  await expect(page.getByText(/^已下架 ·/)).toBeVisible()
  await expect(page.getByRole("button", { name: "下架", exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator("html").evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(false)
  expect((await new AxeBuilder({ page }).include(".publication-list").analyze()).violations).toEqual([])
})

test("analytics storage failures degrade without blocking trusted HTTP browsing", async ({ page }) => {
  await insecure(page)
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem
    const set = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key === "chipmate-market-client") throw new DOMException("blocked for test", "SecurityError")
      return get.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key === "chipmate-market-client") throw new DOMException("blocked for test", "SecurityError")
      return set.call(this, key, value)
    }
  })
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "x-csrf-token": "csrf-for-storage-fallback" },
      body: JSON.stringify({
        id: "market-alice-123456",
        displayName: "Alice",
        firstSeenAt: "2026-07-12T00:00:00.000Z",
        lastSeenAt: "2026-07-12T00:00:00.000Z",
      }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Source-backed Detail Design", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await page.getByLabel("用户名").fill("alice")
  await page.getByLabel("密码").fill("password")
  await page.getByRole("button", { name: "安全登录" }).click()
  await expect(page.getByRole("button", { name: "Alice", exact: true })).toBeVisible()
  await expect
    .poll(() => (clean.get(page) ?? []).filter((item) => item.includes("分析客户端标识无法")).length)
    .toBeGreaterThan(0)
  await page.getByRole("button", { name: "发布技能", exact: true }).click()
  await expect(page.getByRole("heading", { name: "校验并发布 Skill", exact: true })).toBeVisible()
  const issues = clean.get(page) ?? []
  for (let index = issues.length - 1; index >= 0; index -= 1) {
    if (issues[index]?.includes("分析客户端标识无法")) issues.splice(index, 1)
  }
})
