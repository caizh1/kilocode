import { Show, JSX, createSignal, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tag } from "@kilocode/kilo-ui/tag"
import type {
  MarketplaceItem,
  MarketplaceInstalledMetadata,
  SkillMarketplaceItem,
  SkillRiskSummary,
} from "../../types/marketplace"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { installedScopes } from "./utils"

interface Props {
  item: MarketplaceItem
  metadata: MarketplaceInstalledMetadata
  displayName?: string
  linkUrl?: string
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
  onStar?: (item: MarketplaceItem) => void
  onUpload?: (item: SkillMarketplaceItem) => void
  batchActive?: boolean
  batchSelected?: boolean
  batchDisabled?: boolean
  onBatchChange?: (selected: boolean) => void
  onOpen?: (item: SkillMarketplaceItem) => void
  footer?: JSX.Element
}

export const ItemCard = (props: Props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const scopes = () => cardScopes(props.item, props.metadata)
  const installed = () => scopes().length > 0
  const name = () => props.displayName ?? props.item.name
  const skill = () => (props.item.type === "skill" ? (props.item as SkillMarketplaceItem) : undefined)
  const upload = () => !props.batchActive && Boolean(skill()?.uploadable && props.onUpload)
  const local = () =>
    Boolean(
      skill()?.origin === "local" ||
        skill()?.origin === "local-import" ||
        (skill()?.localOnly && skill()?.origin !== "builtin" && skill()?.origin !== "market"),
    )
  const origin = () => {
    if (skill()?.origin === "local-import") return t("marketplace.local.badge.imported")
    if (skill()?.origin === "market") return t("marketplace.local.badge.managed")
    if (skill()?.origin === "builtin") return t("marketplace.local.badge.builtin")
    return undefined
  }
  const published = () => {
    const state = skill()?.publishState
    if (!state) return undefined
    return t(`marketplace.local.publish.${state}`)
  }
  const overridden = () => (skill()?.localState === "modified" ? t("marketplace.local.badge.override") : undefined)
  const [expanded, setExpanded] = createSignal(false)
  const [clamped, setClamped] = createSignal(false)
  let ref: HTMLParagraphElement | undefined

  onMount(() => {
    if (ref && ref.scrollHeight > ref.clientHeight) setClamped(true)
  })

  const openLink = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  return (
    <Card class="marketplace-card" data-selected={props.batchSelected || undefined}>
      <div class="marketplace-card-header">
        <div class="marketplace-card-title">
          <BatchCheckbox
            active={props.batchActive}
            uploadable={skill()?.uploadable}
            selected={props.batchSelected}
            disabled={props.batchDisabled}
            name={name()}
            change={props.onBatchChange}
          />
          <Show when={props.linkUrl} fallback={<span class="marketplace-card-name">{name()}</span>}>
            <span class="marketplace-card-name clickable" onClick={() => openLink(props.linkUrl!)}>
              {name()}
            </span>
          </Show>
        </div>
        <Show when={props.item.author}>
          <span class="marketplace-card-author">
            <Show when={props.item.authorUrl} fallback={t("marketplace.card.by", { author: props.item.author! })}>
              <span class="link" onClick={() => openLink(props.item.authorUrl!)}>
                {t("marketplace.card.by", { author: props.item.author! })}
              </span>
            </Show>
          </span>
        </Show>
      </div>
      <p ref={ref} class="marketplace-card-description" classList={{ expanded: expanded() }}>
        {props.item.description}
      </p>
      <Show when={skill()}>
        {(item) => (
          <div class="marketplace-skill-meta">
            <Show when={item().uploadedBy}>
              <span>{t("marketplace.card.by", { author: item().uploadedBy! })}</span>
            </Show>
            <span>{t("marketplace.aligned.downloads", { count: item().downloadCount ?? 0 })}</span>
            <span class="marketplace-skill-stat">
              <Icon name="star" size="small" />
              {item().stars ?? 0}
            </span>
          </div>
        )}
      </Show>
      <Show when={clamped()}>
        <button class="marketplace-card-expand" onClick={() => setExpanded(!expanded())}>
          {expanded() ? t("marketplace.card.showLess") : t("marketplace.card.showMore")}
        </button>
      </Show>
      <div class="marketplace-card-footer">
        <div class="marketplace-card-tags">
          <Show when={installed()}>
            <Tag class="marketplace-badge-installed">{t("marketplace.card.installed")}</Tag>
          </Show>
          <SkillInstanceBadges item={skill()} />
          <Show when={local()}>
            <Tag>{t("marketplace.aligned.localSkill")}</Tag>
          </Show>
          <Show when={origin()}>{(label) => <Tag>{label()}</Tag>}</Show>
          <Show when={overridden()}>{(label) => <Tag>{label()}</Tag>}</Show>
          <Show when={published()}>{(label) => <Tag>{label()}</Tag>}</Show>
          <Show when={skill() && !local()}>
            <MarketplaceRiskBadge risk={skill()?.risk} />
          </Show>
          {props.footer}
        </div>
        <div class="marketplace-card-actions">
          <Show when={skill() && !local() && props.onOpen}>
            <Button size="small" variant="ghost" onClick={() => props.onOpen?.(skill()!)}>
              {t("marketplace.aligned.details")}
            </Button>
          </Show>
          <Show when={upload()}>
            <IconButton
              icon="cloud-upload"
              size="small"
              variant="ghost"
              aria-label={t("marketplace.aligned.upload")}
              title={t("marketplace.aligned.upload")}
              onClick={() => props.onUpload?.(skill()!)}
            />
          </Show>
          <Show when={localRemoval(local(), skill())}>
            <IconButton
              icon="trash"
              size="small"
              variant="ghost"
              aria-label={t("marketplace.card.remove")}
              title={t("marketplace.card.remove")}
              onClick={() => props.onRemove(props.item, skill()!.localScope!)}
            />
          </Show>
          <Show when={props.item.type === "skill" && !local() && props.onStar}>
            <IconButton
              icon="star"
              size="small"
              variant="ghost"
              aria-label={skill()?.favorite ? t("marketplace.aligned.unfavorite") : t("marketplace.aligned.favorite")}
              title={skill()?.favorite ? t("marketplace.aligned.unfavorite") : t("marketplace.aligned.favorite")}
              class={skill()?.favorite ? "marketplace-favorite-active" : undefined}
              onClick={() => props.onStar?.(props.item)}
            />
          </Show>
          <Show when={!local()}>
            <Show
              when={installed()}
              fallback={
                <Button size="small" onClick={() => props.onInstall(props.item)}>
                  {t("marketplace.card.install")}
                </Button>
              }
            >
              {scopes().map((scope) => (
                <Show when={props.item.type !== "skill" || skill()?.origin === "market"}>
                  <Show
                    when={props.item.type === "skill"}
                    fallback={
                      <Button size="small" variant="ghost" onClick={() => props.onRemove(props.item, scope)}>
                        {scopes().length > 1
                          ? t("marketplace.card.removeScope", { scope: t(`marketplace.scope.${scope}`) })
                          : t("marketplace.card.remove")}
                      </Button>
                    }
                  >
                    <IconButton
                      icon="trash"
                      size="small"
                      variant="ghost"
                      aria-label={
                        scopes().length > 1
                          ? t("marketplace.card.removeScope", { scope: t(`marketplace.scope.${scope}`) })
                          : t("marketplace.card.remove")
                      }
                      title={
                        scopes().length > 1
                          ? t("marketplace.card.removeScope", { scope: t(`marketplace.scope.${scope}`) })
                          : t("marketplace.card.remove")
                      }
                      onClick={() => props.onRemove(props.item, scope)}
                    />
                  </Show>
                </Show>
              ))}
            </Show>
          </Show>
        </div>
      </div>
    </Card>
  )
}

function cardScopes(item: MarketplaceItem, metadata: MarketplaceInstalledMetadata): Array<"project" | "global"> {
  if (item.type === "skill" && item.instanceId && item.localScope) return [item.localScope]
  return installedScopes(item.id, item.type, metadata)
}

function localRemoval(local: boolean, item?: SkillMarketplaceItem): boolean {
  return Boolean(local && item?.localScope && (item.removeToken || item.instanceId))
}

function SkillInstanceBadges(props: { item?: SkillMarketplaceItem }) {
  const { t } = useLanguage()
  return (
    <Show when={props.item?.instanceId && props.item.localScope}>
      <Tag class="marketplace-scope-badge">{t(`marketplace.scope.${props.item!.localScope!}`)}</Tag>
      <Show when={props.item?.effective === true}>
        <Tag class="marketplace-effective-badge">{t("marketplace.skill.effective")}</Tag>
      </Show>
      <Show when={props.item?.effective === false}>
        <Tag class="marketplace-shadowed-badge">{t("marketplace.skill.shadowedByProject")}</Tag>
      </Show>
    </Show>
  )
}

function BatchCheckbox(props: {
  active?: boolean
  uploadable?: boolean
  selected?: boolean
  disabled?: boolean
  name: string
  change?: (selected: boolean) => void
}) {
  const { t } = useLanguage()
  return (
    <Show when={props.active && props.uploadable && props.change}>
      <Checkbox
        checked={props.selected}
        disabled={props.disabled}
        onChange={(selected) => props.change?.(selected)}
        hideLabel
      >
        {t("marketplace.batch.select", { name: props.name })}
      </Checkbox>
    </Show>
  )
}

function MarketplaceRiskBadge(props: { risk?: SkillRiskSummary }) {
  const { t } = useLanguage()
  const risk = () => props.risk ?? { level: "unknown" as const, issueCount: 0 }
  const label = () => {
    if (risk().level === "none") return t("marketplace.risk.none")
    if (risk().level === "medium") return t("marketplace.risk.medium", { count: risk().issueCount })
    if (risk().level === "critical") return t("marketplace.risk.critical")
    return t("marketplace.risk.unknown")
  }
  return (
    <Tag class={`marketplace-risk-badge risk-${risk().level}`}>
      <span
        class={`codicon codicon-${risk().level === "none" ? "pass-filled" : risk().level === "unknown" ? "question" : "warning"}`}
        aria-hidden="true"
      />
      {label()}
    </Tag>
  )
}
