/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { ChatView } from "../components/chat"
import { onMount, onCleanup } from "solid-js"
import { SessionProvider, useSession } from "../context/session"
import { StoryProviders } from "./StoryProviders"

function Fixture() {
  const session = useSession()
  onMount(() => {
    const select = (event: Event) => session.selectSession((event as CustomEvent<string>).detail)
    window.addEventListener("验收选择会话", select)
    onCleanup(() => window.removeEventListener("验收选择会话", select))
  })
  return <ChatView />
}

const meta = {
  title: "Chat/Spec Execution",
  render: () => (
    <StoryProviders locale="zh" noPadding>
      <SessionProvider>
        <Fixture />
      </SessionProvider>
    </StoryProviders>
  ),
} satisfies Meta
export default meta
export const Terminal: StoryObj<typeof meta> = {}
