import { UfsReviewAgent } from "./agent"
import type { Lane, LaneReport, ResolvedRequest } from "./types"
import type { Snapshot } from "./snapshot"

const definitions: Record<Lane["id"], Omit<Lane, "status" | "attempts">> = {
  architecture: {
    id: "architecture",
    agent: UfsReviewAgent.ROOT,
    title: "架构与长期维护性",
  },
  behavior: {
    id: "behavior",
    agent: UfsReviewAgent.ROOT,
    title: "UFS 行为、状态机与恢复",
  },
  reliability: {
    id: "reliability",
    agent: UfsReviewAgent.ROOT,
    title: "并发、硬件、资源与性能",
  },
  verification: {
    id: "verification",
    agent: UfsReviewAgent.ROOT,
    title: "构建、验证与兼容性",
  },
}

function critical(snapshot: Snapshot) {
  const paths = snapshot.files.map((file) => file.path.toLowerCase()).join("\n")
  return /(?:uic|link|dma|cache|irq|interrupt|queue|descriptor|register|power|reset|recovery)/.test(paths)
}

function crossModule(snapshot: Snapshot) {
  const roots = new Set(
    snapshot.files.map((file) => {
      const parts = file.path.split("/").filter(Boolean)
      return parts.length > 1 ? parts.slice(0, 2).join("/") : "."
    }),
  )
  return roots.size > 1
}

export function lanes(snapshot: Snapshot, effort: ResolvedRequest["effort"]): Lane[] {
  const base: Lane["id"][] = ["architecture", "behavior"]
  if (effort === "quick") return base.map(create)
  const changed = snapshot.additions + snapshot.deletions
  if (effort === "deep" || changed > 300 || snapshot.files.length > 10 || critical(snapshot) || crossModule(snapshot))
    return ([...base, "reliability", "verification"] satisfies Lane["id"][]).map(create)
  if (changed >= 100 || snapshot.files.length >= 4)
    return ([...base, "verification"] satisfies Lane["id"][]).map(create)
  return base.map(create)
}

function create(id: Lane["id"]): Lane {
  return { ...definitions[id], status: "pending", attempts: 0 }
}

function schema() {
  return JSON.stringify(
    {
      summary: "本方向审核摘要",
      findings: [
        {
          id: "lane-local-id",
          lane: "architecture|behavior|reliability|verification",
          severity: "P0|P1|P2|P3|A1|A2",
          locations: [{ path: "相对工作区路径", line: 1 }],
          trigger: "支持范围内的具体可达触发条件",
          causalChain: "从输入或事件到错误结果的完整执行链",
          impact: "实际影响",
          evidence: ["源码中的精确连续原文摘录，至少八个字符"],
          counterEvidenceChecked: ["检查过的 guard、锁、调用约束或恢复机制"],
          confidence: "high|medium|low",
          remediation: "修复方向",
          recheck: "修复后复核方法",
        },
      ],
      unverifiedRisks: ["证据不足但值得关注的风险"],
      validationCommands: [{ argv: ["make", "test"], reason: "命令目的" }],
    },
    null,
    2,
  )
}

export function lanePrompt(input: { snapshot: Snapshot; request: ResolvedRequest; lane: Lane; retry?: string }) {
  const files = input.snapshot.files
    .map((file) => `- ${file.path} (${file.exists ? file.hash.slice(0, 12) : "已删除"})`)
    .join("\n")
  return [
    `你负责专项方向：${input.lane.title}。`,
    `冻结审核范围：${input.snapshot.scopeLabel}`,
    `冻结内容源：${input.snapshot.source.kind === "worktree" ? "当前工作树" : input.snapshot.source.kind === "index" ? "Git Index" : `Git Tree ${input.snapshot.source.ref}`}`,
    `源码指纹：${input.snapshot.fingerprint}`,
    `规模：${input.snapshot.files.length} 个文件，+${input.snapshot.additions}/-${input.snapshot.deletions}`,
    `构建配置摘要：${input.snapshot.configuration.length ? input.snapshot.configuration.map((file) => `${file.path}:${file.hash.slice(0, 12)}`).join("，") : "未发现根目录已知构建配置"}`,
    input.snapshot.diffCommand ? `只读差异命令：${input.snapshot.diffCommand}` : undefined,
    input.snapshot.source.kind === "worktree"
      ? undefined
      : "当前工作树可能包含范围外修改；必须以冻结内容源和只读差异命令为准，不得把工作树中的额外内容当成审核目标或证据。",
    input.request.guidance ? `用户额外关注点：${input.request.guidance}` : "用户没有额外关注点。",
    "额外关注点不限制开放式审查。你必须自主探索必要的调用者、被调用者、状态定义、硬件接口和测试，但结论必须绑定当前范围中的实际风险。",
    "审核文件：",
    files || "（没有文件）",
    "P0/P1 必须同时满足：当前存在、支持范围内可达、完整因果链、严重影响、足以阻止合并/发布、证据确定。代码风格、单纯缺测试、可选重构和缺少上下文不能判为 P0/P1。",
    "A1 仅用于已经明显阻碍安全演进、人工理解或可靠验证的架构缺陷；A2 用于非阻塞架构改进。",
    "evidence 必须填写当前源码中的精确连续原文摘录；不得只写解释或路径。每个 P0/P1/A1 必须在 counterEvidenceChecked 中记录反证检查。",
    "validationCommands 只提出确有必要、可直接以 argv 执行、不会主动改源码的编译/静态检查/测试；不需要时返回空数组。禁止 shell 运算符、重定向和 Git 写操作。",
    input.retry ? `上次输出校验失败：${input.retry}。这是唯一一次格式重试，请完整修正。` : undefined,
    "严格返回以下结构化对象，不要添加其他文字：",
    schema(),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
}

export function coordinatorPrompt(input: {
  snapshot: Snapshot
  request: ResolvedRequest
  reports: Array<{ lane: Lane; report: LaneReport }>
  validation: unknown[]
  retry?: string
}) {
  return [
    "请对以下 UFS 专项报告执行最终对抗复核。",
    `冻结范围：${input.snapshot.scopeLabel}`,
    `源码指纹：${input.snapshot.fingerprint}`,
    input.request.guidance ? `用户额外关注点：${input.request.guidance}` : undefined,
    "你的任务是合并重复项、检查严重级别、因果链和反证记录。不得因为多个 Reviewer 同意就采纳；只能保留能由输入证据支持的内容。证据不足的候选项放入 unverifiedRisks。不得自行新增没有专项报告证据的问题。",
    "P0/P1 只表示足以阻止批准、合并或发布的严重且可达缺陷。A1/A2 只影响架构门禁。不要输出 VERDICT；Runtime 会在证据校验后确定性计算门禁。",
    `专项报告：\n${JSON.stringify(input.reports, null, 2)}`,
    `已确认执行或拒绝的验证：\n${JSON.stringify(input.validation, null, 2)}`,
    input.retry ? `上次输出校验失败：${input.retry}。这是唯一一次格式重试，请完整修正。` : undefined,
    "严格返回以下结构化对象，不要添加其他文字：",
    schema(),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
}
