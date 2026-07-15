import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { useSlashCommand, type SlashCommandEntry } from "../../webview-ui/src/hooks/useSlashCommand"
import type { ExtensionMessage, SlashCommandInfo, WebviewMessage } from "../../webview-ui/src/types/messages"

function setup(commands: SlashCommandInfo[] = []) {
  const posted: WebviewMessage[] = []
  const handlers = new Set<(message: ExtensionMessage) => void>()
  const cleanup: { run?: () => void } = {}
  const slash = createRoot((root) => {
    cleanup.run = root
    return useSlashCommand({
      postMessage: (message) => posted.push(message),
      onMessage: (handler) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    })
  })

  if (commands.length > 0) {
    for (const handler of handlers) handler({ type: "commandsLoaded", commands })
  }

  return { slash, posted, cleanup }
}

function field(value: string, pos: number) {
  const state = { start: pos, end: pos, focused: false }
  const node = {
    value,
    selectionStart: pos,
    setSelectionRange: (start: number, end: number) => {
      state.start = start
      state.end = end
    },
    focus: () => {
      state.focused = true
    },
  } as unknown as HTMLTextAreaElement
  return { node, state }
}

function key(name: "Enter" | "Tab") {
  const state = { prevented: 0 }
  const event = {
    key: name,
    isComposing: false,
    preventDefault: () => {
      state.prevented++
    },
    stopPropagation: () => {},
  } as unknown as KeyboardEvent
  return { event, state }
}

const skill: SlashCommandEntry = {
  name: "chip-design-doc",
  description: "Generate a design document",
  source: "skill",
  hints: [],
}

describe("useSlashCommand selection", () => {
  it("preserves Chinese and English draft text when a skill is selected directly", () => {
    const ctx = setup()
    const raw = "/chip请分析代码 and keep this context"
    const input = field(raw, 5)
    const state = { text: "" }

    ctx.slash.onInput(raw, 5)
    ctx.slash.select(skill, input.node, (text) => {
      state.text = text
    })

    const expected = "/chip-design-doc 请分析代码 and keep this context"
    expect(input.node.value).toBe(expected)
    expect(state.text).toBe(expected)
    expect(input.state.start).toBe("/chip-design-doc ".length)
    expect(input.state.end).toBe("/chip-design-doc ".length)
    expect(input.state.focused).toBe(true)
    expect(ctx.slash.show()).toBe(false)
    ctx.cleanup.run?.()
  })

  for (const name of ["Enter", "Tab"] as const) {
    it(`preserves trailing text through the ${name} keyboard path`, () => {
      const ctx = setup([skill])
      const raw = "/chipReview the existing implementation"
      const input = field(raw, 5)
      const press = key(name)
      const state = { text: "" }

      ctx.slash.onInput(raw, 5)
      const handled = ctx.slash.onKeyDown(press.event, input.node, (text) => {
        state.text = text
      })

      expect(handled).toBe(true)
      expect(press.state.prevented).toBe(1)
      expect(state.text).toBe("/chip-design-doc Review the existing implementation")
      expect(input.state.start).toBe("/chip-design-doc ".length)
      ctx.cleanup.run?.()
    })
  }

  it("preserves the draft and runs a client action exactly once", () => {
    const ctx = setup()
    const raw = "/new保留这段草稿"
    const input = field(raw, 4)
    const state = { text: "", actions: 0, selected: 0 }

    ctx.slash.onInput(raw, 4)
    ctx.slash.select(
      {
        name: "new",
        description: "Start a new session",
        hints: [],
        action: () => {
          state.actions++
        },
      },
      input.node,
      (text) => {
        state.text = text
      },
      () => {
        state.selected++
      },
    )

    expect(input.node.value).toBe("保留这段草稿")
    expect(state).toEqual({ text: "保留这段草稿", actions: 1, selected: 1 })
    expect(ctx.slash.show()).toBe(false)
    ctx.cleanup.run?.()
  })

  it("keeps the existing empty-input behavior for a server command", () => {
    const ctx = setup()
    const raw = "/chip"
    const input = field(raw, raw.length)
    const state = { text: "" }

    ctx.slash.onInput(raw, raw.length)
    ctx.slash.select(skill, input.node, (text) => {
      state.text = text
    })

    expect(state.text).toBe("/chip-design-doc ")
    expect(input.state.start).toBe("/chip-design-doc ".length)
    ctx.cleanup.run?.()
  })

  it("uses the matched slash boundary even if the live cursor moves", () => {
    const ctx = setup()
    const raw = "/chip原始提示词"
    const input = field(raw, 5)
    const state = { text: "" }

    ctx.slash.onInput(raw, 5)
    input.node.selectionStart = 2
    ctx.slash.select(skill, input.node, (text) => {
      state.text = text
    })

    expect(state.text).toBe("/chip-design-doc 原始提示词")
    expect(input.state.start).toBe("/chip-design-doc ".length)
    ctx.cleanup.run?.()
  })
})
