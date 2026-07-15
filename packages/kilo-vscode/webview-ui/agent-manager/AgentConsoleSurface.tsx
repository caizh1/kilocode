import type { Component, JSX } from "solid-js"

interface Props {
  console: () => boolean
  terminalActive: () => boolean
  terminal: JSX.Element
  children: JSX.Element
}

export const AgentConsoleSurface: Component<Props> = (props) => (
  <div
    class="am-main-pane"
    classList={{
      "am-main-pane-terminal-active": props.terminalActive(),
      "am-main-pane-console": props.console(),
    }}
    data-component={props.console() ? "agent-console" : undefined}
  >
    {props.terminal}
    {props.children}
  </div>
)
