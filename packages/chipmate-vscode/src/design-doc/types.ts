import type {
  DesignDocArtifact,
  DesignDocJob,
  DesignDocModelReference,
} from "@chipmate/sdk/v2/client"

export type DesignDocArtifactType = DesignDocJob["config"]["artifactTypes"][number]

export type DesignDocInMessage =
  | { type: "designDoc.ready" }
  | { type: "designDoc.refresh" }
  | { type: "designDoc.chooseTarget" }
  | {
      type: "designDoc.create"
      workspace: string
      targetPath: string
      artifactTypes: DesignDocArtifactType[]
      documentProfile: "artifact-set" | "source-backed-full"
      outputFormats: Array<"markdown" | "docx">
      recursive: boolean
      concurrency: number
      model: DesignDocModelReference
      maxAttempts: number
    }
  | { type: "designDoc.selectJob"; jobID: string }
  | { type: "designDoc.pause"; jobID: string }
  | { type: "designDoc.resume"; jobID: string }
  | { type: "designDoc.cancel"; jobID: string }
  | { type: "designDoc.retry"; jobID: string; workItemID: string; model?: DesignDocModelReference }
  | { type: "designDoc.openArtifact"; jobID: string; artifactID: string }

export interface DesignDocPanelState {
  workspace?: string
  targetPath?: string
  jobs: DesignDocJob[]
  selectedJobID?: string
  selectedJob?: DesignDocJob
  modules: Array<{ id: string; name: string; path: string; parentID?: string }>
  artifacts: DesignDocArtifact[]
  preview?: {
    artifact: DesignDocArtifact
    encoding: "utf8" | "base64"
    content: string
  }
  loading: boolean
  error?: string
}

export type DesignDocOutMessage =
  | { type: "designDoc.state"; state: DesignDocPanelState }
  | { type: "designDoc.error"; message: string }

export function isDesignDocInMessage(value: unknown): value is DesignDocInMessage {
  return !!value && typeof value === "object" && "type" in value && typeof value.type === "string" && value.type.startsWith("designDoc.")
}
