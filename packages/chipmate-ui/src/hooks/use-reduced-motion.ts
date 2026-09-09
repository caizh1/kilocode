import { isHydrated } from "@solid-primitives/lifecycle"
import { createMediaQuery } from "@solid-primitives/media"
import { createHydratableSingletonRoot } from "@solid-primitives/rootless"
import { createSignal, onCleanup } from "solid-js"

const query = "(prefers-reduced-motion: reduce)"

export function resolveReducedMotion(systemReduced: boolean, vscodeReduced: boolean | undefined) {
  return vscodeReduced ?? systemReduced
}

function readVSCodeReducedMotion() {
  if (typeof document === "undefined") return undefined
  const body = document.body
  if (!body?.hasAttribute("data-vscode-theme-id")) return undefined
  return body.classList.contains("vscode-reduce-motion")
}

export const useReducedMotion = createHydratableSingletonRoot(() => {
  const system = createMediaQuery(query)
  const [vscode, setVSCode] = createSignal(readVSCodeReducedMotion())

  if (typeof document !== "undefined" && typeof MutationObserver !== "undefined" && document.body) {
    const observer = new MutationObserver(() => setVSCode(readVSCodeReducedMotion()))
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-vscode-theme-id"],
    })
    onCleanup(() => observer.disconnect())
  }

  return () => !isHydrated() || resolveReducedMotion(system(), vscode())
})
