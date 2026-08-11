import { createContext, createSignal, onCleanup, useContext, type Accessor, type ParentComponent } from "solid-js"
import {
  EMPTY_CHIPMATE_EMBEDDING_MODEL_CATALOG,
  type ChipMateEmbeddingModelCatalog,
} from "@chipmate/chipmate-indexing/embedding-models"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"

type ChipMateEmbeddingModelsContextValue = {
  catalog: Accessor<ChipMateEmbeddingModelCatalog>
}

export const ChipMateEmbeddingModelsContext = createContext<ChipMateEmbeddingModelsContextValue>()

export const ChipMateEmbeddingModelsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [catalog, setCatalog] = createSignal<ChipMateEmbeddingModelCatalog>(EMPTY_CHIPMATE_EMBEDDING_MODEL_CATALOG)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "chipmateEmbeddingModelsLoaded") return
    setCatalog(message.catalog)
  })

  vscode.postMessage({ type: "requestChipMateEmbeddingModels" })

  onCleanup(unsubscribe)

  return <ChipMateEmbeddingModelsContext.Provider value={{ catalog }}>{props.children}</ChipMateEmbeddingModelsContext.Provider>
}

export function useChipMateEmbeddingModels(): ChipMateEmbeddingModelsContextValue {
  const context = useContext(ChipMateEmbeddingModelsContext)
  if (!context) {
    throw new Error("useChipMateEmbeddingModels must be used within a ChipMateEmbeddingModelsProvider")
  }
  return context
}
