export type RunnerMode = "monitor" | "shadow" | "release" | null

export const runStageLabels = {
  queued: "等待领取",
  diagnosing: "分析问题",
  fixing: "修改代码",
  testing: "运行测试",
  reviewing: "独立审查",
  approval_wait: "等待确认",
  packaging: "生成安装包",
  validating: "双平台验收",
  publishing: "发布新版本",
  released: "处理完成",
} as const

export type ProgressStage = keyof typeof runStageLabels

const repairStages: ProgressStage[] = [
  "queued",
  "diagnosing",
  "fixing",
  "testing",
  "reviewing",
  "approval_wait",
]

const releaseStages: ProgressStage[] = [
  ...repairStages,
  "packaging",
  "validating",
  "publishing",
  "released",
]

const terminalLabels: Record<string, string> = {
  failed: "流程已失败",
  cancelled: "流程已取消",
  revoked: "版本已撤回",
}

export function runProgress(stage: string, mode: RunnerMode) {
  const terminal = terminalLabels[stage]
  const hasReleaseStarted = releaseStages.slice(repairStages.length).includes(stage as ProgressStage)
  const stages = mode === "shadow" && !hasReleaseStarted ? repairStages : releaseStages
  if (terminal) {
    return {
      activeIndex: -1,
      label: terminal,
      percentage: 100,
      stages,
      terminal: true,
    }
  }
  const activeIndex = Math.max(0, stages.indexOf(stage as ProgressStage))
  return {
    activeIndex,
    label: runStageLabels[stages[activeIndex]!] ?? "准备处理",
    percentage: Math.round(((activeIndex + 1) / stages.length) * 100),
    stages,
    terminal: false,
  }
}
