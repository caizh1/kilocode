export const RESTART_MS = 3000
export const STABLE_MS = 60_000
// One automatic recovery after the initial process failure. Further crashes
// stay visible instead of entering a restart loop that can hide a broken CLI.
export const MAX_FAILURES = 2

export class CrashRecovery {
  failures = 0
  exhausted = false

  failed() {
    this.failures++
    if (this.failures < MAX_FAILURES) return true
    this.exhausted = true
    return false
  }

  stable() {
    this.failures = 0
    this.exhausted = false
  }

  manual() {
    this.stable()
  }
}
