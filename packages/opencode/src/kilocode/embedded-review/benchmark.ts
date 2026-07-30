import type { LogicCategory } from "./types"
import { LOGIC_RISK_PAIRS } from "./risk-benchmark-cases"

export type BenchmarkExpectation =
  | { track: "STANDARD"; ruleId: string }
  | { track: "LOGIC"; category: LogicCategory; severity: "P0" | "P1"; line: number }
  | { track: "CLEAN" }

export type BenchmarkCase = {
  id: string
  pair: string
  language: "c" | "cpp"
  source: string
  expected: BenchmarkExpectation
}

type Pair = {
  id: string
  language?: "c" | "cpp"
  defect: string
  clean: string
  expected: Exclude<BenchmarkExpectation, { track: "CLEAN" }>
}

const pairs: Pair[] = [
  standard("trailing-space", "int status = 0; \n", "int status = 0;\n", "C-014"),
  standard("assignment-space", "status=read_status();\n", "status = read_status();\n", "C-015"),
  standard("compound-assignment-space", "flags|=READY;\n", "flags |= READY;\n", "C-015"),
  standard("array-adjacency", "value = samples [index];\n", "value = samples[index];\n", "C-018"),
  standard("member-adjacency", "value = state -> value;\n", "value = state->value;\n", "C-018"),
  standard("call-adjacency", "status = read_status ();\n", "status = read_status();\n", "C-018"),
  standard("open-brace-line", "if (ready) {\n    start();\n}\n", "if (ready)\n{\n    start();\n}\n", "C-035"),
  standard("else-line", "}\nelse {\n    stop();\n}\n", "}\nelse\n{\n    stop();\n}\n", "C-011"),
  standard(
    "header-guard",
    "int motor_start(void);\n",
    "#ifndef MOTOR_H\n#define MOTOR_H\nint motor_start(void);\n#endif\n",
    "C-038",
  ),
  standard("pragma-once", "int sensor_read(void);\n", "#pragma once\nint sensor_read(void);\n", "C-038"),
  standard("paren-padding", "if ( ready )\n{\n}\n", "if (ready)\n{\n}\n", "C-011"),
  standard("close-brace-line", "} else\n{\n}\n", "}\nelse\n{\n}\n", "C-035"),
  logic(
    "null-guard-inversion",
    "MEMORY_SECURITY",
    "void run(ctx_t *ctx)\n{\n    if (ctx != NULL)\n    {\n        return;\n    }\n    ctx->ready = 1;\n}\n",
    "void run(ctx_t *ctx)\n{\n    if (ctx == NULL)\n    {\n        return;\n    }\n    ctx->ready = 1;\n}\n",
    3,
  ),
  logic(
    "buffer-upper-bound",
    "MEMORY_SECURITY",
    "void clear(uint8_t *buf, size_t len)\n{\n    for (size_t i = 0; i <= len; i++)\n    {\n        buf[i] = 0U;\n    }\n}\n",
    "void clear(uint8_t *buf, size_t len)\n{\n    for (size_t i = 0; i < len; i++)\n    {\n        buf[i] = 0U;\n    }\n}\n",
    3,
  ),
  logic(
    "timeout-unit",
    "CONTROL_CONTRACT",
    "void arm(uint32_t timeout_ms)\n{\n    timer_set_us(timeout_ms);\n}\n",
    "void arm(uint32_t timeout_ms)\n{\n    timer_set_us(timeout_ms * 1000U);\n}\n",
    3,
  ),
  logic(
    "double-endian-conversion",
    "CONTROL_CONTRACT",
    "uint16_t decode(uint16_t wire_be)\n{\n    uint16_t host = ntohs(wire_be);\n    return ntohs(host);\n}\n",
    "uint16_t decode(uint16_t wire_be)\n{\n    return ntohs(wire_be);\n}\n",
    4,
  ),
  logic(
    "lock-error-leak",
    "RESOURCE_LIFECYCLE",
    "int update(void)\n{\n    lock();\n    if (write_reg() != 0)\n    {\n        return -1;\n    }\n    unlock();\n    return 0;\n}\n",
    "int update(void)\n{\n    lock();\n    if (write_reg() != 0)\n    {\n        unlock();\n        return -1;\n    }\n    unlock();\n    return 0;\n}\n",
    4,
  ),
  logic(
    "irq-restore",
    "REALTIME_CONCURRENCY",
    "void critical(void)\n{\n    irq_disable();\n    if (!ready())\n    {\n        return;\n    }\n    irq_enable();\n}\n",
    "void critical(void)\n{\n    irq_disable();\n    if (!ready())\n    {\n        irq_enable();\n        return;\n    }\n    irq_enable();\n}\n",
    4,
  ),
  logic(
    "allocation-cleanup",
    "RESOURCE_LIFECYCLE",
    "int start(void)\n{\n    void *mem = alloc();\n    if (device_open() != 0)\n    {\n        return -1;\n    }\n    free(mem);\n    return 0;\n}\n",
    "int start(void)\n{\n    void *mem = alloc();\n    if (device_open() != 0)\n    {\n        free(mem);\n        return -1;\n    }\n    free(mem);\n    return 0;\n}\n",
    4,
  ),
  logic(
    "state-transition",
    "CONTROL_CONTRACT",
    "int start(device_t *dev)\n{\n    if (dev->state != STATE_IDLE)\n    {\n        dev->state = STATE_RUNNING;\n        return 0;\n    }\n    return -1;\n}\n",
    "int start(device_t *dev)\n{\n    if (dev->state == STATE_IDLE)\n    {\n        dev->state = STATE_RUNNING;\n        return 0;\n    }\n    return -1;\n}\n",
    3,
  ),
  logic(
    "return-contract",
    "CONTROL_CONTRACT",
    "int boot(void)\n{\n    int status = hw_init();\n    if (status != 0)\n    {\n        return 0;\n    }\n    return status;\n}\n",
    "int boot(void)\n{\n    int status = hw_init();\n    if (status != 0)\n    {\n        return status;\n    }\n    return 0;\n}\n",
    5,
  ),
  logic(
    "signed-length",
    "MEMORY_SECURITY",
    "int receive(int len)\n{\n    uint8_t buf[16];\n    if (len <= 16)\n    {\n        read_bytes(buf, (size_t)len);\n    }\n    return 0;\n}\n",
    "int receive(int len)\n{\n    uint8_t buf[16];\n    if ((len >= 0) && (len <= 16))\n    {\n        read_bytes(buf, (size_t)len);\n    }\n    return 0;\n}\n",
    4,
  ),
  logic(
    "shift-width",
    "MEMORY_SECURITY",
    "uint32_t mask(uint32_t bit)\n{\n    if (bit <= 32U)\n    {\n        return 1U << bit;\n    }\n    return 0U;\n}\n",
    "uint32_t mask(uint32_t bit)\n{\n    if (bit < 32U)\n    {\n        return 1U << bit;\n    }\n    return 0U;\n}\n",
    3,
  ),
  logic(
    "timeout-wrap",
    "CONTROL_CONTRACT",
    "bool expired(uint32_t now, uint32_t deadline)\n{\n    return now > deadline;\n}\n",
    "bool expired(uint32_t now, uint32_t deadline)\n{\n    return (int32_t)(now - deadline) > 0;\n}\n",
    3,
  ),
  ...LOGIC_RISK_PAIRS,
]

export const EMBEDDED_REVIEW_CASES: BenchmarkCase[] = pairs.flatMap((pair) => [
  {
    id: `${pair.id}-defect`,
    pair: pair.id,
    language: pair.language ?? "c",
    source: pair.defect,
    expected: pair.expected,
  },
  {
    id: `${pair.id}-clean`,
    pair: pair.id,
    language: pair.language ?? "c",
    source: pair.clean,
    expected: { track: "CLEAN" },
  },
])

export type BenchmarkObservation = {
  id: string
  findings: Array<{
    track: "STANDARD" | "LOGIC"
    ruleId?: string
    category?: LogicCategory
    severity?: "P0" | "P1" | "P2" | "P3"
    evidenceValid: boolean
  }>
}

export function scoreBenchmark(observations: BenchmarkObservation[]) {
  const actual = new Map(observations.map((item) => [item.id, item.findings]))
  const defects = EMBEDDED_REVIEW_CASES.filter((item) => item.expected.track !== "CLEAN")
  const logicCases = defects.filter((item) => item.expected.track === "LOGIC")
  const found = (item: BenchmarkCase) => (actual.get(item.id) ?? []).some((finding) => matches(item, finding))
  const recall = (category: LogicCategory) => {
    const cases = logicCases.filter((item) => item.expected.track === "LOGIC" && item.expected.category === category)
    return ratio(cases.filter(found).length, cases.length)
  }
  const categoryRecall: Record<LogicCategory, number> = {
    CONTROL_CONTRACT: recall("CONTROL_CONTRACT"),
    MEMORY_SECURITY: recall("MEMORY_SECURITY"),
    REALTIME_CONCURRENCY: recall("REALTIME_CONCURRENCY"),
    RESOURCE_LIFECYCLE: recall("RESOURCE_LIFECYCLE"),
    UPDATE_PERSISTENCE: recall("UPDATE_PERSISTENCE"),
  }
  const cleanCases = EMBEDDED_REVIEW_CASES.filter((item) => item.expected.track === "CLEAN")
  const all = observations.flatMap((item) => item.findings)
  const correct = observations.flatMap((observation) => {
    const item = EMBEDDED_REVIEW_CASES.find((candidate) => candidate.id === observation.id)
    if (!item) return []
    return observation.findings.filter((finding) => finding.evidenceValid && matches(item, finding))
  })
  const falseClean = cleanCases.filter((item) => (actual.get(item.id) ?? []).length > 0)
  return {
    caseCount: EMBEDDED_REVIEW_CASES.length,
    defectRecall: ratio(defects.filter(found).length, defects.length),
    logicRecall: ratio(logicCases.filter(found).length, logicCases.length),
    categoryRecall,
    findingPrecision: ratio(correct.length, all.length),
    cleanFalsePositiveRate: ratio(falseClean.length, cleanCases.length),
    blockerEvidenceValidity: ratio(
      all
        .filter((finding) => finding.severity === "P0" || finding.severity === "P1")
        .filter((finding) => finding.evidenceValid).length,
      all.filter((finding) => finding.severity === "P0" || finding.severity === "P1").length,
    ),
  }
}

function matches(item: BenchmarkCase, finding: BenchmarkObservation["findings"][number]) {
  if (item.expected.track === "STANDARD") {
    return finding.track === "STANDARD" && finding.ruleId === item.expected.ruleId
  }
  if (item.expected.track === "LOGIC") {
    return (
      finding.track === "LOGIC" &&
      finding.category === item.expected.category &&
      finding.severity === item.expected.severity
    )
  }
  return false
}

export type BenchmarkMode = "direct" | "b0" | "v1" | "runtime"

export function scoreBenchmarkModes(observations: Array<BenchmarkObservation & { mode: BenchmarkMode }>) {
  const score = (mode: BenchmarkMode) => scoreBenchmark(observations.filter((item) => item.mode === mode))
  return {
    direct: score("direct"),
    b0: score("b0"),
    v1: score("v1"),
    runtime: score("runtime"),
  }
}

export function b0Prompt(review: string) {
  return review
    .split(/\r?\n/)
    .filter(
      (line) =>
        !["- code style", "- clean code", "- naming", "- formatting", "- lint-only issues"].includes(line.trim()),
    )
    .join("\n")
}

function standard(id: string, defect: string, clean: string, ruleId: string): Pair {
  return { id, defect, clean, expected: { track: "STANDARD", ruleId } }
}

function logic(id: string, category: LogicCategory, defect: string, clean: string, line: number): Pair {
  return { id, defect, clean, expected: { track: "LOGIC", category, severity: "P1", line } }
}

function ratio(value: number, total: number) {
  return total === 0 ? 1 : value / total
}
