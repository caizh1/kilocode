import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { discoverDesignDocModule, extractBehaviorEvidence } from "../../../src/design-doc"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("控制流证据提取", () => {
  test("void 函数没有返回值时不生成孤立的 return 数据实体", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "actions.c"),
      `void configure(int value) {
  target = value;
}
void maybe_configure(int value) {
  if (value == 0) return;
  target = value;
}
int read_value(void) {
  return target;
}
`,
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractBehaviorEvidence(module)
    const outputs = result.evidence.filter(
      (item) => item.kind === "data-entity" && item.attributes.entityKind === "output",
    )

    expect(outputs).toHaveLength(1)
    expect(outputs[0]?.source.symbol).toContain("read_value")
    expect(result.evidence.some((item) => item.kind === "data-flow" && item.attributes.flowKind === "return")).toBeTrue()
  })

  test("逐个保留 C switch 的 case、default、break 和贯穿分支", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "dispatch.c"),
      `int dispatch(int opcode) {
  switch (opcode) {
    case 1:
      handle_admin();
      break;
    case 2:
    case 3:
      handle_io();
      return 3;
    default:
      handle_unknown();
  }
  finish_command();
  return 0;
}
`,
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractBehaviorEvidence(module)
    const nodes = result.evidence.filter((item) => item.kind === "flow-node")
    const edges = result.evidence.filter((item) => item.kind === "flow-edge")
    const byLabel = new Map(nodes.map((item) => [item.attributes.label, item.attributes.ref] as const))
    const switchRef = nodes.find(
      (item) => item.attributes.nodeKind === "decision" && item.attributes.label === "(opcode)",
    )?.attributes.ref

    expect(switchRef).toBeString()
    expect([...byLabel.keys()]).toEqual(expect.arrayContaining(["case 1", "case 2", "case 3", "default"]))
    for (const label of ["case 1", "case 2", "case 3", "default"]) {
      expect(
        edges.some((item) => item.attributes.fromRef === switchRef && item.attributes.toRef === byLabel.get(label)),
      ).toBeTrue()
    }
    expect(
      edges.some(
        (item) => item.attributes.fromRef === byLabel.get("case 2") && item.attributes.toRef === byLabel.get("case 3"),
      ),
    ).toBeTrue()
    expect(
      edges.some((item) => item.attributes.toRef === byLabel.get("default") && item.attributes.label === "其他情况"),
    ).toBeTrue()
  })

  test("长条件、步骤和数据表达式完整保留，由后续分片与渲染换行处理", async () => {
    const root = await workspace()
    const terms = Array.from({ length: 24 }, (_, index) => `condition_field_${String(index).padStart(2, "0")}`)
    const expression = terms.join(" && ")
    await Bun.write(
      path.join(root, "module", "long-flow.c"),
      `int evaluate(void) {
  int result_target_with_a_long_name = ${terms.join(" + ")};
  if (${expression}) return result_target_with_a_long_name;
  return 0;
}
`,
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractBehaviorEvidence(module)
    const labels = result.evidence.flatMap((item) =>
      typeof item.attributes.label === "string" ? [item.attributes.label] : [],
    )

    expect(labels.some((label) => label.includes(terms.at(-1)!) && label.length > 160)).toBeTrue()
    expect(labels.some((label) => label.includes(terms.join(" + ")) && label.length > 160)).toBeTrue()
  })
})

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "kilo-design-doc-behavior-"))
  roots.push(root)
  await mkdir(path.join(root, "module"), { recursive: true })
  return root
}
