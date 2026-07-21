import type { AgentConsoleActivityEvent } from "../src/types/messages/extension-messages"

export interface AgentConsoleActivityBlock {
  id: string
  time: number
  kind: "idle" | "run"
  data: string
  cwd?: string
  exitCode?: number
  running: boolean
  runId?: string
  source?: "direct" | "agent"
  callId?: string
  command?: string
}

export function mergeActivity(current: AgentConsoleActivityEvent[], incoming: AgentConsoleActivityEvent[]) {
  const by = new Map(current.map((event) => [event.seq, event]))
  for (const event of incoming) by.set(event.seq, event)
  return [...by.values()].sort((a, b) => a.seq - b.seq).slice(-5000)
}

export function activityBlocks(events: AgentConsoleActivityEvent[]): AgentConsoleActivityBlock[] {
  const blocks: AgentConsoleActivityBlock[] = []
  const active = new Map<string, AgentConsoleActivityBlock>()
  let latest: AgentConsoleActivityBlock | undefined

  for (const event of events) {
    if (event.kind === "idle") {
      const prev = blocks.at(-1)
      if (prev?.kind === "idle") {
        prev.data += event.data ?? ""
        continue
      }
      const block: AgentConsoleActivityBlock = {
        id: `terminal:${event.seq}`,
        time: event.time,
        kind: "idle",
        data: event.data ?? "",
        running: false,
      }
      blocks.push(block)
      continue
    }

    if (event.kind === "begin") {
      const block: AgentConsoleActivityBlock = {
        id: `terminal:${event.runId ?? event.seq}`,
        time: event.time,
        kind: "run",
        data: "",
        cwd: event.cwd,
        running: true,
        runId: event.runId,
        source: event.source,
        callId: event.callId,
        command: event.command,
      }
      blocks.push(block)
      latest = block
      if (event.runId) active.set(event.runId, block)
      continue
    }

    const block = (event.runId ? active.get(event.runId) : undefined) ?? latest
    if (!block) {
      const fallback: AgentConsoleActivityBlock = {
        id: `terminal:${event.seq}`,
        time: event.time,
        kind: "run",
        data: event.data ?? "",
        cwd: event.cwd,
        exitCode: event.exitCode,
        running: event.kind !== "end",
      }
      blocks.push(fallback)
      latest = fallback.running ? fallback : undefined
      continue
    }
    if (event.kind === "data") {
      block.data += event.data ?? ""
      continue
    }
    block.running = false
    block.cwd = event.cwd ?? block.cwd
    block.exitCode = event.exitCode
    if (block.runId) active.delete(block.runId)
    if (latest === block) latest = undefined
  }

  return blocks.slice(-120)
}
