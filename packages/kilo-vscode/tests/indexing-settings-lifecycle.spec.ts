import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY = `/iframe.html?id=settings--settings-panel&viewMode=story&globals=${GLOBALS}`

type Message = {
  type: string
  key?: string
  value?: unknown
  requestId?: string
}

async function open(page: Page) {
  await page.addInitScript(() => {
    const messages: Message[] = []
    Object.defineProperty(window, "__chipmateIndexingMessages", { configurable: true, value: messages })
    const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data }))
    const visible = () => localStorage.getItem("qa.indexing.showButton") !== "false"
    Object.defineProperty(window, "acquireVsCodeApi", {
      configurable: true,
      value: () => ({
        postMessage: (message: Message) => {
          messages.push(structuredClone(message))
          setTimeout(() => {
            if (message.type === "requestConfig") {
              send({
                type: "configLoaded",
                config: {
                  plugin: ["@kilocode/kilo-indexing"],
                  indexing: {
                    enabled: false,
                    provider: "openai-compatible",
                    model: "fixture-model",
                    dimension: 1024,
                    vectorStore: "lancedb",
                    "openai-compatible": { baseUrl: "http://127.0.0.1:1234/v1/embeddings" },
                    documents: { enabled: false, paths: ["."] },
                  },
                },
                globalConfig: {
                  indexing: {
                    provider: "openai-compatible",
                    model: "fixture-model",
                    dimension: 1024,
                    vectorStore: "lancedb",
                    "openai-compatible": { baseUrl: "http://127.0.0.1:1234/v1/embeddings" },
                  },
                },
                projectConfig: { indexing: { enabled: false, documents: { enabled: false, paths: ["."] } } },
                settings: { maxCost: 0, languageCommitMessage: "sync" },
                features: { indexing: true, sandboxControls: false },
              })
            }
            if (message.type === "requestIndexingSettings") {
              send({
                type: "indexingSettingsLoaded",
                settings: { showButtonWhenDisabled: visible() },
              })
            }
            if (message.type === "requestChatSettings") {
              send({ type: "chatSettingsLoaded", settings: { shiftTabCyclesVariant: true } })
            }
            if (message.type === "requestThroughputSetting") {
              send({ type: "throughputSettingLoaded", visible: false })
            }
            if (message.type === "requestIndexingStatus") {
              send({
                type: "indexingStatusLoaded",
                status: {
                  state: "Complete",
                  message: "Index up-to-date.",
                  processedFiles: 8,
                  totalFiles: 8,
                  percent: 100,
                  pipelines: {
                    codeGraph: { state: "Complete", message: "Code Graph complete.", processedFiles: 8, totalFiles: 8 },
                    rag: { state: "Complete", message: "Code RAG complete.", processedFiles: 8, totalFiles: 8 },
                    documents: { state: "Disabled", message: "Document RAG disabled.", processedFiles: 0, totalFiles: 0 },
                  },
                },
              })
            }
            if (message.type === "requestChipmateServerSettings") {
              send({
                type: "chipmateServerSettingsLoaded",
                state: { baseUrl: "http://127.0.0.1:6001" },
                autoInstall: true,
              })
            }
          }, 0)
        },
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
  await page.goto(STORY, { waitUntil: "load" })
  await page.waitForSelector("[data-ui='settings-shell']", { state: "visible" })
  await navigate(page, "Indexing")
  await expect(page.getByRole("tabpanel", { name: "Indexing" })).toBeVisible()
}

async function navigate(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true })
  if (await tab.isVisible()) {
    await tab.click()
    return
  }
  await page.getByRole("button", { name: /Current settings page:/ }).click()
  await page.getByRole("option", { name, exact: true }).click()
}

async function messages(page: Page) {
  return page.evaluate(() => (window as unknown as { __chipmateIndexingMessages: Message[] }).__chipmateIndexingMessages)
}

async function clear(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __chipmateIndexingMessages: Message[] }).__chipmateIndexingMessages.length = 0
  })
}

function switchFor(page: Page, title: string) {
  return page.locator('[data-slot="settings-row"]', { hasText: title }).getByRole("switch")
}

function clickSwitch(page: Page, title: string) {
  return page.locator('[data-slot="settings-row"]', { hasText: title }).locator('[data-slot="switch-control"]').click()
}

test("indexing setting save reports failure, supports retry, and survives webview reload", async ({ page }) => {
  await open(page)
  const toggle = switchFor(page, "Show button when indexing is off")
  await expect(toggle).toBeChecked()

  await clear(page)
  await clickSwitch(page, "Show button when indexing is off")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect
    .poll(async () => (await messages(page)).filter((item) => item.type === "updateSetting").length)
    .toBe(1)
  const failed = (await messages(page)).find((item) => item.type === "updateSetting")!
  expect(failed).toMatchObject({
    key: "indexing.showButtonWhenDisabled",
    value: false,
  })
  expect((await messages(page)).some((item) => item.type === "updateConfig")).toBe(false)

  await page.evaluate((requestId) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "settingUpdateFailed",
          key: "indexing.showButtonWhenDisabled",
          requestId,
          message: "Configuration chipmate.v2.indexing.showButtonWhenDisabled is not registered.",
        },
      }),
    )
  }, failed.requestId)
  await expect(page.getByText("Couldn't save settings:", { exact: false })).toBeVisible()
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible()

  await clear(page)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect
    .poll(async () => (await messages(page)).filter((item) => item.type === "updateSetting").length)
    .toBe(1)
  const retried = (await messages(page)).find((item) => item.type === "updateSetting")!
  await page.evaluate((requestId) => {
    localStorage.setItem("qa.indexing.showButton", "false")
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "settingUpdated",
          key: "indexing.showButtonWhenDisabled",
          value: false,
          requestId,
        },
      }),
    )
  }, retried.requestId)
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0)

  await page.reload({ waitUntil: "load" })
  await page.waitForSelector("[data-ui='settings-shell']", { state: "visible" })
  await navigate(page, "Indexing")
  await expect(switchFor(page, "Show button when indexing is off")).not.toBeChecked()
})

test("page and indexing-scope switches never emit an indexing mutation", async ({ page }) => {
  await open(page)
  await clear(page)

  await page.getByRole("button", { name: "Global", exact: true }).click()
  await page.getByRole("button", { name: "Local", exact: true }).click()
  await navigate(page, "Display")
  await navigate(page, "Commit Message")
  await navigate(page, "Indexing")
  await page.waitForTimeout(800)

  const mutations = (await messages(page)).filter((item) =>
    ["updateConfig", "updateSetting", "rebuildDocumentRag"].includes(item.type),
  )
  expect(mutations).toEqual([])
})

test("saving an unrelated display setting never emits an indexing mutation", async ({ page }) => {
  await open(page)
  await navigate(page, "Display")
  await clear(page)

  await clickSwitch(page, "Show Token Throughput")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect.poll(async () => (await messages(page)).filter((item) => item.type === "updateSetting").length).toBe(1)

  const sent = await messages(page)
  expect(sent.filter((item) => item.type === "updateSetting")).toEqual([
    expect.objectContaining({
      key: "showTokenThroughput",
      value: true,
    }),
  ])
  expect(sent.filter((item) => ["updateConfig", "rebuildDocumentRag"].includes(item.type))).toEqual([])
})

test("project enablement save emits one scoped config write and no duplicate settings write", async ({ page }) => {
  await open(page)
  await clear(page)

  await clickSwitch(page, "Enable for this project")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect.poll(async () => (await messages(page)).filter((item) => item.type === "updateConfig").length).toBe(1)
  const updates = (await messages(page)).filter((item) => item.type === "updateConfig")
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject({
    config: {},
    projectConfig: { indexing: { enabled: true } },
  })
  expect((await messages(page)).some((item) => item.type === "updateSetting")).toBe(false)
})
