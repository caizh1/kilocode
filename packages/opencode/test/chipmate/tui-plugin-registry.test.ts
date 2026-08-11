import { expect, test } from "bun:test"
import { internalTuiPlugins } from "@/plugin/tui/internal"

const chipmate = [
  "internal:home-news",
  "internal:home-onboarding",
  "internal:chipmate-attention",
  "internal:chipmate-home-footer",
  "internal:chipmate-permissions",
  "internal:chipmate-sidebar-footer",
  "internal:chipmate-sidebar-memory",
  "internal:chipmate-memory-palette",
  "internal:chipmate-sidebar-background-processes",
  "internal:chipmate-sidebar-indexing",
  "internal:chipmate-sidebar-pr",
  "internal:chipmate-sidebar-usage",
  "internal:sandbox",
  "internal:remote",
  "internal:reload",
]

test("internal TUI registry preserves every ChipMate plugin before upstream builtins", () => {
  const ids = internalTuiPlugins({ experimentalEventSystem: false, experimentalSessionSwitcher: false }).map(
    (plugin) => plugin.id,
  )

  expect(ids.slice(0, chipmate.length)).toEqual(chipmate)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids).toContain("internal:sidebar-context")
  expect(ids).toContain("diff-viewer")
})

test("experimental ChipMate TUI plugins remain wired", () => {
  const ids = internalTuiPlugins({ experimentalEventSystem: true, experimentalSessionSwitcher: true }).map(
    (plugin) => plugin.id,
  )

  expect(ids).toContain("internal:session-v2-debug")
  expect(ids).toContain("internal:session-switcher")
})
