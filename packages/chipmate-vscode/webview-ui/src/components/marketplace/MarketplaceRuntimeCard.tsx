import { createSignal, Show, type JSX } from "solid-js"
import { Button } from "@chipmate/chipmate-ui/button"
import { Card } from "@chipmate/chipmate-ui/card"
import { Tag } from "@chipmate/chipmate-ui/tag"
import { Tooltip } from "@chipmate/chipmate-ui/tooltip"
import { useLanguage } from "../../context/language"
import type {
  MarketplaceIdentityState,
  MarketplaceIssue,
  MarketplaceServerState,
} from "../../types/marketplace"

interface Props {
  server: MarketplaceServerState
  identity: MarketplaceIdentityState
  onVerify(): void
  diagnostics?: JSX.Element
}

export function MarketplaceRuntimeCard(props: Props) {
  const { t } = useLanguage()
  const [open, setOpen] = createSignal(false)
  const verifying = () => props.identity.status === "verifying"
  const serverLabel = () => {
    if (props.server.status === "connecting") return t("marketplace.runtime.server.connecting")
    if (props.server.status === "connected") return t("marketplace.runtime.server.connected")
    if (props.server.status === "degraded") return t("marketplace.runtime.server.degraded")
    return t("marketplace.runtime.server.failed")
  }
  const identityLabel = () => {
    if (props.identity.status === "verifying") return t("marketplace.runtime.identity.verifying")
    if (props.identity.status === "verified") return t("marketplace.runtime.identity.verified")
    if (props.identity.status === "unverified") return t("marketplace.runtime.identity.unverified")
    return t("marketplace.runtime.identity.failed")
  }

  return (
    <Card class="marketplace-runtime-card">
      <div class="marketplace-runtime-card__main">
        <div class="marketplace-runtime-statuses">
          <RuntimeStatus
            icon="server"
            label={t("marketplace.runtime.server")}
            value={serverLabel()}
            status={props.server.status}
            checkedAt={props.server.checkedAt}
            issue={props.server.issue}
          />
          <RuntimeStatus
            icon="account"
            label={t("marketplace.runtime.identity")}
            value={props.identity.user?.name ?? identityLabel()}
            status={props.identity.status}
            checkedAt={props.identity.checkedAt}
            issue={props.identity.issue}
          />
        </div>
        <div class="marketplace-runtime-actions">
          <Button size="small" variant="secondary" disabled={verifying()} onClick={props.onVerify}>
            <span class={`codicon codicon-${verifying() ? "loading" : "refresh"}`} aria-hidden="true" />
            {verifying() ? t("marketplace.runtime.verifying") : t("marketplace.runtime.reverify")}
          </Button>
          <Show when={props.diagnostics}>
            <Button size="small" variant="ghost" onClick={() => setOpen((value) => !value)}>
              <span class={`codicon codicon-chevron-${open() ? "up" : "down"}`} aria-hidden="true" />
              {open() ? t("marketplace.runtime.hideDiagnostics") : t("marketplace.runtime.showDiagnostics")}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={open() && props.diagnostics}>
        <div class="marketplace-runtime-card__diagnostics">{props.diagnostics}</div>
      </Show>
    </Card>
  )
}

function RuntimeStatus(props: {
  icon: string
  label: string
  value: string
  status: string
  checkedAt: string
  issue?: MarketplaceIssue
}) {
  const { t } = useLanguage()
  const [open, setOpen] = createSignal(false)
  const tip = () => (
    <div class="marketplace-runtime-tooltip">
      <strong>{props.issue?.summary}</strong>
      <span>{t("marketplace.runtime.checkedAt", { time: formatTime(props.checkedAt) })}</span>
      <Show when={props.issue?.status}>
        <span>HTTP {props.issue!.status}</span>
      </Show>
      <Show when={props.issue?.code}>
        <span>
          {t("marketplace.runtime.code")}: {props.issue!.code}
        </span>
      </Show>
      <Show when={props.issue?.reason}>
        <span>
          {t("marketplace.runtime.reason")}: {props.issue!.reason}
        </span>
      </Show>
      <Show when={props.issue?.upstreamStatus}>
        <span>
          {t("marketplace.runtime.upstreamStatus")}: {props.issue!.upstreamStatus}
        </span>
      </Show>
      <Show when={props.issue?.requestId}>
        <span>
          {t("marketplace.runtime.requestId")}: {props.issue!.requestId}
        </span>
      </Show>
      <Show when={props.issue?.retryAfter}>
        <span>
          {t("marketplace.runtime.retryAfter")}: {props.issue!.retryAfter}
        </span>
      </Show>
    </div>
  )
  return (
    <div class="marketplace-runtime-status">
      <span class={`codicon codicon-${props.icon}`} aria-hidden="true" />
      <span class="marketplace-runtime-status__copy">
        <span>{props.label}</span>
        <Tooltip value={tip()} placement="bottom" inactive={!props.issue} forceOpen={open()}>
          <span
            class="marketplace-runtime-status__trigger"
            classList={{ "has-issue": Boolean(props.issue) }}
            tabIndex={props.issue ? 0 : undefined}
            onMouseEnter={() => setOpen(Boolean(props.issue))}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(Boolean(props.issue))}
            onBlur={() => setOpen(false)}
          >
            <Tag class={`marketplace-runtime-tag status-${props.status}`}>{props.value}</Tag>
          </span>
        </Tooltip>
      </span>
    </div>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
