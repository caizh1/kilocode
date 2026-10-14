import type { ChipMateProvider } from "../../ChipMateProvider"
import type { AgentManagerProvider } from "../../agent-manager/AgentManagerProvider"

type Surface = ChipMateProvider | AgentManagerProvider
let focused: WeakRef<Surface> | undefined

export function focusChatSurface(surface: Surface) {
  focused = new WeakRef(surface)
}

export function focusedChatSurface() {
  return focused?.deref()
}

export function clearChatSurface(surface?: Surface) {
  if (!surface || focused?.deref() === surface) focused = undefined
}
