import type { SessionV1 } from "@opencode-ai/core/v1/session"

export namespace KiloPartLifecycle {
  export const key = "kilocode.lifecycle"

  export function transient(part: SessionV1.Part) {
    return part.type === "text" && part.metadata?.[key] === "transient"
  }
}
