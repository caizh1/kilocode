import type { Message, Session, Part, SnapshotFileDiff, SessionStatus, Provider } from "@chipmate/sdk/v2"
import { createSimpleContext } from "./helper"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

export type NormalizedProviderListResponse = {
  all: Map<string, Provider>
  default: {
    [key: string]: string
  }
  connected: Array<string>
}

type Data = {
  agent?: {
    name: string
    color?: string
  }[]
  provider?: NormalizedProviderListResponse
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: SnapshotFileDiff[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<any>[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
  part_text_accum_delta?: {
    [partID: string]: string
  }
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

// chipmate_change start
export type OpenFileFn = (filePath: string, line?: number, column?: number) => void

export type OpenDiffFn = (diff: {
  file: string
  before?: string // chipmate_change - optional, chipmate uses `patch`
  after?: string // chipmate_change - optional, chipmate uses `patch`
  patch?: string // chipmate_change
  additions: number
  deletions: number
}) => void

export type OpenUrlFn = (url: string) => void

export type OpenContentFn = (content: string, language?: string) => void // chipmate_change

export type ValidateFilesFn = (paths: string[]) => Promise<string[]> // chipmate_change
// chipmate_change end

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onOpenFile?: OpenFileFn // chipmate_change
    onOpenDiff?: OpenDiffFn // chipmate_change
    onOpenUrl?: OpenUrlFn // chipmate_change
    onOpenContent?: OpenContentFn // chipmate_change
    onValidateFiles?: ValidateFilesFn // chipmate_change
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      openFile: props.onOpenFile, // chipmate_change
      openDiff: props.onOpenDiff, // chipmate_change
      openUrl: props.onOpenUrl, // chipmate_change
      openContent: props.onOpenContent, // chipmate_change
      validateFiles: props.onValidateFiles, // chipmate_change
    }
  },
})
