import type { MarketplaceInstalledMetadata, MarketplaceItem, SkillMarketplaceItem } from "../../types/marketplace"
import { isInstalled } from "./utils"

export function marketplaceTags(item: MarketplaceItem): string[] {
  const tags =
    item.type === "skill" ? [(item as SkillMarketplaceItem).displayCategory, ...(item.tags ?? [])] : (item.tags ?? [])
  return Array.from(new Set(tags.filter(Boolean)))
}

export function filterMarketplaceItems(
  items: MarketplaceItem[],
  metadata: MarketplaceInstalledMetadata,
  search: string,
  status: string,
  tags: string[],
): MarketplaceItem[] {
  const query = search.trim().toLowerCase()
  return items.filter((item) => {
    const installed = Boolean(isInstalled(item.id, item.type, metadata))
    if (status === "installed" && !installed) return false
    if (status === "notInstalled" && installed) return false

    const itemTags = marketplaceTags(item)
    if (tags.length > 0 && !tags.some((tag) => itemTags.includes(tag))) return false
    if (!query) return true

    const skill = item.type === "skill" ? (item as SkillMarketplaceItem) : undefined
    const values = [
      item.id,
      item.name,
      item.description,
      item.author,
      ...itemTags,
      skill?.displayName,
      skill?.category,
      skill?.displayCategory,
      skill?.uploadedBy,
    ]
    return values.some((value) => value?.toLowerCase().includes(query))
  })
}
