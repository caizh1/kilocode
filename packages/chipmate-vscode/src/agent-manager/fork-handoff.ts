import type { ChipMateClient } from "@chipmate/sdk/v2/client"

export interface ForkHandoffInput {
  client: ChipMateClient
  sessionId: string
  directory?: string
  operationID?: string
}

export function forkText(input: Pick<ForkHandoffInput, "directory">): string {
  return [
    "<system-reminder>",
    "This session was forked from an existing session in the current repository or worktree.",
    ...(input.directory
      ? [
          `Use this as the current working directory: ${input.directory}`,
          "For this fork, this location supersedes any earlier repository or worktree location retained in the copied context.",
        ]
      : []),
    "The prior conversation context was retained intentionally.",
    "The user may continue the same task, explore an alternative approach, or provide new instructions.",
    "Follow the user's next instruction as the direction for this fork, using retained context when relevant.",
    "</system-reminder>",
  ].join("\n")
}

export async function recordForkHandoff(input: ForkHandoffInput): Promise<void> {
  if (input.operationID) {
    const existing = await input.client.session.messages(
      { sessionID: input.sessionId, ...(input.directory ? { directory: input.directory } : {}) },
      { throwOnError: true },
    )
    const found = existing.data.some((message) =>
      message.parts.some(
        (part) =>
          "metadata" in part && part.metadata?.["chipmate.forkOperationID"] === input.operationID,
      ),
    )
    if (found) return
  }
  const payload = {
    sessionID: input.sessionId,
    ...(input.directory ? { directory: input.directory } : {}),
    noReply: true,
    parts: [
      {
        type: "text",
        text: forkText(input),
        synthetic: true,
        ...(input.operationID ? { metadata: { "chipmate.forkOperationID": input.operationID } } : {}),
      },
    ],
  } as Parameters<ChipMateClient["session"]["promptAsync"]>[0]

  await input.client.session.promptAsync(payload, { throwOnError: true })
}
