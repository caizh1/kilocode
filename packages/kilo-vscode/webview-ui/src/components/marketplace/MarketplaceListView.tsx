import { createSignal, createMemo, For, Show } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Select } from "@kilocode/kilo-ui/select"
import { Tag } from "@kilocode/kilo-ui/tag"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { Button } from "@kilocode/kilo-ui/button"
import type {
  MarketplaceItem,
  McpMarketplaceItem,
  SkillMarketplaceItem,
  MarketplaceInstalledMetadata,
  MarketplaceRelevanceMetadata,
} from "../../types/marketplace"
import { useLanguage } from "../../context/language"
import { filterMarketplaceItems, marketplaceTags } from "./filter"
import { ItemCard } from "./ItemCard"
import { MarketplaceContribute } from "./MarketplaceContribute"
import { selectionKey, selectVisible } from "./batch-selection"

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
  onUploadMarketplaceSkill?: (item: SkillMarketplaceItem) => void
  onStarMarketplaceSkill?: (item: MarketplaceItem) => void
  onOpenSkill?: (item: SkillMarketplaceItem) => void
  batchActive?: boolean
  batchRunning?: boolean
  batchSelected?: string[]
  onBatchStart?: () => void
  onBatchChange?: (ids: string[]) => void
  onBatchCancel?: () => void
  onBatchSubmit?: (ids: string[]) => void
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
  const selectable = createMemo(() =>
    filtered().filter((item): item is SkillMarketplaceItem => item.type === "skill" && Boolean(item.uploadable)),
  )
  const selected = createMemo(() => new Set(props.batchSelected ?? []))
  const change = (item: SkillMarketplaceItem, checked: boolean) => {
    if (props.batchRunning) return
    const ids = props.batchSelected ?? []
    const key = selectionKey(item)
    const next = checked
      ? selectVisible(
          ids,
          selectable().filter((candidate) => selectionKey(candidate) === key),
        )
      : ids.filter((item) => item !== key)
    props.onBatchChange?.(next)
  }

  return (
    <div class="marketplace-list">
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
      <Show when={allTags().length > 0 || props.onBatchStart}>
        <div class="marketplace-tags-row">
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
          <Show when={!props.batchActive && props.onBatchStart}>
            <Button size="small" variant="secondary" onClick={() => props.onBatchStart?.()}>
              <span class="codicon codicon-cloud-upload" aria-hidden="true" />
              {t("marketplace.batch.open")}
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={props.batchActive}>
        <div class="marketplace-batch-toolbar">
          <strong>{t("marketplace.batch.selected", { count: selected().size })}</strong>
          <div class="marketplace-batch-actions">
            <Button
              size="small"
              variant="ghost"
              disabled={props.batchRunning || selectable().length === 0}
              onClick={() => props.onBatchChange?.(selectVisible(props.batchSelected ?? [], selectable()))}
            >
              {t("marketplace.batch.selectVisible")}
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={props.batchRunning || selected().size === 0}
              onClick={() => props.onBatchChange?.([])}
            >
              {t("marketplace.batch.clear")}
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={props.batchRunning}
              onClick={() => props.onBatchCancel?.()}
            >
              {t("marketplace.batch.cancel")}
            </Button>
            <Button
              size="small"
              disabled={props.batchRunning || selected().size === 0}
              onClick={() => props.onBatchSubmit?.(props.batchSelected ?? [])}
            >
              <span class="codicon codicon-cloud-upload" aria-hidden="true" />
              {props.batchRunning
                ? t("marketplace.batch.uploading")
                : t("marketplace.batch.upload", { count: selected().size })}
            </Button>
          </div>
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
                    batchActive={props.batchActive}
                    batchSelected={skill ? selected().has(selectionKey(skill)) : false}
                    batchDisabled={props.batchRunning}
                    onBatchChange={skill?.uploadable ? (checked) => change(skill, checked) : undefined}
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
