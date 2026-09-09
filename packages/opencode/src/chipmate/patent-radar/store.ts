import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { PATENT_RADAR_METHOD_VERSION, PatentRadar } from "./types"

function root(directory: string) {
  const fingerprint = createHash("sha256").update(path.resolve(directory)).digest("hex")
  return path.join(Global.Path.data, "patent-radar", fingerprint)
}

export async function saveRun(run: PatentRadar.Run) {
  const dir = root(run.workspace)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const manifest =
    run.sources.length || !run.evidenceStore ? await saveEvidence(dir, run.id, run.sources) : run.evidenceStore
  await atomic(
    path.join(dir, `${run.id}.json`),
    `${JSON.stringify({ ...run, sources: [], evidenceStore: manifest }, null, 2)}\n`,
  )
  await atomic(path.join(dir, "latest"), `${run.id}\n`)
}

async function saveEvidence(dir: string, id: string, sources: PatentRadar.SourceEvidence[]) {
  const shards = []
  for (let index = 0; index < Math.max(1, Math.ceil(sources.length / 250)); index += 1) {
    const rows = sources.slice(index * 250, (index + 1) * 250)
    const file = `${id}.evidence.${String(index).padStart(4, "0")}.json`
    const bytes = Buffer.from(`${JSON.stringify(rows)}\n`)
    await atomic(path.join(dir, file), bytes)
    shards.push({
      file,
      count: rows.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      evidenceIds: rows.map((row) => row.id),
    })
  }
  return { count: sources.length, shards }
}

export async function loadRun(directory: string, id: string) {
  const value = JSON.parse(await readFile(path.join(root(directory), `${safe(id)}.json`), "utf8"))
  const run = migrate(value)
  if (!run.evidenceStore) return run
  const sources = await readEvidenceShards(directory, run, undefined)
  if (sources.length !== run.evidenceStore.count) throw new Error("Patent Radar 证据分片总数不一致")
  return { ...run, sources }
}

export async function loadEvidence(directory: string, id: string, evidenceIds: string[]) {
  const value = JSON.parse(await readFile(path.join(root(directory), `${safe(id)}.json`), "utf8"))
  const run = migrate(value)
  const requested = new Set(evidenceIds)
  if (!run.evidenceStore) return run.sources.filter((item) => requested.has(item.id))
  return (await readEvidenceShards(directory, run, requested)).filter((item) => requested.has(item.id))
}

async function readEvidenceShards(directory: string, run: PatentRadar.Run, requested: Set<string> | undefined) {
  if (!run.evidenceStore) return run.sources
  const sources: PatentRadar.SourceEvidence[] = []
  for (const shard of run.evidenceStore.shards) {
    if (requested && shard.evidenceIds && !shard.evidenceIds.some((id) => requested.has(id))) continue
    const bytes = await readFile(path.join(root(directory), safeFile(shard.file)))
    const hash = createHash("sha256").update(bytes).digest("hex")
    if (hash !== shard.sha256) throw new Error("Patent Radar 证据分片完整性校验失败")
    const rows = PatentRadar.SourceEvidence.array().parse(JSON.parse(bytes.toString("utf8")))
    if (rows.length !== shard.count) throw new Error("Patent Radar 证据分片数量不一致")
    sources.push(...rows)
  }
  return sources
}

export async function listRuns(directory: string) {
  const dir = root(directory)
  const names = await readdir(dir).catch(() => [])
  const output: PatentRadar.Run[] = []
  for (const name of names.filter((item) => item.endsWith(".json") && !item.includes(".evidence."))) {
    const value = await readFile(path.join(dir, name), "utf8")
      .then(JSON.parse)
      .catch(() => undefined)
    try {
      output.push(migrate(value))
    } catch {
      continue
    }
  }
  return output.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function listModules(directory: string) {
  const file = path.join(root(directory), "modules.json")
  const value = await readFile(file, "utf8").then(JSON.parse).catch(() => [])
  return PatentRadar.ModuleDefinition.array().parse(value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function saveModule(
  directory: string,
  input: {
    id?: string
    name: string
    corePaths: string[]
    expansionPolicy: "quality-first" | "balanced"
    autoScan?: boolean
  },
) {
  const modules = await listModules(directory)
  const now = new Date().toISOString()
  const existing = input.id ? modules.find((item) => item.id === safe(input.id!)) : undefined
  const module = PatentRadar.ModuleDefinition.parse({
    id: existing?.id ?? randomUUID(),
    name: input.name.trim(),
    corePaths: [...new Set(input.corePaths.map((item) => item.trim()).filter(Boolean))],
    expansionPolicy: input.expansionPolicy,
    autoScan: input.autoScan ?? existing?.autoScan ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  await atomic(
    path.join(root(directory), "modules.json"),
    `${JSON.stringify([module, ...modules.filter((item) => item.id !== module.id)], null, 2)}\n`,
  )
  return module
}

export async function deleteModule(directory: string, id: string) {
  const modules = await listModules(directory)
  const next = modules.filter((item) => item.id !== safe(id))
  if (next.length === modules.length) throw new Error("Patent Radar 模块不存在")
  await atomic(path.join(root(directory), "modules.json"), `${JSON.stringify(next, null, 2)}\n`)
  return { deleted: id }
}

export function workspaceFingerprint(directory: string) {
  return createHash("sha256").update(path.resolve(directory)).digest("hex")
}

export function exportRoot(directory: string, runId: string) {
  return path.join(root(directory), "exports", safe(runId))
}

async function atomic(file: string, content: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temp, "wx", 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

function safe(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Patent Radar 标识符格式无效")
  return value
}

function safeFile(value: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value) || value.includes("..")) throw new Error("Patent Radar 证据分片文件名无效")
  return value
}

export function migrate(value: unknown): PatentRadar.Run {
  const current = PatentRadar.Run.safeParse(value)
  if (current.success) {
    if (current.data.methodVersion === PATENT_RADAR_METHOD_VERSION) return current.data
    return {
      ...current.data,
      status: current.data.status === "FAILED" ? "FAILED" : "STALE",
      candidates: current.data.candidates.map((candidate) =>
        candidate.discoveryTier === "review-ready"
          ? { ...candidate, discoveryTier: "technical-candidate" as const }
          : candidate,
      ),
      warnings: [
        ...current.data.warnings,
        `Patent Radar 方法版本已从 ${current.data.methodVersion} 更新为 ${PATENT_RADAR_METHOD_VERSION}，请重新扫描。`,
      ],
    }
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    throw current.error
  }
  const legacy = value as Record<string, unknown>
  const progress = legacy.progress as Record<string, unknown> | undefined
  const phase =
    progress?.phase === "workspace-scan"
      ? "workspace-scan"
      : progress?.phase === "complete"
        ? "complete"
        : "mechanism-distillation"
  const migrated = {
    ...legacy,
    schemaVersion: 2,
    methodVersion: PATENT_RADAR_METHOD_VERSION,
    coverage: null,
    mechanisms: [],
    relations: [],
    bridgeCandidates: [],
    bridgeBatches: {},
    verificationBatches: {},
    researchBatches: {},
    discoveryCheckpoints: {},
    tokenUsage: { input: 0, output: 0, calls: 0, estimated: true },
    rankingPolicy: { mode: "fused-rrf", rerank: "off" },
    evidenceStore: null,
    qualityGate: {
      mode: "experimental",
      goldSetValidated: false,
      reasons: ["v1 运行记录仅保留为兼容数据，方法版本变化后需要重新扫描。"],
    },
    status: legacy.status === "FAILED" ? "FAILED" : "STALE",
    warnings: [
      ...(Array.isArray(legacy.warnings) ? legacy.warnings : []),
      "v1 运行记录已迁移为 v2，并因方法版本变化标记 STALE。",
    ],
    candidates: Array.isArray(legacy.candidates)
      ? legacy.candidates.map((candidate) => ({
          ...(candidate as object),
          discoveryTier: "observation",
          origin: "local",
          groundingStatus: "pending",
        }))
      : [],
    ...(progress
      ? {
          progress: {
            ...progress,
            phase,
            events: Array.isArray(progress.events)
              ? progress.events.map((event) => ({
                  ...(event as object),
                  phase:
                    (event as { phase?: string }).phase === "workspace-scan"
                      ? "workspace-scan"
                      : (event as { phase?: string }).phase === "complete"
                        ? "complete"
                        : "mechanism-distillation",
                }))
              : [],
          },
        }
      : {}),
  }
  return PatentRadar.Run.parse(migrated)
}

export { atomic }
