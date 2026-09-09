import path from "node:path"
import { type Finding, type Lane, type Report, type RunStatus, type Scope, type ValidationResult } from "./types"
import type { Snapshot } from "./snapshot"

export type Draft = {
  summary: string
  findings: readonly Finding[]
  unverifiedRisks: readonly string[]
  validationCommands: readonly { argv: readonly string[]; reason: string }[]
}

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function resolve(root: string, value: string) {
  const absolute = path.resolve(root, value)
  const relative = path.relative(root, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
  return absolute
}

function patch(snapshot: Snapshot, target: string) {
  const sections = snapshot.diff.split(/(?=^diff --git )/m)
  return (
    sections.find((section) => {
      const header = section.match(/^diff --git a\/(.+?) b\/(.+)$/m)
      if (!header) return false
      return [header[1], header[2]].some((value) => value?.replaceAll("\\", "/") === target)
    }) ?? ""
  )
}

async function supported(snapshot: Snapshot, finding: Finding) {
  if (finding.locations.length === 0 || finding.evidence.length === 0) return false
  const scoped = new Set(snapshot.files.map((file) => file.path))
  for (const location of finding.locations) {
    if (!scoped.has(location.path)) continue
    const absolute = resolve(snapshot.root, location.path)
    if (!absolute) continue
    const file = Bun.file(absolute)
    const current = (await file.exists()) ? await file.text().catch(() => "") : ""
    if (location.line !== undefined && snapshot.source.kind === "worktree") {
      const line = Math.trunc(location.line)
      if (line < 1 || (current && line > current.split(/\r?\n/).length)) continue
    }
    const evidence = normalized(
      snapshot.source.kind === "worktree"
        ? `${current}\n${patch(snapshot, location.path)}`
        : patch(snapshot, location.path),
    )
    if (finding.evidence.some((item) => normalized(item).length >= 8 && evidence.includes(normalized(item))))
      return true
  }
  return false
}

function substantial(finding: Finding) {
  return (
    finding.trigger.trim().length >= 8 &&
    finding.causalChain.trim().length >= 16 &&
    finding.impact.trim().length >= 8 &&
    finding.remediation.trim().length >= 4 &&
    finding.recheck.trim().length >= 4
  )
}

export async function validate(snapshot: Snapshot, draft: Draft) {
  const findings: Finding[] = []
  const unverified = [...draft.unverifiedRisks]
  for (const item of draft.findings) {
    const finding: Finding = {
      ...item,
      locations: item.locations.map((location) => ({ ...location, path: location.path.replaceAll("\\", "/") })),
    }
    const blocking = ["P0", "P1", "A1"].includes(finding.severity)
    const counterchecked = finding.counterEvidenceChecked.some((value) => value.trim().length >= 4)
    if (blocking && (!(await supported(snapshot, finding)) || !substantial(finding) || !counterchecked)) {
      unverified.push(
        `${finding.id || finding.impact.slice(0, 40)}：证据位置、原文摘录、完整因果链或反证检查未通过确定性校验。`,
      )
      continue
    }
    findings.push(finding)
  }
  return { findings, unverifiedRisks: [...new Set(unverified.map((item) => item.trim()).filter(Boolean))] }
}

function stableFindings(findings: Finding[]) {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = JSON.stringify({
      severity: finding.severity,
      locations: finding.locations.map((item) => [item.path, item.line]),
      impact: normalized(finding.impact).toLowerCase(),
    })
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function build(input: {
  runId: string
  startedAt: number
  completedAt?: number
  scope: Scope
  scopeLabel: string
  effort: "quick" | "standard" | "deep"
  guidance?: string
  snapshot: Snapshot
  finalFingerprint: string
  lanes: Lane[]
  validation: ValidationResult[]
  model?: Report["model"]
  usage?: Report["usage"]
  filesRead?: string[]
  runStatus: RunStatus
  findings: Finding[]
  unverifiedRisks: string[]
  notes?: string[]
}): Report {
  const findings = stableFindings(input.findings).map((finding, index) => ({
    ...finding,
    id: `UFS-${String(index + 1).padStart(3, "0")}`,
  }))
  const blockers = findings.filter((finding) => finding.severity === "P0" || finding.severity === "P1")
  const architecture = findings.filter((finding) => finding.severity === "A1")
  const nonBlocking = findings.filter((finding) => ["P2", "P3", "A1", "A2"].includes(finding.severity))
  const complete = input.runStatus === "COMPLETE"
  const completedAt = input.completedAt ?? Date.now()
  return {
    version: 1,
    runId: input.runId,
    productStatus: "technical-preview",
    startedAt: input.startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - input.startedAt),
    scope: input.scope,
    scopeLabel: input.scopeLabel,
    effort: input.effort,
    guidance: input.guidance,
    fingerprint: input.snapshot.fingerprint,
    finalFingerprint: input.finalFingerprint,
    files: input.snapshot.files.length,
    additions: input.snapshot.additions,
    deletions: input.snapshot.deletions,
    configuration: input.snapshot.configuration.map((file) => file.path),
    lanes: input.lanes,
    validation: input.validation,
    model: input.model,
    usage: input.usage ?? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    filesRead: [...new Set(input.filesRead ?? [])].toSorted(),
    verdict: blockers.length ? "FAIL" : "PASS",
    architectureGate: architecture.length ? "NEEDS REWORK" : "PASS",
    runStatus: input.runStatus,
    approvable:
      complete &&
      input.snapshot.files.length > 0 &&
      blockers.length === 0 &&
      architecture.length === 0 &&
      input.unverifiedRisks.length === 0,
    findings,
    unverifiedRisks: input.unverifiedRisks,
    nonBlockingFindings: nonBlocking,
    notes: input.notes ?? [],
  }
}

function finding(item: Finding) {
  const locations = item.locations
    .map((location) => `${location.path}${location.line ? `:${location.line}` : ""}`)
    .join(", ")
  return [
    `### ${item.id} · ${item.severity}`,
    `- 位置：${locations || "未提供"}`,
    `- 触发条件：${item.trigger}`,
    `- 完整因果链：${item.causalChain}`,
    `- 实际影响：${item.impact}`,
    `- 支持证据：${item.evidence.join("；")}`,
    `- 反证检查：${item.counterEvidenceChecked.join("；") || "无"}`,
    `- 置信度：${item.confidence}`,
    `- 修复方向：${item.remediation}`,
    `- 复核方式：${item.recheck}`,
  ].join("\n")
}

export function markdown(report: Report) {
  const blockers = report.findings.filter((item) => item.severity === "P0" || item.severity === "P1")
  const other = report.findings.filter((item) => item.severity !== "P0" && item.severity !== "P1")
  return [
    `VERDICT: ${report.verdict}`,
    `ARCHITECTURE GATE: ${report.architectureGate}`,
    `RUN STATUS: ${report.runStatus}`,
    "",
    `审核范围：${report.scopeLabel}；${report.files} 个文件，+${report.additions}/-${report.deletions}`,
    `源码指纹：${report.fingerprint}${report.fingerprint === report.finalFingerprint ? "（未漂移）" : " → 已变化"}`,
    "",
    "## P0/P1 BLOCKERS",
    blockers.length ? blockers.map(finding).join("\n\n") : "无。",
    "",
    "## UNVERIFIED RISKS",
    report.unverifiedRisks.length ? report.unverifiedRisks.map((item) => `- ${item}`).join("\n") : "无。",
    "",
    "## NON-BLOCKING FINDINGS",
    other.length ? other.map(finding).join("\n\n") : "无。",
    "",
    report.approvable
      ? "该技术预览运行完整，且没有阻塞问题或未验证风险。"
      : "该结果不可作为自动批准依据；请结合 RUN STATUS、未验证风险和目标机验证边界处理。",
  ].join("\n")
}
