import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import { useConfig } from "./config"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"
import { applyFontSize, clampFontSize, readFontSize } from "../font-size"

interface DisplayContextValue {
  reasoningAutoCollapse: Accessor<boolean>
  setReasoningAutoCollapse: (collapse: boolean) => void
  fontSize: Accessor<number>
  setFontSize: (size: number) => void
  // Shared response-performance toggle for the latest completed turn.
  // It starts false until the persisted setting arrives, avoiding a flash for
  // users who explicitly disabled it.
  throughputVisible: Accessor<boolean>
}

export const DisplayContext = createContext<DisplayContextValue>()

export const DisplayProvider: ParentComponent = (props) => {
  const { config, updateConfig } = useConfig()
  const vscode = useVSCode()
  const reasoningAutoCollapse = createMemo(() => config().auto_collapse_reasoning ?? false)
  const [fontSize, setFontSizeSignal] = createSignal(readFontSize())
  const [throughputVisible, setThroughputVisible] = createSignal(false)

  // Request the response-performance toggle once on mount; the extension
  // posts back and forwards subsequent configuration edits.
  onMount(() => vscode.postMessage({ type: "requestThroughputSetting" }))

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "ready" && message.fontSize !== undefined) setFontSizeSignal(clampFontSize(message.fontSize))
    if (message.type === "fontSizeChanged") setFontSizeSignal(clampFontSize(message.fontSize))
    if (message.type === "throughputSettingLoaded") setThroughputVisible(Boolean(message.visible))
  })

  createEffect(() => {
    applyFontSize(fontSize())
  })

  onCleanup(unsubscribe)

  return (
    <DisplayContext.Provider
      value={{
        reasoningAutoCollapse,
        setReasoningAutoCollapse: (collapse) => updateConfig({ auto_collapse_reasoning: collapse }),
        fontSize,
        setFontSize: (size) => {
          const next = clampFontSize(size)
          setFontSizeSignal(next)
          vscode.postMessage({ type: "updateSetting", key: "fontSize", value: next })
        },
        throughputVisible,
      }}
    >
      {props.children}
    </DisplayContext.Provider>
  )
}

export function useDisplay(): DisplayContextValue {
  const context = useContext(DisplayContext)
  if (!context) {
    throw new Error("useDisplay must be used within a DisplayProvider")
  }
  return context
}
