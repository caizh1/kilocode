import { type Accessor, type Component, createEffect } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import type { PermissionRequest } from "../../types/messages"
import { PermissionDock } from "./PermissionDock"

interface Props {
  request: Accessor<PermissionRequest | undefined>
  responding: (id: string) => boolean
  onDecide: (response: "once" | "reject", approved: string[], denied: string[]) => void
  onEdit: (request: PermissionRequest) => void
}

export const PermissionDialogController: Component<Props> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const state = { id: undefined as string | undefined, settled: false }

  const close = () => {
    state.settled = true
    state.id = undefined
    dialog.close()
  }

  const show = (request: PermissionRequest) => {
    state.id = request.id
    state.settled = false
    dialog.show(
      () => (
        <Dialog
          title={language.t("notification.permission.title")}
          action={
            <span data-slot="permission-risk-badge" aria-hidden="true">
              <Icon name="warning" size="small" />
            </span>
          }
          class="permission-risk-dialog"
          fit
          transition
        >
          <PermissionDock
            request={request}
            responding={props.responding(request.id)}
            presentation="dialog"
            onDecide={(response, approved, denied) => {
              props.onDecide(response, approved, denied)
              close()
            }}
            onEdit={() => {
              props.onEdit(request)
              close()
            }}
          />
        </Dialog>
      ),
      () => {
        const reject = !state.settled
        state.id = undefined
        if (reject && !props.responding(request.id)) props.onDecide("reject", [], [])
      },
    )
  }

  createEffect(() => {
    const request = props.request()
    if (!request) {
      if (state.id) close()
      return
    }
    if (state.id === request.id || props.responding(request.id)) return
    show(request)
  })

  return null
}
