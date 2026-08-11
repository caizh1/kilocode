import { parentPort } from "node:worker_threads"
import type { CodeGraphFileGraph } from "../types"
import { parseCodeGraphFile } from "./cpp"

type ParseInput = Parameters<typeof parseCodeGraphFile>[0]

type Request = { id: number; type: "health" } | { id: number; type: "parse"; input: ParseInput }

type Response = { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string }

parentPort?.on("message", (msg: Request) => {
  try {
    if (msg.type === "health") {
      reply({ id: msg.id, ok: true, data: { healthy: true } })
      return
    }
    if (msg.type === "parse") {
      const graph: CodeGraphFileGraph = parseCodeGraphFile(msg.input)
      reply({ id: msg.id, ok: true, data: graph })
      return
    }
    reply({ id: (msg as { id: number }).id, ok: false, error: "Unknown code graph parser worker request." })
  } catch (err) {
    reply({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

function reply(msg: Response): void {
  parentPort?.postMessage(msg)
}
