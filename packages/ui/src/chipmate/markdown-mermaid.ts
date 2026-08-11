import DOMPurify from "dompurify"
import { fnv1a } from "../context/marked"
import { mountMermaidActions, mountMermaidErrorActions } from "./markdown-mermaid-actions"
import { clampMermaidZoom, fitMermaidZoom } from "./markdown-mermaid-zoom"

// DOMPurify >= 3.1.7 dropped foreignObject from the default HTML integration
// points, which caused the inner <div> / <span> / <p> labels Mermaid renders
// inside <foreignObject> to be stripped during sanitization, leaving every
// shape with empty text. Restoring it via HTML_INTEGRATION_POINTS keeps the
// labels while still sanitizing untrusted markup.
const svgConfig = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ["foreignObject"],
  HTML_INTEGRATION_POINTS: { foreignobject: true },
  FORBID_TAGS: ["script"],
  FORBID_CONTENTS: ["script"],
}

type Mermaid = typeof import("mermaid").default

export type MermaidLabels = {
  rendering: string
  renderError: (message: string) => string
  errorDefault: string
  errorEmpty: string
  copied: string
  copy: string
  download: string
  copySource: string
  copySvg: string
  copyPng: string
  downloadSvg: string
  downloadPng: string
  zoomOut: string
  zoomIn: string
  fit: string
  openViewer: string
  viewerTitle: string
  viewerControls: string
  showSource: string
  hideSource: string
  prepareRepair: string
  repairPrompt: (source: string, error: string) => string
}

const labels: MermaidLabels = {
  rendering: "Rendering Mermaid diagram...",
  renderError: (message) => `Mermaid render failed: ${message}`,
  errorDefault: "Unable to render Mermaid diagram.",
  errorEmpty: "Mermaid rendered an empty diagram.",
  copied: "Copied",
  copy: "Copy",
  download: "Download",
  copySource: "Copy Mermaid source",
  copySvg: "Copy SVG",
  copyPng: "Copy PNG",
  downloadSvg: "Download SVG",
  downloadPng: "Download PNG",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  fit: "Fit diagram",
  openViewer: "Open diagram viewer",
  viewerTitle: "Mermaid diagram",
  viewerControls: "Diagram viewer controls",
  showSource: "Show Mermaid source",
  hideSource: "Hide Mermaid source",
  prepareRepair: "Prepare repair",
  repairPrompt: (source, error) =>
    `Fix the Mermaid syntax error below while preserving the diagram's meaning. Return exactly one valid fenced Mermaid block and no additional explanation.\n\nParser error:\n${error}\n\nSource:\n\`\`\`mermaid\n${source}\n\`\`\``,
}

const cache: { promise?: Promise<Mermaid>; id: number; queue: Promise<void> } = {
  id: 0,
  queue: Promise.resolve(),
}

const actions = new WeakMap<HTMLElement, () => void>()

async function load() {
  if (!cache.promise) {
    cache.promise = import("mermaid").then((mod) => mod.default)
  }
  return cache.promise
}

function parse(color: string) {
  const value = color.trim()
  const hex = value.match(/^#([0-9a-f]{6})/i)
  if (hex?.[1]) {
    return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)]
  }

  const short = value.match(/^#([0-9a-f]{3})/i)
  if (short?.[1]) return short[1].split("").map((part) => parseInt(`${part}${part}`, 16))

  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgb?.[1] && rgb[2] && rgb[3]) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
}

function resolve(root: Element, value: string) {
  const trimmed = value.trim()
  if (!trimmed) return
  if (!trimmed.includes("var(")) return trimmed

  const doc = root.ownerDocument
  const probe = doc.createElement("span")
  probe.style.color = trimmed
  probe.style.position = "absolute"
  probe.style.visibility = "hidden"
  probe.style.pointerEvents = "none"

  const parent = root instanceof HTMLElement ? root : doc.body
  parent.appendChild(probe)
  const color = getComputedStyle(probe).color.trim()
  probe.remove()
  return color || trimmed
}

function css(root: Element, names: string[], fallback: string) {
  const style = getComputedStyle(root)
  for (const name of names) {
    const value = resolve(root, style.getPropertyValue(name))
    if (value) return value
  }
  return resolve(root, fallback) ?? fallback
}

function dark(root: Element, background: string) {
  if (document.body.classList.contains("vscode-light")) return false
  if (document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast"))
    return true

  const scheme = getComputedStyle(root).colorScheme
  if (scheme.includes("dark")) return true
  if (scheme.includes("light")) return false

  const rgb = parse(background)
  if (!rgb) return true
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.5
}

function config(root: Element) {
  const style = getComputedStyle(root)
  const background = css(
    root,
    ["--vscode-editor-background", "--background-base", "--surface-base"],
    style.backgroundColor || "#1e1e1e",
  )
  const panel = css(root, ["--vscode-editorWidget-background", "--surface-raised-base", "--surface-base"], background)
  const alt = css(root, ["--vscode-input-background", "--surface-weak", "--surface-base"], panel)
  const text = css(
    root,
    ["--vscode-editor-foreground", "--text-strong", "--vscode-foreground"],
    style.color || "#ffffff",
  )
  const weak = css(root, ["--vscode-descriptionForeground", "--text-weak", "--vscode-foreground"], text)
  const border = css(root, ["--vscode-editorWidget-border", "--vscode-editorGroup-border", "--border-weak-base"], weak)
  const accent = css(
    root,
    ["--vscode-textLink-foreground", "--vscode-charts-blue", "--text-interactive-base"],
    "#6cb6ff",
  )
  const critical = css(root, ["--vscode-errorForeground", "--vscode-charts-red", "--syntax-critical"], "#ff9580")
  const criticalBg = css(root, ["--vscode-inputValidation-errorBackground", "--surface-critical-base"], alt)

  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    theme: "base" as const,
    themeVariables: {
      darkMode: dark(root, background),
      background,
      textColor: text,
      mainBkg: panel,
      nodeBorder: border,
      lineColor: weak,
      primaryColor: panel,
      primaryTextColor: text,
      primaryBorderColor: border,
      secondaryColor: alt,
      tertiaryColor: background,
      classText: text,
      labelColor: text,
      actorLineColor: weak,
      actorBkg: panel,
      actorBorder: border,
      actorTextColor: text,
      fillType0: panel,
      fillType1: alt,
      fillType2: background,
      fontSize: "16px",
      fontFamily: "var(--font-family-sans)",
      noteTextColor: text,
      noteBkgColor: alt,
      noteBorderColor: border,
      critBorderColor: critical,
      critBkgColor: criticalBg,
      taskTextColor: text,
      taskTextOutsideColor: text,
      taskTextLightColor: text,
      sectionBkgColor: panel,
      sectionBkgColor2: alt,
      altBackground: panel,
      linkColor: accent,
      compositeBackground: panel,
      compositeBorder: border,
      titleColor: text,
      edgeLabelBackground: background,
    },
  }
}

function enqueue<T>(run: () => Promise<T>) {
  const next = cache.queue.then(run, run)
  cache.queue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function sanitize(svg: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(svg, svgConfig)
}

function mergeLabels(input?: Partial<MermaidLabels>) {
  return { ...labels, ...input }
}

function message(err: unknown, labels: MermaidLabels) {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return labels.errorDefault
}

function panel(wrapper: HTMLElement) {
  const found = Array.from(wrapper.children).find(
    (child): child is HTMLDivElement =>
      child instanceof HTMLDivElement && child.getAttribute("data-component") === "markdown-mermaid",
  )
  if (found) return found

  const el = document.createElement("div")
  el.setAttribute("data-component", "markdown-mermaid")
  wrapper.insertBefore(el, wrapper.firstChild)
  return el
}

function fail(wrapper: HTMLElement, pre: HTMLPreElement, err: unknown, labels: MermaidLabels, source?: string) {
  const el = panel(wrapper)
  cleanupActions(el)
  const detail = message(err, labels)
  el.setAttribute("data-state", "error")
  el.replaceChildren()
  const text = document.createElement("div")
  text.setAttribute("data-slot", "markdown-mermaid-error-message")
  text.textContent = labels.renderError(detail)
  el.appendChild(text)
  wrapper.setAttribute("data-mermaid-state", "error")
  pre.hidden = false
  const value = source ?? pre.querySelector("code")?.textContent ?? ""
  actions.set(
    el,
    mountMermaidErrorActions(el, {
      labels,
      onCopySource: () => copyText(value),
      onPrepare: () => prepare(wrapper, value, detail, labels),
    }),
  )
}

function cleanupActions(el: HTMLElement) {
  const dispose = actions.get(el)
  if (!dispose) return
  dispose()
  actions.delete(el)
}

export function disposeMermaid(root: HTMLElement) {
  const nodes = root.matches('[data-component="markdown-mermaid"]')
    ? [root, ...root.querySelectorAll<HTMLElement>('[data-component="markdown-mermaid"]')]
    : Array.from(root.querySelectorAll<HTMLElement>('[data-component="markdown-mermaid"]'))
  for (const node of nodes) cleanupActions(node)
}

function serialize(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const dims = size(svg)
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("width", String(dims.width))
  clone.setAttribute("height", String(dims.height))
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${dims.width} ${dims.height}`)
  return new XMLSerializer().serializeToString(clone)
}

function dataUrl(type: string, content: string) {
  return `data:${type};base64,${btoa(unescape(encodeURIComponent(content)))}`
}

function size(svg: SVGSVGElement) {
  const box = svg.viewBox.baseVal
  const rect = svg.getBoundingClientRect()
  const width = Math.max(Math.ceil(box?.width || rect.width || 1), 1)
  const height = Math.max(Math.ceil(box?.height || rect.height || 1), 1)
  return { width, height }
}

function opaque(color: string) {
  if (!color || color === "transparent") return false
  return !/^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\)$/i.test(color)
}

function background(svg: SVGSVGElement) {
  const roots = [
    svg.closest('[data-slot="markdown-mermaid-canvas"]'),
    svg.closest('[data-component="markdown-mermaid"]'),
    svg.closest('[data-component="markdown-code"]'),
    document.body,
  ]
  for (const root of roots) {
    if (!(root instanceof Element)) continue
    const color = getComputedStyle(root).backgroundColor
    if (opaque(color)) return color
  }
}

async function png(svg: SVGSVGElement) {
  const source = serialize(svg)
  const url = dataUrl("image/svg+xml", source)
  const img = new Image()
  const dims = size(svg)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("Unable to export Mermaid diagram."))
    img.src = url
  })

  const canvas = document.createElement("canvas")
  const scale = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
  canvas.width = Math.max(Math.ceil(dims.width * scale), 1)
  canvas.height = Math.max(Math.ceil(dims.height * scale), 1)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Unable to export Mermaid diagram.")
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  const color = background(svg)
  if (color) {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, dims.width, dims.height)
  }
  ctx.drawImage(img, 0, 0, dims.width, dims.height)
  return canvas.toDataURL("image/png")
}

function download(url: string, filename: string) {
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function save(url: string, filename: string) {
  const event = new CustomEvent("chipmate:save-image", {
    bubbles: true,
    cancelable: true,
    detail: { dataUrl: url, filename },
  })
  window.dispatchEvent(event)
  if (event.defaultPrevented) return
  download(url, filename)
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

async function copyPng(svg: SVGSVGElement) {
  const url = await png(svg)
  const blob = await (await fetch(url)).blob()
  if (typeof ClipboardItem === "undefined") {
    await navigator.clipboard.writeText(serialize(svg))
    return
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
}

type Viewport = {
  zoom: number
  set: (value: number) => number
  fit: () => number
  dispose: () => void
}

function viewport(el: HTMLDivElement, svg: SVGSVGElement): Viewport {
  const dims = size(svg)
  const canvas = document.createElement("div")
  const surface = document.createElement("div")
  const state = { zoom: 1, fitted: true }
  const drag = { active: false, x: 0, y: 0, left: 0, top: 0 }
  canvas.setAttribute("data-slot", "markdown-mermaid-canvas")
  canvas.setAttribute("tabindex", "0")
  surface.setAttribute("data-slot", "markdown-mermaid-surface")
  surface.appendChild(svg)
  canvas.appendChild(surface)
  el.appendChild(canvas)

  const apply = () => {
    surface.style.width = `${Math.max(dims.width * state.zoom, 1)}px`
    surface.style.height = `${Math.max(dims.height * state.zoom, 1)}px`
    el.style.setProperty("--markdown-mermaid-zoom", String(state.zoom))
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

async function prepare(wrapper: HTMLElement, source: string, error: string, labels: MermaidLabels) {
  const parent = wrapper.closest("[data-session-id]")
  const sessionID = parent?.getAttribute("data-session-id") ?? ""
  const event = new CustomEvent("chipmate:prepare-mermaid-repair", {
    bubbles: true,
    cancelable: true,
    detail: { sessionID, source, error },
  })
  wrapper.dispatchEvent(event)
  if (event.defaultPrevented) return
  await copyText(labels.repairPrompt(source, error))
}

function renderActions(el: HTMLDivElement, pre: HTMLPreElement, source: string, labels: MermaidLabels) {
  const svg = el.querySelector("svg")
  if (!(svg instanceof SVGSVGElement)) return

  cleanupActions(el)
  const old = el.querySelector('[data-slot="markdown-mermaid-actions-root"]')
  old?.remove()
  const sourceText = pre.querySelector("code")?.textContent ?? source
  const dims = size(svg)
  const view = viewport(el, svg)
  const initial = view.fit()
  const sourceSvg = () => serialize(svg)
  const sourceSvgUrl = () => dataUrl("image/svg+xml", sourceSvg())

  actions.set(
    el,
    mountMermaidActions(el, {
      labels,
      svg: sourceSvg(),
      size: dims,
      zoom: initial,
      onZoom: view.set,
      onFit: view.fit,
      onSource: () => {
        pre.hidden = !pre.hidden
        el.parentElement?.toggleAttribute("data-source-visible", !pre.hidden)
        return !pre.hidden
      },
      onCopySource: () => copyText(sourceText),
      onCopySvg: () => copyText(sourceSvg()),
      onCopyPng: () => copyPng(svg),
      onDownloadSvg: () => save(sourceSvgUrl(), "mermaid-diagram.svg"),
      onDownloadPng: async () => save(await png(svg), "mermaid-diagram.png"),
    }),
  )
  const dispose = actions.get(el)
  if (dispose) {
    actions.set(el, () => {
      view.dispose()
      dispose()
    })
  }
}

export function preserveMermaid(fromEl: Element, toEl: Element) {
  if (!(fromEl instanceof HTMLElement)) return false
  if (!(toEl instanceof HTMLElement)) return false
  if (fromEl.getAttribute("data-component") !== "markdown-code") return false
  if (fromEl.getAttribute("data-kind") !== "mermaid") return false
  if (fromEl.getAttribute("data-mermaid-state") !== "rendered") return false
  if (toEl.getAttribute("data-component") !== "markdown-code") return false

  const from = fromEl.querySelector('pre > code[data-lang="mermaid"]')?.textContent ?? ""
  const to = toEl.querySelector('pre > code[data-lang="mermaid"]')?.textContent ?? ""
  if (!from || from !== to) return false
  return true
}

export function hasMermaid(root: HTMLElement) {
  return root.querySelector('pre > code[data-lang="mermaid"]') !== null
}

async function svg(renderer: Mermaid, source: string, cfg: ReturnType<typeof config>) {
  return enqueue(async () => {
    renderer.initialize(cfg)
    await renderer.parse(source)
    return renderer.render(`markdown-mermaid-${fnv1a(source)}-${cache.id++}`, source)
  })
}

export async function renderMermaid(
  root: HTMLDivElement,
  signal: { aborted: boolean },
  input?: Partial<MermaidLabels>,
) {
  const label = mergeLabels(input)
  const blocks = Array.from(root.querySelectorAll('pre > code[data-lang="mermaid"]'))
  if (blocks.length === 0) return

  const renderer = await load().catch((err) => {
    for (const block of blocks) {
      const pre = block.parentElement
      const wrapper = pre?.parentElement
      if (!(pre instanceof HTMLPreElement)) continue
      if (!(wrapper instanceof HTMLElement)) continue
      if (wrapper.getAttribute("data-component") !== "markdown-code") continue
      fail(wrapper, pre, err, label)
    }
  })
  if (!renderer) return

  for (const block of blocks) {
    if (signal.aborted || !root.isConnected) return
    if (!(block instanceof HTMLElement)) continue

    const pre = block.parentElement
    if (!(pre instanceof HTMLPreElement)) continue

    const wrapper = pre.parentElement
    if (!(wrapper instanceof HTMLElement)) continue
    if (wrapper.getAttribute("data-component") !== "markdown-code") continue

    const source = block.textContent ?? ""
    if (!source.trim()) continue

    const cfg = config(wrapper)
    const hash = fnv1a(source)
    const theme = fnv1a(JSON.stringify(cfg.themeVariables))
    const state = wrapper.getAttribute("data-mermaid-state")
    if (
      state === "rendered" &&
      wrapper.getAttribute("data-mermaid-hash") === hash &&
      wrapper.getAttribute("data-mermaid-theme") === theme
    ) {
      pre.hidden = true
      continue
    }

    const keep = state === "rendered" && wrapper.getAttribute("data-mermaid-hash") === hash

    wrapper.setAttribute("data-kind", "mermaid")
    wrapper.setAttribute("data-mermaid-hash", hash)
    wrapper.setAttribute("data-mermaid-theme", theme)
    wrapper.setAttribute("data-mermaid-state", "rendering")

    const el = panel(wrapper)
    if (!keep) {
      el.setAttribute("data-state", "rendering")
      el.textContent = label.rendering
      pre.hidden = false
    } else {
      pre.hidden = true
    }

    try {
      const result = await svg(renderer, source, cfg)
      if (signal.aborted || !root.isConnected || !wrapper.isConnected) return

      const safe = sanitize(result.svg)
      if (!safe) throw new Error(label.errorEmpty)

      cleanupActions(el)
      el.setAttribute("data-state", "rendered")
      el.innerHTML = safe
      renderActions(el, pre, source, label)
      wrapper.setAttribute("data-mermaid-state", "rendered")
      pre.hidden = true
    } catch (err) {
      if (signal.aborted || !root.isConnected || !wrapper.isConnected) return
      fail(wrapper, pre, err, label, source)
    }
  }
}
