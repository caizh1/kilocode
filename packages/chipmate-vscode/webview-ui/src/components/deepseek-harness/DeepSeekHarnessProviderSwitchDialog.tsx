import type { Component } from "solid-js"
import { AlertDialog } from "@kobalte/core/alert-dialog"
import { Button } from "@chipmate/chipmate-ui/button"
import { useLanguage } from "../../context/language"

interface Props {
  open: boolean
  source: string
  target: string
  onConfirm: () => void
  onCancel: () => void
}

export const DeepSeekHarnessProviderSwitchDialog: Component<Props> = (props) => {
  const language = useLanguage()
  let cancel: HTMLButtonElement | undefined
  const cancelOnEscape = (event: Event) => {
    event.preventDefault()
    props.onCancel()
  }
  const block = (event: Event) => event.preventDefault()
  return (
    <AlertDialog open={props.open} modal preventScroll onOpenChange={() => undefined}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay data-component="dialog-overlay" class="dsh-mode-dialog-overlay" />
        <div data-component="dialog" data-fit class="dsh-mode-dialog">
          <div data-slot="dialog-container">
            <AlertDialog.Content
              data-slot="dialog-content"
              onEscapeKeyDown={cancelOnEscape}
              onPointerDownOutside={block}
              onInteractOutside={block}
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                cancel?.focus()
              }}
            >
              <div data-slot="dialog-header" class="dsh-mode-dialog-header">
                <span class="dsh-mode-dialog-mark" aria-hidden="true">
                  <span class="codicon codicon-server-process" />
                  <span class="codicon codicon-arrow-swap" />
                </span>
                <AlertDialog.Title data-slot="dialog-title">
                  {local(language.locale(), "切换官方 DSH Provider", "Switch official DSH Provider")}
                </AlertDialog.Title>
              </div>
              <AlertDialog.Description data-slot="dialog-description">
                {local(
                  language.locale(),
                  `从 ${props.source} 切换到 ${props.target} 需要停止当前官方 DSH 进程。不会提前取消任务或注入消息。`,
                  `Switching from ${props.source} to ${props.target} requires stopping the current official DSH process. No task will be cancelled and no shutdown message will be injected.`,
                )}
              </AlertDialog.Description>
              <div data-slot="dialog-body">
                <div class="dsh-provider-switch-actions">
                  <Button
                    ref={(element: HTMLButtonElement) => {
                      cancel = element
                    }}
                    variant="secondary"
                    size="large"
                    onClick={props.onCancel}
                  >
                    {local(language.locale(), "取消", "Cancel")}
                  </Button>
                  <Button variant="primary" size="large" onClick={props.onConfirm}>
                    {local(language.locale(), "停止并切换 Provider", "Stop and switch Provider")}
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

function local(locale: string, zh: string, en: string): string {
  return locale === "zh" ? zh : en
}
