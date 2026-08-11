import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { discoverDesignDocModule, extractLifecycleEvidence } from "@kilocode/kilo-indexing/design-doc"
import { buildEvidencePack, hasSufficientLifecycleEvidence } from "../../../src/kilocode/design-doc/evidence"

type Transition = readonly [from: string, to: string]

interface BenchmarkCase {
  name: string
  files: Record<string, string>
  supported: boolean
  states: string[]
  transitions: Transition[]
}

const root = await mkdtemp(path.join(tmpdir(), "kilo-design-doc-benchmark-"))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("Lifecycle 30 模块固定基准", () => {
  test("20 个正样本和 10 个负样本满足确定性覆盖门槛", async () => {
    const cases = benchmarkCases()
    const metrics = {
      stateTP: 0,
      stateFP: 0,
      stateFN: 0,
      transitionTP: 0,
      transitionFP: 0,
      transitionFN: 0,
    }
    let supported = 0
    let rejected = 0

    expect(cases).toHaveLength(30)
    expect(cases.filter((item) => item.supported)).toHaveLength(20)
    expect(cases.filter((item) => !item.supported)).toHaveLength(10)

    for (const [index, item] of cases.entries()) {
      const directory = path.join(root, `module-${String(index + 1).padStart(2, "0")}`)
      await mkdir(directory, { recursive: true })
      await Promise.all(
        Object.entries(item.files).map(async ([file, content]) => {
          const target = path.join(directory, file)
          await mkdir(path.dirname(target), { recursive: true })
          await Bun.write(target, content)
        }),
      )
      const module = await discoverDesignDocModule({
        workspace: root,
        targetPath: path.relative(root, directory),
      })
      const extraction = await extractLifecycleEvidence(module)
      const pack = buildEvidencePack({
        extraction,
        workItemID: `WI-${index + 1}`,
        maxItems: 256,
        maxPromptBytes: 256 * 1024,
        maxSnippetCharacters: 2_000,
      })
      const actualStates = new Set(
        pack.evidence
          .filter(
            (evidence) =>
              evidence.kind === "state-definition" &&
              evidence.confidence === "explicit" &&
              evidence.source.sourceKind !== "test",
          )
          .flatMap((evidence) => (typeof evidence.attributes.state === "string" ? [evidence.attributes.state] : [])),
      )
      const actualTransitions = new Set(
        pack.evidence
          .filter(
            (evidence) =>
              evidence.kind === "state-transition" &&
              evidence.confidence === "explicit" &&
              evidence.source.sourceKind !== "test",
          )
          .map((evidence) => `${evidence.attributes.from}->${evidence.attributes.to}`),
      )
      const expectedStates = new Set(item.states)
      const expectedTransitions = new Set(item.transitions.map(([from, to]) => `${from}->${to}`))

      accumulate(metrics, "state", actualStates, expectedStates)
      accumulate(metrics, "transition", actualTransitions, expectedTransitions)
      expect([...actualStates].sort(), `${item.name} 状态 oracle`).toEqual([...expectedStates].sort())
      expect([...actualTransitions].sort(), `${item.name} 迁移 oracle`).toEqual([...expectedTransitions].sort())
      expect(hasSufficientLifecycleEvidence(pack), `${item.name} 支持判定`).toBe(item.supported)
      if (item.supported) supported += 1
      else rejected += 1
    }

    expect(supported).toBe(20)
    expect(rejected).toBe(10)
    expect(ratio(metrics.stateTP, metrics.stateFP)).toBeGreaterThanOrEqual(0.95)
    expect(ratio(metrics.stateTP, metrics.stateFN)).toBeGreaterThanOrEqual(0.9)
    expect(ratio(metrics.transitionTP, metrics.transitionFP)).toBeGreaterThanOrEqual(0.95)
    expect(ratio(metrics.transitionTP, metrics.transitionFN)).toBeGreaterThanOrEqual(0.9)
  })
})

function accumulate(
  metrics: Record<string, number>,
  kind: "state" | "transition",
  actual: Set<string>,
  expected: Set<string>,
) {
  for (const value of actual) metrics[`${kind}${expected.has(value) ? "TP" : "FP"}`] += 1
  for (const value of expected) if (!actual.has(value)) metrics[`${kind}FN`] += 1
}

function ratio(matches: number, misses: number) {
  return matches + misses === 0 ? 1 : matches / (matches + misses)
}

function benchmarkCases(): BenchmarkCase[] {
  return [
    ...Array.from({ length: 5 }, (_, index) => typescriptIfCase(index + 1)),
    ...Array.from({ length: 5 }, (_, index) => typescriptSwitchCase(index + 1)),
    ...Array.from({ length: 5 }, (_, index) => cIfCase(index + 1)),
    ...Array.from({ length: 5 }, (_, index) => cSwitchCase(index + 1)),
    ...negativeCases(),
  ]
}

function typescriptIfCase(index: number): BenchmarkCase {
  const prefix = `ts_if_${index}`
  const states = [`${prefix}_idle`, `${prefix}_running`, `${prefix}_done`]
  const files: Record<string, string> = {
    "runner.ts": `export type RunnerState = "${states[0]}" | "${states[1]}" | "${states[2]}"
export class Runner${index} {
  state: RunnerState = "${states[0]}"
  start() { if (this.state === "${states[0]}") this.state = "${states[1]}" }
  finish() { if (this.state === "${states[1]}") this.state = "${states[2]}" }
}
`,
  }
  if (index === 5) {
    files["runner.test.ts"] = `type TestState = "fixture-idle" | "fixture-done"
class FixtureRunner { state: TestState = "fixture-idle"; finish() { if (this.state === "fixture-idle") this.state = "fixture-done" } }
`
  }
  return {
    name: `TypeScript if 迁移 ${index}`,
    files,
    supported: true,
    states,
    transitions: [
      [states[0], states[1]],
      [states[1], states[2]],
    ],
  }
}

function typescriptSwitchCase(index: number): BenchmarkCase {
  const states = [`PHASE_${index}_IDLE`, `PHASE_${index}_ACTIVE`, `PHASE_${index}_DONE`]
  return {
    name: `TypeScript switch 迁移 ${index}`,
    files: {
      "machine.ts": `export enum Lifecycle${index} { ${states[0]}, ${states[1]}, ${states[2]} }
export class Machine${index} {
  phase: Lifecycle${index} = Lifecycle${index}.${states[0]}
  advance() {
    switch (this.phase) {
      case Lifecycle${index}.${states[0]}: this.phase = Lifecycle${index}.${states[1]}; break
      case Lifecycle${index}.${states[1]}: this.phase = Lifecycle${index}.${states[2]}; break
    }
  }
}
`,
    },
    supported: true,
    states,
    transitions: [
      [states[0], states[1]],
      [states[1], states[2]],
    ],
  }
}

function cIfCase(index: number): BenchmarkCase {
  const states = [`C_IF_${index}_IDLE`, `C_IF_${index}_RUNNING`, `C_IF_${index}_DONE`]
  return {
    name: `C if 迁移 ${index}`,
    files: {
      "machine.c": `#define ${states[0]} 0
#define ${states[1]} 1
#define ${states[2]} 2
unsigned int status;
void machine_main(void) {
  status = ${states[0]};
  if (status == ${states[0]}) status = ${states[1]};
  if (status == ${states[1]}) status = ${states[2]};
}
`,
    },
    supported: true,
    states,
    transitions: [
      [states[0], states[1]],
      [states[1], states[2]],
    ],
  }
}

function cSwitchCase(index: number): BenchmarkCase {
  const states = [`C_SWITCH_${index}_IDLE`, `C_SWITCH_${index}_ACTIVE`, `C_SWITCH_${index}_CLOSED`]
  return {
    name: `C switch 迁移 ${index}`,
    files: {
      "machine.h": `#define ${states[0]} 0
#define ${states[1]} 1
#define ${states[2]} 2
typedef struct { unsigned int phase; } MACHINE_${index};
`,
      "machine.c": `#include "machine.h"
MACHINE_${index} machine;
void machine_main(void) {
  machine.phase = ${states[0]};
  switch (machine.phase) {
    case ${states[0]}: machine.phase = ${states[1]}; break;
    case ${states[1]}: machine.phase = ${states[2]}; break;
  }
}
`,
    },
    supported: true,
    states,
    transitions: [
      [states[0], states[1]],
      [states[1], states[2]],
    ],
  }
}

function negativeCases(): BenchmarkCase[] {
  return [
    {
      name: "TypeScript 单一状态",
      files: {
        "single.ts": `type State = "idle"\nclass Single { state: State = "idle" }\n`,
      },
      supported: false,
      states: [],
      transitions: [],
    },
    {
      name: "TypeScript 无迁移",
      files: {
        "no-transition.ts": `type State = "idle" | "running"\nclass NoFlow { state: State = "idle" }\n`,
      },
      supported: false,
      states: ["idle", "running"],
      transitions: [],
    },
    {
      name: "TypeScript 无 guard 赋值",
      files: {
        "unguarded.ts": `type State = "idle" | "running"\nclass Unsafe { state: State = "idle"; start() { this.state = "running" } }\n`,
      },
      supported: false,
      states: ["idle", "running"],
      transitions: [],
    },
    {
      name: "TypeScript 多状态字段",
      files: {
        "ambiguous.ts": `type State = "idle" | "running"\nclass Ambiguous { state: State = "idle"; status: State = "idle"; start() { if (this.state === "idle") this.state = "running" } }\n`,
      },
      supported: false,
      states: ["idle", "running"],
      transitions: [["idle", "running"]],
    },
    {
      name: "TypeScript 仅测试源码",
      files: {
        "runner.test.ts": `type State = "idle" | "running"\nclass TestRunner { state: State = "idle"; start() { if (this.state === "idle") this.state = "running" } }\n`,
      },
      supported: false,
      states: [],
      transitions: [],
    },
    {
      name: "C 单一状态",
      files: {
        "single.c": `#define ONLY_IDLE 0\nunsigned int status;\nvoid only_main(void) { status = ONLY_IDLE; }\n`,
      },
      supported: false,
      states: ["ONLY_IDLE"],
      transitions: [],
    },
    {
      name: "C 无 guard 赋值",
      files: {
        "unguarded.c": `#define C_IDLE 0\n#define C_RUNNING 1\nunsigned int status;\nvoid unsafe_main(void) { status = C_IDLE; }\nvoid start(void) { status = C_RUNNING; }\n`,
      },
      supported: false,
      states: ["C_IDLE", "C_RUNNING"],
      transitions: [],
    },
    {
      name: "C 多状态字段",
      files: {
        "ambiguous.c": `#define C_IDLE 0\n#define C_RUNNING 1\ntypedef struct { unsigned int state; unsigned int status; } BOTH;\nBOTH both;\nvoid both_main(void) { both.state = C_IDLE; if (both.state == C_IDLE) both.state = C_RUNNING; }\n`,
      },
      supported: false,
      states: ["C_IDLE", "C_RUNNING"],
      transitions: [["C_IDLE", "C_RUNNING"]],
    },
    {
      name: "C 缺少入口初始状态",
      files: {
        "no-entry.c": `#define C_WAIT 0\n#define C_DONE 1\nvoid advance(unsigned int status) { if (status == C_WAIT) status = C_DONE; }\n`,
      },
      supported: false,
      states: ["C_WAIT", "C_DONE"],
      transitions: [["C_WAIT", "C_DONE"]],
    },
    {
      name: "C 与 TypeScript 混合状态机不静默丢失",
      files: {
        "native.c": `#define NATIVE_IDLE 0\n#define NATIVE_DONE 1\nunsigned int status;\nvoid native_main(void) { status = NATIVE_IDLE; if (status == NATIVE_IDLE) status = NATIVE_DONE; }\n`,
        "web.ts": `type State = "web-idle" | "web-done"\nclass Web { state: State = "web-idle"; finish() { if (this.state === "web-idle") this.state = "web-done" } }\n`,
      },
      supported: false,
      states: ["NATIVE_IDLE", "NATIVE_DONE", "web-idle", "web-done"],
      transitions: [
        ["NATIVE_IDLE", "NATIVE_DONE"],
        ["web-idle", "web-done"],
      ],
    },
  ]
}
