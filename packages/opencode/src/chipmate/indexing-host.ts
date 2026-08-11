import {
  CodeIndexAnalysisService,
  CodeIndexManager,
  disabledCodeGraphSidecarStatus,
} from "@chipmate/chipmate-indexing/engine"
import { normalizeIndexingStatus } from "@chipmate/chipmate-indexing/status"
import type { Event, Request, Result } from "./indexing-worker-protocol"
import type { IndexingPressure } from "./indexing-memory"

export function createIndexingHost(send: (message: Result | Event) => void) {
  let manager: CodeIndexManager | undefined
  let mode: IndexingPressure = "normal"
  let progress: { dispose(): void } | undefined
  let telemetry: { dispose(): void } | undefined

  const dispose = async () => {
    progress?.dispose()
    telemetry?.dispose()
    progress = undefined
    telemetry = undefined
    await manager?.checkpoint()
    await manager?.dispose()
    manager = undefined
  }

  const checkpoint = async () => {
    await manager?.checkpoint()
  }

  const init = async (request: Extract<Request, { method: "init" }>) => {
    await dispose()
    if (request.input.lancedbPath) process.env.CHIPMATE_LANCEDB_PATH = request.input.lancedbPath
    const next = new CodeIndexManager(request.input.directory, request.input.root, request.input.baselineDirectory)
    manager = next
    next.setMemoryPressure(mode)
    progress = next.onProgressUpdate.on(() => {
      send({ type: "event", event: "status", data: normalizeIndexingStatus(next) })
    })
    telemetry = next.onTelemetry.on((data) => {
      send({ type: "event", event: "telemetry", data })
    })
    await next.initialize(request.input.config)
    send({ type: "result", id: request.id, method: "init", ok: true, value: normalizeIndexingStatus(next) })
  }

  const handle = async (request: Request) => {
    try {
      if (request.method === "dispose") {
        await dispose()
        send({ type: "result", id: request.id, method: "dispose", ok: true, value: undefined })
        return
      }

      if (request.method === "search") {
        const value = manager ? await manager.searchIndex(request.input.query, request.input.directoryPrefix) : []
        send({ type: "result", id: request.id, method: "search", ok: true, value })
        return
      }

      if (request.method === "documentSearch") {
        const { query, ...options } = request.input
        const value = manager ? await manager.searchDocuments(query, options) : []
        send({ type: "result", id: request.id, method: "documentSearch", ok: true, value })
        return
      }

      if (request.method === "rebuildDocuments") {
        if (!manager) throw new Error("Indexing process is not initialized.")
        await manager.rebuildDocuments()
        send({
          type: "result",
          id: request.id,
          method: "rebuildDocuments",
          ok: true,
          value: normalizeIndexingStatus(manager),
        })
        return
      }

      if (request.method === "updateConfig") {
        if (!manager) throw new Error("Indexing process is not initialized.")
        await manager.handleSettingsChange(request.input)
        send({
          type: "result",
          id: request.id,
          method: "updateConfig",
          ok: true,
          value: normalizeIndexingStatus(manager),
        })
        return
      }

      if (request.method === "queryEvidence") {
        const { query, ...options } = request.input
        const value = manager
          ? await manager.queryEvidence(query, options)
          : await new CodeIndexAnalysisService().queryEvidence(query, options, { reason: "indexing-not-initialized" })
        send({ type: "result", id: request.id, method: "queryEvidence", ok: true, value })
        return
      }

      if (request.method === "codeGraphStatus") {
        const value = manager
          ? manager.getCodeGraphStatus()
          : disabledCodeGraphSidecarStatus({ reason: "indexing-not-initialized" })
        send({ type: "result", id: request.id, method: "codeGraphStatus", ok: true, value })
        return
      }

      await init(request)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      send({ type: "result", id: request.id, method: request.method, ok: false, error })
    }
  }

  const pressure = (value: IndexingPressure) => {
    mode = value
    manager?.setMemoryPressure(value)
  }

  return { handle, dispose, checkpoint, pressure }
}
