import type { SessionStatus } from "../../types/messages"

type TranslateDuration = (key: string, params: Record<string, string | number>) => string

export function tracksElapsed(status: SessionStatus, submitting: boolean, since: number | undefined): since is number {
  return since !== undefined && (status !== "idle" || submitting)
}

export function formatWorkingElapsed(totalSeconds: number, translate: TranslateDuration) {
  const elapsed = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  if (minutes === 0) return translate("session.turn.duration.seconds", { seconds })
  return translate("session.turn.duration.minutes", {
    minutes,
    seconds: String(seconds).padStart(2, "0"),
  })
}
