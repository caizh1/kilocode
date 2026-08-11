export type ChipMateEmbeddingModel = {
  id: string
  name: string
  dimension: number
  scoreThreshold: number
  note?: string
}

export type ChipMateEmbeddingModelCatalog = {
  defaultModel: string
  models: ChipMateEmbeddingModel[]
  aliases: Record<string, string>
}

export const EMPTY_CHIPMATE_EMBEDDING_MODEL_CATALOG: ChipMateEmbeddingModelCatalog = {
  defaultModel: "",
  models: [],
  aliases: {},
}

export function normalizeChipMateEmbeddingModelId(model: string | undefined, catalog = EMPTY_CHIPMATE_EMBEDDING_MODEL_CATALOG) {
  if (!model) return undefined
  return catalog.aliases[model] ?? model
}

export function getChipMateEmbeddingModel(model: string | undefined, catalog = EMPTY_CHIPMATE_EMBEDDING_MODEL_CATALOG) {
  const id = normalizeChipMateEmbeddingModelId(model, catalog)
  return catalog.models.find((item) => item.id === id)
}

export function formatChipMateEmbeddingModelLabel(model: ChipMateEmbeddingModel): string {
  const note = model.note ? `${model.note}, ` : ""
  return `${model.name} (${note}${model.dimension}d)`
}
