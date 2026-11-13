export type ScheduleRule =
  | { kind: "once"; at: string }
  | { kind: "interval"; minutes: number; anchor: string }
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "monthly"; day: number; time: string }

export type TaskDefinition = {
  name: string
  prompt: string
  timezone: string
  schedule: ScheduleRule
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
  sessionID?: string
  timeoutMinutes: number
}

export type ScheduledTask = TaskDefinition & {
  id: string
  directory: string
  version: number
  status: "enabled" | "paused" | "finished" | "deleted"
  nextAt: number | null
  createdAt: number
}

export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "skipped"
export type ScheduledRun = {
  directory: string
  id: string
  taskID: string
  taskVersion: number
  scheduledAt: number
  createdAt: number
  startedAt?: number
  endedAt?: number
  status: RunStatus
  reason?: string
  sessionID?: string
  messageID: string
  owner: string
  snapshot: TaskDefinition
  missedCount?: number
  missedThrough?: number
}

export type SchedulerAction =
  | "create"
  | "list"
  | "get"
  | "update"
  | "pause"
  | "resume"
  | "delete"
  | "run_now"
  | "runs"
  | "get_run"
  | "cancel_run"
  | "preview"
export type SchedulerCommand = {
  action: SchedulerAction
  taskID?: string
  runID?: string
  version?: number
  key?: string
  definition?: TaskDefinition
}
export type SchedulerState = { tasks: ScheduledTask[]; runs: ScheduledRun[]; serverTime: number }
