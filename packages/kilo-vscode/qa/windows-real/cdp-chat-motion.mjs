#!/usr/bin/env node

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const index = item.indexOf("=")
    return index === -1 ? [item.replace(/^--/, ""), "true"] : [item.slice(2, index), item.slice(index + 1)]
  }),
)
const port = Number(args.port)
if (!Number.isSafeInteger(port) || port < 1) throw new Error("--port is required")
if (!args.output) throw new Error("--output is required")
const text = args.text ?? "[QA:TIMEOUT] 验证首次 Reload 后的动态思考动画"
const sampleMs = Number(args["sample-ms"] ?? 280)
if (!Number.isSafeInteger(sampleMs) || sampleMs < 80 || sampleMs > 2_000) {
  throw new Error("--sample-ms must be an integer between 80 and 2000")
}
const timeoutMs = Number(args["timeout-ms"] ?? 45_000)
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 180_000) {
  throw new Error("--timeout-ms must be an integer between 5000 and 180000")
}

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
          reject(new Error(`CDP call timed out: ${method}`))
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

const inspectExpression = `(() => {
  const documents = []
  const visit = (doc, left = 0, top = 0, depth = 0) => {
    if (!doc || documents.some((item) => item.doc === doc)) return
    documents.push({ doc, left, top, depth })
    for (const frame of doc.querySelectorAll('iframe')) {
      try {
        if (!frame.contentDocument) continue
        const rect = frame.getBoundingClientRect()
        visit(frame.contentDocument, left + rect.left, top + rect.top, depth + 1)
      } catch (error) {
        void error
      }
    }
  }
  visit(document)
  const candidates = documents
    .map((entry) => {
      const root = entry.doc.querySelector('.chat-view[data-ui="qa-shell"]')
      if (!root) return
      const rect = root.getBoundingClientRect()
      const input = root.querySelector('textarea.prompt-input')
      const submit = root.querySelector('[data-ui="qa-action-submit"]')
      const visible =
        rect.width > 2 &&
        rect.height > 2 &&
        entry.doc.visibilityState === 'visible' &&
        getComputedStyle(root).visibility !== 'hidden' &&
        getComputedStyle(root).display !== 'none'
      return {
        entry,
        root,
        input,
        submit,
        visible,
        rect,
      }
    })
    .filter(Boolean)
  candidates.sort((left, right) => {
    const score = (item) =>
      Number(item.entry.doc === document) * 16 +
      Number(item.visible) * 8 +
      Number(Boolean(item.input)) * 4 +
      Number(Boolean(item.submit)) * 2 -
      item.entry.depth
    return score(right) - score(left)
  })
  const selected = candidates[0]
  if (!selected) {
    return {
      found: false,
      documentCount: documents.length,
      chatRoots: 0,
      readyState: document.readyState,
      url: location.href,
    }
  }
  const inputDisabled = selected.input?.getAttribute('aria-disabled') === 'true' || selected.input?.disabled === true
  const submitDisabled = selected.submit?.getAttribute('aria-disabled') === 'true' || selected.submit?.disabled === true
  const spinner = [...selected.root.querySelectorAll('[data-component="spinner"].working-spinner')].find((item) => {
    const rect = item.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1 && getComputedStyle(item).visibility !== 'hidden'
  })
  const spinnerRect = spinner?.getBoundingClientRect()
  const motion = spinner?.querySelector('[data-slot="spinner-motion"]')
  const motionImages = [...(motion?.querySelectorAll('img') ?? [])].map((image) => ({
    src: image.currentSrc || image.src,
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }))
  const still = spinner?.querySelector('[data-slot="spinner-still"]')
  const styles = motion
    ? [...motion.querySelectorAll('[data-motion], [data-motion] > img')].map((item) => {
        const style = getComputedStyle(item)
        return {
          motion: item.getAttribute('data-motion') ?? item.parentElement?.getAttribute('data-motion') ?? '',
          animationName: style.animationName,
          animationPlayState: style.animationPlayState,
          opacity: style.opacity,
          transform: style.transform,
        }
      })
    : []
  return {
    found: true,
    directDocument: selected.entry.doc === document,
    documentCount: documents.length,
    chatRoots: candidates.length,
    visible: selected.visible,
    input: {
      exists: Boolean(selected.input),
      disabled: Boolean(inputDisabled),
      value: selected.input?.value ?? '',
    },
    submit: {
      exists: Boolean(selected.submit),
      disabled: Boolean(submitDisabled),
      label: selected.submit?.getAttribute('aria-label') ?? selected.submit?.textContent?.trim() ?? '',
    },
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    forcedColors: matchMedia('(forced-colors: active)').matches,
    motionBaseUri: window.KILO_LOADING_MOTION_URI ?? '',
    spinner: spinner
      ? {
          exists: true,
          variant: spinner.getAttribute('data-spinner-variant') ?? '',
          ready: Boolean(motion?.classList.contains('is-ready')),
          motionExists: Boolean(motion),
          motionImages,
          still: still
            ? {
                src: still.currentSrc || still.src,
                complete: still.complete,
                naturalWidth: still.naturalWidth,
                naturalHeight: still.naturalHeight,
              }
            : undefined,
          styles,
          rect: spinnerRect
            ? {
                x: selected.entry.left + spinnerRect.left,
                y: selected.entry.top + spinnerRect.top,
                width: spinnerRect.width,
                height: spinnerRect.height,
              }
            : undefined,
        }
      : { exists: false },
  }
})()`

const submitExpression = `(() => {
  const documents = []
  const visit = (doc, depth = 0) => {
    if (!doc || documents.some((item) => item.doc === doc)) return
    documents.push({ doc, depth })
    for (const frame of doc.querySelectorAll('iframe')) {
      try {
        if (frame.contentDocument) visit(frame.contentDocument, depth + 1)
      } catch (error) {
        void error
      }
    }
  }
  visit(document)
  const match = documents
    .map((entry) => ({
      entry,
      root: entry.doc.querySelector('.chat-view[data-ui="qa-shell"]'),
    }))
    .find((item) => item.root?.querySelector('textarea.prompt-input'))
  const input = match?.root?.querySelector('textarea.prompt-input')
  if (!input) return { submitted: false, reason: 'prompt input not found' }
  if (input.disabled || input.getAttribute('aria-disabled') === 'true') {
    return { submitted: false, reason: 'prompt input is disabled' }
  }
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (!setter) return { submitted: false, reason: 'textarea setter unavailable' }
  const value = ${JSON.stringify(text)}
  setter.call(input, value)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  const dispatched = input.dispatchEvent(event)
  return {
    submitted: !dispatched || event.defaultPrevented,
    defaultPrevented: event.defaultPrevented,
    inputValue: input.value,
    active: input.ownerDocument.activeElement === input,
  }
})()`

async function findChatTarget() {
  const limit = Date.now() + timeoutMs
  let targets = []
  let diagnostics = []
  while (Date.now() < limit) {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
    diagnostics = []
    const matches = []
    for (const target of targets) {
      if (!target.webSocketDebuggerUrl) continue
      const client = await rpc(target.webSocketDebuggerUrl)
      const state = await evaluate(client, inspectExpression).catch((error) => ({
        found: false,
        error: error instanceof Error ? error.message : String(error),
      }))
      diagnostics.push({ id: target.id, type: target.type, title: target.title, state })
      if (state.found) {
        matches.push({ client, target, state })
        continue
      }
      client.close()
    }
    if (matches.length) {
      const score = (match) =>
        Number(match.state.directDocument) * 16 +
        Number(match.state.visible) * 8 +
        Number(match.state.input?.exists) * 4 +
        Number(!match.state.input?.disabled) * 2
      matches.sort((left, right) => score(right) - score(left))
      const [choice, ...stale] = matches
      for (const item of stale) item.client.close()
      return { ...choice, targets, diagnostics }
    }
    await wait(250)
  }
  throw new Error(`ChipMate chat CDP target not found; diagnostics=${JSON.stringify(diagnostics)}`)
}

async function waitForInput(client) {
  const limit = Date.now() + timeoutMs
  let state
  do {
    state = await evaluate(client, inspectExpression)
    if (state.found && state.visible && state.input?.exists && !state.input.disabled) return state
    await wait(200)
  } while (Date.now() < limit)
  throw new Error(`ChipMate chat prompt did not become ready: ${JSON.stringify(state)}`)
}

async function waitForSpinner(client) {
  const limit = Date.now() + timeoutMs
  let state
  do {
    state = await evaluate(client, inspectExpression)
    const spinner = state.spinner
    const resources = spinner?.motionImages ?? []
    const motionLoaded = resources.length > 0 && resources.every((image) => image.complete && image.naturalWidth > 0)
    const stillLoaded = !spinner?.still || (spinner.still.complete && spinner.still.naturalWidth > 0)
    if (
      state.found &&
      state.visible &&
      state.reducedMotion === false &&
      state.forcedColors === false &&
      spinner?.exists &&
      spinner.variant &&
      spinner.variant !== "reduced" &&
      spinner.variant !== "system" &&
      spinner.motionExists &&
      spinner.ready &&
      motionLoaded &&
      stillLoaded &&
      spinner.rect?.width > 1 &&
      spinner.rect?.height > 1
    ) {
      return state
    }
    await wait(150)
  } while (Date.now() < limit)
  throw new Error(`Working spinner did not reach an animated ready state: ${JSON.stringify(state)}`)
}

async function captureSpinner(client, rect) {
  const padding = 2
  const clip = {
    x: Math.max(0, rect.x - padding),
    y: Math.max(0, rect.y - padding),
    width: Math.max(1, rect.width + padding * 2),
    height: Math.max(1, rect.height + padding * 2),
    scale: 4,
  }
  const result = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip,
  })
  if (!result.data) throw new Error("CDP spinner screenshot returned no data")
  return { data: Buffer.from(result.data, "base64"), clip }
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function writeOutput(value) {
  mkdirSync(dirname(args.output), { recursive: true })
  writeFileSync(args.output, `${JSON.stringify(value, null, 2)}\n`)
}

async function run() {
  const { client, target, targets, diagnostics } = await findChatTarget()
  try {
    const ready = await waitForInput(client)
    const submitted = await evaluate(client, submitExpression)
    if (!submitted?.submitted) throw new Error(`Chat prompt did not accept the timeout request: ${JSON.stringify(submitted)}`)
    const spinner = await waitForSpinner(client)
    await client.call("Page.enable")
    const frames = []
    for (let index = 0; index < 3; index += 1) {
      const shot = await captureSpinner(client, spinner.spinner.rect)
      const hash = digest(shot.data)
      const image = args["image-dir"] ? join(args["image-dir"], `spinner-frame-${index + 1}.png`) : undefined
      if (image) {
        mkdirSync(dirname(image), { recursive: true })
        writeFileSync(image, shot.data)
      }
      frames.push({ index: index + 1, bytes: shot.data.length, sha256: hash, image, clip: shot.clip })
      if (index < 2) await wait(sampleMs)
    }
    const after = await evaluate(client, inspectExpression)
    const uniqueFrameHashes = new Set(frames.map((frame) => frame.sha256)).size
    const assertions = [
      {
        id: "reduced-motion-disabled",
        status: spinner.reducedMotion === false ? "PASS" : "FAIL",
        detail: `prefers-reduced-motion=${spinner.reducedMotion}`,
      },
      {
        id: "spinner-motion-ready",
        status: spinner.spinner.ready && spinner.spinner.motionExists ? "PASS" : "FAIL",
        detail: `variant=${spinner.spinner.variant} ready=${spinner.spinner.ready} motion=${spinner.spinner.motionExists}`,
      },
      {
        id: "spinner-motion-assets",
        status: spinner.spinner.motionImages.every((image) => image.complete && image.naturalWidth > 0) ? "PASS" : "FAIL",
        detail: JSON.stringify(spinner.spinner.motionImages),
      },
      {
        id: "spinner-pixels-change",
        status: uniqueFrameHashes > 1 ? "PASS" : "FAIL",
        detail: `frames=${frames.length} uniqueHashes=${uniqueFrameHashes} sampleMs=${sampleMs}`,
      },
    ]
    const passed = assertions.every((item) => item.status === "PASS")
    return {
      status: passed ? "PASS" : "FAIL",
      generatedAt: new Date().toISOString(),
      target: { id: target.id, type: target.type, title: target.title, url: target.url },
      candidates: targets.map((item) => ({ id: item.id, type: item.type, title: item.title, url: item.url })),
      diagnostics,
      request: { text, submitted },
      before: ready,
      spinner,
      after,
      frames,
      assertions,
    }
  } finally {
    client.close()
  }
}

try {
  const result = await run()
  writeOutput(result)
  if (result.status !== "PASS") process.exitCode = 1
} catch (error) {
  const result = {
    status: "FAIL",
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }
  writeOutput(result)
  process.exitCode = 1
}
