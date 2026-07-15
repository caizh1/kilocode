import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Show } from "solid-js"
import type { MarketplaceItem } from "../../types/marketplace"
import { useLanguage } from "../../context/language"

interface Props {
  item: MarketplaceItem
  scope: "project" | "global"
  onClose: () => void
  onConfirm: () => void
  pending?: boolean
  phase?: "validating" | "removing" | "refreshing" | "reconciling"
  error?: string
}

export const RemoveDialog = (props: Props) => {
  const { t } = useLanguage()

  const typeName = () => {
    if (props.item.type === "mcp") return t("marketplace.remove.type.mcp")
    if (props.item.type === "agent") return t("marketplace.remove.type.agent")
    return t("marketplace.remove.type.skill")
  }

  return (
    <Dialog title={t("marketplace.remove.title", { name: props.item.name })} fit>
      <div class="dialog-confirm-body">
        <span>
          {t("marketplace.remove.confirm", { type: typeName(), scope: t(`marketplace.scope.${props.scope}`) })}
        </span>
        <Show when={props.phase}>
          {(phase) => (
            <span role="status" aria-live="polite" style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <Spinner style={{ width: "14px", height: "14px" }} />
              {t(`settings.agentBehaviour.removeSkill.phase.${phase()}`)}
            </span>
          )}
        </Show>
        <Show when={props.error}>
          {(error) => (
            <span role="alert" style={{ color: "var(--vscode-errorForeground)" }}>
              {error()}
            </span>
          )}
        </Show>
        <div class="dialog-confirm-actions">
          <Button variant="secondary" disabled={props.pending} onClick={props.onClose}>
            {t("marketplace.remove.cancel")}
          </Button>
          <Button variant="primary" class="danger-btn" disabled={props.pending} onClick={props.onConfirm}>
            <Show when={props.pending}>
              <Spinner style={{ width: "14px", height: "14px" }} />
            </Show>
            {t("marketplace.remove.confirm.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
