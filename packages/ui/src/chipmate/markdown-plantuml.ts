import { fnv1a } from "../context/marked"
import {
  mountPlantUmlActions,
  mountPlantUmlErrorActions,
  mountPlantUmlStatus,
} from "./markdown-plantuml-actions"
import { clampMermaidZoom, fitMermaidZoom } from "./markdown-mermaid-zoom"
import { cleanPlantUml, completePlantUml } from "./markdown-plantuml-source"

export type PlantUmlLabels = {
  rendering: string
  waiting: string
  renderError: (message: string) => string
  errorDefault: string
  copied: string
  copySource: string
  downloadPng: string
  zoomOut: string
  zoomIn: string
  fit: string
  openViewer: string
  viewerTitle: string
  viewerControls: string
  showSource: string
  hideSource: string
  retry: string
  prepareRepair: string
  repairPrompt: (source: string, error: string) => string
}

type Result = {
  type: "plantUmlRendered"
  requestId: string
  ok: boolean
  dataUrl?: string
  width?: number
  height?: number
  issues?: string[]
}

type Image = {
  url: string
  width: number
  height: number
  size: number
}

type Flight = {
  id: string
  promise: Promise<Result>
  started: number
}

const defaults: PlantUmlLabels = {
  rendering: "Rendering PlantUML diagram through ChipMate Server...",
  waiting: "The server is still rendering. Please wait...",
  renderError: (message) => `PlantUML render failed: ${message}`,
  errorDefault: "Unable to render PlantUML diagram.",
  copied: "Copied",
  copySource: "Copy PlantUML source",
  downloadPng: "Download PNG",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  fit: "Fit diagram",
  openViewer: "Open diagram viewer",
  viewerTitle: "PlantUML diagram",
  viewerControls: "Diagram viewer controls",
  showSource: "Show PlantUML source",
  hideSource: "Hide PlantUML source",
  retry: "Retry",
  prepareRepair: "Prepare repair",
  repairPrompt: (source, error) =>
    `Fix the PlantUML syntax error below while preserving the diagram's meaning. Return exactly one valid fenced PlantUML block and no additional explanation.\n\nRender error:\n${error}\n\nSource:\n\`\`\`plantuml\n${source}\n\`\`\``,
}

const cache = new Map<string, Image>()
const flights = new Map<string, Flight>()
const actions = new WeakMap<HTMLElement, () => void>()
const jobs = new WeakMap<HTMLElement, () => void>()
const MAX_CACHE_ITEMS = 12
const MAX_CACHE_SIZE = 64 * 1024 * 1024

function labels(input?: Partial<PlantUmlLabels>) {
  return { ...defaults, ...input }
}

function panel(wrapper: HTMLElement) {
  const found = Array.from(wrapper.children).find(
    (child): child is HTMLDivElement =>
      child instanceof HTMLDivElement && child.getAttribute("data-component") === "markdown-plantuml",
  )
  if (found) return found
  const el = document.createElement("div")
  el.setAttribute("data-component", "markdown-plantuml")
  wrapper.insertBefore(el, wrapper.firstChild)
  return el
}

function cleanup(el: HTMLElement) {
  actions.get(el)?.()
  actions.delete(el)
}

function current(wrapper: HTMLElement, fallback: HTMLPreElement) {
  return wrapper.querySelector<HTMLPreElement>("pre") ?? fallback
}

function cancel(wrapper: HTMLElement) {
  jobs.get(wrapper)?.()
  jobs.delete(wrapper)
}

function scrollable(el: HTMLElement) {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) return parent
  }
}

function anchor(wrapper: HTMLElement, update: () => void) {
  const scroll = scrollable(wrapper)
  if (!scroll) {
    update()
    return
  }
  const bottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 32
  const top = wrapper.getBoundingClientRect().top
  update()
  requestAnimationFrame(() => {
    if (!scroll.isConnected || !wrapper.isConnected) return
    if (bottom) {
      scroll.scrollTop = scroll.scrollHeight
      return
    }
    scroll.scrollTop += wrapper.getBoundingClientRect().top - top
  })
}

function status(el: HTMLElement, text: string) {
  cleanup(el)
  el.replaceChildren()
  el.setAttribute("data-state", "rendering")
  el.setAttribute("role", "status")
  el.setAttribute("aria-live", "polite")
  actions.set(el, mountPlantUmlStatus(el, text))
}

function touch(key: string, image: Image) {
  cache.delete(key)
  cache.set(key, image)
  const size = () => Array.from(cache.values()).reduce((total, item) => total + item.size, 0)
  while (cache.size > MAX_CACHE_ITEMS || size() > MAX_CACHE_SIZE) {
    const first = cache.keys().next().value
    if (!first) return
    cache.delete(first)
  }
}

function save(url: string) {
  const event = new CustomEvent("chipmate:save-image", {
    bubbles: true,
    cancelable: true,
    detail: { dataUrl: url, filename: "plantuml-diagram.png" },
  })
  window.dispatchEvent(event)
  if (event.defaultPrevented) return
  const link = document.createElement("a")
  link.href = url
  link.download = "plantuml-diagram.png"
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
}

type Viewport = {
  zoom: number
  set: (value: number) => number
  fit: () => number
  dispose: () => void
}

function viewport(el: HTMLDivElement, image: HTMLImageElement, dims: { width: number; height: number }): Viewport {
  const canvas = document.createElement("div")
  const surface = document.createElement("div")
  const state = { zoom: 1, fitted: true }
  const drag = { active: false, x: 0, y: 0, left: 0, top: 0 }
  canvas.setAttribute("data-slot", "markdown-plantuml-canvas")
  canvas.setAttribute("tabindex", "0")
  surface.setAttribute("data-slot", "markdown-plantuml-surface")
  image.draggable = false
  surface.appendChild(image)
  canvas.appendChild(surface)
  el.appendChild(canvas)

  const apply = () => {
    surface.style.width = `${Math.max(dims.width * state.zoom, 1)}px`
    surface.style.height = `${Math.max(dims.height * state.zoom, 1)}px`
  }
  const set = (value: number) => {
    state.fitted = false
    state.zoom = clampMermaidZoom(value)
    apply()
    return state.zoom
  }
  const fit = () => {
    state.fitted = true
    state.zoom = fitMermaidZoom(
      { width: Math.max(canvas.clientWidth - 24, 1), height: Math.max(canvas.clientHeight - 24, 1) },
      dims,
    )
    apply()
    canvas.scrollLeft = 0
    canvas.scrollTop = 0
    return state.zoom
  }
  const start = (event: PointerEvent) => {
    if (event.button !== 0) return
    drag.active = true
    drag.x = event.clientX
    drag.y = event.clientY
    drag.left = canvas.scrollLeft
    drag.top = canvas.scrollTop
    canvas.setPointerCapture(event.pointerId)
    canvas.setAttribute("data-dragging", "")
  }
  const move = (event: PointerEvent) => {
    if (!drag.active) return
    canvas.scrollLeft = drag.left - (event.clientX - drag.x)
    canvas.scrollTop = drag.top - (event.clientY - drag.y)
  }
  const stop = (event: PointerEvent) => {
    if (!drag.active) return
    drag.active = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    canvas.removeAttribute("data-dragging")
  }
  canvas.addEventListener("pointerdown", start)
  canvas.addEventListener("pointermove", move)
  canvas.addEventListener("pointerup", stop)
  canvas.addEventListener("pointercancel", stop)
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => state.fitted && fit())
  observer?.observe(canvas)
  apply()

  return {
    get zoom() {
      return state.zoom
    },
    set,
    fit,
    dispose: () => {
      observer?.disconnect()
      canvas.removeEventListener("pointerdown", start)
      canvas.removeEventListener("pointermove", move)
      canvas.removeEventListener("pointerup", stop)
      canvas.removeEventListener("pointercancel", stop)
    },
  }
}

async function prepare(wrapper: HTMLElement, source: string, error: string, label: PlantUmlLabels) {
  const parent = wrapper.closest("[data-session-id]")
  const sessionID = parent?.getAttribute("data-session-id") ?? ""
  const event = new CustomEvent("chipmate:prepare-plantuml-repair", {
    bubbles: true,
    cancelable: true,
    detail: { sessionID, source, error },
  })
  wrapper.dispatchEvent(event)
  if (event.defaultPrevented) return
  await copy(label.repairPrompt(source, error))
}

function show(
  wrapper: HTMLElement,
  pre: HTMLPreElement,
  source: string,
  image: Image,
  label: PlantUmlLabels,
) {
  const el = panel(wrapper)
  anchor(wrapper, () => {
    const block = current(wrapper, pre)
    cleanup(el)
    el.replaceChildren()
    el.removeAttribute("role")
    el.removeAttribute("aria-live")
    el.setAttribute("data-state", "rendered")
    const img = document.createElement("img")
    img.src = image.url
    img.alt = label.viewerTitle
    const view = viewport(el, img, image)
    const zoom = view.fit()
    actions.set(
      el,
      mountPlantUmlActions(el, {
        labels: label,
        url: image.url,
        size: image,
        zoom,
        onZoom: view.set,
        onFit: view.fit,
        onSource: () => {
          block.hidden = !block.hidden
          wrapper.toggleAttribute("data-source-visible", !block.hidden)
          return !block.hidden
        },
        onCopySource: () => copy(source),
        onDownload: () => save(image.url),
      }),
    )
    const dispose = actions.get(el)
    actions.set(el, () => {
      view.dispose()
      dispose?.()
    })
    wrapper.setAttribute("data-plantuml-state", "rendered")
    block.hidden = true
  })
}

function fail(
  wrapper: HTMLElement,
  pre: HTMLPreElement,
  source: string,
  issues: string[],
  label: PlantUmlLabels,
) {
  const el = panel(wrapper)
  const error = issues[0] ?? label.errorDefault
  anchor(wrapper, () => {
    const block = current(wrapper, pre)
    cleanup(el)
    el.replaceChildren()
    el.setAttribute("data-state", "error")
    el.setAttribute("role", "alert")
    el.removeAttribute("aria-live")
    const title = document.createElement("div")
    title.setAttribute("data-slot", "markdown-plantuml-error-message")
    title.textContent = label.renderError(error)
    el.appendChild(title)
    if (issues.length > 1) {
      const list = document.createElement("ul")
      list.setAttribute("data-slot", "markdown-plantuml-issues")
      for (const issue of issues.slice(1, 8)) {
        const item = document.createElement("li")
        item.textContent = issue
        list.appendChild(item)
      }
      el.appendChild(list)
    }
    actions.set(
      el,
      mountPlantUmlErrorActions(el, {
        labels: label,
        onRetry: () => void begin(wrapper, pre, source, label),
        onCopySource: () => copy(source),
        onPrepare: () => prepare(wrapper, source, error, label),
      }),
    )
    wrapper.setAttribute("data-plantuml-state", "error")
    block.hidden = false
  })
}

function wait(requestId: string, timeout: number) {
  let done = false
  let resolve: (value: Result) => void = () => undefined
  const promise = new Promise<Result>((next) => {
    resolve = next
  })
  const receive = (event: Event) => {
    const detail = (event as CustomEvent<Result>).detail
    if (detail?.requestId !== requestId) return
    finish(detail)
  }
  const timer = setTimeout(
    () => finish({ type: "plantUmlRendered", requestId, ok: false, issues: ["PlantUML render timed out after 60 seconds."] }),
    timeout,
  )
  const finish = (result: Result) => {
    if (done) return
    done = true
    clearTimeout(timer)
    window.removeEventListener("chipmate:plantuml-rendered", receive)
    resolve(result)
  }
  window.addEventListener("chipmate:plantuml-rendered", receive)
  return { promise, finish }
}

function request(source: string) {
  const found = flights.get(source)
  if (found) return found

  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `plantuml-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const pending = wait(requestId, 60_000)
  const flight = { id: requestId, promise: pending.promise, started: Date.now() }
  flights.set(source, flight)
  void flight.promise.then(() => {
    if (flights.get(source) === flight) flights.delete(source)
  })

  const event = new CustomEvent("chipmate:render-plantuml", {
    bubbles: true,
    cancelable: true,
    detail: { requestId, source },
  })
  window.dispatchEvent(event)
  if (!event.defaultPrevented) {
    pending.finish({
      type: "plantUmlRendered",
      requestId,
      ok: false,
      issues: ["PlantUML renderer is unavailable in this client."],
    })
  }
  return flight
}

async function begin(wrapper: HTMLElement, pre: HTMLPreElement, source: string, label: PlantUmlLabels) {
  cancel(wrapper)
  const generation = Number(wrapper.getAttribute("data-plantuml-generation") ?? "0") + 1
  wrapper.setAttribute("data-plantuml-generation", String(generation))
  wrapper.setAttribute("data-kind", "plantuml")
  wrapper.setAttribute("data-plantuml-hash", fnv1a(source))
  wrapper.setAttribute("data-plantuml-state", "rendering")
  const el = panel(wrapper)
  anchor(wrapper, () => {
    status(el, label.rendering)
    current(wrapper, pre).hidden = false
  })

  const cached = cache.get(source)
  if (cached) {
    touch(source, cached)
    show(wrapper, pre, source, cached, label)
    return
  }

  const pending = request(source)
  wrapper.setAttribute("data-plantuml-request-id", pending.id)
  const waiting = () => {
    if (wrapper.getAttribute("data-plantuml-generation") !== String(generation)) return
    if (!wrapper.isConnected) return
    status(el, label.waiting)
  }
  const delay = Math.max(8_000 - (Date.now() - pending.started), 0)
  const long = delay ? setTimeout(waiting, delay) : undefined
  if (!delay) waiting()
  const stop = () => {
    if (long) clearTimeout(long)
  }
  jobs.set(wrapper, stop)

  const result = await pending.promise
  stop()
  if (jobs.get(wrapper) === stop) jobs.delete(wrapper)
  if (wrapper.getAttribute("data-plantuml-generation") !== String(generation)) return
  if (!wrapper.isConnected) return
  if (!result.ok || !result.dataUrl || !result.width || !result.height) {
    fail(wrapper, pre, source, result.issues?.length ? result.issues : [label.errorDefault], label)
    return
  }
  const image = {
    url: result.dataUrl,
    width: result.width,
    height: result.height,
    size: result.dataUrl.length,
  }
  touch(source, image)
  show(wrapper, pre, source, image, label)
}

export function preservePlantUml(fromEl: Element, toEl: Element) {
  if (!(fromEl instanceof HTMLElement)) return false
  if (!(toEl instanceof HTMLElement)) return false
  if (fromEl.getAttribute("data-component") !== "markdown-code") return false
  if (fromEl.getAttribute("data-kind") !== "plantuml") return false
  if (!["rendering", "rendered", "error"].includes(fromEl.getAttribute("data-plantuml-state") ?? "")) return false
  if (toEl.getAttribute("data-component") !== "markdown-code") return false
  const selector = 'pre > code[data-lang="plantuml"], pre > code[data-lang="puml"]'
  const source = cleanPlantUml(toEl.querySelector(selector)?.textContent ?? "")
  if (!source) return false
  return fromEl.getAttribute("data-plantuml-hash") === fnv1a(source)
}

export function hasPlantUml(root: HTMLElement) {
  return root.querySelector('pre > code[data-lang="plantuml"], pre > code[data-lang="puml"]') !== null
}

export function disposePlantUml(root: HTMLElement) {
  const wrappers = root.matches('[data-component="markdown-code"][data-kind="plantuml"]')
    ? [root, ...root.querySelectorAll<HTMLElement>('[data-component="markdown-code"][data-kind="plantuml"]')]
    : Array.from(root.querySelectorAll<HTMLElement>('[data-component="markdown-code"][data-kind="plantuml"]'))
  for (const wrapper of wrappers) {
    cancel(wrapper)
    wrapper.setAttribute(
      "data-plantuml-generation",
      String(Number(wrapper.getAttribute("data-plantuml-generation") ?? "0") + 1),
    )
    const el = wrapper.querySelector<HTMLElement>('[data-component="markdown-plantuml"]')
    if (el) cleanup(el)
  }
}

export async function renderPlantUml(
  root: HTMLDivElement,
  signal: { aborted: boolean },
  input?: Partial<PlantUmlLabels>,
) {
  const label = labels(input)
  const blocks = Array.from(
    root.querySelectorAll('pre > code[data-lang="plantuml"], pre > code[data-lang="puml"]'),
  )
  const tasks = blocks.map((block) => {
    if (signal.aborted || !root.isConnected) return Promise.resolve()
    const pre = block.parentElement
    const wrapper = pre?.parentElement
    if (!(pre instanceof HTMLPreElement)) return Promise.resolve()
    if (!(wrapper instanceof HTMLElement)) return Promise.resolve()
    if (wrapper.getAttribute("data-component") !== "markdown-code") return Promise.resolve()
    const source = cleanPlantUml(block.textContent ?? "")
    if (!completePlantUml(source)) return Promise.resolve()
    const state = wrapper.getAttribute("data-plantuml-state")
    const hash = wrapper.getAttribute("data-plantuml-hash")
    if (hash === fnv1a(source) && ["rendering", "rendered", "error"].includes(state ?? "")) {
      return Promise.resolve()
    }
    return begin(wrapper, pre, source, label)
  })
  await Promise.all(tasks)
}
