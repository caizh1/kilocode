import { createInterface } from "node:readline"
import { createIndexingHost } from "./indexing-host"
import { INDEXING_PROCESS_PREFIX, isIndexingRequest, type Event, type Result } from "./indexing-worker-protocol"
import { indexingBudget, pressureFor, type IndexingPressure } from "./indexing-memory"

const budget = indexingBudget()

function send(message: Result | Event) {
  process.stdout.write(`${INDEXING_PROCESS_PREFIX}${JSON.stringify(message)}\n`)
}

const host = createIndexingHost(send)
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
let pressure: IndexingPressure = process.env.CHIPMATE_INDEXING_FORCED_LOW === "1" ? "forced-low" : "normal"
let recovered = 0
let critical = 0
let hard = 0
let rolling = false
host.pressure(pressure)
const timer = setInterval(() => {
  const stat = process.memoryUsage()
  const next = pressureFor(stat.rss, budget, pressure, recovered)
  recovered = next.recovered
  if (next.pressure !== pressure) {
    pressure = next.pressure
    host.pressure(pressure)
  }
  send({
    type: "event",
    event: "resource",
    data: {
      rss: stat.rss,
      heapUsed: stat.heapUsed,
      heapTotal: stat.heapTotal,
      external: stat.external,
      arrayBuffers: stat.arrayBuffers,
      pressure,
      budget,
    },
  })
  if (stat.rss < budget.hard) {
    hard = 0
  } else if (stat.rss >= budget.hard + Math.max(256 * 1024 * 1024, Math.floor(budget.hard * 0.25))) {
    process.stderr.write(`Indexing process exceeded RSS limit: ${stat.rss} >= ${budget.hard}\n`)
    process.exit(86)
  } else if (hard === 0) {
    hard = Date.now()
  } else if (Date.now() - hard >= positive(process.env.CHIPMATE_INDEXING_HARD_HOLD_MS, 5_000)) {
    process.stderr.write(`Indexing process exceeded RSS limit: ${stat.rss} >= ${budget.hard}\n`)
    process.exit(86)
  }
  if (stat.rss < budget.critical) {
    critical = 0
    return
  }
  if (critical === 0) {
    critical = Date.now()
    return
  }
  const hold = positive(process.env.CHIPMATE_INDEXING_CRITICAL_HOLD_MS, 10_000)
  if (rolling || Date.now() - critical < hold) return
  rolling = true
  process.stderr.write(
    `Indexing process is rolling over under sustained memory pressure: ${stat.rss} >= ${budget.critical}\n`,
  )
  clearInterval(timer)
  void host.checkpoint().finally(() => process.exit(87))
}, 500)

const stop = async () => {
  clearInterval(timer)
  await host.dispose()
}

process.once("SIGTERM", () => {
  void stop().finally(() => process.exit(0))
})
process.once("SIGINT", () => {
  void stop().finally(() => process.exit(0))
})

for await (const line of input) {
  const text = line.trim()
  if (!text) continue
  const value: unknown = JSON.parse(text)
  if (!isIndexingRequest(value)) throw new Error("Invalid indexing process request.")
  await host.handle(value)
  if (value.method !== "dispose") continue
  break
}

await stop()

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}
