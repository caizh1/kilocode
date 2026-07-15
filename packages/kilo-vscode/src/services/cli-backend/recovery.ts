export const RESTART_MS = 3000
export const STABLE_MS = 60_000
export const MAX_FAILURES = 5

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
