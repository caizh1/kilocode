import type { ChatSurfaceKind, SessionSurfaceKey } from "../shared/session-surface"
import type { SessionSurfaceCoordinator } from "../services/session-surface/coordinator"
import type { SessionForkCoordinator } from "../services/session-fork/coordinator"

export type ChipMateProviderOptions = {
  projectDirectory?: string | null
  platform?: string
  snapshotInitialization?: "wait"
  slimEditMetadata?: boolean
  tabTitle?: (title: string) => void
  worktreeDirectories?: () => string[]
  /** Composite hosts (Agent Manager) own viewed/presence registration themselves. */
  disableViewedRegistration?: boolean
  sessionForks?: SessionForkCoordinator
  forkOwnerID?: string
  /** Await host-specific session preparation after resolveSession and before promptAsync. */
  beforePrompt?: (input: { sessionID: string; directory: string; agent?: string }) => Promise<void>
  surface?: {
    id: string
    kind: ChatSurfaceKind
    coordinator: SessionSurfaceCoordinator
    pinnedKey?: SessionSurfaceKey
  }
}
