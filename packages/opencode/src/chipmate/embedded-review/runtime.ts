import path from "node:path"
import { loadChangeSet } from "./change-set"
import { packets } from "./context"
import { runMechanical } from "./mechanical"
import { latestRulePack, RulePackUnavailableError } from "./rules"
import type { EmbeddedReviewPreparation, EmbeddedReviewSubmission, LogicFinding, StandardFinding } from "./types"

export namespace EmbeddedReviewRuntime {
  type State = {
    preparation: EmbeddedReviewPreparation
    index: number
    started: boolean
    complete: boolean
    submissions: EmbeddedReviewSubmission[]
  }

  const pinned = new Map<string, State>()
  const MAX_PINNED = 16

  export async function prepare(input: {
    root: string
    arguments: string
    endpoint?: string
    abort?: AbortSignal
  }): Promise<EmbeddedReviewPreparation> {
    const changes = await loadChangeSet(input)
    const warnings = changes.skipped.map((item) => `${item.path}: ${item.reason}`)
    const pack = await latestRulePack({ endpoint: input.endpoint, abort: input.abort }).catch((err: unknown) => {
      if (err instanceof RulePackUnavailableError) {
        warnings.push(err.message)
        return undefined
      }
      throw err
    })
    if (!pack) {
      return {
        schemaVersion: 1,
        changes,
        standard: {
          mechanicalStatus: "NOT_EVALUATED",
          findings: [],
          reason: "审查开始时无法固定最新已发布的 RulePack。",
          evaluatedRuleIds: [],
          semanticRuleIds: [],
        },
        packets: packets(changes.files, []),
        warnings,
      }
    }
    const mechanical = runMechanical(changes.files, pack)
    if (mechanical.unsupportedRuleIds.length) {
      warnings.push(`未能确定性检查的机械规则 ID：${mechanical.unsupportedRuleIds.join(", ")}`)
    }
    const incomplete =
      mechanical.unsupportedRuleIds.length > 0 ||
      changes.skipped.some((item) =>
        [".c", ".h", ".cc", ".hh", ".cpp", ".hpp", ".cxx", ".hxx", ".inc", ".inl"].includes(
          path.extname(item.path).toLowerCase(),
        ),
      )
    const semanticRuleIds = pack.rules
      .filter((rule) => rule.level === "MUST" && rule.check === "semantic")
      .map((rule) => rule.id)
    return {
      schemaVersion: 1,
      changes,
      rulePack: pack,
      standard: {
        mechanicalStatus: mechanical.findings.length ? "NON_COMPLIANT" : incomplete ? "NOT_EVALUATED" : "COMPLIANT",
        findings: mechanical.findings,
        ...(incomplete ? { reason: "至少有一个适用文件或机械 MUST 规则无法完成检查。" } : {}),
        evaluatedRuleIds: mechanical.evaluatedRuleIds,
        semanticRuleIds,
      },
      packets: packets(changes.files, pack.rules),
      warnings,
    }
  }

  export function remember(sessionID: string, preparation: EmbeddedReviewPreparation) {
    pinned.delete(sessionID)
    pinned.set(sessionID, {
      preparation: compactChanges(preparation),
      index: 0,
      started: false,
      complete: preparation.packets.length === 0,
      submissions: [],
    })
    if (pinned.size <= MAX_PINNED) return
    const oldest = pinned.keys().next().value
    if (oldest) pinned.delete(oldest)
  }

  export function active(sessionID: string) {
    return pinned.has(sessionID)
  }

  export function discard(sessionID: string) {
    pinned.delete(sessionID)
  }

  export function prompt(preparation: EmbeddedReviewPreparation) {
    return {
      schemaVersion: 1,
      scope: preparation.changes.scope,
      changedFiles: preparation.changes.files.map((file) => ({
        path: file.path,
        status: file.status,
        changedLineCount: file.changedLines.length,
      })),
      skipped: preparation.changes.skipped,
      rulePack: preparation.rulePack
        ? {
            version: preparation.rulePack.version,
            contentHash: preparation.rulePack.contentHash,
            publishedAt: preparation.rulePack.publishedAt,
          }
        : undefined,
      mechanicalStatus: preparation.standard.mechanicalStatus,
      mechanicalFindingCount: preparation.standard.findings.length,
      packetCount: preparation.packets.length,
      obligationCount: preparation.packets.reduce((total, packet) => total + packet.obligations.length, 0),
      warnings: preparation.warnings,
    }
  }

  export function next(
    sessionID: string,
    input:
      | { action: "start"; packet: number }
      | { action: "submit"; packet: number; submission?: EmbeddedReviewSubmission },
  ) {
    const state = pinned.get(sessionID)
    if (!state) return { complete: true, error: "当前会话没有已固定的 Embedded Review。" }
    if (input.action === "start") {
      if (input.packet !== 0) return { complete: false, error: "启动证据包序列时 packet 必须为 0。" }
      if (state.started) return { complete: false, error: "证据包序列已经开始。" }
      state.started = true
      return packet(state)
    }
    if (!state.started) return { complete: false, error: "提交前必须先以 `start` 动作调用本工具。" }
    if (state.complete) return { complete: true, error: "全部证据包均已提交。" }
    const expected = state.index + 1
    if (input.packet !== expected) {
      return { complete: false, error: `证据包序号不匹配：当前必须提交 packet ${expected}。` }
    }
    if (!input.submission) return { complete: false, error: "必须提交完整的当前证据包结果。" }
    const current = state.preparation.packets[state.index]
    if (!current) return { complete: true, error: "当前证据包不可用。" }
    state.submissions.push(limit(input.submission, current))
    state.preparation.packets[state.index] = compactPacket(current)
    state.index++
    state.complete = state.index >= state.preparation.packets.length
    return packet(state)
  }

  export function seal(sessionID: string, _text: string) {
    const state = pinned.get(sessionID)
    if (!state) return undefined
    pinned.delete(sessionID)
    const preparation = state.preparation
    const parsed = state.complete ? merge(state.submissions) : undefined
    const warnings = [...preparation.warnings]
    if (!state.complete) {
      warnings.push(`模型只完成 ${state.index}/${preparation.packets.length} 个证据包；未提交的候选已丢弃。`)
    }
    const semanticFindings = semantic(preparation, parsed?.standardFindings ?? [])
    const standard = [...preparation.standard.findings, ...semanticFindings]
    const logic = logical(preparation, parsed?.logicFindings ?? [], parsed?.obligationReviews ?? [])
    const obligationRisks = audit(preparation, parsed, logic)
    if (parsed && semanticFindings.length < parsed.standardFindings.length) {
      warnings.push(`${parsed.standardFindings.length - semanticFindings.length} 个规范候选未通过确定性证据校验。`)
    }
    if (parsed && logic.length < parsed.logicFindings.length) {
      warnings.push(`${parsed.logicFindings.length - logic.length} 个逻辑候选未通过确定性证据校验。`)
    }
    const semanticIncomplete =
      !state.complete &&
      preparation.packets.some((packet) =>
        packet.rules.some((rule) => rule.level === "MUST" && rule.check === "semantic"),
      )
    const status = standard.length
      ? "NON_COMPLIANT"
      : !preparation.rulePack || preparation.standard.mechanicalStatus === "NOT_EVALUATED" || semanticIncomplete
        ? "NOT_EVALUATED"
        : "COMPLIANT"
    const verdict = logic.length ? "FAIL" : "PASS"
    const risks = unique([...warnings, ...obligationRisks, ...(parsed?.unverifiedRisks ?? [])])
    const nonblocking = unique(parsed?.nonBlockingFindings ?? [])
    const rules = preparation.rulePack
      ? `${preparation.rulePack.version} ${preparation.rulePack.contentHash}`
      : "不可用"
    const blockers = logic.length
      ? logic
          .map((finding, index) =>
            [
              `${index + 1}. ${finding.severity} ${finding.category} ${finding.path}:${finding.line}`,
              ...(finding.obligationId ? [`   - 通用义务：${finding.obligationId}`] : []),
              `   - 触发条件：${finding.trigger}`,
              `   - 执行路径：${finding.pathEvidence.join(" -> ")}`,
              `   - 因果链：${finding.causalChain.join(" -> ")}`,
              `   - 实际影响：${finding.impact}`,
              `   - P0/P1 依据：该可达因果链会造成 ${finding.severity} 级正确性、安全性、可靠性、实时性或数据完整性影响。`,
              `   - 支持证据：变更行 ${finding.path}:${finding.line}`,
              `   - 反证检查：${finding.protectionCounterevidence}`,
            ].join("\n"),
          )
          .join("\n")
      : "无"
    const standards = standard.length
      ? standard
          .map((finding, index) =>
            [
              `${index + 1}. ${finding.ruleId} ${finding.path}:${finding.line}`,
              `   - RulePack：${finding.ruleVersion}`,
              `   - 违规说明：${finding.violation}`,
              `   - 违规代码：${JSON.stringify(finding.code)}`,
              `   - 例外反证：${finding.exceptionCounterevidence}`,
            ].join("\n"),
          )
          .join("\n")
      : "无"
    const output = [
      `VERDICT: ${verdict}`,
      `STANDARD: ${status}`,
      `RULEPACK: ${rules}`,
      "",
      "P0/P1 BLOCKERS:",
      blockers,
      "",
      "STANDARD FINDINGS:",
      standards,
      "",
      "UNVERIFIED RISKS:",
      risks.length ? risks.map((item) => `- ${item}`).join("\n") : "无",
      "",
      "NON-BLOCKING FINDINGS:",
      nonblocking.length ? nonblocking.map((item) => `- ${item}`).join("\n") : "无",
      "",
      ...logic.map((finding) =>
        directive({
          title: `[${finding.severity}] 嵌入式逻辑矛盾`,
          body: `${finding.trigger} ${finding.impact}`,
          file: path.join(preparation.changes.root, finding.path),
          line: finding.line,
          priority: finding.severity === "P0" ? 0 : 1,
        }),
      ),
      ...standard.map((finding) =>
        directive({
          title: `[${finding.ruleId}] 编码规范违规`,
          body: `${finding.violation} ${finding.exceptionCounterevidence}`,
          file: path.join(preparation.changes.root, finding.path),
          line: finding.line,
          priority: 2,
        }),
      ),
    ]
      .filter((item, index, all) => item !== "" || all[index - 1] !== "")
      .join("\n")
      .trim()
    return { text: output, verdict, status, logic, standard }
  }
}

function semantic(
  preparation: EmbeddedReviewPreparation,
  candidates: EmbeddedReviewSubmission["standardFindings"],
): StandardFinding[] {
  if (!preparation.rulePack) return []
  const result: StandardFinding[] = []
  for (const finding of candidates) {
    const packet = preparation.packets.find(
      (item) =>
        item.path === finding.path &&
        item.changedLines.includes(finding.line) &&
        item.rules.some((rule) => rule.id === finding.ruleId && rule.level === "MUST" && rule.check === "semantic"),
    )
    if (!packet) continue
    if (![finding.violation, finding.code, finding.exceptionCounterevidence].every(nonempty)) continue
    const file = preparation.changes.files.find((item) => item.path === finding.path)
    if (file?.after.split(/\r?\n/)[finding.line - 1] !== finding.code) continue
    result.push({
      track: "STANDARD",
      ruleId: finding.ruleId,
      ruleVersion: preparation.rulePack.version,
      path: finding.path,
      line: finding.line,
      violation: finding.violation.trim(),
      code: finding.code,
      exceptionCounterevidence: finding.exceptionCounterevidence.trim(),
    })
  }
  return dedupe(result, (item) => `${item.ruleId}:${item.path}:${item.line}`)
}

function compactChanges(preparation: EmbeddedReviewPreparation): EmbeddedReviewPreparation {
  return {
    ...preparation,
    changes: {
      ...preparation.changes,
      files: preparation.changes.files.map((file) => {
        const changed = new Set(file.changedLines)
        return {
          ...file,
          before: "",
          after: file.after
            .split(/\r?\n/)
            .map((line, index) => (changed.has(index + 1) ? line : ""))
            .join("\n"),
          patch: "",
          hunks: [],
        }
      }),
    },
    ...(preparation.rulePack ? { rulePack: { ...preparation.rulePack, rules: [] } } : {}),
  }
}

function compactPacket(packet: EmbeddedReviewPreparation["packets"][number]) {
  return {
    ...packet,
    hunk: "",
    ...(packet.function
      ? {
          function: {
            ...packet.function,
            source: "",
          },
        }
      : {}),
    relatedFunctions: packet.relatedFunctions.map((fn) => ({
      ...fn,
      source: "",
    })),
    rules: packet.rules.map((rule) => ({
      ...rule,
      title: "",
      description: "",
      appliesTo: [],
      exceptions: [],
    })),
  }
}

function packet(state: { preparation: EmbeddedReviewPreparation; index: number; complete: boolean }) {
  if (state.complete) {
    return {
      complete: true,
      processed: state.index,
      total: state.preparation.packets.length,
      instruction: "全部证据包已完成。返回协议要求的最终空 JSON 对象；所有 finding 由 Runtime 管理。",
    }
  }
  return {
    complete: false,
    packet: state.index + 1,
    total: state.preparation.packets.length,
    rulePack: state.preparation.rulePack
      ? {
          version: state.preparation.rulePack.version,
          contentHash: state.preparation.rulePack.contentHash,
        }
      : undefined,
    evidence: state.preparation.packets[state.index],
    instruction:
      "只审查当前证据包，然后以 submit 动作调用 embedded_review_packet；packet 必须原样回传当前响应中的序号，并提交且只提交本包的候选数组。",
  }
}

function limit(submission: EmbeddedReviewSubmission, packet: EmbeddedReviewPreparation["packets"][number]) {
  return {
    standardFindings: submission.standardFindings.filter(
      (finding) =>
        finding.path === packet.path &&
        packet.changedLines.includes(finding.line) &&
        packet.rules.some((rule) => rule.id === finding.ruleId),
    ),
    logicFindings: submission.logicFindings
      .filter(
        (finding) =>
          !finding.obligationId || packet.obligations.some((obligation) => obligation.id === finding.obligationId),
      )
      .map((finding) => bind(finding, packet))
      .map((finding) => ({
        ...finding,
        pathEvidence: normalize(packet, finding.pathEvidence),
      }))
      .filter(
        (finding) =>
          finding.path === packet.path &&
          packet.changedLines.includes(finding.line) &&
          packet.logicProfiles.some((profile) => profile.category === finding.category),
      ),
    obligationReviews: submission.obligationReviews
      .filter((review) => packet.obligations.some((obligation) => obligation.id === review.obligationId))
      .map((review) => ({
        ...review,
        evidence: normalize(packet, review.evidence),
      })),
    unverifiedRisks: submission.unverifiedRisks.filter((value) => reference(packet, value)).slice(0, 4),
    nonBlockingFindings: submission.nonBlockingFindings.slice(0, 4),
  }
}

function bind(
  finding: EmbeddedReviewSubmission["logicFindings"][number],
  packet: EmbeddedReviewPreparation["packets"][number],
) {
  const matches = packet.obligations.filter((item) => item.path === finding.path && item.line === finding.line)
  const obligation = finding.obligationId
    ? packet.obligations.find((item) => item.id === finding.obligationId)
    : matches.length === 1
      ? matches[0]
      : undefined
  if (!obligation) return finding
  return {
    ...finding,
    obligationId: obligation.id,
    category: obligation.category,
    path: obligation.path,
    line: obligation.line,
  }
}

function merge(values: EmbeddedReviewSubmission[]): EmbeddedReviewSubmission {
  return {
    standardFindings: values.flatMap((value) => value.standardFindings),
    logicFindings: values.flatMap((value) => value.logicFindings),
    obligationReviews: values.flatMap((value) => value.obligationReviews),
    unverifiedRisks: values.flatMap((value) => value.unverifiedRisks),
    nonBlockingFindings: values.flatMap((value) => value.nonBlockingFindings),
  }
}

function audit(
  preparation: EmbeddedReviewPreparation,
  submission: EmbeddedReviewSubmission | undefined,
  findings: LogicFinding[],
) {
  const groups = new Map<string, EmbeddedReviewSubmission["obligationReviews"]>()
  for (const review of submission?.obligationReviews ?? []) {
    const found = groups.get(review.obligationId) ?? []
    found.push(review)
    groups.set(review.obligationId, found)
  }
  return preparation.packets.flatMap((packet) =>
    packet.obligations.flatMap((obligation) => {
      const matches = groups.get(obligation.id) ?? []
      const prefix = `${obligation.path}:${obligation.line} 通用义务 ${obligation.id}`
      if (matches.length > 1) return [`${prefix} 被重复处置，按未验证风险保留。`]
      const review = matches[0]
      if (!review) return [`${prefix} 未被模型提交处置，不能据此认定该变更无风险。`]
      if (!nonempty(review.reason)) return [`${prefix} 的处置缺少具体理由，按未验证风险保留。`]
      if (review.disposition === "UNVERIFIED") return [`${prefix} 未验证：${review.reason.trim()}`]
      if (!review.evidence.length || !review.evidence.every((value) => reference(packet, value))) {
        return [`${prefix} 的 ${review.disposition} 处置缺少包内有效证据，按未验证风险保留。`]
      }
      if (review.disposition === "CONFIRMED" && !findings.some((finding) => finding.obligationId === obligation.id)) {
        return [`${prefix} 已确认，但没有通过证据门禁的 P0/P1 finding，按未验证风险保留。`]
      }
      return []
    }),
  )
}

function logical(
  preparation: EmbeddedReviewPreparation,
  candidates: EmbeddedReviewSubmission["logicFindings"],
  reviews: EmbeddedReviewSubmission["obligationReviews"],
): LogicFinding[] {
  const result: LogicFinding[] = []
  for (const finding of candidates) {
    const packet = preparation.packets.find(
      (item) =>
        item.path === finding.path &&
        item.changedLines.includes(finding.line) &&
        item.logicProfiles.some((profile) => profile.category === finding.category),
    )
    if (!packet || !["P0", "P1"].includes(finding.severity)) continue
    if (finding.obligationId) {
      const matches = reviews.filter((review) => review.obligationId === finding.obligationId)
      const review = matches.length === 1 ? matches[0] : undefined
      if (
        !review ||
        review.disposition !== "CONFIRMED" ||
        !nonempty(review.reason) ||
        !review.evidence.length ||
        !review.evidence.every((value) => reference(packet, value))
      ) {
        continue
      }
    }
    if (
      ![finding.trigger, finding.impact, finding.protectionCounterevidence].every(nonempty) ||
      !evidence(preparation, finding.pathEvidence) ||
      !strings(finding.causalChain)
    ) {
      continue
    }
    const location = anchor(preparation, finding)
    result.push({
      track: "LOGIC",
      category: finding.category,
      severity: finding.severity,
      ...(finding.obligationId ? { obligationId: finding.obligationId } : {}),
      path: location.path,
      line: location.line,
      trigger: finding.trigger.trim(),
      pathEvidence: finding.pathEvidence.map((item) => item.trim()),
      causalChain: finding.causalChain.map((item) => item.trim()),
      impact: finding.impact.trim(),
      protectionCounterevidence: finding.protectionCounterevidence.trim(),
    })
  }
  return dedupe(result, (item) => `${item.category}:${item.path}:${item.line}:${item.trigger}`)
}

function anchor(preparation: EmbeddedReviewPreparation, finding: EmbeddedReviewSubmission["logicFindings"][number]) {
  if (finding.category !== "REALTIME_CONCURRENCY") return { path: finding.path, line: finding.line }
  const refs = [...finding.pathEvidence, ...finding.causalChain].flatMap((value) =>
    [...value.matchAll(/([A-Za-z0-9_./-]+\.c):(\d+)(?:-(\d+))?/g)].map((match) => ({
      name: match[1] ?? "",
      start: Number(match[2]),
      end: Number(match[3] ?? match[2]),
    })),
  )
  for (const ref of refs) {
    const files = preparation.changes.files.filter(
      (file) => file.path === ref.name || path.basename(file.path) === ref.name,
    )
    if (files.length !== 1) continue
    const file = files[0]
    if (!file) continue
    for (let line = ref.start; line <= ref.end; line++) {
      if (!file.changedLines.includes(line)) continue
      const code = file.after.split(/\r?\n/)[line - 1] ?? ""
      if (/\bpending\b/.test(code) && /=\s*(?:0U?|false)\b/i.test(code)) {
        return { path: file.path, line }
      }
    }
  }
  return { path: finding.path, line: finding.line }
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonempty)
}

function evidence(preparation: EmbeddedReviewPreparation, values: unknown): values is string[] {
  if (!strings(values)) return false
  const refs = values.flatMap((value) => {
    const match = value.match(/^(.+):(\d+)(?=\s|$)/)
    if (!match?.[1] || !match[2]) return []
    return [{ path: match[1], line: Number(match[2]) }]
  })
  if (refs.length !== values.length) return false
  if (new Set(refs.map((item) => `${item.path}:${item.line}`)).size < 2) return false
  return refs.every((ref) =>
    preparation.packets.some((packet) => {
      return cited(packet, ref.path, ref.line)
    }),
  )
}

function reference(packet: EmbeddedReviewPreparation["packets"][number], value: string) {
  const match = value.trim().match(/^(.+):(\d+)(?=\s|$)/)
  if (!match?.[1] || !match[2]) return false
  return cited(packet, match[1], Number(match[2]))
}

function normalize(packet: EmbeddedReviewPreparation["packets"][number], values: string[]) {
  const paths = unique([packet.path, ...packet.relatedFunctions.map((fn) => fn.path)])
  return unique(
    values.flatMap((value) => {
      const exact = value.trim().match(/^(.+):(\d+)(?:-(\d+))?\b(.*)$/)
      if (exact?.[1] && exact[2]) {
        const matches = paths.filter((item) => item === exact[1] || path.basename(item) === exact[1])
        if (matches.length !== 1) return []
        const lines = unique([exact[2], exact[3] ?? exact[2]])
        return lines.map((line) => `${matches[0]}:${line}${exact[4] ?? ""}`)
      }
      const local = value.trim().match(/^lines?\s+(\d+)(?:-(\d+))?\s*:?\s*(.*)$/i)
      if (!local?.[1]) return []
      const lines = unique([local[1], local[2] ?? local[1]])
      return lines.map((line) => `${packet.path}:${line}${local[3] ? ` ${local[3]}` : ""}`)
    }),
  ).slice(0, 4)
}

function cited(packet: EmbeddedReviewPreparation["packets"][number], path: string, line: number) {
  if (packet.path === path) {
    if (packet.changedLines.includes(line)) return true
    if (packet.function && line >= packet.function.startLine && line <= packet.function.endLine) return true
    if (packet.function?.calls.some((call) => call.line === line)) return true
    if (packet.macros.some((macro) => macro.line === line)) return true
    if (packet.types.some((type) => type.line === line)) return true
  }
  return packet.relatedFunctions.some((fn) => fn.path === path && line >= fn.startLine && line <= fn.endLine)
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function dedupe<T>(values: T[], key: (value: T) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function directive(input: { title: string; body: string; file: string; line: number; priority: number }) {
  return `::code-comment{title="${attr(input.title)}" body="${attr(input.body)}" file="${attr(input.file)}" start=${input.line} end=${input.line} priority=${input.priority}}`
}

function attr(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
}
