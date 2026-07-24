import type { BatchPublicationItem, PublicationRun } from "./types"

interface Target {
  id: string
  name: string
}

type Submit<T extends Target> = (item: T) => Promise<PublicationRun | void>
type Progress<T extends Target> = (item: T, current: number, total: number) => void

export function publicationState(run?: PublicationRun): BatchPublicationItem["state"] {
  if (!run || run.status === "PUBLISHED") return "published"
  if (run.status === "UNCHANGED") return "unchanged"
  return "attention"
}

export async function publishBatch<T extends Target>(
  items: readonly T[],
  submit: Submit<T>,
  progress?: Progress<T>,
): Promise<BatchPublicationItem[]> {
  const results: BatchPublicationItem[] = []
  for (const [index, item] of items.entries()) {
    progress?.(item, index + 1, items.length)
    const result = await submit(item)
      .then((run) => ({
        id: item.id,
        name: item.name,
        state: publicationState(run ?? undefined),
        ...(run ? { run } : {}),
      }))
      .catch((err: unknown) => ({
        id: item.id,
        name: item.name,
        state: "failed" as const,
        error: err instanceof Error ? err.message : String(err),
      }))
    results.push(result)
  }
  return results
}
