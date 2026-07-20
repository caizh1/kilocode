import { createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type {
  InstallationState,
  AnalyticsSeries,
  MarketCapabilities,
  MarketplaceInstalledMetadata,
  MarketplaceUser,
  MarketStatus,
  PublicationRun,
  SkillDetail,
  SkillMarketplaceItem,
} from "../../types/marketplace"
import { MarketplaceListView } from "./MarketplaceListView"

type Section = "home" | "favorites" | "installed" | "publications" | "analytics" | "diagnostics"

interface Props {
  items: SkillMarketplaceItem[]
  metadata: MarketplaceInstalledMetadata
  fetching: boolean
  user?: MarketplaceUser
  baseUrl?: string
  capabilities?: MarketCapabilities
  installations: InstallationState[]
  publications: PublicationRun[]
  status?: MarketStatus
  analytics: AnalyticsSeries[]
  detail?: SkillDetail
  detailId?: string
  detailError?: string
  onOpen(item: SkillMarketplaceItem): void
  onCloseDetail(): void
  onInstall(item: SkillMarketplaceItem): void
  onRemove(item: SkillMarketplaceItem, scope: "project" | "global"): void
  onStar(item: SkillMarketplaceItem): void
  onUpload?(item: SkillMarketplaceItem): void
  onUnpublish(id: string): void
}

const sections: Array<{ id: Section; icon: string; key: Parameters<ReturnType<typeof useLanguage>["t"]>[0] }> = [
  { id: "home", icon: "library", key: "marketplace.aligned.home" },
  { id: "favorites", icon: "star-empty", key: "marketplace.aligned.favorites" },
  { id: "installed", icon: "cloud-download", key: "marketplace.aligned.installed" },
  { id: "publications", icon: "history", key: "marketplace.aligned.publications" },
  { id: "analytics", icon: "graph", key: "marketplace.aligned.analytics" },
  { id: "diagnostics", icon: "server", key: "marketplace.aligned.diagnostics" },
]
const SKILL_SPEC_VERSION = "agent-skills-1"

export const AlignedSkillMarket = (props: Props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const [section, setSection] = createSignal<Section>("home")
  const installed = createMemo(() => {
    const ids = new Set(props.installations.filter((item) => item.status !== "removed").map((item) => item.skillId))
    for (const [id, item] of Object.entries(props.metadata.project)) if (item.type === "skill") ids.add(id)
    for (const [id, item] of Object.entries(props.metadata.global)) if (item.type === "skill") ids.add(id)
    return props.items.filter((item) => ids.has(item.id))
  })
  const favorites = createMemo(() => props.items.filter((item) => item.favorite))
  const detailItem = createMemo(() => props.items.find((item) => item.id === props.detailId))

  const openStatus = () => {
    if (!props.baseUrl) return
    const root = props.baseUrl.replace(/\/marketplace\/?$/i, "")
    vscode.postMessage({ type: "openExternal", url: `${root}/status` })
  }

  const browse = () => {
    if (!props.baseUrl) return
    const root = props.baseUrl.replace(/\/marketplace\/?$/i, "")
    vscode.postMessage({ type: "openExternal", url: `${root}/extensions?source=vscode` })
  }

  const list = (items: SkillMarketplaceItem[], empty: string) => (
    <MarketplaceListView
      items={items}
      metadata={props.metadata}
      fetching={props.fetching}
      type="skill"
      searchPlaceholder={t("marketplace.search")}
      emptyMessage={empty}
      showIdentity={false}
      onInstall={(item) => {
        if (item.type === "skill") props.onInstall(item)
      }}
      onRemove={(item, scope) => {
        if (item.type === "skill") props.onRemove(item, scope)
      }}
      onStarMarketplaceSkill={(item) => {
        if (item.type === "skill") props.onStar(item)
      }}
      onUploadMarketplaceSkill={props.onUpload}
      onOpenSkill={props.onOpen}
    />
  )

  return (
    <div class="aligned-marketplace">
      <div class="aligned-marketplace-header">
        <div class="marketplace-identity-copy">
          <span class="marketplace-identity-label">{t("marketplace.aligned.user")}:</span>
          <strong class="marketplace-identity-value">{props.user?.name ?? t("marketplace.aligned.unverified")}</strong>
          <span class="marketplace-identity-url">{t("marketplace.aligned.protocol")}: aligned-v1</span>
          <Show when={props.capabilities}>
            <span class="marketplace-identity-url">API {props.capabilities!.apiVersion}</span>
          </Show>
        </div>
        <nav class="aligned-marketplace-nav" aria-label={t("marketplace.tab.skills")}>
          <Show when={props.capabilities?.features.extensions && props.baseUrl}>
            <Button size="small" variant="secondary" onClick={browse}>
              <span class="codicon codicon-extensions" aria-hidden="true" />
              在浏览器中打开 VS Code 插件市场
            </Button>
          </Show>
          <For each={sections}>
            {(item) => (
              <Button
                size="small"
                variant={section() === item.id ? "primary" : "ghost"}
                onClick={() => {
                  props.onCloseDetail()
                  setSection(item.id)
                }}
              >
                <span class={`codicon codicon-${item.icon}`} aria-hidden="true" />
                {t(item.key)}
              </Button>
            )}
          </For>
        </nav>
      </div>
      <Show when={props.capabilities?.skillSpecVersion !== SKILL_SPEC_VERSION}>
        <Card variant="info" class="marketplace-legacy-notice">
          {t("marketplace.local.serverRevalidation", {
            local: SKILL_SPEC_VERSION,
            remote: props.capabilities?.skillSpecVersion ?? t("marketplace.local.serverUnknown"),
          })}
        </Card>
      </Show>

      <Show
        when={!props.detailId}
        fallback={
          <SkillDetailView
            item={detailItem()}
            detail={props.detail}
            loading={!props.detail && !props.detailError}
            error={props.detailError}
            back={props.onCloseDetail}
            install={props.onInstall}
            star={props.onStar}
          />
        }
      >
        <Show when={section() === "home"}>{list(props.items, t("marketplace.empty"))}</Show>
        <Show when={section() === "favorites"}>
          <Show when={props.user} fallback={<Empty text={t("marketplace.aligned.signInHint")} />}>
            {list(favorites(), t("marketplace.aligned.noFavorites"))}
          </Show>
        </Show>
        <Show when={section() === "installed"}>
          <Show when={props.user} fallback={<Empty text={t("marketplace.aligned.signInHint")} />}>
            {list(installed(), t("marketplace.aligned.noInstalled"))}
          </Show>
        </Show>
        <Show when={section() === "publications"}>
          <Show when={props.user} fallback={<Empty text={t("marketplace.aligned.signInHint")} />}>
            <PublicationList
              items={props.publications}
              empty={t("marketplace.aligned.noPublications")}
              unpublish={props.onUnpublish}
            />
          </Show>
        </Show>
        <Show when={section() === "analytics"}>
          <Show when={props.user} fallback={<Empty text={t("marketplace.aligned.signInHint")} />}>
            <Show
              when={props.capabilities?.features.analytics}
              fallback={<Empty text={t("marketplace.aligned.analysisUnavailable")} />}
            >
              <AnalyticsView items={props.analytics} />
            </Show>
          </Show>
        </Show>
        <Show when={section() === "diagnostics"}>
          <Diagnostics status={props.status} capabilities={props.capabilities} open={openStatus} />
        </Show>
      </Show>
    </div>
  )
}

function SkillDetailView(props: {
  item?: SkillMarketplaceItem
  detail?: SkillDetail
  loading: boolean
  error?: string
  back(): void
  install(item: SkillMarketplaceItem): void
  star(item: SkillMarketplaceItem): void
}) {
  const { t } = useLanguage()
  return (
    <div class="aligned-skill-detail">
      <Button size="small" variant="ghost" onClick={props.back}>
        <Icon name="arrow-left" size="small" />
        {t("marketplace.aligned.back")}
      </Button>
      <Show when={props.loading}>
        <div class="marketplace-loading">
          <Spinner />
        </div>
      </Show>
      <Show when={props.error}>
        <Card variant="error">{props.error}</Card>
      </Show>
      <Show when={props.detail}>
        {(detail) => (
          <>
            <Card class="aligned-skill-hero">
              <div>
                <h2>{detail().name}</h2>
                <p>{detail().description}</p>
              </div>
              <div class="aligned-skill-tags">
                <For each={detail().tags}>{(tag) => <Tag>{tag}</Tag>}</For>
                <SkillRiskBadge risk={detail().risk} />
              </div>
              <div class="aligned-skill-meta">
                <span>{detail().author.displayName}</span>
                <span>{t("marketplace.aligned.revision", { revision: detail().latestRevision })}</span>
                <span>SHA {detail().sha256.slice(0, 12)}…</span>
              </div>
              <Show when={props.item}>
                <div class="aligned-skill-actions">
                  <Button size="small" onClick={() => props.install(props.item!)}>
                    {t("marketplace.card.install")}
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => props.star(props.item!)}>
                    {props.item!.favorite ? t("marketplace.aligned.unfavorite") : t("marketplace.aligned.favorite")}
                  </Button>
                </div>
              </Show>
            </Card>
            <SkillRiskPanel detail={detail()} />
            <div class="aligned-skill-columns">
              <Card class="aligned-skill-prose">
                <h3>{t("marketplace.aligned.instructions")}</h3>
                <Markdown text={detail().markdown} />
              </Card>
              <div class="aligned-skill-side">
                <Card>
                  <h3>{t("marketplace.aligned.releases")}</h3>
                  <div class="aligned-release-list">
                    <For each={detail().releases}>
                      {(release) => (
                        <div>
                          <strong>
                            r{release.revision}
                            {release.semver ? ` · ${release.semver}` : ""}
                          </strong>
                          <span>{formatDate(release.publishedAt)}</span>
                          <code>{release.sha256.slice(0, 12)}…</code>
                        </div>
                      )}
                    </For>
                  </div>
                </Card>
                <Card>
                  <h3>{t("marketplace.aligned.files")}</h3>
                  <div class="aligned-file-list">
                    <For each={detail().files}>
                      {(file) => (
                        <div>
                          <span>{file.path}</span>
                          <small>
                            {file.type} · {formatBytes(file.size)}
                          </small>
                        </div>
                      )}
                    </For>
                  </div>
                </Card>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}

function PublicationList(props: { items: PublicationRun[]; empty: string; unpublish(id: string): void }) {
  const { t } = useLanguage()
  const latest = createMemo(() => {
    const result = new Map<string, string>()
    for (const run of [...props.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (run.skillId && !result.has(run.skillId)) result.set(run.skillId, run.id)
    }
    return result
  })
  const active = (run: PublicationRun) =>
    Boolean(
      run.skillId && latest().get(run.skillId) === run.id && (run.status === "PUBLISHED" || run.status === "UNCHANGED"),
    )
  return (
    <Show when={props.items.length > 0} fallback={<Empty text={props.empty} />}>
      <div class="aligned-publication-list">
        <For each={props.items}>
          {(run) => (
            <Card>
              <div class="aligned-publication-heading">
                <strong>{run.skillId ?? run.id}</strong>
                <Tag>{run.status === "UNPUBLISHED" ? t("marketplace.aligned.unpublished") : run.status}</Tag>
              </div>
              <p>{run.release ? `r${run.release.revision} · ${run.release.sha256.slice(0, 12)}…` : run.stage}</p>
              <small>{formatDate(run.updatedAt)}</small>
              <Show when={active(run)}>
                <div class="aligned-publication-actions">
                  <Button size="small" variant="ghost" onClick={() => props.unpublish(run.skillId!)}>
                    <span class="codicon codicon-archive" aria-hidden="true" />
                    {t("marketplace.aligned.unpublish")}
                  </Button>
                </div>
              </Show>
              <For each={run.report?.issues ?? []}>
                {(issue) => <p class="aligned-publication-issue">{issue.message}</p>}
              </For>
            </Card>
          )}
        </For>
      </div>
    </Show>
  )
}

function SkillRiskBadge(props: { risk: SkillDetail["risk"] }) {
  const { t } = useLanguage()
  const label = () => {
    if (props.risk.level === "none") return t("marketplace.risk.none")
    if (props.risk.level === "medium") return t("marketplace.risk.medium", { count: props.risk.issueCount })
    if (props.risk.level === "critical") return t("marketplace.risk.critical")
    return t("marketplace.risk.unknown")
  }
  return (
    <Tag class={`marketplace-risk-badge risk-${props.risk.level}`}>
      <span
        class={`codicon codicon-${props.risk.level === "none" ? "pass-filled" : props.risk.level === "unknown" ? "question" : "warning"}`}
        aria-hidden="true"
      />
      {label()}
    </Tag>
  )
}

function SkillRiskPanel(props: { detail: SkillDetail }) {
  const { t } = useLanguage()
  const release = () => props.detail.releases.find((item) => item.revision === props.detail.latestRevision)
  const issues = () => (release()?.report.issues ?? []).filter((item) => item.riskLevel !== "none")
  return (
    <Card class={`aligned-risk-panel risk-${props.detail.risk.level}`}>
      <div class="aligned-risk-heading">
        <span
          class={`codicon codicon-${props.detail.risk.level === "none" ? "pass-filled" : props.detail.risk.level === "unknown" ? "question" : "warning"}`}
          aria-hidden="true"
        />
        <strong>
          {props.detail.risk.level === "none"
            ? t("marketplace.risk.detailNone")
            : props.detail.risk.level === "unknown"
              ? t("marketplace.risk.unknownTitle")
              : t("marketplace.risk.detailMedium", { count: props.detail.risk.issueCount })}
        </strong>
      </div>
      <p>
        {props.detail.risk.level === "none"
          ? t("marketplace.risk.noGuarantee")
          : props.detail.risk.level === "unknown"
            ? t("marketplace.risk.installUnknown")
            : t("marketplace.risk.detailHint")}
      </p>
      <For each={issues()}>
        {(issue) => (
          <div class="aligned-risk-issue">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>
              <strong>{issue.message}</strong>
              <small>{issue.file ?? issue.field ?? t("marketplace.risk.archive")}</small>
            </span>
          </div>
        )}
      </For>
    </Card>
  )
}

function Diagnostics(props: { status?: MarketStatus; capabilities?: MarketCapabilities; open(): void }) {
  const { t } = useLanguage()
  return (
    <div class="aligned-diagnostics">
      <Card>
        <div class="aligned-diagnostic-heading">
          <Icon name="server" />
          <strong>{t("marketplace.aligned.serviceStatus")}</strong>
          <Tag>{props.status?.ok ? "READY" : "DEGRADED"}</Tag>
        </div>
        <Show when={props.status} fallback={<p>{t("marketplace.aligned.legacy")}</p>}>
          <div class="aligned-status-grid">
            <span>Render</span>
            <strong>{props.status!.render}</strong>
            <span>Market</span>
            <strong>{props.status!.market}</strong>
            <span>Packages</span>
            <strong>{props.status!.packages}</strong>
            <span>Transport</span>
            <strong>{props.status!.transport}</strong>
          </div>
          <For each={props.status!.warnings}>{(warning) => <p class="aligned-diagnostic-warning">{warning}</p>}</For>
        </Show>
        <Button size="small" variant="ghost" onClick={props.open}>
          {t("marketplace.aligned.openWebStatus")}
        </Button>
      </Card>
      <Card>
        <strong>{t("marketplace.aligned.capabilities")}</strong>
        <div class="aligned-capability-list">
          <For each={Object.entries(props.capabilities?.features ?? {})}>
            {([name, enabled]) => (
              <span>
                <Icon name={enabled ? "check" : "close"} size="small" />
                {name}
              </span>
            )}
          </For>
        </div>
      </Card>
    </div>
  )
}

function AnalyticsView(props: { items: AnalyticsSeries[] }) {
  const { t } = useLanguage()
  return (
    <Show when={props.items.length > 0} fallback={<Empty text={t("marketplace.aligned.noAnalytics")} />}>
      <div class="aligned-analytics-list">
        <For each={props.items}>
          {(series) => (
            <Card>
              <div class="aligned-analytics-heading">
                <strong>{series.metric}</strong>
                <Tag>
                  {t("marketplace.aligned.total", {
                    count: series.points.reduce((sum, point) => sum + point.value, 0),
                  })}
                </Tag>
              </div>
              <div class="aligned-analytics-points">
                <For each={series.points}>
                  {(point) => (
                    <div>
                      <span>{point.date}</span>
                      <strong>{point.value}</strong>
                    </div>
                  )}
                </For>
              </div>
            </Card>
          )}
        </For>
      </div>
    </Show>
  )
}

function Empty(props: { text: string }) {
  return (
    <Card class="aligned-marketplace-state">
      <p>{props.text}</p>
    </Card>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}
