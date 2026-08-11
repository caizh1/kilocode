/** @jsxImportSource solid-js */
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { useReducedMotion } from "../hooks/use-reduced-motion"
import { Spinner as SystemSpinner } from "./spinner"
import { next, type SpinnerVariant } from "./spinner-sequence"

export type { SpinnerVariant } from "./spinner-sequence"
export { cycle } from "./spinner-sequence"

export type SpinnerProps = Omit<ComponentProps<"span">, "children"> & {
  variant?: SpinnerVariant
  assetBase?: string
  scope?: string
  width?: string | number
  height?: string | number
}

type Theme = "dark" | "light" | "contrast"
type MotionProps = {
  root: string
  variant: SpinnerVariant
  ready: () => void
  fail: () => void
}

const capsules = [0, 1, 2, 3, 4] as const
const prism = ["a", "b", "c", "flare"] as const

function current(): Theme {
  if (typeof document === "undefined") return "dark"
  const body = document.body.classList
  if (body.contains("vscode-high-contrast") || body.contains("vscode-high-contrast-light")) return "contrast"
  if (body.contains("vscode-light") || body.contains("vscode-high-contrast-light")) return "light"
  return "dark"
}

function useTheme() {
  const [theme, setTheme] = createSignal<Theme>(current())

  onMount(() => {
    const media = window.matchMedia("(forced-colors: active)")
    const update = () => setTheme(media.matches ? "contrast" : current())
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })
    media.addEventListener("change", update)
    update()

    onCleanup(() => {
      observer.disconnect()
      media.removeEventListener("change", update)
    })
  })

  return theme
}

function unit(value: string | number | undefined) {
  if (typeof value === "number") return `${value}px`
  return value
}

function sized(
  style: JSX.CSSProperties | string | undefined,
  width: string | number | undefined,
  height: string | number | undefined,
) {
  const x = unit(width)
  const y = unit(height)
  if (typeof style === "string") {
    return [`width:${x ?? "1em"}`, `height:${y ?? x ?? "1em"}`, style].filter(Boolean).join(";")
  }
  return {
    width: x ?? "1em",
    height: y ?? x ?? "1em",
    ...style,
  }
}

function globalBase() {
  if (typeof window === "undefined") return
  return (window as typeof window & { CHIPMATE_LOADING_MOTION_URI?: string }).CHIPMATE_LOADING_MOTION_URI
}

function Motion(props: MotionProps) {
  const total = props.variant === "signal" ? 6 : prism.length
  const [count, setCount] = createSignal(0)
  const load = () => {
    setCount((value) => {
      const next = value + 1
      if (next === total) props.ready()
      return next
    })
  }

  if (props.variant === "liquid" || props.variant === "orbital") {
    return (
      <img
        data-motion={props.variant}
        src={`${props.root}.webp`}
        alt=""
        draggable={false}
        onLoad={props.ready}
        onError={props.fail}
      />
    )
  }

  if (props.variant === "signal") {
    return (
      <span data-motion="signal">
        <For each={capsules}>
          {(index) => (
            <img
              data-layer="capsule"
              data-index={index}
              src={`${props.root}-capsule.png`}
              alt=""
              draggable={false}
              onLoad={load}
              onError={props.fail}
            />
          )}
        </For>
        <img
          data-layer="glint"
          src={`${props.root}-glint.png`}
          alt=""
          draggable={false}
          onLoad={load}
          onError={props.fail}
        />
      </span>
    )
  }

  return (
    <span data-motion="prism">
      <For each={prism}>
        {(layer) => (
          <img
            data-layer={layer}
            src={`${props.root}-${layer}.png`}
            alt=""
            draggable={false}
            onLoad={load}
            onError={props.fail}
          />
        )}
      </For>
    </span>
  )
}

export function Spinner(props: SpinnerProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "assetBase",
    "scope",
    "class",
    "classList",
    "style",
    "width",
    "height",
  ])
  const reduced = useReducedMotion()
  const theme = useTheme()
  const variant = local.variant ?? next(local.scope)
  const base = local.assetBase ?? globalBase()
  const [ready, setReady] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [stillFailed, setStillFailed] = createSignal(false)
  const path = () => (base && theme() !== "contrast" ? `${base}/${theme()}/${variant}` : undefined)
  const asset = () => {
    const root = path()
    if (!root || stillFailed()) return
    return root
  }

  createEffect(() => {
    path()
    setReady(false)
    setFailed(false)
    setStillFailed(false)
  })

  return (
    <span
      {...rest}
      data-component="spinner"
      data-spinner-variant={theme() === "contrast" ? "system" : reduced() ? "reduced" : variant}
      aria-hidden="true"
      class={local.class}
      classList={local.classList}
      style={sized(local.style, local.width, local.height)}
    >
      <Show
        when={asset()}
        fallback={<SystemSpinner data-slot="spinner-system" />}
        keyed
      >
        {(root) => (
          <>
            <img
              data-slot="spinner-still"
              classList={{ "is-covered": ready() }}
              src={`${root}.png`}
              alt=""
              draggable={false}
              onError={() => setStillFailed(true)}
            />
            <Show when={!reduced() && !failed()}>
              <span data-slot="spinner-motion" classList={{ "is-ready": ready() }}>
                <Motion
                  root={root}
                  variant={variant}
                  ready={() => setReady(true)}
                  fail={() => {
                    setReady(false)
                    setFailed(true)
                  }}
                />
              </span>
            </Show>
          </>
        )}
      </Show>
    </span>
  )
}
