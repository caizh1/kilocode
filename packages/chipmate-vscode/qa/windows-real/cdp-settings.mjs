#!/usr/bin/env node

import { writeFileSync } from "node:fs"

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const index = item.indexOf("=")
    return index === -1 ? [item.replace(/^--/, ""), "true"] : [item.slice(2, index), item.slice(index + 1)]
  }),
)
const port = Number(args.port)
if (!Number.isSafeInteger(port) || port < 1) throw new Error("--port is required")
if (!args.output) throw new Error("--output is required")
const mode = args.mode ?? "audit-server"

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function rpc(url) {
  const socket = new WebSocket(url)
  const calls = new Map()
  const errors = []
  let id = 0
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params?.exceptionDetails?.text ?? "Runtime exception")
      return
    }
    if (!message.id) return
    const call = calls.get(message.id)
    if (!call) return
    calls.delete(message.id)
    if (message.error) call.reject(new Error(message.error.message))
    else call.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })
  return {
    errors,
    call(method, params = {}, timeout = 20_000) {
      const key = ++id
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          calls.delete(key)
          reject(new Error("CDP call timed out: " + method))
        }, timeout)
        calls.set(key, {
          resolve(value) {
            clearTimeout(timer)
            resolve(value)
          },
          reject(error) {
            clearTimeout(timer)
            reject(error)
          },
        })
        socket.send(JSON.stringify({ id: key, method, params }))
      })
    },
    close() {
      socket.close()
    },
  }
}

async function evaluate(client, expression, timeout = 120_000) {
  const result = await client.call(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    },
    timeout,
  )
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
    throw new Error(detail ?? "CDP evaluation failed")
  }
  return result.result?.value
}

async function find() {
  const limit = Date.now() + 60_000
  let diagnostics = []
  while (Date.now() < limit) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
    diagnostics = []
    for (const target of targets) {
      if (!target.webSocketDebuggerUrl || !["page", "iframe"].includes(target.type)) continue
      const client = await rpc(target.webSocketDebuggerUrl)
      await client.call("Runtime.enable")
      const state = await evaluate(
        client,
        `(() => {
          const docs = [document]
          for (let index = 0; index < docs.length; index++) {
            for (const frame of docs[index].querySelectorAll('iframe')) {
              try {
                if (frame.contentDocument && !docs.includes(frame.contentDocument)) docs.push(frame.contentDocument)
              } catch (error) {
                void error
              }
            }
          }
          const doc = docs.find((item) => item.querySelector('[data-ui="settings-shell"]'))
          const shell = doc?.querySelector('[data-ui="settings-shell"]')
          const rect = shell?.getBoundingClientRect()
          return {
            found: Boolean(doc),
            visible: Boolean(rect && rect.width > 1 && rect.height > 1),
            documents: docs.length,
            title: doc?.title ?? '',
            body: document.body?.innerText?.slice(0, 1000) ?? '',
            html: document.body?.innerHTML?.slice(0, 1000) ?? '',
          }
        })()`,
      ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      diagnostics.push({
        id: target.id,
        type: target.type,
        title: target.title,
        url: target.url,
        state,
        errors: client.errors,
      })
      if (state.found && state.visible) {
        const hostTarget = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
        if (!hostTarget)
          throw new Error(`VS Code top-level CDP target not found; diagnostics=${JSON.stringify(diagnostics)}`)
        const host = await rpc(hostTarget.webSocketDebuggerUrl)
        await client.call("Runtime.enable")
        await client.call("Page.enable")
        await host.call("Runtime.enable")
        await host.call("Page.enable")
        return { client, target, host, hostTarget, diagnostics }
      }
      client.close()
    }
    await wait(500)
  }
  throw new Error(`Settings CDP target not found; diagnostics=${JSON.stringify(diagnostics)}`)
}

const base = `
  const docs = [document]
  for (let index = 0; index < docs.length; index++) {
    for (const frame of docs[index].querySelectorAll('iframe')) {
      try {
        if (frame.contentDocument && !docs.includes(frame.contentDocument)) docs.push(frame.contentDocument)
      } catch (error) {
        void error
      }
    }
  }
  const doc = docs.find((item) => item.querySelector('[data-ui="settings-shell"]'))
  if (!doc) throw new Error('Settings document is unavailable')
  const visible = (element) => {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    const style = element.ownerDocument.defaultView.getComputedStyle(element)
    return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden'
  }
  const within = (element, container) => {
    if (!visible(element) || !visible(container)) return false
    const rect = element.getBoundingClientRect()
    const bounds = container.getBoundingClientRect()
    return rect.top >= bounds.top && rect.bottom <= bounds.bottom
  }
  const text = (element) =>
    [element?.getAttribute('aria-label') ?? '', element?.getAttribute('title') ?? '', element?.textContent ?? '']
      .join(' ')
      .trim()
  const settle = () => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))))
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) throw new Error('Native input value setter is unavailable')
    input.focus()
    setter.call(input, value)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const page = async (terms) => {
    const item = [...doc.querySelectorAll('[data-ui="settings-nav-item"]')]
      .find((element) => terms.some((term) => text(element).toLocaleLowerCase().includes(term.toLocaleLowerCase())))
    if (!item) throw new Error('Settings page not found: ' + terms.join('|'))
    item.click()
    await settle()
    return item
  }
  const current = () => [...doc.querySelectorAll('[data-ui="settings-content"]')].find(visible)
`

async function run(expression) {
  return evaluate(
    session.client,
    `(async () => {
      ${base}
      ${expression}
    })()`,
  )
}

async function until(check, message, timeout = 120_000) {
  const limit = Date.now() + timeout
  let value
  while (Date.now() < limit) {
    value = await check()
    if (value) return value
    await wait(100)
  }
  throw new Error(`${message}; last=${JSON.stringify(value)}`)
}

async function shot(path) {
  const result = await session.host.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
  writeFileSync(path, Buffer.from(result.data, "base64"))
}

async function save() {
  await run(`
    const button = doc.querySelector('.settings-save-button')
    if (!visible(button) || button.disabled) throw new Error('Save button is unavailable')
    button.click()
    return true
  `)
  await until(
    () =>
      run(`
        return !visible(doc.querySelector('[data-ui="settings-save-bar"]')) &&
          !visible(doc.querySelector('.settings-save-bar-error'))
      `),
    "Settings save did not reach a clean state",
  )
}

async function close() {
  await run(`
    const button = doc.querySelector('.settings-close-button')
    if (!visible(button)) throw new Error('Settings close button is unavailable')
    button.click()
    return true
  `)
}

const session = await find()
const payload = {
  generatedAt: new Date().toISOString(),
  mode,
  target: {
    id: session.target.id,
    type: session.target.type,
    title: session.target.title,
    url: session.target.url,
  },
}

try {
  if (mode === "audit-server") {
    await until(
      () =>
        run(`
          const items = [...doc.querySelectorAll('[data-ui="settings-nav-item"]')]
          const indexing = items.some((item) =>
            ['索引', 'Indexing'].some((term) =>
              text(item).toLocaleLowerCase().includes(term.toLocaleLowerCase())))
          return items.length >= 15 && indexing
        `),
      "Settings feature-gated navigation did not finish loading",
      60_000,
    )
    payload.desktop = await run(`
      const shell = doc.querySelector('[data-ui="settings-shell"]')
      const navigation = doc.querySelector('[data-ui="settings-navigation"]')
      const groups = [...doc.querySelectorAll('[data-ui="settings-nav-group"]')].map((group) => ({
        id: group.getAttribute('data-group'),
        heading: group.querySelector('.settings-nav-heading')?.textContent?.trim() ?? '',
        items: [...group.querySelectorAll('[data-ui="settings-nav-item"]')].map((item) => text(item)),
      }))
      const labels = groups.flatMap((group) => group.items)
      const pages = []
      for (const label of labels) {
        const item = [...doc.querySelectorAll('[data-ui="settings-nav-item"]')].find((entry) => text(entry) === label)
        item.click()
        await settle()
        const content = current()
        const rect = content?.getBoundingClientRect()
        pages.push({
          label,
          heading: content?.querySelector('[data-ui="settings-page-title"] h3')?.textContent?.trim() ?? '',
          visible: visible(content),
          controls: content?.querySelectorAll('input, textarea, select, button, [role="switch"], [role="combobox"]').length ?? 0,
          overflow: Boolean(content && rect && content.scrollWidth > rect.width + 1),
        })
      }
      return {
        width: shell.getBoundingClientRect().width,
        navigationVisible: visible(navigation),
        groups,
        pages,
      }
    `)
    if (payload.desktop.groups.length !== 4) {
      throw new Error(`Expected four settings groups, got ${payload.desktop.groups.length}`)
    }
    if (!payload.desktop.navigationVisible) {
      throw new Error(`Expected desktop settings navigation at ${payload.desktop.width}px`)
    }
    if (payload.desktop.pages.length < 15) {
      throw new Error(`Expected at least 15 visible internal settings pages, got ${payload.desktop.pages.length}`)
    }
    const broken = payload.desktop.pages.filter((page) => !page.visible || !page.heading || page.overflow)
    if (broken.length) throw new Error(`Broken settings pages: ${JSON.stringify(broken)}`)

    payload.search = await run(`
      const root = doc.querySelector('[data-ui="settings-search"]')
      const input = root?.matches('input') ? root : root?.querySelector('input')
      if (!input) throw new Error('Desktop settings search input is unavailable')
      setValue(input, 'ChipMate 服务器')
      await settle()
      const pageResult = [...doc.querySelectorAll('[data-ui="settings-search-option"]')]
        .find((item) => item.getAttribute('data-kind') === 'page' && text(item).includes('ChipMate'))
      setValue(input, '嵌入维度')
      await settle()
      const fieldResult = [...doc.querySelectorAll('[data-ui="settings-search-option"]')]
        .find((item) => item.getAttribute('data-kind') === 'field' && text(item).includes('向量维度'))
      if (!fieldResult) throw new Error('Child setting search result is unavailable')
      fieldResult.click()
      await settle()
      await new Promise((resolve) => setTimeout(resolve, 700))
      const target = doc.querySelector('[data-setting-search-title="向量维度"][data-search-target="true"]')
      const content = current()
      const header = doc.querySelector('[data-ui="settings-header"]')
      const located = {
        page: content?.querySelector('[data-ui="settings-page-title"] h3')?.textContent?.trim() ?? '',
        target: Boolean(target),
        targetVisible: within(target, content),
        focused: Boolean(target?.contains(doc.activeElement)),
        dirty: visible(doc.querySelector('[data-ui="settings-save-bar"]')),
        documentScroll: doc.defaultView?.scrollY ?? -1,
        headerTop: Math.round(header?.getBoundingClientRect().top ?? -1),
      }
      setValue(input, 'qa-no-such-settings-page')
      await settle()
      const empty = visible(doc.querySelector('[data-ui="settings-search-empty"]'))
      setValue(input, '嵌入维度')
      await settle()
      return { pageResult: Boolean(pageResult), fieldResult: Boolean(fieldResult), located, empty }
    `)
    if (
      !payload.search.pageResult ||
      !payload.search.fieldResult ||
      !["索引", "Indexing"].some((term) => payload.search.located.page.includes(term)) ||
      !payload.search.located.target ||
      !payload.search.located.targetVisible ||
      payload.search.located.focused ||
      payload.search.located.dirty ||
      payload.search.located.documentScroll !== 0 ||
      payload.search.located.headerTop < 0 ||
      !payload.search.empty
    ) {
      throw new Error(`Settings search regression: ${JSON.stringify(payload.search)}`)
    }

    await shot(args.desktop)
    await run(`
      const root = doc.querySelector('[data-ui="settings-search"]')
      const input = root?.matches('input') ? root : root?.querySelector('input')
      setValue(input, '')
      await settle()
      return true
    `)
    payload.server = await run(`
      await page(['ChipMate 服务器', 'ChipMate Server'])
      const input = doc.querySelector('#chipmate-server-base-url')
      if (!input) throw new Error('ChipMate Server input is unavailable')
      const original = input.value
      setValue(input, 'not-a-valid-url')
      input.blur()
      await settle()
      const invalid = {
        aria: input.getAttribute('aria-invalid'),
        saveDisabled: Boolean(doc.querySelector('.settings-save-button')?.disabled),
      }
      setValue(input, ${JSON.stringify(args.server)})
      input.blur()
      await settle()
      return {
        original,
        value: input.value,
        invalid,
        dirty: visible(doc.querySelector('[data-ui="settings-save-bar"]')),
        saveEnabled: !doc.querySelector('.settings-save-button')?.disabled,
      }
    `)
    if (
      payload.server.invalid.aria !== "true" ||
      !payload.server.invalid.saveDisabled ||
      payload.server.value !== args.server ||
      !payload.server.dirty ||
      !payload.server.saveEnabled
    ) {
      throw new Error(`ChipMate Server validation regression: ${JSON.stringify(payload.server)}`)
    }
    await save()
    payload.server.saved = true
    await close()
  } else if (mode === "audit-narrow") {
    payload.narrow = await run(`
      await settle()
      const shell = doc.querySelector('[data-ui="settings-shell"]')
      const desktop = doc.querySelector('[data-ui="settings-navigation"]')
      const trigger = doc.querySelector('[data-ui="settings-mobile-trigger"]')
      if (!visible(trigger)) throw new Error('Narrow settings picker is unavailable')
      trigger.click()
      await settle()
      const menu = docs.map((item) => item.querySelector('[data-ui="settings-mobile-menu"]')).find(visible)
      const options = menu ? [...menu.querySelectorAll('[data-ui="settings-mobile-option"]')] : []
      const search = menu?.querySelector('[data-ui="settings-mobile-search"] input, [data-ui="settings-mobile-search"]')
      if (!search) throw new Error('Narrow settings search input is unavailable')
      const menuVisible = visible(menu)
      const searchVisible = visible(search)
      const optionCount = options.length
      setValue(search, '嵌入维度')
      await settle()
      const result = [...menu.querySelectorAll('[data-ui="settings-mobile-search-option"]')]
        .find((item) => item.getAttribute('data-kind') === 'field' && text(item).includes('向量维度'))
      const ids = [...doc.querySelectorAll('[id^="settings-"][id*="-option-"]')].map((item) => item.id)
      const duplicateIds = ids.length - new Set(ids).size
      if (!result) throw new Error('Narrow child setting search result is unavailable')
      result.click()
      await settle()
      await new Promise((resolve) => setTimeout(resolve, 700))
      const target = doc.querySelector('[data-setting-search-title="向量维度"][data-search-target="true"]')
      const content = current()
      const openMenu = docs.map((item) => item.querySelector('[data-ui="settings-mobile-menu"]')).find(visible)
      return {
        width: Math.round(shell.getBoundingClientRect().width),
        desktopHidden: !visible(desktop),
        triggerVisible: visible(trigger),
        menuVisible,
        options: optionCount,
        searchVisible,
        resultVisible: Boolean(result),
        duplicateIds,
        menuClosed: !visible(openMenu),
        target: Boolean(target),
        targetVisible: within(target, content),
        focused: Boolean(target?.contains(doc.activeElement)),
        dirty: visible(doc.querySelector('[data-ui="settings-save-bar"]')),
        page: content?.querySelector('[data-ui="settings-page-title"] h3')?.textContent?.trim() ?? '',
        overflow: doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 1,
      }
    `)
    await shot(args.narrow)
    if (
      payload.narrow.width < 220 ||
      payload.narrow.width > 420 ||
      !payload.narrow.desktopHidden ||
      !payload.narrow.triggerVisible ||
      !payload.narrow.menuVisible ||
      payload.narrow.options < 15 ||
      !payload.narrow.searchVisible ||
      !payload.narrow.resultVisible ||
      payload.narrow.duplicateIds !== 0 ||
      !payload.narrow.menuClosed ||
      !payload.narrow.target ||
      !payload.narrow.targetVisible ||
      payload.narrow.focused ||
      payload.narrow.dirty ||
      !["索引", "Indexing"].some((term) => payload.narrow.page.includes(term)) ||
      payload.narrow.overflow
    ) {
      throw new Error(`Narrow settings regression: ${JSON.stringify(payload.narrow)}`)
    }
    await close()
  } else if (mode === "verify-indexing") {
    payload.server = await run(`
      await page(['ChipMate 服务器', 'ChipMate Server'])
      const input = doc.querySelector('#chipmate-server-base-url')
      return { value: input?.value ?? '', expected: ${JSON.stringify(args.server)} }
    `)
    if (payload.server.value !== args.server) {
      throw new Error(`ChipMate Server setting did not persist: ${JSON.stringify(payload.server)}`)
    }
    payload.indexing = await run(`
      await page(['索引', 'Indexing'])
      const rows = [...current().querySelectorAll('[data-slot="settings-row"]')]
      const findInput = (terms) => {
        const row = rows.find((entry) =>
          terms.some((term) =>
            (entry.querySelector('[data-slot="settings-row-label-title"]')?.textContent ?? '')
              .toLocaleLowerCase()
              .includes(term.toLocaleLowerCase())))
        return row?.querySelector('input')
      }
      const model = findInput(['嵌入模型', 'Embedding model'])
      const dimension = findInput(['向量维度', 'Vector dimension'])
      const endpoint = findInput(['基础 url', 'Base URL'])
      if (!model || !dimension || !endpoint || model.disabled || dimension.disabled || endpoint.disabled) {
        throw new Error('Editable indexing endpoint/model/dimension fields are unavailable')
      }
      const original = { endpoint: endpoint.value, model: model.value, dimension: dimension.value }
      setValue(model, ${JSON.stringify(args.model)})
      model.blur()
      await settle()
      setValue(dimension, ${JSON.stringify(args.dimension)})
      dimension.blur()
      await settle()
      return {
        original,
        endpoint: endpoint.value,
        model: model.value,
        dimension: dimension.value,
        dirty: visible(doc.querySelector('[data-ui="settings-save-bar"]')),
        saveEnabled: !doc.querySelector('.settings-save-button')?.disabled,
      }
    `)
    if (
      payload.indexing.endpoint !== args.embedding ||
      payload.indexing.model !== args.model ||
      payload.indexing.dimension !== args.dimension ||
      !payload.indexing.dirty ||
      !payload.indexing.saveEnabled
    ) {
      throw new Error(`Indexing edit regression: ${JSON.stringify(payload.indexing)}`)
    }
    await save()
    payload.indexing.saved = true
    await close()
  } else if (mode === "verify") {
    payload.persisted = await run(`
      await page(['ChipMate 服务器', 'ChipMate Server'])
      const server = doc.querySelector('#chipmate-server-base-url')?.value ?? ''
      await page(['索引', 'Indexing'])
      const rows = [...current().querySelectorAll('[data-slot="settings-row"]')]
      const value = (terms) => {
        const row = rows.find((entry) =>
          terms.some((term) =>
            (entry.querySelector('[data-slot="settings-row-label-title"]')?.textContent ?? '')
              .toLocaleLowerCase()
              .includes(term.toLocaleLowerCase())))
        return row?.querySelector('input')?.value ?? ''
      }
      const content = current()?.textContent ?? ''
      const endpointErrors = content
        .split(/\\r?\\n/)
        .map((line) => line.trim())
        .filter((line) => /Invalid endpoint URL|Please verify the endpoint/i.test(line))
      const runtimeErrors = content
        .split(/\\r?\\n/)
        .map((line) => line.trim())
        .filter((line) => /初始扫描失败|initial scan/i.test(line))
      return {
        server,
        endpoint: value(['基础 url', 'Base URL']),
        model: value(['嵌入模型', 'Embedding model']),
        dimension: value(['向量维度', 'Vector dimension']),
        endpointErrorVisible: endpointErrors.length > 0,
        endpointErrors: endpointErrors.slice(0, 8),
        runtimeErrors: runtimeErrors.slice(0, 8),
        saveBarVisible: visible(doc.querySelector('[data-ui="settings-save-bar"]')),
        saveErrorVisible: visible(doc.querySelector('.settings-save-bar-error')),
      }
    `)
    if (
      payload.persisted.server !== args.server ||
      payload.persisted.endpoint !== args.embedding ||
      payload.persisted.model !== args.model ||
      payload.persisted.dimension !== args.dimension ||
      payload.persisted.endpointErrorVisible ||
      payload.persisted.saveBarVisible ||
      payload.persisted.saveErrorVisible
    ) {
      throw new Error(`Settings did not persist after reopen: ${JSON.stringify(payload.persisted)}`)
    }
    await shot(args.desktop)
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }
  payload.runtimeErrors = session.client.errors
  payload.pass = session.client.errors.length === 0
  if (!payload.pass) throw new Error(`Settings webview runtime errors: ${JSON.stringify(session.client.errors)}`)
  writeFileSync(args.output, JSON.stringify(payload, null, 2) + "\n")
} catch (error) {
  payload.pass = false
  payload.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  payload.runtimeErrors = session.client.errors
  writeFileSync(args.output, JSON.stringify(payload, null, 2) + "\n")
  throw error
} finally {
  session.client.close()
  session.host.close()
}
