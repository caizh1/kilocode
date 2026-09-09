import { describe, expect, it } from "bun:test"
import {
  handleImportAndSend,
  handleRequestCloudSessionData,
  type CloudSessionContext,
} from "../../src/chipmate-provider/handlers/cloud-session"

function stalled(options?: { signal?: AbortSignal }) {
  return new Promise<never>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
  })
}

function context(sent: unknown[]) {
  return {
    client: {
      chipmate: {
        cloud: {
          session: {
            get: (_params: { id: string }, options?: { signal?: AbortSignal }) => stalled(options),
            import: (_params: { sessionId: string; directory: string }, options?: { signal?: AbortSignal }) =>
              stalled(options),
          },
        },
      },
    },
    currentSession: null,
    trackedSessionIds: new Set<string>(),
    connectionService: { recordMessageSessionId: () => undefined },
    postMessage: (message: unknown) => sent.push(message),
    getWorkspaceDirectory: () => "/repo",
    gatherEditorContext: async () => ({}),
  } as unknown as CloudSessionContext
}

describe("cloud session preview handler", () => {
  it("rejects import before touching the CLI when no model is selected", async () => {
    const sent: unknown[] = []
    await handleImportAndSend(context(sent), "cloud-session", "Continue")
    expect(sent).toEqual([
      {
        type: "cloudSessionImportFailed",
        cloudSessionId: "cloud-session",
        error: "Select a model before sending",
      },
      {
        type: "sendMessageFailed",
        error: "Select a model before sending",
        text: "Continue",
        sessionID: "cloud:cloud-session",
        messageID: undefined,
        files: undefined,
        review: undefined,
      },
    ])
  })

  it("reports a failure when the CLI preview request stalls", async () => {
    const timeout = AbortSignal.timeout
    AbortSignal.timeout = () => {
      const controller = new AbortController()
      queueMicrotask(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")))
      return controller.signal
    }

    try {
      const sent: unknown[] = []
      const outcome = await Promise.race([
        handleRequestCloudSessionData(context(sent), "cloud-session").then(() => "resolved" as const),
        Bun.sleep(50).then(() => "still-pending" as const),
      ])

      expect(outcome).toBe("resolved")
      expect(sent).toEqual([
        {
          type: "cloudSessionImportFailed",
          cloudSessionId: "cloud-session",
          error: "The operation timed out",
        },
      ])
    } finally {
      AbortSignal.timeout = timeout
    }
  })

  it("reports a failure when the CLI import request stalls", async () => {
    const timeout = AbortSignal.timeout
    AbortSignal.timeout = () => {
      const controller = new AbortController()
      queueMicrotask(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")))
      return controller.signal
    }

    try {
      const sent: unknown[] = []
      const outcome = await Promise.race([
        handleImportAndSend(context(sent), "cloud-session", "Continue", undefined, "openai", "gpt-4.1").then(
          () => "resolved" as const,
        ),
        Bun.sleep(50).then(() => "still-pending" as const),
      ])

      expect(outcome).toBe("resolved")
      expect(sent).toEqual([
        {
          type: "cloudSessionImportFailed",
          cloudSessionId: "cloud-session",
          error: "The operation timed out",
        },
        {
          type: "sendMessageFailed",
          error: "The operation timed out",
          text: "Continue",
          sessionID: "cloud:cloud-session",
          messageID: undefined,
          files: undefined,
          review: undefined,
        },
      ])
    } finally {
      AbortSignal.timeout = timeout
    }
  })

  it("returns an accepted terminal event after import and backend submission", async () => {
    const sent: unknown[] = []
    const value = context(sent) as unknown as {
      client: {
        chipmate: { cloud: { session: { import: () => Promise<{ data: unknown }> } } }
        session: { promptAsync: () => Promise<Record<string, never>> }
      }
    }
    value.client.chipmate.cloud.session.import = async () => ({
      data: {
        id: "local-session",
        slug: "local-session",
        title: "Imported",
        directory: "/repo",
        time: { created: Date.now(), updated: Date.now() },
      },
    })
    value.client.session = { promptAsync: async () => ({}) }

    await handleImportAndSend(
      value as unknown as CloudSessionContext,
      "cloud-session",
      "Continue",
      "message-1",
      "openai",
      "gpt-4.1",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      7,
    )

    expect(sent).toContainEqual({
      type: "sendMessageAccepted",
      messageID: "message-1",
      sessionID: "local-session",
      draftID: "cloud:cloud-session",
      revision: 7,
    })
  })
})
