/** @jsxImportSource solid-js */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, onMount, type Component } from "solid-js"
import { ChatView } from "../components/chat"
import { SessionSurfaceProvider, useSessionSurface } from "../context/session-surface"
import type { ChatSurfaceKind, SessionSurfacePhase } from "../../../src/shared/session-surface"
import { StoryProviders } from "./StoryProviders"

const key = { kind: "session" as const, id: "story-session" }

const SurfaceFixture: Component<{
  kind: ChatSurfaceKind
  phase: SessionSurfacePhase
  owner: boolean
}> = (props) => {
  onMount(() => {
    queueMicrotask(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "sessionSurface.bootstrap",
            surfaceId: props.kind === "sidebar" ? "sidebar" : "main:story",
            kind: props.kind,
            pinnedKey: props.kind === "main-editor" ? key : undefined,
          },
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "sessionSurface.state",
            state: {
              key,
              phase: props.phase,
              ownerSurfaceId: props.owner ? (props.kind === "sidebar" ? "sidebar" : "main:story") : "main:story",
              token: props.owner
                ? {
                    generation: "story-generation",
                    surfaceId: props.kind === "sidebar" ? "sidebar" : "main:story",
                    epoch: 1,
                  }
                : undefined,
              draftRevision: 0,
              mode: "qa",
              dshLease: false,
            },
          },
        }),
      )
    })
  })
  return <ChatView />
}

const DraftSwitchBarrierFixture: Component = () => {
  const surface = useSessionSurface()
  const [text, setText] = createSignal("")
  const [sequence, setSequence] = createSignal(0)
  const [status, setStatus] = createSignal("ready")
  const content = () => ({
    boxId: "prompt:story-session-a",
    text: text(),
    reviewComments: [],
    images: [],
    references: [],
    inputScrollTop: 0,
  })
  onMount(() => {
    queueMicrotask(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "sessionSurface.bootstrap", surfaceId: "sidebar", kind: "sidebar" },
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "sessionSurface.state",
            state: {
              key: { kind: "session", id: "story-session-a" },
              phase: "sidebar",
              ownerSurfaceId: "sidebar",
              token: { generation: "story-generation", surfaceId: "sidebar", epoch: 1 },
              draftRevision: 1,
              mode: "qa",
              dshLease: true,
            },
          },
        }),
      )
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "sessionSurface.draft.snapshot",
            draft: {
              schemaVersion: 1,
              key: { kind: "session", id: "story-session-a" },
              revision: 1,
              updatedAt: 1,
              content: content(),
            },
          },
        }),
      )
    })
  })
  const update = (value: string) => {
    setText(value)
    const next = content()
    surface.stageDraft(next)
    setSequence(surface.updateDraft(next))
  }
  const switchSession = () => {
    const current = surface.activeKey()
    if (!current) return
    setStatus("waiting")
    const switching = surface.switchActive({ kind: "session", id: "story-session-b" })
    setTimeout(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "sessionSurface.draft.ack",
            key: current,
            clientSeq: sequence(),
            revision: 2,
          },
        }),
      )
    }, 500)
    void switching.then(() => setStatus("switched"))
  }
  return (
    <main style={{ padding: "16px", display: "grid", gap: "12px" }}>
      <label for="draft-switch-input">会话草稿</label>
      <textarea id="draft-switch-input" value={text()} onInput={(event) => update(event.currentTarget.value)} />
      <button type="button" onClick={switchSession}>
        切换到 B
      </button>
      <output
        data-ui="draft-switch-state"
        data-status={status()}
        data-active={`${surface.activeKey()?.kind ?? ""}:${surface.activeKey()?.id ?? ""}`}
      >
        {status()}
      </output>
    </main>
  )
}

const meta = {
  title: "Chat/Session Surface",
  component: SurfaceFixture,
  decorators: [
    (Story) => (
      <StoryProviders sessionID="story-session" locale="zh" noPadding>
        <SessionSurfaceProvider>
          <Story />
        </SessionSurfaceProvider>
      </StoryProviders>
    ),
  ],
} satisfies Meta<typeof SurfaceFixture>

export default meta
type Story = StoryObj<typeof meta>

export const MainOwner: Story = { args: { kind: "main-editor", phase: "main", owner: true } }
export const SidebarOwner: Story = { args: { kind: "sidebar", phase: "sidebar", owner: true } }
export const SidebarMirror: Story = { args: { kind: "sidebar", phase: "main", owner: false } }
export const OpeningMain: Story = { args: { kind: "main-editor", phase: "sidebar", owner: false } }
export const DeletedMain: Story = { args: { kind: "main-editor", phase: "deleted", owner: false } }
export const DraftSwitchBarrier: Story = {
  args: { kind: "sidebar", phase: "sidebar", owner: true },
  render: () => <DraftSwitchBarrierFixture />,
}
