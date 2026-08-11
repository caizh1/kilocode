import type { ChipMateClient } from "@chipmate/sdk/v2/client"

export async function hasGit(client: ChipMateClient, directory: string): Promise<boolean> {
  return client.project
    .current({ directory })
    .then((r) => r.data?.vcs === "git")
    .catch(() => false)
}
