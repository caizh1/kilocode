/** Shared prompt status icon with an in-flow state indicator. */

import type { Component } from "solid-js"
import { Icon, type IconProps } from "@chipmate/chipmate-ui/icon"

export interface PromptStatusIconProps {
  name: IconProps["name"]
}

export const PromptStatusIcon: Component<PromptStatusIconProps> = (props) => (
  <span class="prompt-status-icon-stack" aria-hidden="true">
    <Icon name={props.name} size="small" />
    <span class="prompt-status-indicator" />
  </span>
)
