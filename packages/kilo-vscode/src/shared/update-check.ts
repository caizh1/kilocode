export const CHIPMATE_UPDATE_TARGETS = [
  "win32-x64-baseline",
  "linux-x64-baseline",
  "darwin-x64",
  "darwin-arm64",
] as const

export type ChipmateUpdateTarget = (typeof CHIPMATE_UPDATE_TARGETS)[number]

export type ChipmateUpdateResult =
  | {
      status: "latest"
      currentVersion: string
      checkedAt: number
      target: ChipmateUpdateTarget
    }
  | {
      status: "available"
      candidateId: string
      currentVersion: string
      version: string
      target: ChipmateUpdateTarget
      releaseNotes?: string
      publishedAt?: string
    }
  | {
      status: "installed"
      version: string
    }
  | {
      status: "error"
      code: string
      message: string
      retryable: boolean
    }
