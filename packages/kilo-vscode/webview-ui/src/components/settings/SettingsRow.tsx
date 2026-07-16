import { Tag } from "@kilocode/kilo-ui/tag"
import { Component, JSX, Show } from "solid-js"

const SettingsRow: Component<{
  title: string
  description?: string
  descriptionId?: string
  tag?: () => string | undefined
  last?: boolean
  children: JSX.Element
}> = (props) => (
  <div
    data-slot="settings-row"
    data-last={props.last ? "true" : undefined}
    data-description={props.description === null || props.description === undefined ? undefined : "true"}
  >
    <div data-slot="settings-row-label">
      <div data-slot="settings-row-label-title">
        <span>{props.title}</span>
        <Show when={props.tag?.()}>{(tag) => <Tag>{tag()}</Tag>}</Show>
      </div>
      {props.description !== null && props.description !== undefined && (
        <div id={props.descriptionId} data-slot="settings-row-label-subtitle">
          {props.description}
        </div>
      )}
    </div>
    <div data-slot="settings-row-input">{props.children}</div>
  </div>
)

export default SettingsRow
