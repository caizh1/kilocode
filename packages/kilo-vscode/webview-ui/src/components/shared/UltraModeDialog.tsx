import { type Component, For } from "solid-js"
import { AlertDialog } from "@kobalte/core/alert-dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon, type IconProps } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"

interface Props {
  open: boolean
  onConfirm: () => void
}

const benefits = [
  { icon: "dot-grid", key: "prompt.ultra.confirm.benefit.explore" },
  { icon: "shield", key: "prompt.ultra.confirm.benefit.verify" },
  { icon: "history", key: "prompt.ultra.confirm.benefit.cost" },
] as const satisfies ReadonlyArray<{ icon: IconProps["name"]; key: string }>

export const UltraModeDialog: Component<Props> = (props) => {
  const language = useLanguage()
  const button = { current: undefined as HTMLButtonElement | undefined }
  const block = (event: Event) => event.preventDefault()

  return (
    <AlertDialog open={props.open} modal preventScroll onOpenChange={() => undefined}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay data-component="dialog-overlay" class="ultra-mode-dialog-overlay" />
        <div data-component="dialog" data-fit class="ultra-mode-dialog">
          <div data-slot="dialog-container">
            <AlertDialog.Content
              data-slot="dialog-content"
              onEscapeKeyDown={block}
              onPointerDownOutside={block}
              onInteractOutside={block}
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                button.current?.focus()
              }}
            >
              <div data-slot="dialog-header" class="ultra-mode-dialog-header">
                <span class="codicon codicon-sparkle ultra-mode-dialog-sparkle" aria-hidden="true" />
                <AlertDialog.Title data-slot="dialog-title">
                  {language.t("prompt.ultra.confirm.title")}
                </AlertDialog.Title>
              </div>
              <AlertDialog.Description data-slot="dialog-description">
                {language.t("prompt.ultra.confirm.description")}
              </AlertDialog.Description>
              <div data-slot="dialog-body">
                <div class="ultra-mode-dialog-body">
                  <div class="ultra-mode-dialog-benefits">
                    <For each={benefits}>
                      {(benefit) => (
                        <div class="ultra-mode-dialog-benefit">
                          <Icon name={benefit.icon} size="medium" />
                          <span>{language.t(benefit.key)}</span>
                        </div>
                      )}
                    </For>
                  </div>
                  <p class="ultra-mode-dialog-note">{language.t("prompt.ultra.confirm.note")}</p>
                  <Button
                    ref={(element: HTMLButtonElement) => {
                      button.current = element
                    }}
                    variant="primary"
                    size="large"
                    data-full-width="true"
                    onClick={props.onConfirm}
                  >
                    {language.t("prompt.ultra.confirm.action")}
                  </Button>
                </div>
              </div>
            </AlertDialog.Content>
          </div>
        </div>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
