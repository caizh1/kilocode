import { Emitter } from "./runtime"
import type { IndexingNotice } from "./interfaces/manager"

export type IndexingState = "Standby" | "Indexing" | "Indexed" | "Error"
export type IndexingActivePipeline = "codeGraph" | "rag" | "documents"

export type IndexingPipelineProgress = {
  state: IndexingState
  message: string
  processedFiles: number
  totalFiles: number
  percent: number
}

export class CodeIndexStateManager {
  private _systemStatus: IndexingState = "Standby"
  private _statusMessage = ""
  private _processedFiles = 0
  private _totalFiles = 0
  private _percent = 0
  private _activePipeline?: IndexingActivePipeline
  private _codeGraphProgress?: IndexingPipelineProgress
  private _notices: IndexingNotice[] = []
  private _gitBranch?: string
  private _manifest?: {
    totalFiles: number
    totalChunks: number
    lastUpdated: string
  }
  private _progressEmitter = new Emitter<ReturnType<typeof this.getCurrentStatus>>()

  public readonly onProgressUpdate = this._progressEmitter

  public get state(): IndexingState {
    return this._systemStatus
  }

  public getCurrentStatus() {
    return {
      systemStatus: this._systemStatus,
      message: this._statusMessage,
      processedItems: this._processedFiles,
      totalItems: this._totalFiles,
      currentItemUnit: "files",
      percent: this._percent,
      activePipeline: this._activePipeline,
      notices: this._notices.slice(),
      gitBranch: this._gitBranch,
      manifest: this._manifest,
    }
  }

  public getCodeGraphProgress(): IndexingPipelineProgress | undefined {
    return this._codeGraphProgress
  }

  public setSystemState(
    newState: IndexingState,
    message?: string,
    manifest?: {
      totalFiles: number
      totalChunks: number
      lastUpdated: string
    },
    gitBranch?: string,
  ): void {
    const stateChanged = newState !== this._systemStatus || (message !== undefined && message !== this._statusMessage)
    const graphChanged = newState !== "Indexing" && this._codeGraphProgress !== undefined

    if (!stateChanged && !graphChanged) return

    this._systemStatus = newState
    if (message !== undefined) this._statusMessage = message
    if (manifest !== undefined) this._manifest = manifest
    if (gitBranch !== undefined) this._gitBranch = gitBranch
    if (graphChanged) this._codeGraphProgress = undefined

    if (newState !== "Indexing") {
      this._activePipeline = undefined
      this._percent = newState === "Indexed" ? 100 : 0
      if (newState === "Standby" && message === undefined) this._statusMessage = "Ready."
      if (newState === "Indexed" && message === undefined) this._statusMessage = "Index up-to-date."
      if (newState === "Error" && message === undefined) this._statusMessage = "An error occurred."
    }

    if (newState !== "Indexed") {
      this._manifest = undefined
    }

    this._progressEmitter.fire(this.getCurrentStatus())
  }

  public setActivePipeline(pipeline?: IndexingActivePipeline): void {
    if (pipeline === this._activePipeline) return
    this._activePipeline = pipeline
    this._progressEmitter.fire(this.getCurrentStatus())
  }

  public notify(): void {
    this._progressEmitter.fire(this.getCurrentStatus())
  }

  public clearCodeGraphProgress(): void {
    if (!this._codeGraphProgress) return
    this._codeGraphProgress = undefined
    this._progressEmitter.fire(this.getCurrentStatus())
  }

  public upsertNotice(notice: IndexingNotice): void {
    const index = this._notices.findIndex((item) => item.id === notice.id)
    if (index >= 0 && JSON.stringify(this._notices[index]) === JSON.stringify(notice)) return
    if (index >= 0) {
      this._notices[index] = notice
    } else {
      this._notices.unshift(notice)
    }
    this._notices.splice(5)
    this._progressEmitter.fire(this.getCurrentStatus())
  }

  public removeNotice(id: string): void {
    const notices = this._notices.filter((notice) => notice.id !== id)
    if (notices.length === this._notices.length) return
    this._notices = notices
    this._progressEmitter.fire(this.getCurrentStatus())
  }

  public reportFileProgress(processedFiles: number, totalFiles: number, currentFileBasename?: string): void {
    const percent = totalFiles > 0 ? Math.min(100, Math.round((processedFiles / totalFiles) * 100)) : 0
    const progressChanged =
      processedFiles !== this._processedFiles || totalFiles !== this._totalFiles || percent !== this._percent

    if (!progressChanged && this._systemStatus === "Indexing") return

    this._processedFiles = processedFiles
    this._totalFiles = totalFiles
    this._percent = percent

    const message =
      totalFiles > 0
        ? `Processed ${processedFiles} / ${totalFiles} files (${percent}%).${currentFileBasename ? ` Current: ${currentFileBasename}` : ""}`
        : "Indexing files..."
    const oldStatus = this._systemStatus
    const oldMessage = this._statusMessage

    this._systemStatus = "Indexing"
    this._statusMessage = message

    if (oldStatus !== this._systemStatus || oldMessage !== this._statusMessage || progressChanged) {
      this._progressEmitter.fire(this.getCurrentStatus())
    }
  }

  public reportFileQueueProgress(processedFiles: number, totalFiles: number, currentFileBasename?: string): void {
    this.reportFileProgress(processedFiles, totalFiles, currentFileBasename)
  }

  public reportCodeGraphProgress(processedFiles: number, totalFiles: number, currentFileBasename?: string): void {
    const percent = totalFiles > 0 ? Math.min(100, Math.round((processedFiles / totalFiles) * 100)) : 0
    const message =
      totalFiles > 0
        ? `Built ${processedFiles} / ${totalFiles} code graph files (${percent}%).${currentFileBasename ? ` Current: ${currentFileBasename}` : ""}`
        : "Code Graph waiting for C/C++ files."
    const next: IndexingPipelineProgress = {
      state: totalFiles > 0 ? "Indexing" : "Standby",
      message,
      processedFiles,
      totalFiles,
      percent,
    }
    const prev = this._codeGraphProgress
    const changed =
      !prev ||
      prev.state !== next.state ||
      prev.message !== next.message ||
      prev.processedFiles !== next.processedFiles ||
      prev.totalFiles !== next.totalFiles ||
      prev.percent !== next.percent

    if (!changed) return

    this._codeGraphProgress = next
    this._progressEmitter.fire(this.getCurrentStatus())
  }

  public dispose(): void {
    this._progressEmitter.dispose()
  }
}
