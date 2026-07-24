import fs from "node:fs/promises"
import path from "node:path"

type Unit = {
  id: string
  name: string
  kind: "target" | "confirmed-submodule"
  parentId?: string
}

type Census = {
  version: 1
  targetDesignUnitId: string
  targetSourceRoot?: string
  designUnits: Unit[]
  implementationUnits?: Array<{
    path?: string
    disposition?: string
    designUnitId?: string | null
    exclusion?: {
      reason?: string
      ownerDesignUnitId?: string
    }
  }>
}

type Topic = {
  status: "PASS" | "N/A"
  body: string
}

type Claim = {
  version: 1
  diagramId: string
  diagramType: string
  designUnitId?: string
  splitFromDiagramId?: string
}

type Result = {
  complete: boolean
  items: Array<{
    diagramId: string
    rendered: boolean
    semanticStatus: string
    pngPath?: string
    documentReady: boolean
  }>
}

type Prose = {
  root: string
  census?: Census
  topics: Map<string, Map<number, Topic>>
  issues: string[]
}

const VIEWS = new Set(["architecture", "business-flow", "code-flow", "state-machine", "data-lifecycle"])

export async function prose(workspace: string, input: string): Promise<Prose> {
  const root = await secure(workspace, input)
  const issues: string[] = []
  const topics = new Map<string, Map<number, Topic>>()
  const census = await read<Census>(path.join(root, "02-source-evidence", "design-unit-census.json")).catch((err) => {
    issues.push(`cannot read frozen design-unit census: ${message(err)}`)
    return undefined
  })
  if (!census) return { root, topics, issues }
  if (census.version !== 1 || !Array.isArray(census.designUnits) || !census.designUnits.length) {
    issues.push("design-unit census must be version 1 with at least one design unit")
    return { root, census, topics, issues }
  }
  const ids = new Set<string>()
  for (const unit of census.designUnits) {
    if (!unit?.id?.trim() || ids.has(unit.id)) {
      issues.push(`invalid or duplicate design unit ID: ${String(unit?.id ?? "(missing)")}`)
      continue
    }
    ids.add(unit.id)
    const file = path.join(root, "05-enhanced-detail-design", "units", `${unit.id}.md`)
    const text = await fs.readFile(file, "utf8").catch((err) => {
      issues.push(`missing unit prose ${unit.id}: ${message(err)}`)
      return ""
    })
    if (!text) continue
    const parsed = parse(text, unit.id, issues)
    topics.set(unit.id, parsed)
  }
  if (!ids.has(census.targetDesignUnitId)) issues.push("targetDesignUnitId is absent from designUnits")
  implementations(census, ids, issues)
  return { root, census, topics, issues }
}

export async function figures(workspace: string, input: string, state?: Prose) {
  const ready = state ?? (await prose(workspace, input))
  const issues = [...ready.issues]
  if (!ready.census || ready.issues.length) return { ...ready, issues }
  const files = await walk(ready.root)
  const claims = new Map<string, Claim>()
  const slots = new Map<string, string[]>()
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const value = await read<unknown>(file).catch(() => undefined)
    if (!claim(value)) continue
    if (!value.designUnitId || !ready.topics.has(value.designUnitId)) {
      issues.push(`claim ${value.diagramId} has an unknown or missing designUnitId`)
      continue
    }
    if (!VIEWS.has(value.diagramType)) {
      issues.push(`claim ${value.diagramId} uses unsupported diagramType ${value.diagramType}`)
      continue
    }
    if (claims.has(value.diagramId)) {
      issues.push(`duplicate Diagram ID ${value.diagramId}`)
      continue
    }
    claims.set(value.diagramId, value)
    if (value.splitFromDiagramId) continue
    const key = `${value.designUnitId}:${value.diagramType}`
    slots.set(key, [...(slots.get(key) ?? []), value.diagramId])
  }
  const results = new Map<string, Result["items"][number]>()
  for (const file of files.filter((item) => item.endsWith(".results.json"))) {
    const value = await read<unknown>(file).catch(() => undefined)
    if (!result(value)) continue
    for (const item of value.items) {
      if (!item.rendered || !item.documentReady || !["valid", "valid-with-unknowns"].includes(item.semanticStatus)) {
        continue
      }
      if (results.has(item.diagramId)) {
        issues.push(`duplicate terminal result for Diagram ID ${item.diagramId}`)
        continue
      }
      results.set(item.diagramId, item)
    }
  }
  for (const unit of ready.census.designUnits) {
    const topics = ready.topics.get(unit.id)
    if (!topics) continue
    const views = ["architecture", "business-flow", "code-flow", "data-lifecycle"]
    if (topics.get(8)?.status !== "N/A") views.push("state-machine")
    for (const view of views) {
      const key = `${unit.id}:${view}`
      const ids = slots.get(key) ?? []
      if (ids.length !== 1) {
        issues.push(`${key} requires exactly one primary claim; found ${ids.length}`)
        continue
      }
      const item = results.get(ids[0]!)
      if (!item || !item.rendered || !item.documentReady || !["valid", "valid-with-unknowns"].includes(item.semanticStatus)) {
        issues.push(`${key} has no semantically valid, readable rendered PNG`)
        continue
      }
      if (!item.pngPath || !(await png(workspace, item.pngPath))) issues.push(`${key} has a missing or invalid PNG`)
    }
    if (topics.get(8)?.status === "N/A" && (slots.get(`${unit.id}:state-machine`)?.length ?? 0) > 0) {
      issues.push(`${unit.id}:state-machine is evidenced N/A but has a primary claim`)
    }
  }
  for (const name of ["resume-state.md", "review-notes.md"]) {
    if (!(await regular(path.join(ready.root, name)))) issues.push(`missing required checkpoint file ${name}`)
  }
  return { ...ready, issues, claims, results }
}

function parse(text: string, unit: string, issues: string[]) {
  const lines = text.split(/\r?\n/)
  const topics = new Map<number, Topic>()
  const headings: Array<{ topic: number; index: number }> = []
  for (const [index, line] of lines.entries()) {
    const found = /^####\s+(?:主题\s*)?(0?[1-9]|1[0-4])(?:[.、：:\s]|$)/.exec(line.trim())
    if (found) headings.push({ topic: Number(found[1]), index })
  }
  for (let topic = 1; topic <= 14; topic++) {
    const matches = headings.filter((item) => item.topic === topic)
    if (matches.length !== 1) {
      issues.push(`${unit} topic ${topic} requires one separate H4 heading; found ${matches.length}`)
      continue
    }
    const start = matches[0]!.index
    const end = headings.find((item) => item.index > start)?.index ?? lines.length
    const block = lines.slice(start + 1, end)
    const offset = block.findIndex((line) => line.trim())
    const marker = offset < 0 ? undefined : /^SBDD-TOPIC-STATUS:\s*(0?[1-9]|1[0-4])\s*\|\s*(PASS|N\/A)\s*\|\s*(.+)\s*$/.exec(block[offset]!.trim())
    if (!marker || Number(marker[1]) !== topic) {
      issues.push(`${unit} topic ${topic} must place its exact PASS/N/A marker immediately after the heading`)
      continue
    }
    const status = marker[2] as Topic["status"]
    if (topic !== 8 && status !== "PASS") issues.push(`${unit} topic ${topic} cannot be N/A`)
    const body = block
      .slice(offset + 1)
      .filter((line) => {
        const value = line.trim()
        return value && !value.startsWith("|") && !/^[-*+]\s/.test(value) && !/^\d+[.)]\s/.test(value)
      })
      .join("\n")
      .trim()
    if (!body) issues.push(`${unit} topic ${topic} lacks explanatory prose`)
    topics.set(topic, { status, body })
  }
  if (topics.size !== 14) issues.push(`${unit} has ${topics.size}/14 structurally complete topics`)
  if (/SBDD-TOPIC-STATUS:\s*\d+\s*[-–]\s*\d+/.test(text)) issues.push(`${unit} combines topic status ranges`)
  if (/\b(?:MISSING|PARTIAL)\b/.test(text)) issues.push(`${unit} contains MISSING/PARTIAL content`)
  return topics
}

async function secure(workspace: string, input: string) {
  const root = path.resolve(workspace, input)
  const relative = path.relative(workspace, root)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("artifact root must stay inside workspace")
  const [base, real] = await Promise.all([fs.realpath(workspace), fs.realpath(root)])
  const nested = path.relative(base, real)
  if (nested.startsWith("..") || path.isAbsolute(nested)) throw new Error("artifact root resolves outside workspace")
  return real
}

async function walk(root: string) {
  const output: string[] = []
  const visit = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(file)
      if (entry.isFile()) output.push(file)
    }
  }
  await visit(root)
  return output
}

async function read<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T
}

function claim(input: unknown): input is Claim {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  return value.version === 1 && typeof value.diagramId === "string" && typeof value.diagramType === "string"
}

function result(input: unknown): input is Result {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  return typeof value.complete === "boolean" && Array.isArray(value.items)
}

function implementations(census: Census, ids: Set<string>, issues: string[]) {
  if (!census.targetSourceRoot?.trim()) issues.push("design-unit census must declare targetSourceRoot")
  if (!Array.isArray(census.implementationUnits) || !census.implementationUnits.length) {
    issues.push("design-unit census must map every target implementation unit")
    return
  }
  const paths = new Set<string>()
  const owners = new Set<string>()
  const exclusions = new Set(["generated", "test", "inactive", "non-build-variant", "forwarding-only-alias"])
  for (const unit of census.implementationUnits) {
    const file = unit.path?.trim()
    if (!file || paths.has(file)) {
      issues.push(`invalid or duplicate implementation path: ${file || "(missing)"}`)
      continue
    }
    paths.add(file)
    if (unit.disposition === "target" || unit.disposition === "confirmed-submodule") {
      if (!unit.designUnitId || !ids.has(unit.designUnitId)) {
        issues.push(`implementation ${file} maps to an unknown or missing DesignUnit`)
        continue
      }
      owners.add(unit.designUnitId)
      continue
    }
    if (unit.disposition !== "excluded" && unit.disposition !== "excluded_non_submodule") {
      issues.push(`implementation ${file} has unsupported disposition ${String(unit.disposition ?? "(missing)")}`)
      continue
    }
    const reason = unit.exclusion?.reason
    if (!reason || !exclusions.has(reason)) {
      issues.push(
        `implementation ${file} uses invalid exclusion reason ${String(reason ?? "(missing)")}; stateless, utility, storage, adapter, small, or FSM-free implementations remain DesignUnits`,
      )
      continue
    }
    if (reason !== "forwarding-only-alias") continue
    const owner = unit.exclusion?.ownerDesignUnitId ?? unit.designUnitId ?? undefined
    if (!owner || !ids.has(owner)) {
      issues.push(`forwarding-only alias ${file} must name its confirmed owner DesignUnit`)
    }
  }
  for (const id of ids) {
    if (!owners.has(id)) issues.push(`DesignUnit ${id} has no mapped implementation unit`)
  }
}

async function png(workspace: string, input: string) {
  const file = path.resolve(workspace, input)
  const relative = path.relative(workspace, file)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false
  const data = await fs.readFile(file).catch(() => undefined)
  return Boolean(data && data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
}

async function regular(file: string) {
  return fs.stat(file).then((stat) => stat.isFile()).catch(() => false)
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
