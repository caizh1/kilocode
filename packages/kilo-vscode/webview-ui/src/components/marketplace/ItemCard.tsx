import { Show, JSX, createSignal, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tag } from "@kilocode/kilo-ui/tag"
import type { MarketplaceItem, MarketplaceInstalledMetadata, SkillMarketplaceItem } from "../../types/marketplace"
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
  footer?: JSX.Element
}

export const ItemCard = (props: Props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const scopes = () => installedScopes(props.item.id, props.item.type, props.metadata)
  const installed = () => scopes().length > 0
  const name = () => props.displayName ?? props.item.name
  const skill = () => (props.item.type === "skill" ? (props.item as SkillMarketplaceItem) : undefined)
  const local = () => Boolean(skill()?.localOnly)
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
    <Card class="marketplace-card">
      <div class="marketplace-card-header">
        <div class="marketplace-card-title">
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
              <span>by {item().uploadedBy}</span>
            </Show>
            <span>下载 {item().downloadCount ?? 0}</span>
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
          <Show when={local()}>
            <Tag>本地 Skill</Tag>
          </Show>
          {props.footer}
        </div>
        <div class="marketplace-card-actions">
          <Show when={skill()?.localOnly && skill()?.uploadable && props.onUpload}>
            <IconButton
              icon="cloud-upload"
              size="small"
              variant="ghost"
              aria-label="上传此 Skill 到市场"
              title="上传此 Skill 到市场"
              onClick={() => props.onUpload?.(skill()!)}
            />
          </Show>
          <Show when={props.item.type === "skill" && !local() && props.onStar}>
            <IconButton
              icon="star"
              size="small"
              variant="ghost"
              aria-label="为 Skill 点赞"
              title="为 Skill 点赞"
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
              ))}
            </Show>
          </Show>
        </div>
      </div>
    </Card>
  )
}
