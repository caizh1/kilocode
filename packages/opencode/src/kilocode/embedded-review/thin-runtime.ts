import { existsSync, lstatSync, readFileSync } from "node:fs"
import path from "node:path"
import { Process } from "@/util/process"
import { loadChangeSet } from "./change-set"
import { runMechanical } from "./mechanical"
import { latestRulePack, RulePackUnavailableError } from "./rules"
import type { ChangeSet, RulePack, StandardFinding, StandardStatus } from "./types"

export type ThinCategory =
  | "INTEGER_BOUNDARY"
  | "CONDITION_USE"
  | "LOCAL_RESOURCE"
  | "RETURN_ERROR"
  | "UNIT_WIDTH_ENDIAN"

export type ThinFinding = {
  category: ThinCategory
  severity: "P0" | "P1"
  path: string
  line: number
  trigger: string
  pathEvidence: string[]
  causalChain: string[]
  impact: string
  protectionCounterevidence: string
}

export type ThinSubmission = {
  findings: ThinFinding[]
}

export type ThinPreparation = {
  schemaVersion: 1
  changes: ChangeSet
  rulePack?: RulePack
  standard: {
    mechanicalStatus: StandardStatus
    findings: StandardFinding[]
    reason?: string
    evaluatedRuleIds: string[]
    unsupportedRuleIds: string[]
    semanticRuleIds: string[]
  }
  warnings: string[]
}

type State = {
  preparation: ThinPreparation
  submission?: ThinSubmission
}

const pinned = new Map<string, State>()
const MAX_PINNED = 16

const supported = [
  "INTEGER_BOUNDARY：整数溢出、回绕、截断、数组索引及显式长度/容量边界。",
  "CONDITION_USE：条件检查与后续实际使用值之间的直接矛盾。",
  "LOCAL_RESOURCE：单函数或直接调用范围内明确的申请、发布、释放闭环。",
  "RETURN_ERROR：显式返回值、错误码和调用方处理之间的直接冲突。",
  "UNIT_WIDTH_ENDIAN：代码中有明确类型、宏或转换证据的单位、位宽和端序冲突。",
]

const excluded = [
  "复杂跨函数所有权、环形队列、phase/epoch 和协议状态机。",
  "并发、中断、掉电恢复及持久化时序。",
  "缺少明确仓库证据的 MMIO、寄存器副作用和硬件行为。",
  "编译、链接、ABI、目标工具链及 AR/SR/需求符合性。",
  "编码规范中的语义规则、P2/P3、可维护性和优化建议。",
]

export namespace EmbeddedReviewThinRuntime {
  export async function prepare(input: {
    root: string
    arguments: string
    endpoint?: string
    abort?: AbortSignal
  }): Promise<ThinPreparation> {
    const changes = await loadChangeSet(input)
    const warnings = changes.skipped.map((item) => `${item.path}: ${item.reason}`)
    if (changes.scope.kind === "commit") {
      const current = await Process.run(["git", "rev-parse", "HEAD"], {
        cwd: changes.root,
        abort: input.abort,
        nothrow: true,
      })
      if (current.code !== 0 || current.stdout.toString().trim() !== changes.scope.commit) {
        warnings.push(
          "所审查 commit 不是当前工作树 HEAD；Read/Grep/Glob 读取的是当前工作树，跨文件上下文不保证属于目标快照。",
        )
      }
    }
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
          unsupportedRuleIds: [],
          semanticRuleIds: [],
        },
        warnings,
      }
    }
    const mechanical = runMechanical(changes.files, pack)
    const semanticRuleIds = pack.rules
      .filter((rule) => rule.level === "MUST" && rule.check === "semantic")
      .map((rule) => rule.id)
    const incomplete =
      mechanical.unsupportedRuleIds.length > 0 ||
      changes.skipped.some((item) => /\.(?:c|h|cc|hh|cpp|hpp|cxx|hxx|inc|inl)$/i.test(item.path))
    return {
      schemaVersion: 1,
      changes,
      rulePack: pack,
      standard: {
        mechanicalStatus: mechanical.findings.length ? "NON_COMPLIANT" : incomplete ? "NOT_EVALUATED" : "COMPLIANT",
        findings: mechanical.findings,
        ...(incomplete ? { reason: "至少有一个适用文件或机械 MUST 规则无法完成确定性检查。" } : {}),
        evaluatedRuleIds: mechanical.evaluatedRuleIds,
        unsupportedRuleIds: mechanical.unsupportedRuleIds,
        semanticRuleIds,
      },
      warnings,
    }
  }

  export function remember(sessionID: string, preparation: ThinPreparation) {
    pinned.delete(sessionID)
    pinned.set(sessionID, { preparation: compact(preparation) })
    if (pinned.size <= MAX_PINNED) return
    const oldest = pinned.keys().next().value
    if (oldest) pinned.delete(oldest)
  }

  export function active(sessionID: string) {
    return pinned.has(sessionID)
  }

  export function submitted(sessionID: string) {
    return pinned.get(sessionID)?.submission !== undefined
  }

  export function discard(sessionID: string) {
    pinned.delete(sessionID)
  }

  export function prompt(preparation: ThinPreparation) {
    return {
      schemaVersion: 1,
      mode: "thin",
      scope: preparation.changes.scope,
      supported,
      excluded,
      files: preparation.changes.files.map((file) => ({
        path: file.path,
        status: file.status,
        changedLines: file.changedLines,
        patch: file.patch,
      })),
      skipped: preparation.changes.skipped,
      rulePack: preparation.rulePack
        ? {
            version: preparation.rulePack.version,
            contentHash: preparation.rulePack.contentHash,
            publishedAt: preparation.rulePack.publishedAt,
          }
        : undefined,
      standard: {
        mechanicalStatus: preparation.standard.mechanicalStatus,
        findings: preparation.standard.findings,
        evaluatedRuleIds: preparation.standard.evaluatedRuleIds,
        unsupportedRuleIds: preparation.standard.unsupportedRuleIds,
        semanticRuleIds: preparation.standard.semanticRuleIds,
        reason: preparation.standard.reason,
      },
      warnings: preparation.warnings,
    }
  }

  export function submit(sessionID: string, submission: ThinSubmission) {
    const state = pinned.get(sessionID)
    if (!state) return { complete: true, error: "当前会话没有已固定的 Embedded Review。" }
    if (state.submission) return { complete: true, error: "薄 Runtime 只接受一次最终提交。" }
    state.submission = {
      findings: submission.findings.map((finding) => ({
        ...finding,
        pathEvidence: [...finding.pathEvidence],
        causalChain: [...finding.causalChain],
      })),
    }
    return {
      complete: true,
      received: state.submission.findings.length,
      instruction: "提交已固定。返回空 JSON 对象，最终报告由薄 Runtime 渲染。",
    }
  }

  export function seal(sessionID: string, _text: string) {
    const state = pinned.get(sessionID)
    if (!state) return undefined
    pinned.delete(sessionID)
    const preparation = state.preparation
    const checked = validate(preparation, state.submission?.findings ?? [])
    const logic = checked.findings
    const standard = preparation.standard.findings
    const submitted = state.submission !== undefined
    const warnings = [
      ...preparation.warnings,
      ...checked.rejected,
      ...(!submitted ? ["模型没有调用 embedded_review_submit；LOGIC 未完成评估。"] : []),
    ]
    const status = standard.length
      ? "NON_COMPLIANT"
      : !preparation.rulePack ||
          preparation.standard.mechanicalStatus === "NOT_EVALUATED" ||
          preparation.standard.semanticRuleIds.length > 0
        ? "NOT_EVALUATED"
        : "COMPLIANT"
    const verdict = logic.length ? "FAIL" : "PASS"
    const blockers = logic.length
      ? logic
          .map((finding, index) =>
            [
              `${index + 1}. ${finding.severity} ${finding.category} ${finding.path}:${finding.line}`,
              `   - 触发条件：${finding.trigger}`,
              `   - 执行路径：${finding.pathEvidence.join(" -> ")}`,
              `   - 因果链：${finding.causalChain.join(" -> ")}`,
              `   - 实际影响：${finding.impact}`,
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
    const rules = preparation.rulePack
      ? `${preparation.rulePack.version} ${preparation.rulePack.contentHash}`
      : "不可用"
    const output = [
      `VERDICT: ${verdict}`,
      "REVIEW_MODE: THIN",
      `LOGIC: ${submitted ? "EVALUATED" : "NOT_EVALUATED"}`,
      `STANDARD: ${status}`,
      `STANDARD_MECHANICAL: ${preparation.standard.mechanicalStatus}`,
      "STANDARD_SEMANTIC: NOT_EVALUATED",
      `RULEPACK: ${rules}`,
      "",
      "SUPPORTED LOGIC SCOPE:",
      ...supported.map((item) => `- ${item}`),
      "",
      "NOT EVALUATED:",
      ...excluded.map((item) => `- ${item}`),
      "",
      "P0/P1 BLOCKERS:",
      blockers,
      "",
      "STANDARD FINDINGS:",
      standards,
      "",
      "RUNTIME WARNINGS:",
      warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "无",
      "",
      "PASS 说明：PASS 只表示在上述 SUPPORTED LOGIC SCOPE 中未发现通过证据校验的 P0/P1，不表示代码不存在缺陷。",
      "",
      ...logic.map((finding) =>
        directive({
          title: `[${finding.severity}] ${finding.category}`,
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
    return { text: output, verdict, status, logic, standard, submitted, rejected: checked.rejected }
  }
}

function compact(preparation: ThinPreparation): ThinPreparation {
  return {
    ...preparation,
    changes: {
      ...preparation.changes,
      files: preparation.changes.files.map((file) => ({
        ...file,
        before: "",
        after: file.after
          .split(/\r?\n/)
          .map((line, index) => (file.changedLines.includes(index + 1) ? line : ""))
          .join("\n"),
        patch: "",
        hunks: [],
      })),
    },
    ...(preparation.rulePack ? { rulePack: { ...preparation.rulePack, rules: [] } } : {}),
  }
}

function validate(preparation: ThinPreparation, candidates: ThinFinding[]) {
  const findings: ThinFinding[] = []
  const rejected: string[] = []
  for (const finding of candidates) {
    const path = resolveFile(preparation, finding.path)
    const refs = finding.pathEvidence.map((value) => normalizeReference(preparation, value))
    const normalized = {
      ...finding,
      path: path ?? finding.path,
      pathEvidence: refs.filter((value): value is string => value !== undefined),
    }
    const reason =
      !path || refs.some((value) => value === undefined)
        ? "path 或 pathEvidence 包含不存在、越界、不唯一或不安全的 path:line 引用。"
        : invalid(preparation, normalized)
    if (reason) {
      rejected.push(`${finding.path}:${finding.line} ${finding.category} 未进入 blocker：${reason}`)
      continue
    }
    findings.push({
      ...normalized,
      trigger: normalized.trigger.trim(),
      pathEvidence: normalized.pathEvidence.map((item) => item.trim()).slice(0, 4),
      causalChain: normalized.causalChain.map((item) => item.trim()),
      impact: normalized.impact.trim(),
      protectionCounterevidence: normalized.protectionCounterevidence.trim(),
    })
  }
  return {
    findings: dedupe(findings, (finding) => `${finding.category}:${finding.path}:${finding.line}:${finding.trigger}`),
    rejected,
  }
}

function invalid(preparation: ThinPreparation, finding: ThinFinding) {
  const file = preparation.changes.files.find((item) => item.path === finding.path)
  if (!file || !file.changedLines.includes(finding.line)) return "位置不是本次变更后的 changed line。"
  if (
    ![
      finding.trigger,
      finding.impact,
      finding.protectionCounterevidence,
      ...finding.pathEvidence,
      ...finding.causalChain,
    ].every(nonempty)
  ) {
    return "触发条件、路径、因果链、影响或反证字段为空。"
  }
  if (finding.pathEvidence.length < 2) return "pathEvidence 少于两个关键引用。"
  if (!finding.causalChain.length) return "causalChain 为空。"
  return undefined
}

function normalizeReference(preparation: ThinPreparation, value: string) {
  const match = value.match(/^(.+?):(\d+)(?:-\d+)?(?=\s|$)/)
  if (!match?.[1] || !match[2]) return
  const line = Number(match[2])
  if (!Number.isSafeInteger(line) || line < 1) return
  const file = resolveFile(preparation, match[1])
  if (!file || !lineExists(preparation, file, line)) return
  return `${file}:${line}${value.slice(match[0].length)}`
}

function resolveFile(preparation: ThinPreparation, value: string) {
  const raw = path.isAbsolute(value) ? path.relative(preparation.changes.root, value) : value.replace(/^\.\//, "")
  if (!raw || raw.startsWith("..") || path.isAbsolute(raw)) return
  const exact = preparation.changes.files.find((item) => item.path === raw)
  if (exact) return exact.path
  const changed = preparation.changes.files.filter((item) => item.path.endsWith(`/${raw}`))
  if (changed.length === 1) return changed[0]?.path
  const target = path.resolve(preparation.changes.root, raw)
  if (target !== preparation.changes.root && !target.startsWith(`${preparation.changes.root}${path.sep}`)) return
  if (!existsSync(target)) return
  const info = lstatSync(target)
  if (!info.isFile() || info.isSymbolicLink()) return
  return raw
}

function lineExists(preparation: ThinPreparation, file: string, line: number) {
  const target = path.resolve(preparation.changes.root, file)
  const changed = preparation.changes.files.find((item) => item.path === file)
  if (changed) {
    const source = changed.status === "deleted" ? changed.before : changed.after
    return line <= source.split(/\r?\n/).length
  }
  if (!existsSync(target)) return false
  const info = lstatSync(target)
  if (!info.isFile() || info.isSymbolicLink()) return false
  return line <= readFileSync(target, "utf8").split(/\r?\n/).length
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function dedupe<T>(values: T[], key: (value: T) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function directive(input: { title: string; body: string; file: string; line: number; priority: number }) {
  return `::code-comment{title=${JSON.stringify(input.title)} body=${JSON.stringify(input.body)} file=${JSON.stringify(input.file)} start=${input.line} end=${input.line} priority=${input.priority}}`
}
