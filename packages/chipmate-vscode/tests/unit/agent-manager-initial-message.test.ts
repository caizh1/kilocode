import { describe, expect, it } from "bun:test"
import { hasVersionModels } from "../../src/agent-manager/multi-version"
import { initialMessage, initialVariant, seedInitialVariant } from "../../webview-ui/agent-manager/initial-message"

describe("Agent Manager initial message", () => {
  it("forwards the selected variant to sendMessage", () => {
    const msg = initialMessage({
      type: "agentManager.sendInitialMessage",
      sessionId: "session-a",
      worktreeId: "wt-a",
      text: "Fix it",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant: "high",
    })

    expect(msg).toEqual({
      type: "sendMessage",
      text: "Fix it",
      sessionID: "session-a",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      variant: "high",
      files: undefined,
    })
  })

  it("does not create an empty sendMessage payload", () => {
    expect(
      initialMessage({
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
      }),
    ).toBeUndefined()
  })

  it("does not create a sendMessage payload without a complete model", () => {
    expect(
      initialMessage({
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
        text: "Fix it",
        providerID: "anthropic",
      }),
    ).toBeUndefined()
  })

  it("builds the initial session variant state", () => {
    const state = initialVariant(
      {
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "medium",
      },
      "code",
    )

    expect(state).toEqual({
      sessionID: "session-a",
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
      agent: "code",
      value: "medium",
    })
  })

  it("does not build variant state without a complete model variant", () => {
    expect(
      initialVariant(
        {
          type: "agentManager.sendInitialMessage",
          sessionId: "session-a",
          worktreeId: "wt-a",
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
        },
        "code",
      ),
    ).toBeUndefined()
  })

  it("seeds initial variant state into the session store", () => {
    const calls: unknown[] = []

    seedInitialVariant(
      {
        getSessionAgent: () => "code",
        setSessionVariant: (...args) => calls.push(args),
      },
      {
        type: "agentManager.sendInitialMessage",
        sessionId: "session-a",
        worktreeId: "wt-a",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "medium",
      },
    )

    expect(calls).toEqual([["session-a", "anthropic", "claude-sonnet-4", "medium", "code"]])
  })
})

describe("Agent Manager model preflight", () => {
  it("requires a complete model for every version before creating sessions", () => {
    expect(hasVersionModels([], undefined, 1)).toBe(false)
    expect(hasVersionModels([], { providerID: "openai", modelID: "gpt-4.1" }, 2)).toBe(true)
    expect(
      hasVersionModels(
        [
          { providerID: "openai", modelID: "gpt-4.1" },
          { providerID: "", modelID: "gpt-4.1-mini" },
        ],
        undefined,
        2,
      ),
    ).toBe(false)
  })
})
