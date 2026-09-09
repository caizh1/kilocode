import { Show } from "solid-js"

// 随正文保留在文档流中；原皮肤隐藏此身份行，切换时无需重建消息。
export function AppearanceMessageIdentity(props: { role: "user" | "assistant"; created?: number }) {
  const stamp = () =>
    props.created === undefined
      ? undefined
      : new Date(props.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  return (
    <div class="night-city-message-identity" data-role={props.role}>
      <span class={`codicon codicon-${props.role === "user" ? "account" : "circuit-board"}`} aria-hidden="true" />
      <span>{props.role === "user" ? "你" : "ChipMate"}</span>
      <Show when={stamp()}>
        <time dateTime={new Date(props.created!).toISOString()}>{stamp()}</time>
      </Show>
    </div>
  )
}
