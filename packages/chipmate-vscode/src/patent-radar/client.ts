import type { ChipMateConnectionService } from "../services/cli-backend"
import { isPatentRadarRun, type PatentRadarRun } from "./types"
import type { PatentCenterModelSelection } from "../shared/patent-center"

export type PatentRadarScope =
  | { kind: "workspace" }
  | {
      kind: "module"
      moduleId?: string
      name?: string
      corePaths: string[]
      expansionPolicy: "quality-first" | "balanced"
    }

export interface PatentRadarModule {
  id: string
  name: string
  corePaths: string[]
  expansionPolicy: "quality-first" | "balanced"
  autoScan: boolean
  createdAt: string
  updatedAt: string
}

export class PatentRadarClient {
  constructor(private readonly connection: ChipMateConnectionService) {}

  async scan(
    directory: string,
    cutoffDate: string,
    serverBaseUrl: string | undefined,
    analysisModel?: PatentCenterModelSelection,
    scope: PatentRadarScope = { kind: "workspace" },
    confirmLargeClosure = false,
  ) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.scan({
      directory,
      cutoffDate,
      serverBaseUrl,
      analysisModel,
      scope,
      confirmLargeClosure,
    })
    return run(response.data, response.error)
  }

  async list(directory: string) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.list({ directory })
    if (response.error) throw new Error(patentRadarErrorMessage(response.error))
    if (!Array.isArray(response.data)) throw new Error("Patent Radar 返回的运行列表无效")
    return response.data.filter(isPatentRadarRun)
  }

  async previewScope(directory: string, scope: PatentRadarScope) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.previewScope({ directory, body: scope })
    if (response.error) throw new Error(patentRadarErrorMessage(response.error))
    return response.data as {
      scope: PatentRadarScope
      scopeFingerprint: string
      coverage: {
        coreFiles: string[]
        dependencyFiles: string[]
        documentFiles: string[]
        supportingFiles: string[]
        selectedEvidence: number
        workspaceEvidence: number
        workspacePercent: number
        closureComplete: boolean
        requiresConfirmation: boolean
        excludedBoundaries: Array<{ relationId: string; fromFile: string; toFile: string; reason: string }>
        warnings: string[]
      }
      estimatedModelCalls: number
    }
  }

  async listModules(directory: string) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.listModules({ directory })
    if (response.error) throw new Error(patentRadarErrorMessage(response.error))
    if (!Array.isArray(response.data)) throw new Error("Patent Radar 返回的模块列表无效")
    return response.data as PatentRadarModule[]
  }

  async saveModule(
    directory: string,
    input: Omit<PatentRadarModule, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.saveModule({ directory, ...input })
    if (response.error) throw new Error(patentRadarErrorMessage(response.error))
    return response.data as PatentRadarModule
  }

  async deleteModule(directory: string, moduleId: string) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.deleteModule({ directory, moduleID: moduleId })
    if (response.error) throw new Error(patentRadarErrorMessage(response.error))
  }

  async get(directory: string, runId: string) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.get({ directory, runID: runId })
    const value = run(response.data, response.error)
    const evidenceIds = [...new Set(value.candidates.flatMap((candidate) => candidate.evidenceIds))]
    if (!evidenceIds.length) return value
    const sources: PatentRadarRun["sources"] = []
    for (const batch of patentRadarEvidenceBatches(evidenceIds)) {
      const evidence = await client.patentRadar.evidence({ directory, runID: runId, evidenceIds: batch })
      if (evidence.error || !Array.isArray(evidence.data))
        throw new Error(patentRadarErrorMessage(evidence.error ?? "Patent Radar 证据响应无效"))
      sources.push(...(evidence.data as PatentRadarRun["sources"]))
    }
    return { ...value, sources }
  }

  async cancel(directory: string, runId: string) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.cancel({ directory, runID: runId })
    return run(response.data, response.error)
  }

  async resume(directory: string, runId: string) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.resume({ directory, runID: runId })
    return run(response.data, response.error)
  }

  async research(directory: string, runId: string, serverBaseUrl?: string) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.research({ directory, runID: runId, serverBaseUrl })
    return run(response.data, response.error)
  }

  async review(
    directory: string,
    runId: string,
    input: { candidateId: string; reviewer: string; decision: "worthy" | "reject" | "needs-arbitration"; note: string },
  ) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.review({ directory, runID: runId, ...input })
    return run(response.data, response.error)
  }

  async importReviews(
    directory: string,
    runId: string,
    input: {
      schemaVersion: 2
      runId: string
      sourceFingerprint: string
      methodVersion: string
      reviews: Array<{
        candidateId: string
        reviewer: string
        decision: "worthy" | "reject" | "needs-arbitration"
        note: string
      }>
    },
  ) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.importReviews({ directory, runID: runId, ...input })
    return run(response.data, response.error)
  }

  async export(directory: string, runId: string) {
    const client = await this.connection.getClientAsync(directory)
    const response = await client.patentRadar.export({ directory, runID: runId })
    if (response.error) throw new Error(patentRadarErrorMessage(response.error))
    const value = response.data as { root?: unknown; files?: unknown }
    if (!value || typeof value.root !== "string" || !Array.isArray(value.files))
      throw new Error("Patent Radar 导出响应无效")
    return value as { root: string; files: Array<{ path: string; size: number; sha256: string }> }
  }
}

export function patentRadarEvidenceBatches(evidenceIds: string[]) {
  return Array.from({ length: Math.ceil(evidenceIds.length / 200) }, (_value, index) =>
    evidenceIds.slice(index * 200, (index + 1) * 200),
  )
}

function run(data: unknown, error: unknown): PatentRadarRun {
  if (error) throw new Error(patentRadarErrorMessage(error))
  if (!isPatentRadarRun(data)) throw new Error("Patent Radar 返回的运行记录无效")
  return data
}

export function patentRadarErrorMessage(value: unknown, seen = new Set<object>()): string {
  if (value instanceof Error && value.message.trim()) return value.message
  if (typeof value === "string" && value.trim()) return value
  if (!value || typeof value !== "object") return String(value ?? "Patent Radar 请求失败")
  if (seen.has(value)) return "Patent Radar 请求失败"
  seen.add(value)

  const item = value as Record<string, unknown>
  for (const key of ["message", "error", "detail", "cause"] as const) {
    if (!(key in item)) continue
    const message = patentRadarErrorMessage(item[key], seen)
    if (message && message !== "Patent Radar 请求失败") return message
  }
  if (typeof item._tag === "string" && item._tag.trim()) return `请求失败（${item._tag}）`
  try {
    const serialized = JSON.stringify(value)
    if (serialized && serialized !== "{}") return serialized
  } catch {
    return "Patent Radar 请求失败"
  }
  return "Patent Radar 请求失败"
}
