export const LONG_RUNNING_TASK_HEADER = "x-chipmate-long-running-task"

export function consumeLongRunningTaskHeader(init: BunFetchRequestInit | undefined) {
  if (!init?.headers) return { init, longRunning: false }
  const headers = new Headers(init.headers as HeadersInit)
  const longRunning = headers.get(LONG_RUNNING_TASK_HEADER) === "patent-radar"
  if (!longRunning) return { init, longRunning: false }
  headers.delete(LONG_RUNNING_TASK_HEADER)
  return { init: { ...init, headers }, longRunning: true }
}
