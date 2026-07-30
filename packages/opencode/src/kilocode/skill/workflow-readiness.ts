import { createHash } from "node:crypto"
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
  title: string
  status: "PASS" | "N/A"
  body: string
}

type Family = {
  id: string
  owner: string
  diagrams: string[]
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
  generatedAt?: number
  resolvedSplitDiagramIds?: string[]
  pendingSplitDiagramIds?: string[]
  pendingSplitDetails?: PendingSplit[]
  items: Array<{
    diagramId: string
    rendered: boolean
    semanticStatus: string
    sourcePath?: string
    sourceHash?: string
    semanticEvidenceHash?: string
    pngPath?: string
    wordFitStatus?: "readable" | "split-required"
    documentReady: boolean
  }>
}

export type PendingSplit = {
  diagramId: string
  missingNodes: Array<{ id: string; symbol?: string; designUnitId?: string }>
  missingEdges: Array<{
    from: string
    to: string
    relation: "direct-call" | "callback" | "ownership" | "data-flow" | "state-transition" | "dependency" | "unknown"
    fromSymbol?: string
    toSymbol?: string
    event?: string
  }>
}

type Prose = {
  root: string
  census?: Census
  topics: Map<string, Map<number, Topic>>
  families: Family[]
  issues: string[]
}

export type FigureProgress = {
  designUnitCount: number
  requiredSlotCount: number
  completedSlotCount: number
  missingSlotCount: number
  completedDesignUnitIds: string[]
  remainingDesignUnitIds: string[]
  nextMissingSlots: string[]
  wordAllowed: boolean
}

const VIEWS = new Set(["architecture", "business-flow", "code-flow", "state-machine", "data-lifecycle"])
const FLOW_HEADERS = [
  "flow_family_id",
  "owning_design_unit",
  "entry_trigger",
  "input_business_object",
  "entry_step_ids",
  "participating_units",
  "decision_edge_ids",
  "async_handoff_edge_ids",
  "wait_retry_timeout_cancel_edge_ids",
  "failure_recovery_cleanup_edge_ids",
  "terminal_step_ids",
  "state_data_resource_effects",
  "evidence_ids",
  "diagram_ids",
  "status",
] as const
const FLOW_REQUIRED = FLOW_HEADERS.filter((item) => item !== "diagram_ids")
const FLOW_CONCRETE = new Set([
  "entry_trigger",
  "input_business_object",
  "entry_step_ids",
  "participating_units",
  "terminal_step_ids",
  "state_data_resource_effects",
  "evidence_ids",
])
const FLOW_PLACEHOLDER = /^(?:n\/a|none|unknown|tbd|not[_ -]?applicable|待确认|-)$/i
const REVISION = "SBDD_RULESET_REVISION=2026-07-source-semantic-v122"

export async function prose(workspace: string, input: string): Promise<Prose> {
  const root = await secure(workspace, input)
  const issues: string[] = []
  const topics = new Map<string, Map<number, Topic>>()
  const families: Family[] = []
  const census = await read<Census>(path.join(root, "02-source-evidence", "design-unit-census.json")).catch((err) => {
    issues.push(`cannot read frozen design-unit census: ${message(err)}`)
    return undefined
  })
  if (!census) return { root, topics, families, issues }
  if (census.version !== 1 || !Array.isArray(census.designUnits) || !census.designUnits.length) {
    issues.push("design-unit census must be version 1 with at least one design unit")
    return { root, census, topics, families, issues }
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
  families.push(...(await flows(root, ids, issues)))
  return { root, census, topics, families, issues }
}

export async function figures(workspace: string, input: string, state?: Prose) {
  const ready = state ?? (await prose(workspace, input))
  const issues = [...ready.issues]
  if (!ready.census || ready.issues.length) {
    const units = ready.census?.designUnits ?? []
    const progress: FigureProgress = {
      designUnitCount: units.length,
      requiredSlotCount: 0,
      completedSlotCount: 0,
      missingSlotCount: 0,
      completedDesignUnitIds: [],
      remainingDesignUnitIds: units.map((unit) => unit.id),
      nextMissingSlots: [],
      wordAllowed: false,
    }
    return {
      ...ready,
      issues,
      claims: new Map<string, Claim>(),
      results: new Map<string, Result["items"][number]>(),
      progress,
      pendingSplits: [] as PendingSplit[],
    }
  }
  const files = await walk(ready.root)
  const claims = new Map<string, Claim>()
  const hashes = new Map<string, string>()
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
    hashes.set(
      value.diagramId,
      createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex"),
    )
    if (value.splitFromDiagramId) continue
    const key = `${value.designUnitId}:${value.diagramType}`
    slots.set(key, [...(slots.get(key) ?? []), value.diagramId])
  }
  const results = new Map<string, Result["items"][number]>()
  const split = new Set<string>()
  const pending = new Set<string>()
  const resolved = new Set<string>()
  const details = new Map<string, PendingSplit>()
  const batches = (
    await Promise.all(
      files
        .filter((item) => item.endsWith(".json"))
        .map(async (file) => {
          const [value, stat] = await Promise.all([
            read<unknown>(file).catch(() => undefined),
            fs.stat(file).catch(() => undefined),
          ])
          return result(value) ? { file, value, time: value.generatedAt ?? stat?.mtimeMs ?? 0 } : undefined
        }),
    )
  )
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => left.time - right.time || left.file.localeCompare(right.file))
  for (const batch of batches) {
    const value = batch.value
    if (value.pendingSplitDiagramIds) {
      for (const id of value.pendingSplitDiagramIds) {
        pending.add(id)
        resolved.delete(id)
      }
    }
    for (const detail of value.pendingSplitDetails ?? []) details.set(detail.diagramId, detail)
    for (const id of value.resolvedSplitDiagramIds ?? []) {
      pending.delete(id)
      resolved.add(id)
      details.delete(id)
    }
    for (const item of value.items) {
      if (item.wordFitStatus === "split-required") split.add(item.diagramId)
      if (!item.rendered || !item.documentReady || !["valid", "valid-with-unknowns"].includes(item.semanticStatus)) {
        continue
      }
      results.set(item.diagramId, item)
    }
  }
  for (const id of pending) {
    if (!resolved.has(id)) issues.push(`split-required Diagram ID ${id} has no resolved readable replacement set`)
  }
  const mapped = new Set<string>()
  for (const family of ready.families) {
    if (!family.diagrams.length) {
      issues.push(`business-flow family ${family.id} has no diagram_ids mapping`)
      continue
    }
    for (const id of family.diagrams) {
      if (mapped.has(`${family.id}:${id}`)) {
        issues.push(`business-flow family ${family.id} repeats Diagram ID ${id}`)
        continue
      }
      mapped.add(`${family.id}:${id}`)
      const item = claims.get(id)
      if (!item) {
        issues.push(`business-flow family ${family.id} maps to missing Diagram ID ${id}`)
        continue
      }
      if (item.diagramType !== "business-flow" || item.designUnitId !== family.owner) {
        issues.push(
          `business-flow family ${family.id} maps to ${id}, which is not a business-flow claim owned by ${family.owner}`,
        )
      }
    }
  }
  const required = new Set<string>()
  const done = new Set<string>()
  for (const unit of ready.census.designUnits) {
    const topics = ready.topics.get(unit.id)
    if (!topics) continue
    const views = ["architecture", "business-flow", "code-flow", "data-lifecycle"]
    if (topics.get(8)?.status !== "N/A") views.push("state-machine")
    for (const view of views) {
      const key = `${unit.id}:${view}`
      required.add(key)
      const ids = slots.get(key) ?? []
      if (ids.length !== 1) {
        issues.push(`${key} requires exactly one primary claim; found ${ids.length}`)
        continue
      }
      const id = ids[0]!
      const item = results.get(id)
      if (!item && split.has(id) && resolved.has(id)) {
        const children = descendants(id, claims)
          .map((child) => results.get(child.diagramId))
          .filter((child): child is Result["items"][number] => Boolean(child))
        if (!children.length) {
          issues.push(`${key} resolved its split parent but has no readable replacement PNG`)
          continue
        }
        const valid = []
        for (const child of children) {
          valid.push(
            Boolean(
              child.pngPath &&
                (await png(workspace, child.pngPath)) &&
                (await fresh(workspace, child, hashes.get(child.diagramId))),
            ),
          )
        }
        if (valid.some((item) => !item)) {
          issues.push(`${key} has a missing, invalid, or stale readable replacement PNG`)
          continue
        }
        done.add(key)
        continue
      }
      if (
        !item ||
        !item.rendered ||
        !item.documentReady ||
        !["valid", "valid-with-unknowns"].includes(item.semanticStatus)
      ) {
        issues.push(`${key} has no semantically valid, readable rendered PNG`)
        continue
      }
      if (!item.pngPath || !(await png(workspace, item.pngPath))) {
        issues.push(`${key} has a missing or invalid PNG`)
        continue
      }
      if (!(await fresh(workspace, item, hashes.get(id)))) {
        issues.push(`${key} rendered result is stale relative to its Mermaid source or semantic claim`)
        continue
      }
      done.add(key)
    }
    const business = slots.get(`${unit.id}:business-flow`) ?? []
    if (business.length === 1 && !ready.families.some((family) => family.diagrams.includes(business[0]!))) {
      issues.push(`${unit.id}:business-flow primary Diagram ID ${business[0]} is not mapped by any flow family`)
    }
    if (topics.get(8)?.status === "N/A" && (slots.get(`${unit.id}:state-machine`)?.length ?? 0) > 0) {
      issues.push(`${unit.id}:state-machine is evidenced N/A but has a primary claim`)
    }
  }
  issues.push(...(await checkpoints(ready.root)))
  const remaining = ready.census.designUnits
    .filter((unit) => [...required].some((key) => key.startsWith(`${unit.id}:`) && !done.has(key)))
    .map((unit) => unit.id)
  const completed = ready.census.designUnits
    .filter((unit) => [...required].some((key) => key.startsWith(`${unit.id}:`)))
    .filter((unit) => !remaining.includes(unit.id))
    .map((unit) => unit.id)
  const progress: FigureProgress = {
    designUnitCount: ready.census.designUnits.length,
    requiredSlotCount: required.size,
    completedSlotCount: done.size,
    missingSlotCount: required.size - done.size,
    completedDesignUnitIds: completed,
    remainingDesignUnitIds: remaining,
    nextMissingSlots: [...required].filter((key) => !done.has(key)).slice(0, 20),
    wordAllowed: issues.length === 0 && required.size === done.size,
  }
  const pendingSplits = [...pending].map((id) => details.get(id)).filter((item): item is PendingSplit => Boolean(item))
  return { ...ready, issues, claims, results, progress, pendingSplits }
}

export async function checkpoints(root: string) {
  const issues: string[] = []
  for (const name of ["resume-state.md", "review-notes.md", "continue-prompt.md"]) {
    const file = path.join(root, name)
    const text = await fs.readFile(file, "utf8").catch(() => "")
    if (!text) {
      issues.push(`missing required checkpoint file ${name}`)
      continue
    }
    if (!text.includes(REVISION)) issues.push(`${name} does not declare ${REVISION}`)
    for (const [field, pattern] of [
      ["flowCensusStatus: PASS", /flowCensusStatus\s*[:=]\s*PASS\b/i],
      ["flowCensusParseStatus: PASS", /flowCensusParseStatus\s*[:=]\s*PASS\b/i],
      ["missingTopicCount: 0", /missingTopicCount\s*[:=]\s*0\b/i],
    ] as const) {
      if (!pattern.test(text)) issues.push(`${name} does not record ${field}`)
    }
  }
  return issues
}

export async function image(workspace: string, input: string, target: string) {
  const ready = await figures(workspace, input)
  if (!ready.progress.wordAllowed) {
    return {
      issue: `source-backed figure set is not ready for Word insertion: ${ready.issues.slice(0, 20).join("; ")}`,
    }
  }
  const wanted = path.resolve(workspace, target)
  const item = [...ready.results.values()].find((entry) => {
    if (!entry.pngPath) return false
    return path.resolve(workspace, entry.pngPath) === wanted
  })
  if (!item?.sourcePath || !item.sourceHash) {
    return { issue: "PNG path is not recorded by a semantically valid, readable source-backed batch result" }
  }
  if (!(await png(workspace, item.pngPath!))) {
    return { issue: "recorded source-backed PNG is missing or invalid" }
  }
  const file = path.resolve(workspace, item.sourcePath)
  const real = await fs.realpath(file).catch(() => undefined)
  if (!real) return { issue: "recorded Mermaid source is missing or stale" }
  const nested = path.relative(ready.root, real)
  if (nested.startsWith("..") || path.isAbsolute(nested)) {
    return { issue: "recorded Mermaid source is outside the canonical artifact root" }
  }
  const source = await fs.readFile(real, "utf8").catch(() => undefined)
  if (!source || createHash("sha256").update(source).digest("hex") !== item.sourceHash) {
    return { issue: "recorded Mermaid source is missing or stale" }
  }
  return { source, hash: item.sourceHash }
}

export async function document(
  workspace: string,
  input: string,
  inspection: {
    outline: Array<{ level: 1 | 2 | 3; title: string; paragraphIndex: number }>
    paragraphs: Array<{ index: number; text: string; styleId?: string }>
    images: Array<{ visibleId?: string }>
    paragraphsTruncated: boolean
    tablesTruncated: boolean
    truncated: boolean
  },
) {
  const ready = await figures(workspace, input)
  const issues = [...ready.issues]
  if (inspection.truncated || inspection.paragraphsTruncated || inspection.tablesTruncated) {
    issues.push("Word inspection is truncated")
  }
  for (const unit of ready.census?.designUnits ?? []) {
    const names = new Set([unit.id, unit.name].map(normalize).filter(Boolean))
    const anchors = inspection.outline.filter(
      (item) => item.level === 1 && [...names].some((name) => normalize(item.title).includes(name)),
    )
    if (anchors.length !== 1) {
      issues.push(
        `Word requires one Heading 1 design section containing the exact DesignUnit name ${unit.name}; found ${anchors.length}`,
      )
      continue
    }
    const anchor = anchors[0]!
    const end =
      inspection.outline.find((item) => item.paragraphIndex > anchor.paragraphIndex && item.level <= anchor.level)
        ?.paragraphIndex ?? Number.POSITIVE_INFINITY
    const topics = ready.topics.get(unit.id)
    if (!topics) {
      issues.push(`Word cannot audit missing prose unit ${unit.id}`)
      continue
    }
    for (let topic = 1; topic <= 14; topic++) {
      const expected = topics.get(topic)
      if (!expected) {
        issues.push(`Word cannot audit missing prose topic ${unit.id}:${topic}`)
        continue
      }
      const title = normalize(expected.title)
      const matches = inspection.outline.filter(
        (item) =>
          item.paragraphIndex > anchor.paragraphIndex &&
          item.paragraphIndex < end &&
          item.level > anchor.level &&
          normalize(item.title).endsWith(title),
      )
      if (matches.length !== 1) {
        issues.push(
          `Word ${unit.id} requires one local heading for topic ${topic} ${expected.title}; found ${matches.length}`,
        )
        continue
      }
      const heading = matches[0]!
      const stop =
        inspection.outline.find((item) => item.paragraphIndex > heading.paragraphIndex && item.level <= heading.level)
          ?.paragraphIndex ?? end
      const body = inspection.paragraphs
        .filter(
          (item) =>
            item.index > heading.paragraphIndex &&
            item.index < Math.min(stop, end) &&
            item.styleId !== "Caption" &&
            item.text.trim(),
        )
        .map((item) => item.text.trim())
        .join("\n")
      if (!normalize(body).includes(normalize(expected.body))) {
        issues.push(`Word ${unit.id} topic ${topic} does not preserve its persisted explanatory prose`)
      }
    }
  }
  if (inspection.images.length < ready.progress.requiredSlotCount) {
    issues.push(
      `Word has ${inspection.images.length} images but the source-backed matrix requires at least ${ready.progress.requiredSlotCount}`,
    )
  }
  const visible = inspection.images
    .map((item) => item.visibleId?.trim())
    .filter((item): item is string => Boolean(item))
  if (visible.length !== inspection.images.length || new Set(visible).size !== visible.length) {
    issues.push("Every Word image must have one unique visible Diagram ID")
  }
  return { issues, progress: ready.progress }
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
    const marker =
      offset < 0
        ? undefined
        : /^SBDD-TOPIC-STATUS:\s*(0?[1-9]|1[0-4])\s*\|\s*(PASS|N\/A)\s*\|\s*(.+)\s*$/.exec(block[offset]!.trim())
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
    const title = lines[start]!.replace(/^####\s+(?:主题\s*)?(?:0?[1-9]|1[0-4])(?:[.、：:\s]+)?/, "").trim()
    topics.set(topic, { title, status, body })
  }
  if (topics.size !== 14) issues.push(`${unit} has ${topics.size}/14 structurally complete topics`)
  if (/SBDD-TOPIC-STATUS:\s*\d+\s*[-–]\s*\d+/.test(text)) issues.push(`${unit} combines topic status ranges`)
  if (/\b(?:MISSING|PARTIAL)\b/.test(text)) issues.push(`${unit} contains MISSING/PARTIAL content`)
  return topics
}

async function secure(workspace: string, input: string) {
  const root = path.resolve(workspace, input)
  const relative = path.relative(workspace, root)
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("artifact root must stay inside workspace")
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

function descendants(id: string, claims: Map<string, Claim>) {
  const output: Claim[] = []
  const queue = [id]
  const seen = new Set(queue)
  while (queue.length) {
    const parent = queue.shift()!
    for (const item of claims.values()) {
      if (item.splitFromDiagramId !== parent || seen.has(item.diagramId)) continue
      seen.add(item.diagramId)
      output.push(item)
      queue.push(item.diagramId)
    }
  }
  return output
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

async function flows(root: string, ids: Set<string>, issues: string[]) {
  const output: Family[] = []
  const file = path.join(root, "03-control-flow-evidence", "14-business-flow-family-census.csv")
  const text = await fs.readFile(file, "utf8").catch((err) => {
    issues.push(`cannot read business-flow family census: ${message(err)}`)
    return ""
  })
  if (!text) return output
  const rows = csv(text, issues)
  if (!rows.length) {
    issues.push("business-flow family census is empty")
    return output
  }
  const header = rows[0]!.map((item, index) => (index === 0 ? item.replace(/^\uFEFF/, "") : item))
  if (header.length !== FLOW_HEADERS.length || header.some((item, index) => item !== FLOW_HEADERS[index])) {
    issues.push(`business-flow family census header must equal: ${FLOW_HEADERS.join(",")}`)
    return output
  }
  const data = rows.slice(1).filter((row) => row.some((item) => item.trim()))
  if (data.length < ids.size) {
    issues.push(`business-flow family census requires at least ${ids.size} covered rows; found ${data.length}`)
  }
  const flows = new Set<string>()
  const owners = new Set<string>()
  for (const [offset, row] of data.entries()) {
    const line = offset + 2
    if (row.length !== FLOW_HEADERS.length) {
      issues.push(`business-flow family census row ${line} has ${row.length} columns; expected ${FLOW_HEADERS.length}`)
      continue
    }
    const value = Object.fromEntries(FLOW_HEADERS.map((name, index) => [name, row[index]!.trim()])) as Record<
      (typeof FLOW_HEADERS)[number],
      string
    >
    if (!value.flow_family_id || flows.has(value.flow_family_id)) {
      issues.push(`business-flow family census row ${line} has a missing or duplicate flow_family_id`)
    } else {
      flows.add(value.flow_family_id)
    }
    if (!ids.has(value.owning_design_unit)) {
      issues.push(
        `business-flow family census row ${line} maps to unknown owning DesignUnit ${value.owning_design_unit || "(missing)"}`,
      )
    } else if (value.status === "covered") {
      owners.add(value.owning_design_unit)
    }
    for (const name of FLOW_REQUIRED) {
      if (value[name]) continue
      issues.push(`business-flow family census row ${line} has an empty ${name}`)
    }
    for (const name of FLOW_CONCRETE) {
      if (!value[name as keyof typeof value] || !FLOW_PLACEHOLDER.test(value[name as keyof typeof value])) continue
      issues.push(`business-flow family census row ${line} must provide concrete ${name}`)
    }
    const participants = new Set(
      value.participating_units
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean),
    )
    if (ids.has(value.owning_design_unit) && !participants.has(value.owning_design_unit)) {
      issues.push(
        `business-flow family census row ${line} participating_units must include owning DesignUnit ${value.owning_design_unit}`,
      )
    }
    if (value.status !== "covered") {
      issues.push(
        `business-flow family census row ${line} status must be covered; found ${value.status || "(missing)"}`,
      )
    }
    if (value.flow_family_id && ids.has(value.owning_design_unit) && value.status === "covered") {
      output.push({
        id: value.flow_family_id,
        owner: value.owning_design_unit,
        diagrams: value.diagram_ids
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean),
      })
    }
  }
  for (const id of ids) {
    if (!owners.has(id)) issues.push(`business-flow family census has no covered local flow owned by DesignUnit ${id}`)
  }
  return output
}

function csv(text: string, issues: string[]) {
  const rows: string[][] = []
  const row: string[] = []
  const cell: string[] = []
  let quote = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quote) {
      if (char !== '"') {
        cell.push(char)
        continue
      }
      if (text[index + 1] === '"') {
        cell.push('"')
        index++
        continue
      }
      quote = false
      continue
    }
    if (char === '"' && cell.length === 0) {
      quote = true
      continue
    }
    if (char === ",") {
      row.push(cell.join(""))
      cell.length = 0
      continue
    }
    if (char !== "\n" && char !== "\r") {
      cell.push(char)
      continue
    }
    if (char === "\r" && text[index + 1] === "\n") index++
    row.push(cell.join(""))
    cell.length = 0
    rows.push([...row])
    row.length = 0
  }
  if (quote) issues.push("business-flow family census has an unclosed quoted field")
  if (cell.length || row.length) {
    row.push(cell.join(""))
    rows.push([...row])
  }
  return rows
}

async function png(workspace: string, input: string) {
  const file = path.resolve(workspace, input)
  const relative = path.relative(workspace, file)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false
  const data = await fs.readFile(file).catch(() => undefined)
  return Boolean(data && data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
}

async function fresh(workspace: string, item: Result["items"][number], claim?: string) {
  if (!item.sourcePath || !item.sourceHash || !item.semanticEvidenceHash || !claim) return false
  if (item.semanticEvidenceHash !== claim) return false
  const file = path.resolve(workspace, item.sourcePath)
  const relative = path.relative(workspace, file)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false
  const data = await fs.readFile(file).catch(() => undefined)
  return Boolean(data && createHash("sha256").update(data).digest("hex") === item.sourceHash)
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function normalize(input: string) {
  return input.toLowerCase().replace(/[\s_*\-—–:：、，。()[\]【】/\\`#>]+/g, "")
}
