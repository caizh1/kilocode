import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import {
  discoverDesignDocModule,
  extractBehaviorEvidence,
  extractCodeStructureEvidence,
  extractTopicEvidence,
} from "@kilocode/kilo-indexing/design-doc"
import { tmpdir } from "../../fixture/fixture"
import type { JobConfig } from "../../../src/kilocode/design-doc/domain"
import {
  buildBehaviorEvidencePack,
  buildCodeStructureEvidencePack,
  buildTopicEvidencePack,
  EvidenceBudgetError,
  hasSufficientBehaviorEvidence,
  hasSufficientCodeStructureEvidence,
  hasSufficientTopicEvidence,
} from "../../../src/kilocode/design-doc/evidence"
import {
  balancedBehaviorValues,
  planEvidenceScopes,
  scopeExtraction,
  selectDocumentScopes,
} from "../../../src/kilocode/design-doc/manager"

const roots: AsyncDisposable[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => root[Symbol.asyncDispose]()))
})

describe("DesignDoc 原子证据分片", () => {
  test("关系总数不能整除上限时重新均分尾部，禁止生成少于四条边的碎片图", () => {
    for (const [total, limit] of [
      [274, 8],
      [212, 10],
      [82, 8],
    ] as const) {
      const values = Array.from({ length: total }, (_, index) => `REF-${index}`)
      const groups = balancedBehaviorValues(values, limit)
      expect(groups.flat()).toEqual(values)
      expect(groups.every((group) => group.length >= 4 && group.length <= limit)).toBe(true)
    }
  })

  test("大型执行流程按 callable 分片且每片保持充分证据并满足独立预算", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    await Bun.write(`${workspace.path}/workflow.ts`, source(24))
    const module = await discoverDesignDocModule({ workspace: workspace.path, targetPath: "." })
    const extraction = await extractBehaviorEvidence(module)
    const config = jobConfig()

    expect(() =>
      buildBehaviorEvidencePack({
        artifactType: "execution-flow",
        extraction,
        workItemID: "WI-flat",
        ...config.evidenceBudget,
      }),
    ).toThrow(EvidenceBudgetError)

    const scopes = planEvidenceScopes("execution-flow", extraction, config)

    expect(scopes.length).toBeGreaterThan(1)
    expect(scopes.every((scope) => scope.kind === "behavior-refs")).toBe(true)
    expect(scopes.length).toBeLessThan(24)
    for (const [index, scope] of scopes.entries()) {
      const pack = buildBehaviorEvidencePack({
        artifactType: "execution-flow",
        extraction: scopeExtraction("execution-flow", extraction, scope),
        workItemID: `WI-${index}`,
        ...config.atomicEvidenceBudget!,
      })
      expect(pack.evidence.length).toBeLessThanOrEqual(config.atomicEvidenceBudget!.maxItems)
      expect(pack.budget.promptBytes).toBeLessThanOrEqual(config.atomicEvidenceBudget!.maxPromptBytes)
      expect(hasSufficientBehaviorEvidence(pack)).toBe(true)
    }
  })

  test("单个超大 callable 也按原子关系分片", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    const branches = Array.from(
      { length: 48 },
      (_, index) => `if (value > ${index}) value += ${index}; else value -= ${index};`,
    )
    await Bun.write(
      `${workspace.path}/large.ts`,
      `export function large(input: number) { let value = input; ${branches.join("\n")} return value }\n`,
    )
    const module = await discoverDesignDocModule({ workspace: workspace.path, targetPath: "." })
    const extraction = await extractBehaviorEvidence(module)
    const config = jobConfig()

    expect(() =>
      buildBehaviorEvidencePack({
        artifactType: "execution-flow",
        extraction,
        workItemID: "WI-flat",
        ...config.evidenceBudget,
      }),
    ).toThrow(EvidenceBudgetError)

    const scopes = planEvidenceScopes("execution-flow", extraction, config)
    expect(scopes.length).toBeGreaterThan(1)
    expect(scopes.every((scope) => scope.kind === "behavior-refs")).toBe(true)
    for (const [index, scope] of scopes.entries()) {
      const pack = buildBehaviorEvidencePack({
        artifactType: "execution-flow",
        extraction: scopeExtraction("execution-flow", extraction, scope),
        workItemID: `WI-large-${index}`,
        ...config.atomicEvidenceBudget!,
      })
      expect(hasSufficientBehaviorEvidence(pack)).toBe(true)
      expect(pack.evidence.length).toBeLessThanOrEqual(64)
    }
  })

  test("完整 Word 模式生成导航总览并用无遗漏的平衡分图覆盖全部源码关系", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    const branches = Array.from(
      { length: 12 },
      (_, index) => `if (value > ${index}) value += ${index}; else value -= ${index};`,
    )
    await Bun.write(
      `${workspace.path}/large.ts`,
      `export function large(input: number) { let value = input; ${branches.join("\n")} return value }\n`,
    )
    const module = await discoverDesignDocModule({ workspace: workspace.path, targetPath: "." })
    const extraction = await extractBehaviorEvidence(module)
    const config = { ...jobConfig(), documentProfile: "source-backed-full" as const }

    const scopes = planEvidenceScopes("execution-flow", extraction, config)

    expect(scopes.length).toBeGreaterThan(2)
    expect(scopes[0]?.label).toContain("源码流程导航总览")
    expect(scopes[0]?.kind).toBe("behavior-refs")
    if (scopes[0]?.kind === "behavior-refs") expect(scopes[0].coverageRole).toBe("overview")
    const details = scopes.slice(1)
    for (const scope of details) {
      expect(scope.kind).toBe("behavior-refs")
      if (scope.kind === "behavior-refs") {
        expect(scope.coverageRole).toBe("detail")
        expect(scope.values.length).toBeGreaterThanOrEqual(4)
        expect(scope.values.length).toBeLessThanOrEqual(10)
      }
    }
    const detailRefs = details.flatMap((scope) => (scope.kind === "behavior-refs" ? scope.values : []))
    const unique = [...new Set(detailRefs)].sort()
    const total = scopes[0]?.kind === "behavior-refs" ? scopes[0].coverageTotal : 0
    const expectedHash = scopes[0]?.kind === "behavior-refs" ? scopes[0].coverageSetHash : ""
    expect(detailRefs).toHaveLength(unique.length)
    expect(unique).toHaveLength(total)
    expect(createHash("sha256").update(unique.join("\n")).digest("hex")).toBe(expectedHash)

    const selected = selectDocumentScopes(
      { ...module, unitKind: "c-component", implementationFiles: ["large.ts"] },
      "execution-flow",
      scopes,
    )
    expect(selected).toEqual(scopes)

    const scoped = scopeExtraction("execution-flow", extraction, selected[0]!, true)
    expect(scoped.unknowns.some((item) => item.startsWith("scope-disclosure:"))).toBe(false)
  })

  test("根 DesignUnit 同样保留完整关系图集而不是抽样一张基础图", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    await Bun.write(`${workspace.path}/alpha.ts`, source(4))
    await Bun.write(`${workspace.path}/beta.ts`, source(4).replaceAll("step", "phase"))
    const module = await discoverDesignDocModule({ workspace: workspace.path, targetPath: "." })
    const extraction = await extractBehaviorEvidence(module)
    const config = { ...jobConfig(), documentProfile: "source-backed-full" as const }
    const planned = planEvidenceScopes("execution-flow", extraction, config)

    const selected = selectDocumentScopes(
      {
        ...module,
        unitKind: "root",
        implementationFiles: ["alpha.ts", "beta.ts"],
      },
      "execution-flow",
      planned,
    )

    expect(selected).toEqual(planned)
    expect(selected.length).toBeGreaterThan(1)
  })

  test("大型主题按完整证据集合分片并携带无遗漏覆盖元数据", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    const declarations = Array.from(
      { length: 96 },
      (_, index) => `int operation_${String(index).padStart(3, "0")}(int input, int *output);`,
    )
    await Bun.write(`${workspace.path}/api.h`, `${declarations.join("\n")}\n`)
    const module = await discoverDesignDocModule({ workspace: workspace.path, targetPath: "." })
    const extraction = await extractTopicEvidence(module, "responsibilities")
    const config = { ...jobConfig(), artifactTypes: ["topic" as const], documentProfile: "source-backed-full" as const }

    expect(extraction.evidence.length).toBeGreaterThan(64)
    expect(() =>
      buildTopicEvidencePack({
        extraction,
        purpose: { kind: "topic", topic: "responsibilities" },
        workItemID: "WI-flat-topic",
        ...config.evidenceBudget,
      }),
    ).toThrow(EvidenceBudgetError)

    const scopes = planEvidenceScopes("topic", extraction, config)
    expect(scopes.length).toBeGreaterThan(1)
    expect(scopes.every((scope) => scope.kind === "topic-evidence")).toBeTrue()
    const refs = scopes.flatMap((scope) => (scope.kind === "topic-evidence" ? scope.values : []))
    expect(refs).toHaveLength(new Set(refs).size)
    for (const [index, scope] of scopes.entries()) {
      if (scope.kind !== "topic-evidence") throw new Error("主题分片类型错误")
      expect(scope.coverageTotal).toBe(refs.length)
      expect(scope.coverageSetHash).toBe(
        createHash("sha256")
          .update([...refs].sort().join("\n"))
          .digest("hex"),
      )
      const pack = buildTopicEvidencePack({
        extraction: scopeExtraction("topic", extraction, scope),
        purpose: { kind: "topic", topic: "responsibilities" },
        workItemID: `WI-topic-${index}`,
        ...config.atomicEvidenceBudget!,
        maxItems: Math.min(config.atomicEvidenceBudget!.maxItems, 96),
        maxPromptBytes: Math.min(config.atomicEvidenceBudget!.maxPromptBytes, 48 * 1_024),
      })
      expect(hasSufficientTopicEvidence(pack)).toBeTrue()
      expect(pack.budget.promptBytes).toBeLessThanOrEqual(48 * 1_024)
    }
  })

  test("代码结构按输出膨胀上限分片，避免单 Session 生成超大 IR", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    for (let file = 0; file < 4; file++) {
      const declarations = Array.from(
        { length: 20 },
        (_, index) => `export function function${file}_${index}() { return ${index} }`,
      )
      await Bun.write(`${workspace.path}/module${file}.ts`, `${declarations.join("\n")}\n`)
    }
    const module = await discoverDesignDocModule({ workspace: workspace.path, targetPath: "." })
    const extraction = await extractCodeStructureEvidence(module)
    const config = { ...jobConfig(), artifactTypes: ["code-structure" as const] }

    expect(() =>
      buildCodeStructureEvidencePack({ extraction, workItemID: "WI-flat", ...config.evidenceBudget }),
    ).toThrow(EvidenceBudgetError)

    const scopes = planEvidenceScopes("code-structure", extraction, config)
    expect(scopes.length).toBeGreaterThan(1)
    expect(scopes.every((scope) => scope.kind === "source-files")).toBe(true)
    for (const [index, scope] of scopes.entries()) {
      const pack = buildCodeStructureEvidencePack({
        extraction: scopeExtraction("code-structure", extraction, scope),
        workItemID: `WI-code-${index}`,
        ...config.atomicEvidenceBudget!,
      })
      expect(pack.evidence.length).toBeLessThanOrEqual(48)
      expect(pack.budget.promptBytes).toBeLessThanOrEqual(48 * 1_024)
      expect(hasSufficientCodeStructureEvidence(pack)).toBe(true)
    }
  })
})

function source(count: number) {
  const functions = Array.from({ length: count }, (_, index) => {
    const next = (index + 1) % count
    return `export function step${index}(input: number) {
  let value = input
  if (value > ${index}) value = value + ${index}
  else value = value - ${index}
  for (let attempt = 0; attempt < 2; attempt++) value += attempt
  return step${next}(value)
}`
  })
  return `${functions.join("\n\n")}\n`
}

function jobConfig(): JobConfig {
  return {
    targetPath: ".",
    artifactTypes: ["execution-flow"],
    languages: ["typescript", "tsx"],
    concurrency: 1,
    recursive: false,
    evidenceBudget: { maxItems: 64, maxPromptBytes: 49_152, maxSnippetCharacters: 800 },
    atomicEvidenceBudget: { maxItems: 160, maxPromptBytes: 128 * 1_024, maxSnippetCharacters: 400 },
    retryPolicy: { maxAttempts: 3, timeoutMs: 120_000, backoffMs: [0, 500, 1_000], retryableCodes: [] },
    modelPolicy: {
      primary: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
      fallbacks: [],
      structuredOutput: "tool-json-schema",
    },
    renderer: "mermaid",
  }
}
