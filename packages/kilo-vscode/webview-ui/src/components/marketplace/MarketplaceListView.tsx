import { createSignal, createMemo, For, Show } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Select } from "@kilocode/kilo-ui/select"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  SkillMarketplaceItem,
  MarketplaceInstalledMetadata,
  MarketplaceUser,
  MarketplaceRelevanceMetadata,
} from "../../types/marketplace"
import { useLanguage } from "../../context/language"
import { filterMarketplaceItems, marketplaceTags } from "./filter"
import { ItemCard } from "./ItemCard"
import { MarketplaceContribute } from "./MarketplaceContribute"

interface StatusOption {
  value: string
  label: string
}

interface Props {
  items: MarketplaceItem[]
  metadata: MarketplaceInstalledMetadata
  fetching: boolean
  type?: "mcp" | "agent" | "skill"
  searchPlaceholder: string
  emptyMessage: string
  relevantEmptyMessage?: string
  relevance?: MarketplaceRelevanceMetadata
  initialRelevant?: boolean
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
  marketplaceUser?: MarketplaceUser
  marketplaceBaseUrl?: string
  marketplaceSkillsOnly?: boolean
  marketplaceMode?: "skills-only" | "full"
  onUploadMarketplaceSkill?: (item: SkillMarketplaceItem) => void
  onStarMarketplaceSkill?: (item: MarketplaceItem) => void
  onOpenSkill?: (item: SkillMarketplaceItem) => void
  showIdentity?: boolean
}

export const MarketplaceListView = (props: Props) => {
  const { t } = useLanguage()
  const [search, setSearch] = createSignal("")
  const [status, setStatus] = createSignal<StatusOption>({ value: "all", label: t("marketplace.filter.all") })
  const [tags, setTags] = createSignal<string[]>([])
  const [relevant, setRelevant] = createSignal(props.initialRelevant ?? false)

  const options = (): StatusOption[] => [
    { value: "all", label: t("marketplace.filter.all") },
    { value: "installed", label: t("marketplace.filter.installed") },
    { value: "notInstalled", label: t("marketplace.filter.notInstalled") },
  ]

  const allTags = createMemo(() => {
    const counts = new Map<string, number>()
    for (const item of props.items) {
      for (const tag of marketplaceTags(item)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    const min = props.type === "mcp" ? 5 : 1
    return Array.from(counts.entries())
      .filter(([, n]) => n >= min)
      .map(([tag]) => tag)
      .sort()
  })

  const toggleTag = (tag: string) => {
    const current = tags()
    if (current.includes(tag)) {
      setTags(current.filter((t) => t !== tag))
    } else {
      setTags([...current, tag])
    }
  }

  const filtered = createMemo(() => {
    const items = filterMarketplaceItems(props.items, props.metadata, search(), status().value, tags())
    if (!relevant()) return items
    return items.filter((item) => !!props.relevance?.[`${item.type}:${item.id}`])
  })

  return (
    <div class="marketplace-list">
      <Show when={props.type === "skill" && props.showIdentity !== false}>
        <div class="marketplace-identity-bar">
          <div class="marketplace-identity-copy">
            <span class="marketplace-identity-label">{t("marketplace.aligned.user")}:</span>
            <span class="marketplace-identity-value">
              {props.marketplaceUser?.name ?? t("marketplace.aligned.unverified")}
            </span>
            <Show when={props.marketplaceBaseUrl}>
              <span class="marketplace-identity-url">{props.marketplaceBaseUrl}</span>
            </Show>
            <span class="marketplace-identity-url">
              {t("marketplace.aligned.mode")}:{" "}
              {props.marketplaceMode === "skills-only" || props.marketplaceSkillsOnly
                ? t("marketplace.aligned.skillsOnlyMode")
                : t("marketplace.aligned.fullMode")}
            </span>
          </div>
        </div>
      </Show>
      <div class="marketplace-filters">
        <div class="marketplace-search-field">
          <TextField
            placeholder={props.searchPlaceholder}
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
        <Select
          options={options()}
          current={status()}
          value={(o: StatusOption) => o.value}
          label={(o: StatusOption) => o.label}
          onSelect={(v: StatusOption | undefined) => v && setStatus(v)}
        />
      </div>
      <Show when={props.relevance}>
        <div class="marketplace-relevance-filter">
          <Checkbox checked={relevant()} onChange={setRelevant}>
            {t("marketplace.filter.relevant")}
          </Checkbox>
        </div>
      </Show>
      <Show when={allTags().length > 0}>
        <div class="marketplace-active-tags">
          <For each={allTags()}>
            {(tag) => (
              <button
                class="marketplace-tag-filter"
                classList={{ active: tags().includes(tag) }}
                onClick={() => toggleTag(tag)}
              >
                <Tag>{tag}</Tag>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show
        when={!props.fetching}
        fallback={
          <div class="marketplace-loading">
            <Spinner />
          </div>
        }
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="marketplace-empty">
              <span class="marketplace-empty-message">
                {relevant() ? (props.relevantEmptyMessage ?? props.emptyMessage) : props.emptyMessage}
              </span>
              <MarketplaceContribute />
            </div>
          }
        >
          <div class="marketplace-grid">
            <For each={filtered()}>
              {(item) => {
                const skill = item.type === "skill" ? (item as SkillMarketplaceItem) : undefined
                const mcp = item.type === "mcp" ? (item as McpMarketplaceItem) : undefined
                return (
                  <ItemCard
                    item={item}
                    metadata={props.metadata}
                    displayName={skill?.displayName}
                    linkUrl={skill?.githubUrl ?? mcp?.url}
                    onInstall={props.onInstall}
                    onRemove={props.onRemove}
                    onStar={props.onStarMarketplaceSkill}
                    onUpload={props.onUploadMarketplaceSkill}
                    onOpen={props.onOpenSkill}
                    footer={<For each={marketplaceTags(item)}>{(tag) => <Tag>{tag}</Tag>}</For>}
                  />
                )
              }}
            </For>
          </div>
          <MarketplaceContribute />
        </Show>
      </Show>
    </div>
  )
}
