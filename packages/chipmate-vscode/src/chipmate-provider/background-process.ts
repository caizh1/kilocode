import type { ChipMateClient } from "@chipmate/sdk/v2/client"

export async function stopSessionProcesses(
  client: ChipMateClient | null,
  sessionID: string,
  directory: string,
): Promise<void> {
  if (!client) return
  await client.backgroundProcess
    .stopSession({ sessionID, directory })
    .catch((err: unknown) => console.warn("[ChipMate New] ChipMateProvider: Failed to stop background processes:", err))
}
