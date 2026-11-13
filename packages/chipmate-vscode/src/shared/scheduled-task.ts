export type {
  ScheduledTask,
  ScheduledRun,
  TaskDefinition,
  ScheduleRule,
  SchedulerCommand,
  SchedulerState,
} from "@opencode-ai/core/chipmate/scheduler/types"
import type { SchedulerState, SchedulerCommand } from "@opencode-ai/core/chipmate/scheduler/types"
export type SchedulerOptions = {
  agents: string[]
  models: { id: string; label: string }[]
  sessions: { id: string; title: string }[]
}
export type SchedulerViewState = SchedulerState & {
  directories: string[]
  options?: SchedulerOptions
  selected?: string
}
export type SchedulerMessage =
  | { type: "scheduler.ready" }
  | { type: "scheduler.options"; directory: string }
  | { type: "scheduler.command"; directory: string; command: SchedulerCommand }
  | { type: "scheduler.openSession"; sessionID: string; directory: string }
