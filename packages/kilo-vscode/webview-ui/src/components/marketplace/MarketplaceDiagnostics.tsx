import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { MarketCapabilities, MarketStatus } from "../../types/marketplace"

interface Props {
  status?: MarketStatus
  capabilities?: MarketCapabilities
  baseUrl?: string
  protocol: "aligned-v1" | "legacy"
  mode?: "skills-only" | "full"
}

export function MarketplaceDiagnostics(props: Props) {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const open = () => {
    if (!props.baseUrl) return
    const root = props.baseUrl.replace(/\/marketplace\/?$/i, "")
    vscode.postMessage({ type: "openExternal", url: `${root}/status` })
  }
  return (
    <div class="aligned-diagnostics">
      <Card>
        <div class="aligned-diagnostic-heading">
          <Icon name="server" />
          <strong>{t("marketplace.aligned.serviceStatus")}</strong>
          <Tag>{props.status?.ok ? "READY" : props.status ? "DEGRADED" : "UNKNOWN"}</Tag>
        </div>
        <div class="aligned-status-grid">
          <span>{t("marketplace.aligned.protocol")}</span>
          <strong>{props.protocol}</strong>
          <Show when={props.baseUrl}>
            <span>{t("marketplace.runtime.baseUrl")}</span>
            <strong class="aligned-status-value">{props.baseUrl}</strong>
          </Show>
          <span>{t("marketplace.aligned.mode")}</span>
          <strong>
            {props.mode === "skills-only"
              ? t("marketplace.aligned.skillsOnlyMode")
              : t("marketplace.aligned.fullMode")}
          </strong>
          <Show when={props.capabilities}>
            <span>{t("marketplace.runtime.apiVersion")}</span>
            <strong>{props.capabilities!.apiVersion}</strong>
            <span>{t("marketplace.runtime.catalogVersion")}</span>
            <strong>{props.capabilities!.catalogVersion}</strong>
            <span>{t("marketplace.runtime.skillSpecVersion")}</span>
            <strong>{props.capabilities!.skillSpecVersion ?? "—"}</strong>
          </Show>
          <Show when={props.status}>
            <span>Render</span>
            <strong>{props.status!.render}</strong>
            <span>Market</span>
            <strong>{props.status!.market}</strong>
            <span>Packages</span>
            <strong>{props.status!.packages}</strong>
            <span>Transport</span>
            <strong>{props.status!.transport}</strong>
          </Show>
        </div>
        <For each={props.status?.warnings ?? []}>
          {(warning) => <p class="aligned-diagnostic-warning">{warning}</p>}
        </For>
        <p class="aligned-diagnostic-note">{t("marketplace.runtime.configuredNotVerified")}</p>
        <Show when={props.baseUrl}>
          <Button size="small" variant="ghost" onClick={open}>
            {t("marketplace.aligned.openWebStatus")}
          </Button>
        </Show>
      </Card>
      <Show when={props.capabilities}>
        <Card>
          <strong>{t("marketplace.aligned.capabilities")}</strong>
          <div class="aligned-capability-list">
            <For each={Object.entries(props.capabilities!.features)}>
              {([name, enabled]) => (
                <span>
                  <Icon name={enabled ? "check" : "close"} size="small" />
                  {name}
                </span>
              )}
            </For>
          </div>
        </Card>
      </Show>
    </div>
  )
}
