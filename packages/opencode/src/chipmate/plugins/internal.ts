import type { BuiltinTuiPlugin } from "@opencode-ai/tui/builtins"
import HomeNews from "@/chipmate/plugins/home-news"
import HomeOnboarding from "@/chipmate/plugins/home-onboarding"
import Attention from "@/chipmate/plugins/attention"
import HomeFooter from "@/chipmate/plugins/home-footer"
import Permissions from "@/chipmate/plugins/permissions"
import SidebarFooter from "@/chipmate/plugins/sidebar-footer"
import MemoryStatus from "@/chipmate/plugins/memory-status"
import MemoryPalette from "@/chipmate/plugins/memory-palette"
import SidebarProcesses from "@/chipmate/plugins/sidebar-background-processes"
import SidebarIndexing from "@/chipmate/plugins/sidebar-indexing"
import SidebarPr from "@/chipmate/plugins/sidebar-pr"
import SidebarUsage from "@/chipmate/plugins/sidebar-usage"
import Sandbox from "@/chipmate/plugins/sandbox"
import Remote from "@/chipmate/plugins/remote"
import Reload from "@/chipmate/plugins/reload"
import SessionSwitcher from "@/chipmate/plugins/session-switcher"
import SessionV2Debug from "@/chipmate/plugins/session-v2-debug"
import type { RuntimeFlags } from "@/effect/runtime-flags"

const plugins = [
  HomeNews,
  HomeOnboarding,
  Attention,
  HomeFooter,
  Permissions,
  SidebarFooter,
  MemoryStatus,
  MemoryPalette,
  SidebarProcesses,
  SidebarIndexing,
  SidebarPr,
  SidebarUsage,
  Sandbox,
  Remote,
  Reload,
] satisfies BuiltinTuiPlugin[]

export function withChipMateTuiPlugins(
  builtins: BuiltinTuiPlugin[],
  flags: Pick<RuntimeFlags.Info, "experimentalEventSystem" | "experimentalSessionSwitcher">,
) {
  return [
    ...plugins,
    ...(flags.experimentalEventSystem ? [SessionV2Debug] : []),
    ...(flags.experimentalSessionSwitcher ? [SessionSwitcher] : []),
    ...builtins,
  ]
}
