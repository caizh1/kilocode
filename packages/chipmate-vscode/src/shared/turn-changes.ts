import type { TurnChangesGetResponse } from "@chipmate/sdk/v2/client"

export type TurnChangesResult = TurnChangesGetResponse
export type TurnChangesSummary = NonNullable<TurnChangesResult["summary"]>
export type TurnChangesDetail = NonNullable<TurnChangesResult["detail"]>
type Target = { sessionID: string; messageID: string; requestID: string }
export type TurnChangesRequest = Target &
  (
    | { type: "turnChangesRequest"; fileID?: string }
    | { type: "turnChangesMutate"; revision: number; action: "revert" | "restore"; fileID?: string; hunkID?: string }
  )
export type TurnChangesMessage =
  | (Target & { type: "turnChangesResult"; result: TurnChangesResult })
  | { type: "turnChangesUpdated"; sessionID: string; messageID: string }
