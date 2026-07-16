import type { MarketplaceUploadPayload, PublicationRun } from "./types"

export type PublicationPhase = "preparing" | "submitting" | "complete"

export interface PublicationOutcome {
  payload: MarketplaceUploadPayload
  run?: PublicationRun
}

type Report = (phase: PublicationPhase, status?: PublicationRun["status"]) => void

interface Flow {
  progress(task: (report: Report) => Promise<PublicationOutcome>): PromiseLike<PublicationOutcome>
  build(): Promise<MarketplaceUploadPayload>
  submit(payload: MarketplaceUploadPayload): Promise<PublicationRun | void>
  finish(outcome: PublicationOutcome): Promise<void>
}

export async function publish(flow: Flow): Promise<void> {
  const outcome = await flow.progress(async (report) => {
    report("preparing")
    const payload = await flow.build()
    report("submitting")
    const run = await flow.submit(payload)
    report("complete", run?.status)
    return { payload, ...(run ? { run } : {}) }
  })
  await flow.finish(outcome)
}
