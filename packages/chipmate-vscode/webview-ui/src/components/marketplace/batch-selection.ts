import type { SkillMarketplaceItem } from "../../types/marketplace"

export function uploadable(items: readonly SkillMarketplaceItem[]): SkillMarketplaceItem[] {
  return items.filter((item) => Boolean(item.uploadable))
}

export function selectionKey(item: SkillMarketplaceItem): string {
  return item.instanceId ?? item.id
}

export function reconcileSelection(ids: readonly string[], items: readonly SkillMarketplaceItem[]): string[] {
  const available = new Set(uploadable(items).map(selectionKey))
  return ids.filter((id) => available.has(id))
}

export function selectVisible(ids: readonly string[], items: readonly SkillMarketplaceItem[]): string[] {
  const selected = new Set(ids)
  for (const item of uploadable(items)) selected.add(selectionKey(item))
  return Array.from(selected)
}
