import { Show, type JSX } from "solid-js"
import { BasicTool as Base, GenericTool } from "@opencode-ai/ui/basic-tool"
import type { BasicToolProps as BaseProps, TriggerTitle } from "@opencode-ai/ui/basic-tool"
import { useI18n, type UiI18nKey } from "@opencode-ai/ui/context/i18n"
import { Icon } from "./icon"
import { toolOpenKey, readToolOpen, writeToolOpen } from "./tool-open-state"
import { useToolApproval, ToolApprovalLine } from "./tool-approval"

export { GenericTool }
export type { TriggerTitle }

export interface BasicToolProps extends BaseProps {
  tool?: string
  callID?: string
  partID?: string
}

type OpenProps = Pick<BasicToolProps, "tool" | "callID" | "partID" | "forceOpen" | "defaultOpen">

const completed = "ui.basicTool.completed" as UiI18nKey
const readFile = "ui.basicTool.readFile" as UiI18nKey

function structured(value: unknown): value is TriggerTitle {
  if (typeof value !== "object" || value === null || !("title" in value)) return false
  if (typeof Node !== "undefined" && value instanceof Node) return false
  return typeof value.title === "string"
}

export function initialOpen(props: OpenProps) {
  return props.forceOpen ? true : readToolOpen(toolOpenKey(props), props.defaultOpen)
}

export function BasicTool(props: BasicToolProps) {
  const i18n = useI18n()
  const key = () => toolOpenKey(props)
  const initial = () => initialOpen(props)
  const approval = useToolApproval()
  const change = (open: boolean) => {
    writeToolOpen(key(), open)
    props.onOpenChange?.(open)
  }
  // The "why was this allowed" line lives in the expanded body, above any tool-specific details.
  const details = () => (
    <div data-slot="basic-tool-details">
      <Show when={approval()}>{(value) => <ToolApprovalLine display={value()} />}</Show>
      {props.children}
    </div>
  )
  const status = () => (
    <Show when={props.status === "completed"}>
      <span data-slot="basic-tool-completed">
        <span data-slot="basic-tool-completed-icon" aria-hidden="true">
          <Icon name="circle-check" size="small" />
        </span>
        <span data-slot="basic-tool-completed-label">{i18n.t(completed)}</span>
      </span>
    </Show>
  )
  const trigger = (): TriggerTitle | JSX.Element => {
    const value = props.trigger
    if (structured(value)) {
      return {
        ...value,
        action: (
          <span data-slot="basic-tool-actions">
            <Show when={props.tool === "read"}>
              <span data-slot="basic-tool-qa-read-icon" aria-hidden="true">
                <Icon name="liquid-file" size="small" />
              </span>
              <span data-slot="basic-tool-qa-read-info">
                <span data-slot="basic-tool-qa-read-title">{i18n.t(readFile)}</span>
                <Show when={value.subtitle}>
                  <span data-slot="basic-tool-qa-read-separator">·</span>
                  <span data-slot="basic-tool-qa-read-subtitle">{value.subtitle}</span>
                </Show>
              </span>
            </Show>
            {value.action}
            {status()}
          </span>
        ),
      }
    }
    return (
      <div data-slot="basic-tool-trigger-layout">
        <Show when={props.tool === "read"}>
          <span data-slot="basic-tool-qa-read-icon" aria-hidden="true">
            <Icon name="liquid-file" size="small" />
          </span>
          <span data-slot="basic-tool-qa-read-title">{i18n.t(readFile)}</span>
        </Show>
        <div data-slot="basic-tool-trigger-original">{value}</div>
        {status()}
      </div>
    )
  }
  if (!("children" in props) && !approval()) {
    return (
      <Base
        {...props}
        trigger={trigger()}
        defaultOpen={initial()}
        retainDetails={props.defer}
        onOpenChange={change}
      />
    )
  }
  return (
    <Base
      {...props}
      trigger={trigger()}
      defaultOpen={initial()}
      retainDetails={props.defer}
      onOpenChange={change}
      hasDetails
    >
      {details()}
    </Base>
  )
}
