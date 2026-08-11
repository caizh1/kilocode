#!/usr/bin/env bun
import { runBenchmark, writeBenchmarkReports, type BenchmarkMode } from "../src/services/qwen-autocomplete/benchmark"

type Cli = {
  mode?: BenchmarkMode
  fixturesPath?: string
  outputPath?: string
  repeat?: number
  cache?: boolean
  timeoutMs?: number
  endpoint?: string
  model?: string
  apiKeyEnv?: string
  redactPrompts?: boolean
}

const opts = parse(process.argv.slice(2))
const report = await runBenchmark(opts)
const output = await writeBenchmarkReports(report, opts.outputPath)

console.log("qwen-direct autocomplete benchmark complete")
console.log(`mode: ${report.mode}`)
console.log(`fixtures: ${report.summary.total}`)
console.log(`passed: ${report.summary.passed}`)
console.log(`failed: ${report.summary.failed}`)
console.log(`manualAcceptEligibleRate: ${report.summary.manualAcceptEligibleRate}`)
console.log(`json: ${output.jsonPath}`)
console.log(`markdown: ${output.markdownPath}`)

function parse(argv: string[]): Cli {
  const cli: Cli = {}
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]
    if (!item?.startsWith("--")) continue
    const key = item.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${key}`)
    index++
    assign(cli, key, value)
  }
  return cli
}

function assign(cli: Cli, key: string, value: string): void {
  if (key === "mode") {
    if (value !== "mock" && value !== "real") throw new Error("--mode must be mock or real")
    cli.mode = value
    return
  }
  if (key === "fixtures") {
    cli.fixturesPath = value
    return
  }
  if (key === "output") {
    cli.outputPath = value
    return
  }
  if (key === "repeat") {
    cli.repeat = positive(value, key)
    return
  }
  if (key === "cache") {
    cli.cache = bool(value, key)
    return
  }
  if (key === "timeout-ms") {
    cli.timeoutMs = positive(value, key)
    return
  }
  if (key === "endpoint") {
    cli.endpoint = value
    return
  }
  if (key === "model") {
    cli.model = value
    return
  }
  if (key === "api-key-env") {
    cli.apiKeyEnv = value
    return
  }
  if (key === "redact-prompts") {
    cli.redactPrompts = bool(value, key)
    return
  }
  throw new Error(`Unknown option --${key}`)
}

function positive(value: string, key: string): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) throw new Error(`--${key} must be a positive number`)
  return num
}

function bool(value: string, key: string): boolean {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`--${key} must be true or false`)
}
