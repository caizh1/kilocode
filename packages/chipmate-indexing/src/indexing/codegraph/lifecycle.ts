import type { CodeGraphSidecarOptions, CodeGraphSidecarState, CodeGraphSidecarStatus } from "./types"
import { CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS } from "./constants"

export class CodeGraphSidecarLifecycle {
  private state: CodeGraphSidecarState = "stopped"
  private readonly transitions: CodeGraphSidecarStatus["transitions"] = []
  private readonly clock: () => number

  constructor(private readonly opts: CodeGraphSidecarOptions) {
    this.clock = opts.clock ?? Date.now
  }

  public start(reason = "start requested"): CodeGraphSidecarStatus {
    if (this.state === "disposed") return this.status()
    if (this.state === "container_ready") return this.status()

    this.transition("container_ready", reason)
    return this.status()
  }

  public stop(reason = "stop requested"): CodeGraphSidecarStatus {
    if (this.state === "disposed") return this.status()
    if (this.state === "stopped") return this.status()

    this.transition("stopped", reason)
    return this.status()
  }

  public restart(reason = "restart requested"): CodeGraphSidecarStatus {
    if (this.state === "disposed") return this.status()

    if (this.state === "container_ready") {
      this.transition("stopped", reason)
    }
    this.transition("container_ready", reason)
    return this.status()
  }

  public dispose(reason = "disposed"): CodeGraphSidecarStatus {
    if (this.state === "disposed") return this.status()

    this.transition("disposed", reason)
    return this.status()
  }

  public status(): CodeGraphSidecarStatus {
    return {
      state: this.state,
      enabled: this.state === "container_ready",
      evidenceAvailable: false,
      detail: detail(this.state),
      workspacePath: this.opts.workspacePath,
      cacheDirectory: this.opts.cacheDirectory,
      transitions: [...this.transitions],
      storage: this.opts.storage?.status(),
      snippetLimit: CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS,
    }
  }

  private transition(state: CodeGraphSidecarState, reason: string): void {
    this.state = state
    this.transitions.push({
      state,
      reason,
      timestamp: this.clock(),
    })
  }
}

export function disabledCodeGraphSidecarStatus(
  input: {
    workspacePath?: string
    reason?: string
    clock?: () => number
  } = {},
): CodeGraphSidecarStatus {
  const reason = input.reason ?? "code graph sidecar disabled"
  return {
    state: "disabled",
    enabled: false,
    evidenceAvailable: false,
    detail: reason,
    workspacePath: input.workspacePath ?? "",
    transitions: [
      {
        state: "disabled",
        reason,
        timestamp: (input.clock ?? Date.now)(),
      },
    ],
    snippetLimit: CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS,
  }
}

function detail(state: CodeGraphSidecarState): string {
  if (state === "container_ready") {
    return "Code graph sidecar container is initialized; graph evidence is not returned by queryEvidence in Phase 2b."
  }
  if (state === "disposed") return "Code graph sidecar lifecycle is disposed."
  if (state === "disabled") return "Code graph sidecar is disabled."
  return "Code graph sidecar is stopped."
}
