import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { render } from "solid-js/web"
import { Button } from "../components/button"
import { Dialog } from "../components/dialog"
import { IconButton } from "../components/icon-button"
import { Spinner } from "../components/spinner"
import { Tooltip } from "../components/tooltip"
import type { PlantUmlLabels } from "./markdown-plantuml"
import { clampMermaidZoom } from "./markdown-mermaid-zoom"

type Size = { width: number; height: number }

type Props = {
  labels: PlantUmlLabels
  url: string
  size: Size
  zoom: number
  onZoom: (value: number) => number
  onFit: () => number
  onSource: () => boolean
  onCopySource: () => Promise<void>
  onDownload: () => void
}

type ErrorProps = {
  labels: PlantUmlLabels
  onRetry: () => void
  onCopySource: () => Promise<void>
  onPrepare: () => Promise<void>
}

function Tool(props: {
  icon: "dash" | "plus" | "reset" | "expand" | "code" | "copy" | "check" | "download"
  label: string
  disabled?: boolean
  pressed?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip value={props.label} placement="top" gutter={4}>
      <IconButton
        icon={props.icon}
        size="small"
        variant="ghost"
        disabled={props.disabled}
        aria-label={props.label}
        aria-pressed={props.pressed}
        onClick={props.onClick}
      />
    </Tooltip>
  )
}

function Viewer(props: {
  labels: PlantUmlLabels
  url: string
  size: Size
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const [zoom, setZoom] = createSignal(1)
  const drag = { active: false, x: 0, y: 0, left: 0, top: 0 }
  let canvas: HTMLDivElement | undefined

  const change = (value: number) => setZoom(clampMermaidZoom(value))
  const fit = () => {
    const width = Math.max((canvas?.clientWidth ?? props.size.width) - 32, 1)
    const height = Math.max((canvas?.clientHeight ?? props.size.height) - 32, 1)
    change(Math.min(1, width / props.size.width, height / props.size.height))
    queueMicrotask(() => {
      if (!canvas) return
      canvas.scrollLeft = Math.max((canvas.scrollWidth - canvas.clientWidth) / 2, 0)
      canvas.scrollTop = Math.max((canvas.scrollHeight - canvas.clientHeight) / 2, 0)
    })
  }
  const start = (event: PointerEvent) => {
    if (!canvas || event.button !== 0) return
    drag.active = true
    drag.x = event.clientX
    drag.y = event.clientY
    drag.left = canvas.scrollLeft
    drag.top = canvas.scrollTop
    canvas.setPointerCapture(event.pointerId)
    canvas.setAttribute("data-dragging", "")
  }
  const move = (event: PointerEvent) => {
    if (!canvas || !drag.active) return
    canvas.scrollLeft = drag.left - (event.clientX - drag.x)
    canvas.scrollTop = drag.top - (event.clientY - drag.y)
  }
  const stop = (event: PointerEvent) => {
    if (!canvas || !drag.active) return
    drag.active = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    canvas.removeAttribute("data-dragging")
  }

  createEffect(() => {
    if (!props.open) return
    requestAnimationFrame(fit)
  })

  onMount(() => {
    if (!canvas || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (props.open) fit()
    })
    observer.observe(canvas)
    onCleanup(() => observer.disconnect())
  })

  return (
    <Kobalte open={props.open} onOpenChange={props.onOpen}>
      <Kobalte.Portal>
        <Kobalte.Overlay data-component="dialog-overlay" />
        <Dialog title={props.labels.viewerTitle} size="x-large" class="markdown-plantuml-viewer" transition>
          <div data-slot="markdown-plantuml-viewer-toolbar" role="toolbar" aria-label={props.labels.viewerControls}>
            <Tool
              icon="dash"
              label={props.labels.zoomOut}
              disabled={zoom() <= 0.25}
              onClick={() => change(zoom() - 0.25)}
            />
            <span data-slot="markdown-plantuml-zoom-value">{Math.round(zoom() * 100)}%</span>
            <Tool
              icon="plus"
              label={props.labels.zoomIn}
              disabled={zoom() >= 6}
              onClick={() => change(zoom() + 0.25)}
            />
            <Tool icon="reset" label={props.labels.fit} onClick={fit} />
          </div>
          <div
            ref={canvas}
            data-slot="markdown-plantuml-viewer-canvas"
            tabindex="0"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
          >
            <div
              data-slot="markdown-plantuml-viewer-surface"
              style={{
                width: `${Math.max(props.size.width * zoom(), 1)}px`,
                height: `${Math.max(props.size.height * zoom(), 1)}px`,
              }}
            >
              <img src={props.url} alt={props.labels.viewerTitle} draggable={false} />
            </div>
          </div>
        </Dialog>
      </Kobalte.Portal>
    </Kobalte>
  )
}

export function PlantUmlActions(props: Props) {
  const [zoom, setZoom] = createSignal(props.zoom)
  const [source, setSource] = createSignal(false)
  const [open, setOpen] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  let trigger: HTMLElement | undefined
  const copy = () => {
    void props.onCopySource().then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const viewer = (value: boolean) => {
    if (value) {
      trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      setOpen(true)
      return
    }
    setOpen(false)
    requestAnimationFrame(() => trigger?.focus())
  }

  return (
    <>
      <div data-slot="markdown-plantuml-actions" role="toolbar" aria-label={props.labels.viewerControls}>
        <div data-slot="markdown-plantuml-zoom-actions">
          <Tool
            icon="dash"
            label={props.labels.zoomOut}
            disabled={zoom() <= 0.25}
            onClick={() => setZoom(props.onZoom(zoom() - 0.25))}
          />
          <span data-slot="markdown-plantuml-zoom-value">{Math.round(zoom() * 100)}%</span>
          <Tool
            icon="plus"
            label={props.labels.zoomIn}
            disabled={zoom() >= 6}
            onClick={() => setZoom(props.onZoom(zoom() + 0.25))}
          />
          <Tool icon="reset" label={props.labels.fit} onClick={() => setZoom(props.onFit())} />
          <Tool icon="expand" label={props.labels.openViewer} onClick={() => viewer(true)} />
        </div>
        <div data-slot="markdown-plantuml-file-actions">
          <Tool
            icon={copied() ? "check" : "copy"}
            label={copied() ? props.labels.copied : props.labels.copySource}
            onClick={copy}
          />
          <Tool icon="download" label={props.labels.downloadPng} onClick={props.onDownload} />
          <Tool
            icon="code"
            label={source() ? props.labels.hideSource : props.labels.showSource}
            pressed={source()}
            onClick={() => setSource(props.onSource())}
          />
        </div>
      </div>
      <Viewer labels={props.labels} url={props.url} size={props.size} open={open()} onOpen={viewer} />
    </>
  )
}

export function PlantUmlErrorActions(props: ErrorProps) {
  const [copied, setCopied] = createSignal(false)
  const copy = () => {
    void props.onCopySource().then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div data-slot="markdown-plantuml-error-actions">
      <Button size="small" variant="secondary" icon="reset" onClick={props.onRetry}>
        {props.labels.retry}
      </Button>
      <Button size="small" variant="secondary" onClick={() => void props.onPrepare()}>
        {props.labels.prepareRepair}
      </Button>
      <Tooltip value={copied() ? props.labels.copied : props.labels.copySource} placement="top" gutter={4}>
        <IconButton
          icon={copied() ? "check" : "copy"}
          size="small"
          variant="ghost"
          aria-label={copied() ? props.labels.copied : props.labels.copySource}
          onClick={copy}
        />
      </Tooltip>
    </div>
  )
}

export function PlantUmlStatus(props: { text: string }) {
  return (
    <div data-slot="markdown-plantuml-status-content">
      <Spinner />
      <span>{props.text}</span>
    </div>
  )
}

export function mountPlantUmlActions(el: HTMLElement, props: Props) {
  const host = document.createElement("div")
  host.setAttribute("data-slot", "markdown-plantuml-actions-root")
  el.insertBefore(host, el.firstChild)
  return render(() => <PlantUmlActions {...props} />, host)
}

export function mountPlantUmlErrorActions(el: HTMLElement, props: ErrorProps) {
  const host = document.createElement("div")
  host.setAttribute("data-slot", "markdown-plantuml-error-actions-root")
  el.appendChild(host)
  return render(() => <PlantUmlErrorActions {...props} />, host)
}

export function mountPlantUmlStatus(el: HTMLElement, text: string) {
  return render(() => <PlantUmlStatus text={text} />, el)
}
