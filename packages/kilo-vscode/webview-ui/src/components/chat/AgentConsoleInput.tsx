import { type Accessor, type Component, Show, createEffect, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tabs } from "@kilocode/kilo-ui/tabs"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../context/language"

export type AgentConsoleInputMode = "agent" | "shell"

export interface AgentConsoleInputProps {
  mode: Accessor<AgentConsoleInputMode>
  setMode: (mode: AgentConsoleInputMode) => void
  pending: Accessor<boolean>
  onShell: (command: string) => void
  children: JSX.Element
}

export const AgentConsoleInput: Component<AgentConsoleInputProps> = (props) => {
  const language = useLanguage()
  const [text, setText] = createSignal("")
  let shell: HTMLDivElement | undefined
  const input = () => shell?.querySelector<HTMLTextAreaElement>("textarea")

  createEffect(() => {
    if (props.mode() !== "shell") return
    queueMicrotask(() => input()?.focus())
  })

  const submit = () => {
    const command = text().trim()
    if (!command || props.pending()) return
    props.onShell(command)
    setText("")
  }

  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
    event.preventDefault()
    submit()
  }

  return (
    <div data-component="agent-console-input" data-mode={props.mode()}>
      <div data-slot="agent-console-mode-row">
        <Tabs
          value={props.mode()}
          onChange={(mode) => props.setMode(mode as AgentConsoleInputMode)}
          variant="pill"
          data-slot="agent-console-mode"
          aria-label="Agent Console input mode"
        >
          <Tabs.List>
            <Tabs.Trigger value="agent">
              <Icon name="brain" size="small" />
              <span>{language.t("command.category.agent")}</span>
            </Tabs.Trigger>
            <Tabs.Trigger value="shell">
              <Icon name="console" size="small" />
              <span>{language.t("prompt.mode.shell")}</span>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>
        <Show when={props.mode() === "shell"}>
          <span data-slot="agent-console-warning">
            <Icon name="warning" size="small" />
            {language.t("prompt.mode.shell.warning")}
          </span>
        </Show>
      </div>

      <Show when={props.mode() === "shell"} fallback={props.children}>
        <div ref={shell} data-slot="agent-console-shell">
          <TextField
            multiline
            value={text()}
            onChange={setText}
            spellcheck={false}
            data-agent-manager-native-text-shortcuts
            label={language.t("prompt.placeholder.shell")}
            hideLabel
            placeholder={language.t("prompt.placeholder.shell")}
            onKeyDown={keydown}
          />
          <Button variant="primary" size="small" disabled={!text().trim() || props.pending()} onClick={submit}>
            <Show when={props.pending()} fallback={<Icon name="arrow-right" size="small" />}>
              <Spinner />
            </Show>
            {language.t("ui.permission.run")}
          </Button>
        </div>
      </Show>
    </div>
  )
}
