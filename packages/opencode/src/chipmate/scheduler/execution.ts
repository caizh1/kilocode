import { Effect } from "effect"
const turns = new Map<string, string>()
export function markTurn(session: string, message = "*") {
  turns.set(session, message)
}
export function releaseTurn(session: string) {
  turns.delete(session)
  guards.delete(session)
}
export function isScheduledTurn(session: string, message?: string) {
  const expected = turns.get(session)
  return !!expected && (expected === "*" || message === expected)
}

const guards = new Map<string, () => Effect.Effect<void>>()
export function guardTurn(session: string, guard: () => Effect.Effect<void>) {
  guards.set(session, guard)
}
export function assertLease(session: string, message?: string) {
  return isScheduledTurn(session, message) ? (guards.get(session)?.() ?? Effect.void) : Effect.void
}
