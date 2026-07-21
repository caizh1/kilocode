export type KiloProviderOptions = {
  projectDirectory?: string | null
  platform?: string
  snapshotInitialization?: "wait"
  slimEditMetadata?: boolean
  tabTitle?: (title: string) => void
  worktreeDirectories?: () => string[]
  /** Composite hosts (Agent Manager) own viewed/presence registration themselves. */
  disableViewedRegistration?: boolean
  /** Await host-specific session preparation after resolveSession and before promptAsync. */
  beforePrompt?: (input: { sessionID: string; directory: string; agent?: string }) => Promise<void>
}
