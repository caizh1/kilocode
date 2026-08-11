import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import {
  DesignDocDiscoveryError,
  discoverDesignDocModule,
  discoverDesignDocModules,
  discoverDesignDocUnits,
  extractBehaviorEvidence,
  extractCLifecycleEvidence,
  extractCodeStructureEvidence,
  extractOverviewEvidence,
  extractRootComponentBehaviorEvidence,
  extractStructureEvidence,
  extractTypeScriptLifecycleEvidence,
} from "../../../src/design-doc"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("行为证据提取", () => {
  test("父模块只聚合有源码证据的跨组件调用和数据交接", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "module", "main.c"), `int child(int value);\nstatic int local(int value) { return value; }\nint run(int value) { return child(local(value)); }\n`)
    await Bun.write(path.join(root, "module", "child.c"), `int child(int value) { return value + 1; }\n`)
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractRootComponentBehaviorEvidence(module)
    const flows = result.evidence.filter((item) => item.kind === "flow-edge")
    const data = result.evidence.filter((item) => item.kind === "data-flow")

    expect(flows).toHaveLength(1)
    expect(flows[0]?.attributes.fromRef).toBe("root-component:module/main.c")
    expect(flows[0]?.attributes.toRef).toBe("root-component:module/child.c")
    expect(flows[0]?.attributes.label).toBe("跨组件调用：child")
    expect(data).toHaveLength(1)
    expect(data[0]?.attributes.label).toBe("通过 child 传递请求与结果")
    expect(flows.some((item) => item.attributes.label === "跨组件调用：local")).toBe(false)
  })

  test("提取 TypeScript 执行步骤、调用消息、数据流和异常路径", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.ts"),
      `export function persist(value: string) { return value }
export function run(input: string) {
  let output = input
  if (input) output = persist(input)
  if (!output) throw new Error("empty")
  return output
}
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractBehaviorEvidence(module)

    expect(result.evidence.some((item) => item.kind === "flow-node" && item.attributes.nodeKind === "entry")).toBe(
      true,
    )
    expect(result.evidence.some((item) => item.kind === "flow-edge")).toBe(true)
    expect(
      result.evidence.filter((item) => item.kind === "flow-edge").every((item) => typeof item.attributes.label === "string"),
    ).toBe(true)
    expect(
      result.evidence.some(
        (item) => item.kind === "call-message" && item.attributes.callKind === "internal" && item.attributes.label === "persist",
      ),
    ).toBe(true)
    expect(result.evidence.some((item) => item.kind === "data-flow" && item.attributes.flowKind === "write")).toBe(
      true,
    )
    expect(result.evidence.some((item) => item.kind === "error-node")).toBe(true)
    expect(result.unknowns).toEqual([])
  })

  test("建立 if/else、循环回边和 try/catch/retry/fallback 的真实关系", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "control.ts"),
      `export function run(input: number) {
  let value = input
  if (input > 0) value = 1
  else value = -1
  while (value < 3) value += 1
  try {
    if (!value) throw new Error("empty")
  } catch (error) {
    retry(value)
    return 0
  }
  return value
}
declare function retry(value: number): void
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractBehaviorEvidence(module)
    const edgeKinds = result.evidence
      .filter((item) => item.kind === "flow-edge")
      .map((item) => item.attributes.edgeKind)
    const errorKinds = result.evidence
      .filter((item) => item.kind === "error-node")
      .map((item) => item.attributes.nodeKind)
    const errorEdges = result.evidence
      .filter((item) => item.kind === "error-edge")
      .map((item) => item.attributes.edgeKind)

    expect(edgeKinds).toContain("branch-true")
    expect(edgeKinds).toContain("branch-false")
    expect(edgeKinds).toContain("loop")
    expect(edgeKinds).toContain("error")
    expect(errorKinds).toEqual(expect.arrayContaining(["raise", "handler", "retry", "fallback"]))
    expect(errorEdges).toEqual(expect.arrayContaining(["error", "handle", "retry", "fallback"]))
    expect(
      result.evidence.filter((item) => item.kind === "error-edge").every((item) => typeof item.attributes.label === "string"),
    ).toBe(true)
  })

  test("break 离开循环而 continue 只回到循环条件", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "loop.ts"),
      `export function run(values: number[]) {
  for (const value of values) {
    if (value < 0) continue
    if (value === 0) break
    consume(value)
  }
  finish()
}
declare function consume(value: number): void
declare function finish(): void
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractBehaviorEvidence(module)
    const nodes = result.evidence.filter((item) => item.kind === "flow-node")
    const edges = result.evidence.filter((item) => item.kind === "flow-edge")
    const breakRef = nodes.find((item) => String(item.attributes.label).startsWith("break"))?.attributes.ref
    const continueRef = nodes.find((item) => String(item.attributes.label).startsWith("continue"))?.attributes.ref
    const finishRef = nodes.find((item) => String(item.attributes.label).startsWith("finish()"))?.attributes.ref

    expect(edges.some((item) => item.attributes.fromRef === continueRef && item.attributes.edgeKind === "loop")).toBe(
      true,
    )
    expect(
      edges.some(
        (item) =>
          item.attributes.fromRef === breakRef &&
          item.attributes.toRef === finishRef &&
          item.attributes.edgeKind === "next",
      ),
    ).toBe(true)
    expect(edges.some((item) => item.attributes.fromRef === breakRef && item.attributes.edgeKind === "loop")).toBe(
      false,
    )
  })

  test("提取环境配置以及数据库、缓存、文件和外部 API 数据流", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "io.ts"),
      `export async function load(id: string) {
  const endpoint = process.env.API_ENDPOINT
  const cached = cache.get(id)
  const remote = await fetch(endpoint + id)
  await database.save(remote)
  await writeFile("result.json", remote)
  return cached
}
declare const cache: { get(id: string): string }
declare const database: { save(value: unknown): Promise<void> }
declare function writeFile(path: string, value: unknown): Promise<void>
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractBehaviorEvidence(module)

    expect(
      result.evidence.some(
        (item) => item.kind === "configuration" && item.attributes.key === "API_ENDPOINT",
      ),
    ).toBe(true)
    expect(
      result.evidence
        .filter((item) => item.kind === "data-entity")
        .map((item) => item.attributes.entityKind),
    ).toEqual(expect.arrayContaining(["store", "external"]))
    expect(
      result.evidence
        .filter((item) => item.kind === "data-flow")
        .map((item) => item.attributes.flowKind),
    ).toEqual(expect.arrayContaining(["read", "write", "transfer"]))
    expect(
      result.evidence.filter((item) => item.kind === "data-flow").every((item) => typeof item.attributes.label === "string"),
    ).toBe(true)
  })

  test("提取 C 函数执行、内部调用和返回数据流", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.c"),
      `static int helper(int value) { return value; }
int run(int input) {
  int output = input;
  if (input > 0) output = helper(input);
  return output;
}
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractBehaviorEvidence(module)

    expect(result.evidence.filter((item) => item.kind === "flow-node" && item.attributes.nodeKind === "entry")).toHaveLength(2)
    expect(
      result.evidence.some(
        (item) => item.kind === "call-message" && item.attributes.callKind === "internal" && item.attributes.label === "helper",
      ),
    ).toBe(true)
    expect(result.evidence.some((item) => item.kind === "data-flow" && item.attributes.flowKind === "return")).toBe(
      true,
    )
    expect(result.unknowns).toEqual([])
  })

  test("把 C ASSERT 前置条件提取为有证据的终止异常流", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.c"),
      `#define ASSERT(X) if (!(X)) { while (1) {} }
#define CHECK(X) log_check(X)
#define TRACE(X) log("while(1)", X)
void run(unsigned int value) {
  ASSERT(value < 8);
  CHECK(value != 0);
  TRACE(value);
  consume(value);
}
`,
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractBehaviorEvidence(module)

    expect(
      result.evidence.some(
        (item) => item.kind === "error-node" && item.attributes.nodeKind === "terminal",
      ),
    ).toBe(true)
    expect(
      result.evidence.some(
        (item) => item.kind === "error-edge" && item.attributes.edgeKind === "terminate",
      ),
    ).toBe(true)
    expect(result.evidence.filter((item) => item.kind === "error-node")).toHaveLength(2)
    expect(result.evidence.filter((item) => item.kind === "error-node").map((item) => item.source.startLine)).toEqual([
      5,
      1,
    ])
  })

  test("发现后源码变化时拒绝提取行为证据", async () => {
    const root = await workspace()
    const file = path.join(root, "module", "runner.ts")
    await Bun.write(file, "export function before() { return 1 }\n")
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    await Bun.write(file, "export function after() { return 2 }\n")

    await expect(extractBehaviorEvidence(module)).rejects.toMatchObject({ code: "SOURCE_CHANGED" })
  })
})

describe("模块概览证据提取", () => {
  test("组合源码文件、每文件代表符号、根调用入口和依赖证据", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "module", "helper.ts"), "export function helper() { return 1 }\n")
    await Bun.write(
      path.join(root, "module", "run.ts"),
      `import { helper } from "./helper.js"
export function run() { return helper() }
`,
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractOverviewEvidence(module)

    expect(result.evidence.filter((item) => item.kind === "source-file")).toHaveLength(2)
    expect(result.evidence.filter((item) => item.kind === "code-symbol")).toHaveLength(2)
    expect(result.evidence.filter((item) => item.kind === "flow-node")).toHaveLength(1)
    expect(result.evidence.filter((item) => item.kind === "dependency")).toHaveLength(1)
  })
})

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "chipmate-design-doc-indexing-"))
  roots.push(root)
  await mkdir(path.join(root, "module"), { recursive: true })
  return root
}

describe("DesignDoc 模块发现", () => {
  test("只发现边界内受支持源码并跳过依赖和符号链接", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "module", "runner.ts"), "export const state = 'idle'\n")
    await mkdir(path.join(root, "module", "node_modules", "ignored"), { recursive: true })
    await Bun.write(path.join(root, "module", "node_modules", "ignored", "bad.ts"), "throw new Error()")
    await Bun.write(path.join(root, "outside.ts"), "export const outside = true")
    await symlink(path.join(root, "outside.ts"), path.join(root, "module", "linked.ts"))

    const result = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    expect(result.files.map((file) => file.path)).toEqual(["module/runner.ts"])
    expect(result.totalBytes).toBeGreaterThan(0)
    expect(result.sourceSnapshotHash).toHaveLength(64)
  })

  test("拒绝工作区外目录", async () => {
    const root = await workspace()
    const outside = await mkdtemp(path.join(tmpdir(), "chipmate-design-doc-outside-"))
    roots.push(outside)
    await Bun.write(path.join(outside, "state.ts"), "export type State = 'a' | 'b'")

    await expect(discoverDesignDocModule({ workspace: root, targetPath: outside })).rejects.toMatchObject({
      code: "PATH_ESCAPE",
    } satisfies Partial<DesignDocDiscoveryError>)
  })

  test("目录深度超过预算时明确失败", async () => {
    const root = await workspace()
    await mkdir(path.join(root, "module", "a", "b"), { recursive: true })
    await Bun.write(path.join(root, "module", "a", "b", "state.ts"), "export type State = 'a' | 'b'")

    await expect(discoverDesignDocModule({ workspace: root, targetPath: "module", maxDepth: 1 })).rejects.toMatchObject(
      { code: "SOURCE_LIMIT_EXCEEDED" },
    )
  })

  test("递归模式建立稳定模块树且每个模块只持有直属源码", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "module", "root.ts"), "export function root() {}\n")
    await mkdir(path.join(root, "module", "child", "nested"), { recursive: true })
    await Bun.write(path.join(root, "module", "child", "child.ts"), "export function child() {}\n")
    await Bun.write(path.join(root, "module", "child", "nested", "nested.ts"), "export function nested() {}\n")

    const tree = await discoverDesignDocModules({ workspace: root, targetPath: "module", recursive: true })

    expect(tree.modules.map((module) => module.path)).toEqual([
      "module",
      "module/child",
      "module/child/nested",
    ])
    expect(tree.modules[0]?.files.map((file) => file.path)).toEqual(["module/root.ts"])
    expect(tree.modules[1]?.files.map((file) => file.path)).toEqual(["module/child/child.ts"])
    expect(tree.modules[2]?.parentID).toBe(tree.modules[1]?.id)
    expect(tree.modules.flatMap((module) => module.files.map((file) => file.path)).sort()).toEqual([
      "module/child/child.ts",
      "module/child/nested/nested.ts",
      "module/root.ts",
    ])
  })

  test("根目录没有直属源码时保留树节点但不复制子模块源码", async () => {
    const root = await workspace()
    await mkdir(path.join(root, "module", "child"), { recursive: true })
    await Bun.write(path.join(root, "module", "child", "child.ts"), "export function child() {}\n")

    const tree = await discoverDesignDocModules({ workspace: root, targetPath: "module", recursive: true })

    expect(tree.modules.map((module) => module.path)).toEqual(["module", "module/child"])
    expect(tree.modules[0]?.files).toEqual([])
    expect(tree.modules[1]?.files.map((file) => file.path)).toEqual(["module/child/child.ts"])
    expect(tree.modules[1]?.parentID).toBe(tree.rootModuleID)
  })

  test("完整设计模式把扁平 C 目录确定性拆为根单元和 C 组件", async () => {
    const root = await workspace()
    await mkdir(path.join(root, "module"), { recursive: true })
    await Bun.write(path.join(root, "module", "host_lld.c"), "void host_lld_run(void) {}\n")
    await Bun.write(path.join(root, "module", "host_lld.h"), "void host_lld_run(void);\n")
    await Bun.write(path.join(root, "module", "nvme.c"), "void nvme_run(void) {}\n")
    await Bun.write(path.join(root, "module", "nvme.h"), "void nvme_run(void);\n")
    await Bun.write(path.join(root, "module", "shared.h"), "typedef unsigned int word_t;\n")

    const tree = await discoverDesignDocUnits({ workspace: root, targetPath: "module" })
    const [rootUnit, host, nvme] = tree.modules

    expect(tree.modules.map((module) => [module.name, module.unitKind])).toEqual([
      ["module", "root"],
      ["host_lld", "c-component"],
      ["nvme", "c-component"],
    ])
    expect(rootUnit?.files.map((file) => file.path)).toEqual([
      "module/host_lld.c",
      "module/host_lld.h",
      "module/nvme.c",
      "module/nvme.h",
      "module/shared.h",
    ])
    expect(rootUnit?.supportFiles).toEqual(["module/shared.h"])
    expect(host?.files.map((file) => file.path)).toEqual(["module/host_lld.c", "module/host_lld.h"])
    expect(nvme?.files.map((file) => file.path)).toEqual(["module/nvme.c", "module/nvme.h"])
    expect(host?.parentID).toBe(tree.rootModuleID)
    expect(tree.ownership).toEqual([
      { path: "module/host_lld.c", ownerModuleID: host?.id, role: "implementation" },
      { path: "module/host_lld.h", ownerModuleID: host?.id, role: "support" },
      { path: "module/nvme.c", ownerModuleID: nvme?.id, role: "implementation" },
      { path: "module/nvme.h", ownerModuleID: nvme?.id, role: "support" },
      { path: "module/shared.h", ownerModuleID: rootUnit?.id, role: "support" },
    ])
  })
})

describe("TypeScript 生命周期证据提取", () => {
  test("发现后源码发生变化时拒绝生成旧快照证据", async () => {
    const root = await workspace()
    const file = path.join(root, "module", "runner.ts")
    await Bun.write(file, `export type State = "idle" | "running"\n`)
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    await Bun.write(file, `export type State = "idle" | "done"\n`)

    await expect(extractTypeScriptLifecycleEvidence(module)).rejects.toMatchObject({ code: "SOURCE_CHANGED" })
  })

  test("只把有明确 guard 起点和赋值终点的迁移作为事实", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.ts"),
      `export type RunnerState = "idle" | "running" | "done"

export class Runner {
  private state: RunnerState = "idle"

  start() {
    if (this.state === "idle") this.state = "running"
  }

  finish() {
    if (this.state === "running") this.state = "done"
  }

  unrelatedGuard() {
    if (this.otherState === "idle") this.state = "done"
  }
}
`,
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractTypeScriptLifecycleEvidence(module)

    expect(
      result.evidence.filter((item) => item.kind === "state-definition").map((item) => item.attributes.state),
    ).toEqual(["idle", "running", "done"])
    expect(
      result.evidence
        .filter((item) => item.kind === "state-transition")
        .map((item) => [item.attributes.from, item.attributes.to]),
    ).toEqual([
      ["idle", "running"],
      ["running", "done"],
    ])
    expect(result.evidence.find((item) => item.kind === "terminal-state")?.confidence).toBe("inferred")
    expect(result.unknowns).toEqual([])
  })

  test("多个候选状态字段不会被静默合并为一个状态机", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.ts"),
      `type State = "idle" | "running"
class Runner {
  state: State = "idle"
  status: State = "idle"
  start() { if (this.state === "idle") this.state = "running" }
}
`,
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractTypeScriptLifecycleEvidence(module)

    expect(result.unknowns.some((item) => item.includes("多个候选状态字段"))).toBe(true)
  })
})

describe("C 生命周期证据提取", () => {
  test("从状态宏、结构体字段和带状态 guard 的赋值提取证据", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.h"),
      `#define TASK_IDLE 0x0
#define TASK_RUNNING 0x1
#define TASK_SHUTDOWN 0x2

typedef struct {
  unsigned int status;
} TASK_CONTEXT;
`,
    )
    await Bun.write(
      path.join(root, "module", "runner.c"),
      `#include "runner.h"

TASK_CONTEXT g_task;

void task_main(void) {
  g_task.status = TASK_IDLE;
  while (1) {
    if (g_task.status == TASK_IDLE) {
      if (can_start()) g_task.status = TASK_RUNNING;
    } else if (g_task.status == TASK_RUNNING) {
      if (should_stop()) g_task.status = TASK_SHUTDOWN;
    }
  }
}
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractCLifecycleEvidence(module)

    expect(module.files.map((file) => [path.extname(file.path), file.language])).toEqual([
      [".c", "c"],
      [".h", "c"],
    ])
    expect(
      result.evidence.filter((item) => item.kind === "state-definition").map((item) => item.attributes.state),
    ).toEqual(["TASK_IDLE", "TASK_RUNNING", "TASK_SHUTDOWN"])
    expect(result.evidence.find((item) => item.kind === "state-field")?.attributes.field).toBe("status")
    expect(result.evidence.find((item) => item.kind === "initial-state")?.attributes.state).toBe("TASK_IDLE")
    expect(
      result.evidence
        .filter((item) => item.kind === "state-transition")
        .map((item) => [item.attributes.from, item.attributes.to]),
    ).toEqual([
      ["TASK_IDLE", "TASK_RUNNING"],
      ["TASK_RUNNING", "TASK_SHUTDOWN"],
    ])
    expect(
      result.evidence
        .filter((item) => item.kind === "state-transition")
        .map((item) => [item.attributes.guard, item.attributes.action]),
    ).toEqual([
      ["can_start()", "g_task.status = TASK_RUNNING"],
      ["should_stop()", "g_task.status = TASK_SHUTDOWN"],
    ])
    expect(result.unknowns).toEqual([])
  })

  test("不把普通函数中没有明确起点的状态赋值伪造成迁移", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.c"),
      `#define TASK_IDLE 0
#define TASK_RUNNING 1
unsigned int status;
void task_main(void) { status = TASK_IDLE; }
void set_status(void) { status = TASK_RUNNING; }
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractCLifecycleEvidence(module)

    expect(result.evidence.filter((item) => item.kind === "state-transition")).toEqual([])
    expect(result.unknowns).toContain("未发现同时具有明确起点和终点的状态迁移")
  })

  test("事件处理器未检查当前状态时保留为任意当前状态迁移", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "device.c"),
      `#define TASK_IDLE 0
#define TASK_WAIT 1
#define TASK_RESET 2
unsigned int status;
void device_irq_handler(void) {
  if (irq.cc_en == 1) {
    if (registers.enabled == 1) status = TASK_WAIT;
    else status = TASK_RESET;
  }
}
void task_main(void) {
  status = TASK_IDLE;
  while (1) {
    if (status == TASK_WAIT) status = TASK_IDLE;
  }
}
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractCLifecycleEvidence(module)
    const eventTransitions = result.evidence.filter(
      (item) => item.kind === "state-transition" && item.attributes.transitionScope === "any-current-state",
    )

    expect(eventTransitions).toHaveLength(2)
    expect(eventTransitions.map((item) => item.attributes.from)).toEqual([
      "__ANY_CURRENT_STATE__",
      "__ANY_CURRENT_STATE__",
    ])
    expect(eventTransitions.map((item) => item.attributes.guard)).toEqual([
      "irq.cc_en == 1 && registers.enabled == 1",
      "irq.cc_en == 1 && !(registers.enabled == 1)",
    ])
  })

  test("识别 C 文件作用域对象的零初始化状态", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.h"),
      `#define TASK_IDLE 0x0
#define TASK_RUNNING 0x1
typedef struct { unsigned int status; } TASK_CONTEXT;
`,
    )
    await Bun.write(
      path.join(root, "module", "runner.c"),
      `#include "runner.h"
volatile TASK_CONTEXT g_task;
void task_main(void) {
  while (1) {
    if (g_task.status == TASK_IDLE) g_task.status = TASK_RUNNING;
  }
}
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractCLifecycleEvidence(module)
    const initial = result.evidence.find((item) => item.kind === "initial-state")

    expect(initial?.attributes).toMatchObject({ field: "g_task.status", state: "TASK_IDLE" })
    expect(initial?.source.path).toBe("module/runner.c")
    expect(initial?.source.startLine).toBe(2)
    expect(result.unknowns).toEqual([])
  })

  test("不把一套状态机的零值宏绑定到另一状态字段", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "runner.c"),
      `#define FIRST_IDLE 0
#define FIRST_RUNNING 1
#define SECOND_WAITING 5
#define SECOND_RUNNING 6
static unsigned int first_status;
static unsigned int second_status;
void run_first(void) {
  if (first_status == FIRST_IDLE) first_status = FIRST_RUNNING;
}
void run_second(void) {
  if (second_status == SECOND_WAITING) second_status = SECOND_RUNNING;
}
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractCLifecycleEvidence(module)
    const initial = result.evidence.filter((item) => item.kind === "initial-state")

    expect(initial.map((item) => item.attributes)).toEqual([
      expect.objectContaining({ field: "first_status", state: "FIRST_IDLE" }),
    ])
    expect(initial.some((item) => item.attributes.field === "second_status")).toBe(false)
  })
})

describe("模块结构证据提取", () => {
  test("提取 TypeScript 内部文件和外部包依赖", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "module", "helper.ts"), 'export const helper = true\nexport const state = "idle"\n')
    await Bun.write(
      path.join(root, "module", "runner.ts"),
      `import { helper } from "./helper.js"
import type { Effect } from "effect"
export { helper }
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractStructureEvidence(module)
    const dependencies = result.evidence.filter((item) => item.kind === "dependency")

    expect(result.evidence.filter((item) => item.kind === "source-file").map((item) => item.attributes.ref)).toEqual([
      "module/helper.ts",
      "module/runner.ts",
    ])
    expect(dependencies.map((item) => [item.attributes.from, item.attributes.to, item.attributes.internal])).toEqual([
      ["module/runner.ts", "module/helper.ts", true],
      ["module/runner.ts", "effect", false],
    ])
    expect(result.unknowns).toEqual([])
  })

  test("提取 C include 并区分模块内头文件和系统头文件", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "module", "runner.h"), "void run(void);\n")
    await Bun.write(
      path.join(root, "module", "runner.c"),
      `#include "runner.h"
#include <stdint.h>
void run(void) {}
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractStructureEvidence(module)

    expect(
      result.evidence
        .filter((item) => item.kind === "dependency")
        .map((item) => [item.attributes.from, item.attributes.to, item.attributes.internal]),
    ).toEqual([
      ["module/runner.c", "module/runner.h", true],
      ["module/runner.c", "stdint.h", false],
    ])
  })

  test("发现后源码发生变化时拒绝生成结构证据", async () => {
    const root = await workspace()
    const file = path.join(root, "module", "runner.ts")
    await Bun.write(file, `import "effect"\n`)
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    await Bun.write(file, `import "zod"\n`)

    await expect(extractStructureEvidence(module)).rejects.toMatchObject({ code: "SOURCE_CHANGED" })
  })
})

describe("代码结构证据提取", () => {
  test("提取 TypeScript 顶层类型、函数和直接方法的包含关系", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "api.ts"),
      `export interface Runner { start(): void }
export type State = "idle" | "running"
export class Job {
  constructor() {}
  start() {}
  value = () => 1
}
export function make() {}
export const arrow = () => 1
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractCodeStructureEvidence(module)
    const symbols = result.evidence.filter((item) => item.kind === "code-symbol")

    expect(symbols.map((item) => [item.attributes.qualifiedName, item.attributes.symbolKind])).toEqual([
      ["Runner", "interface"],
      ["Runner.start", "method"],
      ["State", "type"],
      ["Job", "class"],
      ["Job.constructor", "method"],
      ["Job.start", "method"],
      ["Job.value", "method"],
      ["make", "function"],
      ["arrow", "function"],
    ])
    const job = symbols.find((item) => item.attributes.qualifiedName === "Job")
    expect(symbols.find((item) => item.attributes.qualifiedName === "Job.start")?.attributes.parentRef).toBe(
      job?.attributes.ref,
    )
    expect(result.unknowns).toEqual([])
  })

  test("提取 C typedef、具名结构体、枚举、函数声明和定义", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "api.c"),
      `typedef struct { int state; } CONTEXT;
struct Named { int value; };
typedef enum { MODE_A, MODE_B } MODE;
void declared(int value);
static int helper(void) { return 1; }
`,
    )

    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    const result = await extractCodeStructureEvidence(module)

    expect(
      result.evidence
        .filter((item) => item.kind === "code-symbol")
        .map((item) => [item.attributes.name, item.attributes.symbolKind]),
    ).toEqual([
      ["CONTEXT", "struct"],
      ["Named", "struct"],
      ["MODE", "enum"],
      ["declared", "function"],
      ["helper", "function"],
    ])
    expect(result.unknowns).toEqual([])
  })

  test("发现后源码发生变化时拒绝生成代码结构证据", async () => {
    const root = await workspace()
    const file = path.join(root, "module", "api.ts")
    await Bun.write(file, "export function before() {}\n")
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })
    await Bun.write(file, "export function after() {}\n")

    await expect(extractCodeStructureEvidence(module)).rejects.toMatchObject({ code: "SOURCE_CHANGED" })
  })
})
