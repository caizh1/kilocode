import type { AgentManagerMode } from "../src/types/messages"
import type { TerminalStateControls } from "./terminal"

interface Session {
  id: string
}

interface Deps {
  state: TerminalStateControls
  pending: () => boolean
  setPending: (pending: boolean) => void
  setMode: (mode: AgentManagerMode) => void
  reset: () => void
  current: () => Session | undefined
  isPending: (id: string) => boolean
  select: (id: string) => void
  selectPending: (id: string) => void
  clear: () => void
  post: (message: unknown) => void
  focus: () => void
  local: string
}

export function createConsoleController(deps: Deps) {
  const request = () => {
    if (deps.state.forSelection(deps.local).length > 0 || deps.pending()) return
    deps.setPending(true)
    deps.post({ type: "agentManager.terminal.create", worktreeId: null })
  }

  const open = (mode: AgentManagerMode) => {
    deps.setMode(mode)
    if (mode !== "console") return
    deps.reset()
    const current = deps.current()
    if (current && !deps.isPending(current.id)) deps.select(current.id)
    if (current && deps.isPending(current.id)) {
      deps.selectPending(current.id)
      deps.clear()
    }
    request()
    deps.focus()
  }

  const send = (command: string) => {
    if (deps.state.send(command) !== "missing") return
    request()
  }

  const terminal = (type: string) => {
    if (type === "agentManager.terminal.created" || type === "agentManager.terminal.error") deps.setPending(false)
  }

  return { open, send, terminal }
}
