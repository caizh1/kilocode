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
const action = args.action ?? "probe"
const value = args.value ?? ""
const targetID = args.target ?? ""
const excluded = new Set((args.exclude ?? "").split("|").filter(Boolean))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function rpc(url) {
  const socket = new WebSocket(url)
  const calls = new Map()
  let id = 0
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
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

async function evaluate(client, expression, timeout = 20_000) {
  const result = await client.call(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    },
    timeout,
  )
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "CDP evaluation failed")
  return result.result?.value
}

async function chord(client, keys) {
  await client.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
  })
  for (const item of keys) {
    await client.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: item.key,
      code: item.code,
      modifiers: 2,
      windowsVirtualKeyCode: item.codePoint,
      nativeVirtualKeyCode: item.codePoint,
    })
    await client.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: item.key,
      code: item.code,
      modifiers: 2,
      windowsVirtualKeyCode: item.codePoint,
      nativeVirtualKeyCode: item.codePoint,
    })
  }
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
  })
}

async function find() {
  const limit = Date.now() + 60_000
  let targets = []
  let diagnostics = []
  while (Date.now() < limit) {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
    diagnostics = []
    const matches = []
    for (const target of targets) {
      if (!target.webSocketDebuggerUrl) continue
      if (targetID && target.id !== targetID) continue
      if (excluded.has(target.id)) continue
      const client = await rpc(target.webSocketDebuggerUrl)
      const selector =
        action === "probe" || action === "wait"
          ? '[data-component="agent-console"]'
          : '[data-component="agent-console"] .xterm-screen'
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
          const doc = docs.find((item) => item.querySelector(${JSON.stringify(selector)}))
          const root = doc?.querySelector('[data-component="agent-console"]')
          const rect = root?.getBoundingClientRect()
          const status = root?.querySelector('[data-slot="agent-console-connection"]')
          const route = root?.querySelector('[data-slot="agent-console-route-status"]')
          return {
            ready: document.readyState,
            url: location.href,
            found: Boolean(doc),
            visible:
              Boolean(root && rect && rect.width > 1 && rect.height > 1) &&
              doc.visibilityState === 'visible' &&
              getComputedStyle(root).visibility !== 'hidden',
            focused: Boolean(doc?.hasFocus()),
            mode: root?.dataset.mode ?? '',
            statusState: status?.dataset.state ?? '',
            routeStatus: route?.textContent?.trim() ?? '',
            documents: docs.length,
            root: docs.reduce((count, item) => count + item.querySelectorAll('[data-component="agent-console"]').length, 0),
            xterm: docs.reduce((count, item) => count + item.querySelectorAll('.xterm-screen').length, 0),
            body: docs.map((item) => item.body?.innerText ?? '').join('\\n').slice(0, 500),
          }
        })()`,
      ).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      diagnostics.push({ id: target.id, type: target.type, title: target.title, state })
      if (state.found) {
        matches.push({ client, target, state })
        continue
      }
      client.close()
    }
    if (matches.length) {
      const score = (match) =>
        Number(match.state.visible) * 8 +
        Number(match.state.focused) * 4 +
        Number(match.state.mode === "agent") * 2 +
        Number(match.state.statusState === "connected") +
        Number(!match.state.routeStatus)
      matches.sort((left, right) => score(right) - score(left))
      const [choice, ...stale] = matches
      for (const match of stale) match.client.close()
      return { client: choice.client, target: choice.target, targets }
    }
    await wait(500)
  }
  throw new Error(
    `Agent Console CDP target not found; candidates=${JSON.stringify(targets)} diagnostics=${JSON.stringify(diagnostics)}`,
  )
}

const { client, target, targets } = await find()
try {
  const start = Date.now()
  let waitState
  if (action === "wait") {
    const limit = start + 240_000
    do {
      waitState = await evaluate(
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
          const root = docs
            .find((item) => item.querySelector('[data-component="agent-console"]'))
            ?.querySelector('[data-component="agent-console"]')
          const status = root?.querySelector('[data-slot="agent-console-connection"]')
          return {
            rootCount: docs.reduce(
              (count, item) => count + item.querySelectorAll('[data-component="agent-console"]').length,
              0,
            ),
            xtermCount: root?.querySelectorAll('.xterm-screen').length ?? 0,
            statusState: status?.dataset.state ?? '',
            fallback:
              root?.querySelector('[data-slot="agent-console-terminal"]')?.textContent?.trim() ??
              root?.textContent?.trim() ??
              '',
          }
        })()`,
      )
      if (waitState.rootCount === 1 && waitState.xtermCount === 1 && waitState.statusState === "connected") break
      await wait(250)
    } while (Date.now() < limit)
  }
  const requested = action === "wait" ? "probe" : action
  const result = await (async () => {
    if (requested === "screenshot") {
      if (!args.image) throw new Error("--image is required for screenshot")
      const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
      if (!page?.webSocketDebuggerUrl) throw new Error("Top-level page target not found for screenshot")
      const surface = target.id === page.id ? client : await rpc(page.webSocketDebuggerUrl)
      try {
        await surface.call("Page.enable")
        const shot = await surface.call("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        })
        writeFileSync(args.image, Buffer.from(shot.data, "base64"))
        return { captured: true, image: args.image, target: page.id }
      } finally {
        if (surface !== client) surface.close()
      }
    }
    if (requested === "submit") {
      const focus = await evaluate(
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
          const root = docs
            .find((item) => item.querySelector('[data-component="agent-console"]'))
            ?.querySelector('[data-component="agent-console"]')
          const input = root?.querySelector('.xterm-helper-textarea')
          if (!root || !input) return { focused: false, mode: root?.dataset.mode ?? '' }
          input.focus()
          return {
            focused: input.ownerDocument.activeElement === input,
            mode: root.dataset.mode ?? '',
          }
        })()`,
      )
      if (!focus.focused || focus.mode !== "agent") {
        return { submitted: false, ...focus }
      }
      await client.call("Input.insertText", { text: value })
      await client.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      })
      await client.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      })
      return { submitted: true, focused: true, mode: focus.mode, value, length: value.length }
    }
    if (requested === "clear" || requested === "buffer") {
      const focus = await evaluate(
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
          const root = docs
            .find((item) => item.querySelector('[data-component="agent-console"]'))
            ?.querySelector('[data-component="agent-console"]')
          const input = root?.querySelector('.xterm-helper-textarea')
          if (!root || !input) return { focused: false, mode: root?.dataset.mode ?? '' }
          input.focus()
          return {
            focused: input.ownerDocument.activeElement === input,
            mode: root.dataset.mode ?? '',
          }
        })()`,
      )
      if (!focus.focused) return { cleared: false, ...focus }
      const keys =
        requested === "clear"
          ? [{ key: "u", code: "KeyU", codePoint: 85 }]
          : [
              { key: "x", code: "KeyX", codePoint: 88 },
              { key: "q", code: "KeyQ", codePoint: 81 },
            ]
      await chord(client, keys)
      return { cleared: requested === "clear", probed: requested === "buffer", focused: true, mode: focus.mode }
    }
    if (requested === "scroll") {
      const point = await evaluate(
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
          const screen = docs
            .find((item) => item.querySelector('[data-component="agent-console"] .xterm-screen'))
            ?.querySelector('[data-component="agent-console"] .xterm-screen')
          if (!screen) return
          const rect = screen.getBoundingClientRect()
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, height: rect.height }
        })()`,
      )
      if (point) {
        await client.call("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: point.x,
          y: point.y,
          deltaX: 0,
          deltaY: (value === "up" ? -1 : 1) * Math.max(point.height * 2, 240),
        })
        await wait(100)
      }
    }
    return evaluate(
      client,
      `(async () => {
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
      const doc = docs.find((item) => item.querySelector('[data-component="agent-console"]'))
      const root = doc?.querySelector('[data-component="agent-console"]')
      if (!root) return { rootCount: 0, xtermCount: 0, customTextboxCount: 0, inputFocused: false }
      const screen = root.querySelector('.xterm-screen')
      const terminal = root.querySelector('[data-slot="agent-console-terminal"]')
      const activity = root.querySelector('[data-slot="agent-console-activity"]')
      const status = root.querySelector('[data-slot="agent-console-connection"]')
      const route = root.querySelector('[data-slot="agent-console-route-status"]')
      const shell = root.querySelector('[data-slot="agent-console-mode"] button[data-value="shell"]')
      const agent = root.querySelector('[data-slot="agent-console-mode"] button[data-value="agent"]')
      const input = root.querySelector('.xterm-helper-textarea')
      const viewport = root.querySelector('.xterm-viewport')
      const rowsHost = root.querySelector('.xterm-rows')
      const requested = ${JSON.stringify(requested)}
      const option = ${JSON.stringify(value)}
      if (!screen || !terminal || !activity || !input || !viewport) {
        return {
          rootCount: docs.reduce((count, item) => count + item.querySelectorAll('[data-component="agent-console"]').length, 0),
          xtermCount: root.querySelectorAll('.xterm-screen').length,
          customTextboxCount: root.querySelectorAll('textarea:not(.xterm-helper-textarea), input[type="text"]').length,
          status: status?.textContent?.trim() ?? '',
          statusState: status?.dataset.state ?? '',
          fallback: terminal?.textContent?.trim() ?? root.textContent?.trim() ?? '',
          inputFocused: false,
        }
      }
      if (requested === 'focus') {
        input.focus()
        return { focused: doc.activeElement === input }
      }
      if (requested === 'ime-arm') {
        const previous = window.__chipmateQaIme
        if (previous?.input && previous.handlers) {
          previous.input.removeEventListener('compositionstart', previous.handlers.start)
          previous.input.removeEventListener('compositionupdate', previous.handlers.update)
          previous.input.removeEventListener('compositionend', previous.handlers.end)
        }
        const state = {
          starts: 0,
          updates: 0,
          ends: 0,
          active: false,
          startedAt: 0,
          endedAt: 0,
          data: '',
          updatesData: [],
        }
        const handlers = {
          start: (event) => {
            state.starts += 1
            state.active = true
            state.startedAt = Date.now()
            state.data = event.data ?? ''
          },
          update: (event) => {
            state.updates += 1
            state.data = event.data ?? ''
            state.updatesData.push(state.data)
            if (state.updatesData.length > 20) state.updatesData.shift()
          },
          end: (event) => {
            state.ends += 1
            state.active = false
            state.endedAt = Date.now()
            state.data = event.data ?? ''
          },
        }
        input.addEventListener('compositionstart', handlers.start)
        input.addEventListener('compositionupdate', handlers.update)
        input.addEventListener('compositionend', handlers.end)
        window.__chipmateQaIme = { input, handlers, state }
        input.focus()
        return { armed: true, focused: doc.activeElement === input, ...state }
      }
      if (requested === 'ime-state') {
        const ime = window.__chipmateQaIme
        return {
          armed: Boolean(ime),
          focused: doc.activeElement === input,
          ...(ime?.state ?? {
            starts: 0,
            updates: 0,
            ends: 0,
            active: false,
            startedAt: 0,
            endedAt: 0,
            data: '',
            updatesData: [],
          }),
        }
      }
      if (requested === 'ready') {
        return {
          ready:
            root.dataset.mode === 'agent' &&
            status?.dataset.state === 'connected' &&
            !(route?.textContent?.trim() ?? ''),
          statusState: status?.dataset.state ?? '',
          routeStatus: route?.textContent?.trim() ?? '',
          mode: root.dataset.mode ?? '',
        }
      }
      if (requested === 'mode') {
        const button = option === 'shell' ? shell : agent
        if (!button) return { clicked: false, mode: root.dataset.mode ?? '' }
        button.click()
        await new Promise(requestAnimationFrame)
        input.focus()
        return { clicked: true, mode: root.dataset.mode ?? '', focused: doc.activeElement === input }
      }
      if (requested === 'click') {
        const names = option.split('|').map((item) => item.trim()).filter(Boolean)
        const buttons = [...root.querySelectorAll('button')]
        const button = buttons.find((item) => {
          const rect = item.getBoundingClientRect()
          if (item.disabled || rect.width <= 1 || rect.height <= 1) return false
          const labels = [item.textContent?.trim() ?? '', item.getAttribute('aria-label') ?? '', item.title ?? '']
          return names.some((name) => labels.some((label) => label === name || label.startsWith(name + ' ')))
        })
        if (button) {
          button.click()
          await new Promise(requestAnimationFrame)
        }
        return {
          clicked: Boolean(button),
          candidates: buttons
            .map((item) => item.textContent?.trim() || item.getAttribute('aria-label') || item.title)
            .filter(Boolean),
        }
      }
      if (requested === 'state' || requested === 'scroll') {
        const rows = [...root.querySelectorAll('.xterm-rows > div')].map((row) => row.textContent ?? '')
        return {
          mode: root.dataset.mode ?? '',
          focused: doc.activeElement === input,
          inputValue: input.value,
          rows,
          text: root.textContent ?? '',
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        }
      }
      const frames = []
      for (let index = 0; index < 25; index++) {
        shell.click()
        await new Promise(requestAnimationFrame)
        frames.push({ mode: root.dataset.mode, width: screen.getBoundingClientRect().width, height: screen.getBoundingClientRect().height })
        agent.click()
        await new Promise(requestAnimationFrame)
        frames.push({ mode: root.dataset.mode, width: screen.getBoundingClientRect().width, height: screen.getBoundingClientRect().height })
      }
      const terminalStyle = getComputedStyle(terminal)
      const activityStyle = getComputedStyle(activity)
      const screenStyle = getComputedStyle(rowsHost ?? screen)
      const inputStyle = getComputedStyle(input)
      input.focus()
      return {
        rootCount: docs.reduce((count, item) => count + item.querySelectorAll('[data-component="agent-console"]').length, 0),
        xtermCount: root.querySelectorAll('.xterm-screen').length,
        customTextboxCount: root.querySelectorAll('textarea:not(.xterm-helper-textarea), input[type="text"]').length,
        sameXterm: screen === root.querySelector('.xterm-screen') && screen.isConnected,
        blankFrames: frames.filter((frame) => frame.width <= 1 || frame.height <= 1).length,
        switchFrames: frames.length,
        terminalTransition: terminalStyle.transitionDuration,
        activityTransition: activityStyle.transitionDuration,
        fontFamily: inputStyle.fontFamily,
        fontSize: inputStyle.fontSize,
        lineHeight: inputStyle.lineHeight,
        screenFontFamily: screenStyle.fontFamily,
        status: status?.textContent?.trim() ?? '',
        statusState: status?.dataset.state ?? '',
        inputFocused: doc.activeElement === input,
        frames,
      }
    })()`,
      30_000,
    )
  })()
  const payload = {
    generatedAt: new Date().toISOString(),
    waitMs: action === "wait" ? Date.now() - start : 0,
    waitState,
    target: { id: target.id, type: target.type, title: target.title, url: target.url },
    candidates: targets.map((item) => ({ id: item.id, type: item.type, title: item.title, url: item.url })),
    result,
  }
  writeFileSync(args.output, `${JSON.stringify(payload, null, 2)}\n`)
} finally {
  client.close()
}
