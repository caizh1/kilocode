import { createSignal, onCleanup } from "solid-js"

/** 只观察已生效外观；预览和宿主主题不参与皮肤选择。 */
export function useFutureSkin() {
  const read = () => document.documentElement.dataset.chipmateSkin === "night-city"
  const [enabled, setEnabled] = createSignal(read())
  const changed = () => setEnabled(read())
  window.addEventListener("chipmate:appearance-changed", changed)
  onCleanup(() => window.removeEventListener("chipmate:appearance-changed", changed))
  return enabled
}
