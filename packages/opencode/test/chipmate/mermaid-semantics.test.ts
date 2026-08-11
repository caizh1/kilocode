import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { CodeIndexAnalysisService, type QueryEvidenceResult } from "@chipmate/chipmate-indexing/engine"
import { Effect } from "effect"
import {
  renderMermaidDiagram,
  renderSourceBackedMermaidBatch,
  validateMermaidDiagramRequest,
} from "../../src/chipmate/documents/mermaid"
import * as SemanticGuard from "../../src/chipmate/documents/mermaid-semantic-guard"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const source = ["flowchart TD", '  caller["caller"]', '  callee["callee"]', "  caller --> callee"].join("\n")
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

async function within(fn: (dir: string) => Promise<void>) {
  await using temp = await tmpdir({ git: true })
  await provideTestInstance({ directory: temp.path, fn: () => fn(temp.path) })
}

function result(from = "caller", to = "callee"): QueryEvidenceResult {
  const base = CodeIndexAnalysisService.createStub("call sites", { retrievalMode: "graph-only" })
  return {
    ...base,
    answerPolicy: { ...base.answerPolicy, allowed: true, confidence: "high", mode: "grounded" },
    evidenceRefs: [
      {
        id: "call_1",
        source: "graph",
        path: "code.c",
        filePath: "code.c",
        startLine: 2,
        endLine: 2,
        kind: "call_site",
        reason: "test call",
        confidence: "high",
        callerName: from,
        calleeName: to,
      },
    ],
  }
}

async function claims(dir: string, edge: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) { callee(); }\n", "utf8")
  const value = {
    version: 1,
    diagramId: "arch-1",
    diagramType: "code-flow",
    scopePath: ".",
    sourceHash: createHash("sha256").update(source).digest("hex"),
    language: "c",
    nodes: [
      { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
      { id: "callee", symbol: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
    ],
    edges: [
      {
        id: "call-1",
        from: "caller",
        to: "callee",
        relation: "direct-call",
        fromSymbol: "caller",
        toSymbol: "callee",
        evidence: [{ path: "code.c", startLine: 1, endLine: 2 }],
        ...edge,
      },
    ],
    ...extra,
  }
  const file = path.join(dir, "diagram-claims.json")
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  return "diagram-claims.json"
}

async function scenario(input: {
  dir: string
  source: string
  code: string
  nodes: Array<{ id: string; symbol: string }>
  edge: Record<string, unknown>
}) {
  await fs.writeFile(path.join(input.dir, "code.c"), input.code, "utf8")
  const lines = input.code.split(/\r?\n/).length
  const value = {
    version: 1,
    diagramId: "semantic-1",
    diagramType: "focused",
    scopePath: ".",
    sourceHash: createHash("sha256").update(input.source).digest("hex"),
    language: "c",
    nodes: input.nodes.map((item) => ({
      ...item,
      evidence: [{ path: "code.c", startLine: 1, endLine: lines }],
    })),
    edges: [
      {
        id: "edge-1",
        from: input.nodes[0]!.id,
        to: input.nodes[1]!.id,
        evidence: [{ path: "code.c", startLine: 1, endLine: lines }],
        ...input.edge,
      },
    ],
  }
  await fs.writeFile(path.join(input.dir, "diagram-claims.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8")
  return "diagram-claims.json"
}

describe("source-backed Mermaid semantics", () => {
  test("blocks render-mode downgrade only after source-backed activation in the same session", () => {
    const session = randomUUID()
    const ordinary = randomUUID()
    const hash = "a".repeat(64)
    const png = "/workspace/approved.png"
    expect(SemanticGuard.check(session)).toBeUndefined()
    expect(SemanticGuard.insert(session, hash)).toBeUndefined()
    SemanticGuard.mark(session)
    expect(SemanticGuard.check(session)?.code).toBe("mermaid-semantic-downgrade-blocked")
    expect(SemanticGuard.insert(session, hash)?.code).toBe("mermaid-semantic-insert-blocked")
    expect(SemanticGuard.insert(session, hash, png)?.code).toBe("mermaid-semantic-insert-blocked")
    SemanticGuard.allow(session, hash, png, undefined, "flowchart TD\n  A --> B")
    expect(SemanticGuard.insert(session, hash, png)).toBeUndefined()
    expect(SemanticGuard.source(session, png)).toBe("flowchart TD\n  A --> B")
    expect(SemanticGuard.insert(session, hash, png, true)?.code).toBe("mermaid-semantic-insert-blocked")
    expect(SemanticGuard.insert(session, "b".repeat(64), png)?.code).toBe("mermaid-semantic-insert-blocked")
    expect(SemanticGuard.check(ordinary)).toBeUndefined()
    expect(SemanticGuard.insert(ordinary, hash, "/workspace/ordinary.png")).toBeUndefined()
    expect(SemanticGuard.check(session, "source-backed")).toBeUndefined()
  })

  test("blocks semantic coverage loss for the same rendered Diagram ID only", () => {
    const session = randomUUID()
    const ordinary = randomUUID()
    const evidence = randomUUID()
    const baseline = {
      diagramId: "architecture-1",
      nodeIds: ["entry", "dispatch", "egress"],
      edges: [
        { from: "entry", to: "dispatch", relation: "dependency" as const },
        { from: "dispatch", to: "egress", relation: "data-flow" as const },
      ],
    }
    SemanticGuard.allow(session, "a".repeat(64), "/workspace/detailed.png", baseline)
    expect(SemanticGuard.coverage(session, baseline)).toBeUndefined()
    expect(
      SemanticGuard.coverage(session, {
        ...baseline,
        nodeIds: [...baseline.nodeIds, "recovery"],
        edges: [...baseline.edges, { from: "recovery", to: "dispatch", relation: "dependency" }],
      }),
    ).toBeUndefined()
    expect(
      SemanticGuard.coverage(session, {
        ...baseline,
        nodeIds: ["entry", "egress"],
        edges: [],
      })?.code,
    ).toBe("mermaid-semantic-coverage-regression-blocked")
    expect(
      SemanticGuard.coverage(session, {
        ...baseline,
        diagramId: "architecture-overview-2",
        nodeIds: ["entry", "egress"],
        edges: [],
      }),
    ).toBeUndefined()
    expect(SemanticGuard.check(ordinary)).toBeUndefined()
    SemanticGuard.remember(evidence, baseline)
    expect(SemanticGuard.insert(evidence, "c".repeat(64), "/workspace/evidence-only.png")?.code).toBe(
      "mermaid-semantic-insert-blocked",
    )
    expect(
      SemanticGuard.coverage(evidence, {
        ...baseline,
        nodeIds: ["entry", "egress"],
        edges: [],
      })?.code,
    ).toBe("mermaid-semantic-coverage-regression-blocked")
  })

  test("blocks source-symbol remapping behind unchanged node and edge IDs", () => {
    const session = randomUUID()
    const baseline = {
      diagramId: "code-flow-symbols",
      nodeIds: ["caller", "callee"],
      nodes: [
        { id: "caller", symbol: "real_caller" },
        { id: "callee", symbol: "real_callee" },
      ],
      edges: [
        {
          from: "caller",
          to: "callee",
          relation: "direct-call" as const,
          fromSymbol: "real_caller",
          toSymbol: "real_callee",
        },
      ],
    }
    SemanticGuard.allow(session, "a".repeat(64), "/workspace/code.png", baseline)
    expect(
      SemanticGuard.coverage(session, {
        ...baseline,
        nodes: [
          { id: "caller", symbol: "different_caller" },
          { id: "callee", symbol: "real_callee" },
        ],
        edges: [
          {
            ...baseline.edges[0]!,
            fromSymbol: "different_caller",
          },
        ],
      })?.code,
    ).toBe("mermaid-semantic-coverage-regression-blocked")
  })

  test("blocks deleting visible nodes or branches after the first semantically valid source-backed validation", () => {
    const session = randomUUID()
    const detailed = {
      diagramId: "business-flow",
      nodeIds: ["entry", "dispatch", "retry", "failure", "done"],
      sourceNodeIds: ["entry", "dispatch", "retry", "failure", "done"],
      sourceEdges: [
        { from: "entry", to: "dispatch" },
        { from: "dispatch", to: "retry" },
        { from: "dispatch", to: "failure" },
        { from: "retry", to: "done" },
        { from: "failure", to: "done" },
      ],
      edges: [],
    }
    expect(SemanticGuard.advance(session, detailed)).toBeUndefined()
    expect(
      SemanticGuard.advance(session, {
        ...detailed,
        nodeIds: ["entry", "dispatch", "done"],
        sourceNodeIds: ["entry", "dispatch", "done"],
        sourceEdges: [
          { from: "entry", to: "dispatch" },
          { from: "dispatch", to: "done" },
        ],
      })?.code,
    ).toBe("mermaid-semantic-repair-regression-blocked")
    expect(
      SemanticGuard.advance(session, {
        ...detailed,
        nodeIds: [...detailed.nodeIds, "timeout"],
        sourceNodeIds: [...detailed.sourceNodeIds, "timeout"],
        sourceEdges: [...detailed.sourceEdges, { from: "retry", to: "timeout" }],
      }),
    ).toBeUndefined()
    expect(
      SemanticGuard.advance(session, {
        ...detailed,
        sourceNodeIds: detailed.sourceNodeIds,
        sourceEdges: [
          { from: "entry", to: "dispatch" },
          { from: "dispatch", to: "retry" },
          { from: "dispatch", to: "failure" },
          { from: "retry", to: "done" },
          { from: "failure", to: "done" },
        ],
      })?.code,
    ).toBe("mermaid-semantic-repair-regression-blocked")

    const parallel = randomUUID()
    const duplicate = {
      diagramId: "parallel-flow",
      nodeIds: ["entry", "done"],
      sourceNodeIds: ["entry", "done"],
      sourceEdges: [
        { from: "entry", to: "done" },
        { from: "entry", to: "done" },
      ],
      edges: [],
    }
    expect(SemanticGuard.advance(parallel, duplicate)).toBeUndefined()
    expect(
      SemanticGuard.advance(parallel, {
        ...duplicate,
        sourceEdges: [{ from: "entry", to: "done" }],
      })?.code,
    ).toBe("mermaid-semantic-repair-regression-blocked")
  })

  test("does not freeze an invalid draft as the semantic repair baseline", async () => {
    await within(async (dir) => {
      const session = randomUUID()
      const file = await claims(dir)
      const draft = [source, '  guessed["unproven branch"]', "  caller --> guessed"].join("\n")
      const value = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as Record<string, unknown>
      value.sourceHash = createHash("sha256").update(draft).digest("hex")
      await fs.writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`, "utf8")

      const invalid = await validateMermaidDiagramRequest({
        source: draft,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticSessionId: session,
        semanticQuery: async () => result(),
      })
      expect(invalid.semanticStatus).toBe("invalid")
      expect(invalid.issues.some((item) => item.code === "semantic-node-unclaimed")).toBe(true)

      value.sourceHash = createHash("sha256").update(source).digest("hex")
      await fs.writeFile(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const repaired = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticSessionId: session,
        semanticQuery: async () => result(),
      })
      expect(repaired.semanticStatus).toBe("valid")
      expect(repaired.issues.some((item) => item.code === "mermaid-semantic-repair-regression-blocked")).toBe(false)
    })
  })

  test("blocks advancing views until readable split children cover the pending semantics", () => {
    const session = randomUUID()
    const parent = {
      diagramId: "code-flow",
      nodeIds: ["entry", "dispatch", "wait", "done"],
      edges: [
        { from: "entry", to: "dispatch", relation: "dependency" as const },
        { from: "dispatch", to: "wait", relation: "dependency" as const },
        { from: "wait", to: "done", relation: "dependency" as const },
      ],
    }
    SemanticGuard.hold(session, parent)
    expect(SemanticGuard.pending(session)).toEqual(["code-flow"])
    const initial = SemanticGuard.pendingDetails(session)
    expect(initial).toMatchObject([
      {
        diagramId: "code-flow",
        missingNodes: [{ id: "entry" }, { id: "dispatch" }, { id: "wait" }, { id: "done" }],
        missingEdges: parent.edges,
      },
    ])
    expect(initial[0].suggestedChildren).toHaveLength(1)
    expect(initial[0].suggestedChildren[0]).toMatchObject({
      splitFromDiagramId: "code-flow",
      nodes: initial[0].missingNodes,
      edges: initial[0].missingEdges,
    })
    expect(initial[0].suggestedChildren[0].suggestedDiagramId).toMatch(/^code-flow-FOCUS-[0-9a-f]{8}$/)
    expect(SemanticGuard.pendingDetails(session)[0].suggestedChildren).toEqual(initial[0].suggestedChildren)
    const restored = randomUUID()
    SemanticGuard.restore(restored, initial[0])
    expect(SemanticGuard.pendingDetails(restored)[0].suggestedChildren).toEqual(initial[0].suggestedChildren)
    expect(
      SemanticGuard.advance(session, {
        diagramId: "state-machine",
        nodeIds: ["idle"],
        edges: [],
      })?.code,
    ).toBe("mermaid-semantic-word-fit-pending")

    const overview = {
      diagramId: "code-flow-overview",
      splitFromDiagramId: "code-flow",
      nodeIds: ["entry", "dispatch"],
      edges: [{ from: "entry", to: "dispatch", relation: "dependency" as const }],
    }
    expect(SemanticGuard.advance(session, overview)).toBeUndefined()
    SemanticGuard.hold(session, overview)
    expect(SemanticGuard.pending(session)).toEqual(["code-flow"])
    SemanticGuard.allow(session, "a".repeat(64), "/workspace/overview.png", overview)
    expect(SemanticGuard.pending(session)).toEqual(["code-flow"])
    const remaining = SemanticGuard.pendingDetails(session)
    expect(remaining).toMatchObject([
      {
        diagramId: "code-flow",
        missingNodes: [{ id: "wait" }, { id: "done" }],
        missingEdges: [
          { from: "dispatch", to: "wait", relation: "dependency" },
          { from: "wait", to: "done", relation: "dependency" },
        ],
      },
    ])
    expect(remaining[0].suggestedChildren).toHaveLength(1)
    expect(remaining[0].suggestedChildren[0]).toMatchObject({
      splitFromDiagramId: "code-flow",
      nodes: [{ id: "dispatch" }, { id: "wait" }, { id: "done" }],
      edges: remaining[0].missingEdges,
    })

    const focus = {
      diagramId: "code-flow-focus",
      splitFromDiagramId: "code-flow",
      nodeIds: ["dispatch", "wait", "done"],
      edges: [
        { from: "dispatch", to: "wait", relation: "dependency" as const },
        { from: "wait", to: "done", relation: "dependency" as const },
      ],
    }
    expect(SemanticGuard.advance(session, focus)).toBeUndefined()
    SemanticGuard.allow(session, "b".repeat(64), "/workspace/focus.png", focus)
    expect(SemanticGuard.pending(session)).toEqual([])
    expect(SemanticGuard.pendingDetails(session)).toEqual([])
    expect(
      SemanticGuard.advance(session, {
        diagramId: "state-machine",
        nodeIds: ["idle"],
        edges: [],
      }),
    ).toBeUndefined()
  })

  test("partitions pending split semantics into deterministic focused children", () => {
    const session = randomUUID()
    const nodeIds = Array.from({ length: 18 }, (_, index) => `node-${index}`)
    const edges = nodeIds.slice(1).map((id, index) => ({
      from: nodeIds[index],
      to: id,
      relation: "dependency" as const,
    }))
    SemanticGuard.hold(session, {
      diagramId: "large-flow",
      nodeIds,
      edges,
    })
    const detail = SemanticGuard.pendingDetails(session)[0]
    expect(detail.suggestedChildren.length).toBeGreaterThan(1)
    expect(detail.suggestedChildren.every((child) => child.nodes.length <= 12)).toBe(true)
    expect(new Set(detail.suggestedChildren.map((child) => child.suggestedDiagramId)).size).toBe(
      detail.suggestedChildren.length,
    )
    expect(new Set(detail.suggestedChildren.flatMap((child) => child.nodes.map((node) => node.id)))).toEqual(
      new Set(nodeIds),
    )
    expect(detail.suggestedChildren.flatMap((child) => child.edges.map((link) => `${link.from}->${link.to}`))).toEqual(
      edges.map((link) => `${link.from}->${link.to}`),
    )
    expect(SemanticGuard.pendingDetails(session)[0].suggestedChildren).toEqual(detail.suggestedChildren)
  })

  test("resolves split coverage by visible semantics without duplicating source binding metadata", () => {
    const session = randomUUID()
    const parent = {
      diagramId: "bound-parent",
      nodeIds: ["caller", "callee"],
      nodes: [
        { id: "caller", symbol: "caller", designUnitId: "target" },
        { id: "callee", symbol: "callee", designUnitId: "child" },
      ],
      edges: [
        {
          from: "caller",
          to: "callee",
          relation: "direct-call" as const,
          fromSymbol: "caller",
          toSymbol: "callee",
        },
      ],
    }
    SemanticGuard.hold(session, parent)
    SemanticGuard.allow(session, "a".repeat(64), "/workspace/focus.png", {
      diagramId: "bound-child",
      splitFromDiagramId: "bound-parent",
      nodeIds: ["caller", "callee"],
      edges: [{ from: "caller", to: "callee", relation: "direct-call" }],
    })
    expect(SemanticGuard.pending(session)).toEqual([])

    const conflict = randomUUID()
    SemanticGuard.hold(conflict, parent)
    expect(
      SemanticGuard.advance(conflict, {
        diagramId: "remapped-child",
        splitFromDiagramId: "bound-parent",
        nodeIds: ["caller", "callee"],
        nodes: [
          { id: "caller", symbol: "other", designUnitId: "target" },
          { id: "callee", symbol: "callee", designUnitId: "child" },
        ],
        edges: [{ from: "caller", to: "callee", relation: "direct-call" }],
      })?.code,
    ).toBe("mermaid-semantic-coverage-regression-blocked")
  })

  test("enforces source-backed validation and render budgets without affecting ordinary sessions", () => {
    const session = randomUUID()
    const ordinary = randomUUID()
    const file = "claims/diagram-claims.json"
    for (const _ of Array.from({ length: 10 })) {
      expect(SemanticGuard.validate(session, file)).toBeUndefined()
    }
    expect(SemanticGuard.validate(session, file)?.code).toBe("mermaid-semantic-validation-budget-exhausted")
    expect(SemanticGuard.validate(session, "claims/other.json")).toBeUndefined()
    expect(SemanticGuard.render(session, file)).toBeUndefined()
    expect(SemanticGuard.render(session, file)).toBeUndefined()
    expect(SemanticGuard.render(session, file)).toBeUndefined()
    expect(SemanticGuard.render(session, file)).toBeUndefined()
    expect(SemanticGuard.render(session, file)?.code).toBe("mermaid-semantic-render-budget-exhausted")
    expect(SemanticGuard.check(ordinary)).toBeUndefined()
    expect(SemanticGuard.insert(ordinary, "a".repeat(64), "/workspace/ordinary.png")).toBeUndefined()
  })

  test("does not consume render budget until source-backed validation passes", async () => {
    await within(async (dir) => {
      const diagram = ["flowchart TD", '  caller["caller"]', '  callee["callee"]', "  caller -->|待确认| callee"].join(
        "\n",
      )
      await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) { callee(); }\n", "utf8")
      const file = path.join(dir, "claims.json")
      const manifest = {
        version: 1,
        diagramId: "budget",
        diagramType: "focused",
        scopePath: ".",
        sourceHash: "0".repeat(64),
        language: "c",
        nodes: [
          { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
          { id: "callee", symbol: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
        ],
        edges: [
          {
            id: "edge",
            from: "caller",
            to: "callee",
            relation: "unknown",
            status: "unknown",
            evidence: [{ path: "code.c", startLine: 1, endLine: 2 }],
          },
        ],
      }
      await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      const session = randomUUID()
      let requests = 0
      const server = createServer((_request, response) => {
        requests += 1
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            pngBase64: png,
            width: 480,
            height: 280,
            pixelWidth: 1440,
            pixelHeight: 840,
            scale: 3,
          }),
        )
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("server did not bind")
      const input = {
        source: diagram,
        semanticMode: "source-backed" as const,
        semanticEvidencePath: file,
        semanticSessionId: session,
        remoteEndpoint: `http://127.0.0.1:${address.port}`,
      }
      try {
        for (const _ of Array.from({ length: 10 })) {
          const invalid = await renderMermaidDiagram(input)
          expect(invalid.rendered).toBe(false)
          expect(invalid.semanticIssues.some((item) => item.code === "semantic-source-hash-mismatch")).toBe(true)
        }
        expect(requests).toBe(0)

        manifest.sourceHash = createHash("sha256").update(diagram).digest("hex")
        await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
        for (const _ of Array.from({ length: 4 })) {
          const rendered = await renderMermaidDiagram(input)
          expect(rendered.rendered).toBe(true)
        }
        const exhausted = await renderMermaidDiagram(input)
        expect(exhausted.rendered).toBe(false)
        expect(exhausted.semanticIssues.some((item) => item.code === "mermaid-semantic-render-budget-exhausted")).toBe(
          true,
        )
        expect(requests).toBe(4)
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
      }
    })
  })

  test("accepts the source hash placeholder only inside a source-backed batch", async () => {
    await within(async (dir) => {
      await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) { callee(); }\n", "utf8")
      const file = path.join(dir, "claims.json")
      await fs.writeFile(
        file,
        `${JSON.stringify(
          {
            version: 1,
            diagramId: "placeholder",
            diagramType: "focused",
            scopePath: ".",
            sourceHash: "$MMD_SHA256",
            language: "c",
            nodes: [
              { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
              { id: "callee", symbol: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
            ],
            edges: [
              {
                id: "edge",
                from: "caller",
                to: "callee",
                relation: "unknown",
                status: "unknown",
                evidence: [{ path: "code.c", startLine: 1, endLine: 2 }],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const standalone = await validateMermaidDiagramRequest({
        source: ["flowchart TD", '  caller["caller"]', '  callee["callee"]', "  caller -->|待确认| callee"].join("\n"),
        semanticMode: "source-backed",
        semanticEvidencePath: file,
      })
      expect(standalone.semanticStatus).toBe("invalid")
      expect(standalone.issues.some((item) => item.code === "semantic-source-hash-placeholder-not-allowed")).toBe(true)
    })
  })

  test("keeps ordinary Mermaid synchronous and does not request source semantics", async () => {
    await within(async () => {
      let calls = 0
      const value = await validateMermaidDiagramRequest({
        source,
        semanticQuery: async () => {
          calls += 1
          return result()
        },
      })
      expect(value.valid).toBe(true)
      expect(value.semanticStatus).toBe("not-requested")
      expect(value.claimCount).toBe(0)
      expect(calls).toBe(0)
    })
  })

  test("accepts an exact C call and rejects the reversed direction", async () => {
    await within(async (dir) => {
      const file = await claims(dir)
      let queries = 0
      const valid = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => {
          queries += 1
          return result()
        },
      })
      expect(valid.semanticStatus).toBe("valid")
      expect(valid.validatedClaimCount).toBe(3)
      expect(queries).toBe(0)
      expect(valid.semanticFingerprint).toMatchObject({
        diagramId: "arch-1",
        nodeIds: ["callee", "caller"],
        edges: [{ from: "caller", to: "callee", relation: "direct-call" }],
      })
      expect(valid.diagnosticsPath).toBe(path.join(dir, "diagram-claims.semantic-diagnostics.json"))
      expect(JSON.parse(await fs.readFile(valid.diagnosticsPath!, "utf8")).semanticStatus).toBe("valid")

      await claims(dir, { fromSymbol: "callee", toSymbol: "caller" })
      const invalid = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(invalid.semanticStatus).toBe("invalid")
      expect(invalid.issues.some((item) => item.code === "semantic-call-direction-reversed")).toBe(true)
    })
  })

  test("does not require strong endpoint symbols or CodeGraph for an evidenced dependency edge", async () => {
    await within(async (dir) => {
      const file = await claims(dir, {
        relation: "dependency",
        fromSymbol: "caller",
        toSymbol: "callee",
        evidence: [{ path: "code.c", startLine: 1, endLine: 1 }],
      })
      let queries = 0
      const valid = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => {
          queries += 1
          throw new Error("dependency must not query CodeGraph")
        },
      })
      expect(valid.semanticStatus).toBe("valid")
      expect(valid.validatedClaimCount).toBe(3)
      expect(queries).toBe(0)
      expect(valid.issues).toEqual([])
    })
  })

  test("parses compact arrows and infers strong-relation symbols from active endpoint claims", async () => {
    await within(async (dir) => {
      const diagram = ["flowchart TD", '  caller["caller"]-->|调用|callee["callee"]'].join("\n")
      await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) { callee(); }\n", "utf8")
      await fs.writeFile(
        path.join(dir, "diagram-claims.json"),
        `${JSON.stringify(
          {
            version: 1,
            diagramId: "compact-call",
            diagramType: "code-flow",
            scopePath: ".",
            sourceHash: createHash("sha256").update(diagram).digest("hex"),
            language: "c",
            nodes: [
              {
                id: "caller",
                symbol: "caller",
                status: "active",
                evidence: [{ path: "code.c", startLine: 2, endLine: 2 }],
              },
              {
                id: "callee",
                symbol: "callee",
                status: "active",
                evidence: [{ path: "code.c", startLine: 1, endLine: 1 }],
              },
            ],
            edges: [
              {
                id: "call-1",
                from: "caller",
                to: "callee",
                relation: "direct-call",
                event: "调用",
                status: "active",
                evidence: [{ path: "code.c", startLine: 1, endLine: 2 }],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const valid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(valid.issues).toEqual([])
      expect(valid.semanticStatus).toBe("valid")
      expect(valid.validatedClaimCount).toBe(3)
    })
  })

  test("expands compact node and edge groups without weakening per-item validation", async () => {
    await within(async (dir) => {
      const diagram = [
        "flowchart TD",
        '  entry["entry"] --> dispatch{"dispatch"}',
        '  dispatch --> retry["retry"]',
        '  dispatch --> failure["failure"]',
        "  retry --> done",
        "  failure --> done",
      ].join("\n")
      await fs.writeFile(
        path.join(dir, "code.c"),
        ["void run(void) {", "  if (ready) retry();", "  else fail();", "  done();", "}"].join("\n"),
        "utf8",
      )
      await fs.writeFile(
        path.join(dir, "diagram-claims.json"),
        `${JSON.stringify(
          {
            version: 1,
            diagramId: "compact-groups",
            diagramType: "business-flow",
            scopePath: ".",
            sourceHash: createHash("sha256").update(diagram).digest("hex"),
            language: "c",
            evidenceCatalog: {
              S1: { path: "code.c", startLine: 1, endLine: 5 },
            },
            nodes: [],
            edges: [],
            nodeGroups: [
              {
                items: [["entry"], ["dispatch"], ["retry"], ["failure"], ["done"]],
                status: "confirmed",
                evidenceIds: ["S1"],
              },
            ],
            edgeGroups: [
              {
                id: "flow",
                pairs: [
                  ["entry", "dispatch"],
                  ["dispatch", "retry"],
                  ["dispatch", "failure"],
                  ["retry", "done"],
                  ["failure", "done"],
                ],
                relation: "dependency",
                status: "confirmed",
                evidenceIds: ["S1"],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const valid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticSessionId: randomUUID(),
        semanticQuery: async () => result(),
      })
      expect(valid.semanticStatus).toBe("valid")
      expect(valid.validatedClaimCount).toBe(10)
      expect(valid.claimCount).toBe(10)
      expect(valid.semanticFingerprint?.nodeIds).toEqual(["dispatch", "done", "entry", "failure", "retry"])
      expect(valid.semanticFingerprint?.edges).toHaveLength(5)
    })
  })

  test("rejects compact strong-relation groups without exact endpoint symbols", async () => {
    await within(async (dir) => {
      await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) { callee(); }\n", "utf8")
      await fs.writeFile(
        path.join(dir, "diagram-claims.json"),
        `${JSON.stringify(
          {
            version: 1,
            diagramId: "compact-strong-invalid",
            diagramType: "code-flow",
            scopePath: ".",
            sourceHash: createHash("sha256").update(source).digest("hex"),
            language: "c",
            evidenceCatalog: {
              S1: { path: "code.c", startLine: 1, endLine: 2 },
            },
            nodes: [],
            edges: [],
            nodeGroups: [
              {
                items: [["caller"], ["callee"]],
                status: "confirmed",
                evidenceIds: ["S1"],
              },
            ],
            edgeGroups: [
              {
                id: "calls",
                pairs: [["caller", "callee"]],
                relation: "direct-call",
                status: "confirmed",
                evidenceIds: ["S1"],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const invalid = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(invalid.semanticStatus).toBe("invalid")
      expect(invalid.issues.some((item) => item.code === "semantic-evidence-unreadable")).toBe(true)
      expect(invalid.issues.some((item) => item.message.includes("requires fromSymbol"))).toBe(true)
    })
  })

  test("does not parse bracket-like source notation inside quoted labels as phantom nodes", async () => {
    await within(async (dir) => {
      const diagram = [
        "flowchart TD",
        '  caller["读取 snapshot[]"]',
        '  callee["更新 states[]"]',
        "  caller --> callee",
      ].join("\n")
      const file = await claims(
        dir,
        {},
        {
          sourceHash: createHash("sha256").update(diagram).digest("hex"),
        },
      )
      const valid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(valid.semanticStatus).toBe("valid")
      expect(valid.issues).toEqual([])
    })
  })

  test("rejects dependency claims that downgrade real state-diagram transitions", async () => {
    await within(async (dir) => {
      const diagram = ["stateDiagram-v2", "  FREE --> QUEUED: submit"].join("\n")
      await fs.writeFile(
        path.join(dir, "code.c"),
        "enum State { FREE, QUEUED };\nvoid submit(void) { if (state == FREE) state = QUEUED; }\n",
        "utf8",
      )
      const value = {
        version: 1,
        diagramId: "state-1",
        diagramType: "state-machine",
        scopePath: ".",
        sourceHash: createHash("sha256").update(diagram).digest("hex"),
        language: "c",
        nodes: [
          { id: "FREE", symbol: "FREE", evidence: [{ path: "code.c", startLine: 1, endLine: 2 }] },
          { id: "QUEUED", symbol: "QUEUED", evidence: [{ path: "code.c", startLine: 1, endLine: 2 }] },
        ],
        edges: [
          {
            id: "transition-1",
            from: "FREE",
            to: "QUEUED",
            relation: "dependency",
            fromSymbol: "FREE",
            toSymbol: "QUEUED",
            evidence: [{ path: "code.c", startLine: 2, endLine: 2 }],
          },
        ],
      }
      await fs.writeFile(path.join(dir, "diagram-claims.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const invalid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
      })
      expect(invalid.semanticStatus).toBe("invalid")
      expect(invalid.issues.some((item) => item.code === "semantic-state-transition-downgrade")).toBe(true)
    })
  })

  test("ignores state-transition label symbols and the initial pseudostate edge", async () => {
    await within(async (dir) => {
      const diagram = [
        "stateDiagram-v2",
        "  [*] --> FREE",
        "  FREE --> WAIT_HOST : 待确认: fe_command_wait_host (前态由调用链保证)",
      ].join("\n")
      await fs.writeFile(
        path.join(dir, "code.c"),
        "enum State { FREE, WAIT_HOST };\nvoid fe_command_wait_host(void) {}\n",
        "utf8",
      )
      await fs.writeFile(
        path.join(dir, "diagram-claims.json"),
        `${JSON.stringify(
          {
            version: 1,
            diagramId: "state-labels",
            diagramType: "state-machine",
            scopePath: ".",
            sourceHash: createHash("sha256").update(diagram).digest("hex"),
            language: "c",
            nodes: [
              { id: "FREE", symbol: "FREE", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
              { id: "WAIT_HOST", symbol: "WAIT_HOST", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
            ],
            edges: [
              {
                id: "wait",
                from: "FREE",
                to: "WAIT_HOST",
                relation: "unknown",
                status: "unknown",
                evidence: [{ path: "code.c", startLine: 1, endLine: 2 }],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const valid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
      })
      expect(valid.semanticStatus).toBe("valid-with-unknowns")
      expect(valid.issues.some((item) => item.code === "semantic-node-unclaimed")).toBe(false)
      expect(valid.issues.some((item) => item.code === "semantic-edge-unclaimed")).toBe(false)
    })
  })

  test("rejects fictitious symbols, duplicate claims, unclaimed edges, and stale ranges", async () => {
    await within(async (dir) => {
      const file = await claims(
        dir,
        { evidence: [{ path: "code.c", startLine: 99, endLine: 100 }] },
        {
          nodes: [
            { id: "caller", symbol: "missing_symbol", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
            { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
          ],
          edges: [],
        },
      )
      const invalid = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(invalid.semanticStatus).toBe("invalid")
      expect(invalid.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining([
          "semantic-node-claim-duplicate",
          "semantic-edge-unclaimed",
          "semantic-evidence-invalid",
        ]),
      )
    })
  })

  test("cannot bypass C/C++ validation with a false language or relation", async () => {
    await within(async (dir) => {
      const file = await claims(dir, {}, { language: "python" })
      const language = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(language.semanticStatus).toBe("invalid")
      expect(language.issues.some((item) => item.code === "semantic-language-mismatch")).toBe(true)

      await claims(dir, { relation: "trust-me" })
      const relation = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(relation.semanticStatus).toBe("invalid")
      expect(relation.issues.some((item) => item.code === "semantic-evidence-unreadable")).toBe(true)
      expect(relation.issues[0]?.message).toContain('relation "trust-me"')
      expect(relation.issues[0]?.message).toContain("direct-call, callback, ownership")

      await claims(dir, { relation: "dependency", evidence: [{ path: "code.c", startLine: 1 }] })
      const range = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(range.semanticStatus).toBe("invalid")
      expect(range.issues[0]?.message).toContain("edges[0].evidence[0].endLine must be a number")
      expect(range.issues[0]?.message).not.toContain('relation "dependency"')

      await claims(dir, {
        fromSymbol: undefined,
        toSymbol: undefined,
        evidence: [{ path: "code.c" }],
      })
      const fields = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(fields.semanticStatus).toBe("invalid")
      expect(fields.issues[0]?.message).toContain("edges[0].evidence[0].startLine must be a number")
      expect(fields.issues[0]?.message).toContain("edges[0].evidence[0].endLine must be a number")

      await claims(
        dir,
        { fromSymbol: undefined, toSymbol: undefined },
        {
          nodes: [
            { id: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
            { id: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
          ],
        },
      )
      const symbols = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(symbols.semanticStatus).toBe("invalid")
      expect(symbols.issues[0]?.message).toContain(
        "edges[0] relation direct-call requires fromSymbol/toSymbol or endpoint node symbols",
      )
    })
  })

  test("explains the required top-level manifest shape", async () => {
    await within(async (dir) => {
      const file = path.join(dir, "diagram-claims.json")
      await fs.writeFile(file, `${JSON.stringify({ diagrams: [] })}\n`, "utf8")
      const invalid = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
      })
      expect(invalid.semanticStatus).toBe("invalid")
      expect(invalid.issues[0]?.message).toContain("Do not wrap claims in diagrams[]")
      expect(invalid.issues[0]?.message).toContain("language is the source-code language")
      expect(invalid.issues[0]?.message).toContain("container is its Mermaid subgraph ID")
    })
  })

  test("infers C/C++ strong validation when language is omitted", async () => {
    await within(async (dir) => {
      const file = await claims(dir, {}, { language: undefined })
      let queries = 0
      const valid = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => {
          queries += 1
          return result()
        },
      })
      expect(valid.semanticStatus).toBe("valid")
      expect(queries).toBe(0)
    })
  })

  test("reuses catalog evidence and supports conceptual architecture nodes without fake symbols", async () => {
    await within(async (dir) => {
      const diagram = [
        "flowchart TD",
        '  owner["Module\\n目标对象"]',
        '  role["helper_file\\n辅助职责"]',
        "  owner -->|成员依赖| role",
      ].join("\n")
      await fs.writeFile(path.join(dir, "code.c"), "typedef struct Module { int helper; } Module;\n", "utf8")
      const value = {
        version: 1,
        diagramId: "architecture-catalog",
        diagramType: "architecture",
        designUnitId: "target",
        designUnitCensusPath: "design-unit-census.json",
        scopePath: ".",
        sourceHash: createHash("sha256").update(diagram).digest("hex"),
        language: "c",
        evidenceCatalog: {
          S1: { path: "code.c", startLine: 1, endLine: 1, symbols: ["Module", "helper"] },
        },
        nodes: [
          { id: "owner", symbol: "Module", designUnitId: "target", evidenceIds: ["S1"] },
          { id: "role", designUnitId: "child", evidenceIds: ["S1"] },
        ],
        edges: [{ id: "dependency-1", from: "owner", to: "role", relation: "dependency", evidenceIds: ["S1"] }],
      }
      await fs.writeFile(
        path.join(dir, "design-unit-census.json"),
        `${JSON.stringify(
          {
            version: 1,
            targetDesignUnitId: "target",
            targetSourceRoot: ".",
            designUnits: [
              { id: "target", name: "Module", kind: "target" },
              { id: "child", name: "helper_file", kind: "confirmed-submodule", parentId: "target" },
            ],
            implementationUnits: [{ path: "code.c", disposition: "target", designUnitId: "target" }],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const file = path.join(dir, "diagram-claims.json")
      await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const valid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(valid.semanticStatus).toBe("valid")
      expect(valid.validatedClaimCount).toBe(3)

      value.nodes[1]!.evidenceIds = ["missing"]
      await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const invalid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(invalid.semanticStatus).toBe("invalid")
      expect(invalid.issues.some((item) => item.code === "semantic-evidence-ref-missing")).toBe(true)
    })
  })

  test("rejects an owning architecture that omits or duplicates a frozen confirmed child", async () => {
    await within(async (dir) => {
      const diagram = [
        "flowchart TD",
        '  owner["Module\\n目标对象"]',
        '  role["helper_file\\n辅助职责"]',
        "  owner --> role",
      ].join("\n")
      await fs.writeFile(path.join(dir, "code.c"), "typedef struct Module { int helper; } Module;\n", "utf8")
      const census = {
        version: 1,
        targetDesignUnitId: "target",
        targetSourceRoot: ".",
        designUnits: [
          { id: "target", name: "Module", kind: "target" },
          { id: "child", name: "helper_file", kind: "confirmed-submodule", parentId: "target" },
          { id: "missing", name: "required_worker", kind: "confirmed-submodule", parentId: "target" },
        ],
        implementationUnits: [{ path: "code.c", disposition: "target", designUnitId: "target" }],
      }
      await fs.writeFile(path.join(dir, "design-unit-census.json"), `${JSON.stringify(census, null, 2)}\n`, "utf8")
      const value = {
        version: 1,
        diagramId: "architecture-coverage",
        diagramType: "architecture",
        designUnitId: "target",
        designUnitCensusPath: "design-unit-census.json",
        scopePath: "target.c",
        sourceHash: createHash("sha256").update(diagram).digest("hex"),
        language: "c",
        evidenceCatalog: { S1: { path: "code.c", startLine: 1, endLine: 1 } },
        nodes: [
          { id: "owner", designUnitId: "target", evidenceIds: ["S1"] },
          { id: "role", designUnitId: "child", evidenceIds: ["S1"] },
        ],
        edges: [{ id: "dependency-1", from: "owner", to: "role", relation: "dependency", evidenceIds: ["S1"] }],
      }
      const file = path.join(dir, "diagram-claims.json")
      await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const missing = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(missing.semanticStatus).toBe("invalid")
      expect(missing.issues.some((item) => item.code === "semantic-design-unit-node-missing")).toBe(true)

      value.diagramType = "目标架构图"
      await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const localized = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(localized.semanticStatus).toBe("invalid")
      expect(localized.issues.some((item) => item.code === "semantic-design-unit-node-missing")).toBe(true)

      value.diagramType = "architecture"
      value.nodes[0]!.designUnitId = "child"
      await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const duplicate = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(duplicate.semanticStatus).toBe("invalid")
      expect(duplicate.issues.some((item) => item.code === "semantic-design-unit-node-duplicate")).toBe(true)

      census.designUnits.push({ id: "other-target", name: "Other", kind: "target" })
      await fs.writeFile(path.join(dir, "design-unit-census.json"), `${JSON.stringify(census, null, 2)}\n`, "utf8")
      const targets = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(targets.semanticStatus).toBe("invalid")
      expect(targets.issues.some((item) => item.code === "semantic-census-unreadable")).toBe(true)
    })
  })

  test("rejects a target implementation file omitted or excluded only because it is a utility", async () => {
    await within(async (dir) => {
      const diagram = ["flowchart TD", '  owner["Target"]', '  helper["Endian helper"]', "  owner --> helper"].join(
        "\n",
      )
      await fs.writeFile(path.join(dir, "core.c"), "void core_init(void) { helper_swap(); }\n", "utf8")
      await fs.writeFile(path.join(dir, "helper.c"), "unsigned helper_swap(void) { return 1; }\n", "utf8")
      const units: Array<Record<string, unknown>> = [{ path: "core.c", disposition: "target", designUnitId: "target" }]
      const census = {
        version: 1,
        targetDesignUnitId: "target",
        targetSourceRoot: ".",
        designUnits: [
          { id: "target", name: "Target", kind: "target" },
          { id: "helper", name: "Endian helper", kind: "confirmed-submodule", parentId: "target" },
        ],
        implementationUnits: units,
      }
      const manifest = {
        version: 1,
        diagramId: "architecture-implementation-census",
        diagramType: "architecture",
        designUnitId: "target",
        designUnitCensusPath: "design-unit-census.json",
        scopePath: ".",
        sourceHash: createHash("sha256").update(diagram).digest("hex"),
        language: "c",
        nodes: [
          { id: "owner", designUnitId: "target", evidence: [{ path: "core.c", startLine: 1, endLine: 1 }] },
          { id: "helper", designUnitId: "helper", evidence: [{ path: "helper.c", startLine: 1, endLine: 1 }] },
        ],
        edges: [
          {
            id: "dependency-1",
            from: "owner",
            to: "helper",
            relation: "dependency",
            evidence: [{ path: "core.c", startLine: 1, endLine: 1 }],
          },
        ],
      }
      await fs.writeFile(path.join(dir, "diagram-claims.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      await fs.writeFile(path.join(dir, "design-unit-census.json"), `${JSON.stringify(census, null, 2)}\n`, "utf8")

      const missing = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(missing.semanticStatus).toBe("invalid")
      expect(
        missing.issues.some(
          (item) => item.code === "semantic-implementation-unit-unmapped" && item.path === "helper.c",
        ),
      ).toBe(true)

      units.push({
        path: "helper.c",
        disposition: "excluded",
        exclusion: {
          reason: "utility",
          evidence: [{ path: "helper.c", startLine: 1, endLine: 1 }],
        },
      })
      await fs.writeFile(path.join(dir, "design-unit-census.json"), `${JSON.stringify(census, null, 2)}\n`, "utf8")
      const utility = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(utility.semanticStatus).toBe("invalid")
      expect(utility.issues.some((item) => item.code === "semantic-census-unreadable")).toBe(true)

      units[1] = {
        path: "helper.c",
        disposition: "confirmed-submodule",
        designUnitId: "helper",
      }
      await fs.writeFile(path.join(dir, "design-unit-census.json"), `${JSON.stringify(census, null, 2)}\n`, "utf8")
      const valid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(valid.semanticStatus).toBe("valid")

      await fs.writeFile(path.join(dir, "meson.build"), "sources = ['core.c', 'helper.c']\n", "utf8")
      delete (manifest as { language?: string }).language
      manifest.nodes = [
        { id: "owner", designUnitId: "target", evidence: [{ path: "meson.build", startLine: 1, endLine: 1 }] },
        { id: "helper", designUnitId: "helper", evidence: [{ path: "meson.build", startLine: 1, endLine: 1 }] },
      ]
      manifest.edges = [
        {
          id: "dependency-1",
          from: "owner",
          to: "helper",
          relation: "dependency",
          evidence: [{ path: "meson.build", startLine: 1, endLine: 1 }],
        },
      ]
      await fs.writeFile(path.join(dir, "diagram-claims.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      await fs.writeFile(
        path.join(dir, "design-unit-census.json"),
        `${JSON.stringify(
          {
            version: 1,
            targetDesignUnitId: "target",
            designUnits: census.designUnits,
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const bypass = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(bypass.semanticStatus).toBe("invalid")
      expect(bypass.issues.some((item) => item.code === "semantic-census-unreadable")).toBe(true)
    })
  })

  test("allows an explicitly narrow implementation-file census without weakening directory census", async () => {
    await within(async (dir) => {
      const diagram = [
        "flowchart TD",
        '  owner["Target implementation"]',
        '  role["Scheduling responsibility"]',
        "  owner --> role",
      ].join("\n")
      await fs.writeFile(path.join(dir, "target.c"), "void target_run(void) {}\n", "utf8")
      await fs.writeFile(path.join(dir, "sibling.c"), "void sibling_run(void) {}\n", "utf8")
      const manifest = {
        version: 1,
        diagramId: "architecture-single-file-census",
        diagramType: "architecture",
        designUnitId: "target",
        designUnitCensusPath: "design-unit-census.json",
        scopePath: ".",
        sourceHash: createHash("sha256").update(diagram).digest("hex"),
        language: "c",
        nodes: [
          { id: "owner", designUnitId: "target", evidence: [{ path: "target.c", startLine: 1, endLine: 1 }] },
          { id: "role", evidence: [{ path: "target.c", startLine: 1, endLine: 1 }] },
        ],
        edges: [
          {
            id: "dependency-1",
            from: "owner",
            to: "role",
            relation: "dependency",
            evidence: [{ path: "target.c", startLine: 1, endLine: 1 }],
          },
        ],
      }
      const census = {
        version: 1,
        targetDesignUnitId: "target",
        targetSourceRoot: "target.c",
        designUnits: [{ id: "target", name: "Target", kind: "target" }],
        implementationUnits: [{ path: "target.c", disposition: "target", designUnitId: "target" }],
      }
      await fs.writeFile(path.join(dir, "diagram-claims.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      await fs.writeFile(path.join(dir, "design-unit-census.json"), `${JSON.stringify(census, null, 2)}\n`, "utf8")

      const narrow = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(narrow.semanticStatus).toBe("valid")
      expect(narrow.issues.some((item) => item.code === "semantic-implementation-unit-unmapped")).toBe(false)

      census.targetSourceRoot = "."
      manifest.scopePath = "."
      await fs.writeFile(path.join(dir, "diagram-claims.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      await fs.writeFile(path.join(dir, "design-unit-census.json"), `${JSON.stringify(census, null, 2)}\n`, "utf8")
      const module = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => result(),
      })
      expect(module.semanticStatus).toBe("invalid")
      expect(
        module.issues.some(
          (item) => item.code === "semantic-implementation-unit-unmapped" && item.path === "sibling.c",
        ),
      ).toBe(true)
    })
  })

  test("turns evidence and CodeGraph access failures into invalid diagnostics", async () => {
    await within(async (dir) => {
      const file = await claims(dir, { evidence: [{ path: "missing.c", startLine: 1, endLine: 1 }] })
      const evidence = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(evidence.semanticStatus).toBe("invalid")
      expect(evidence.issues.some((item) => item.code === "semantic-evidence-invalid")).toBe(true)

      await claims(dir)
      await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) {}\n", "utf8")
      const graph = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => {
          throw new Error("index unavailable")
        },
      })
      expect(graph.semanticStatus).toBe("invalid")
      expect(graph.issues.some((item) => item.code === "semantic-codegraph-query-failed")).toBe(true)
    })
  })

  test("validates callback registration, ownership, data flow, and state transitions", async () => {
    await within(async (dir) => {
      const cases = [
        {
          source,
          code: "void callee(void) {}\nvoid caller(void) { register_handler(callee); }\n",
          nodes: [
            { id: "caller", symbol: "caller" },
            { id: "callee", symbol: "callee" },
          ],
          edge: { relation: "callback", fromSymbol: "caller", toSymbol: "callee" },
        },
        {
          source,
          code: "struct caller { void (*callee)(void); };\n",
          nodes: [
            { id: "caller", symbol: "caller" },
            { id: "callee", symbol: "callee" },
          ],
          edge: { relation: "ownership", fromSymbol: "caller", toSymbol: "callee" },
        },
        {
          source,
          code: "int caller;\nint callee;\nvoid transfer(void) { callee = caller; }\n",
          nodes: [
            { id: "caller", symbol: "caller" },
            { id: "callee", symbol: "callee" },
          ],
          edge: { relation: "data-flow", fromSymbol: "caller", toSymbol: "callee" },
        },
      ]
      for (const item of cases) {
        const file = await scenario({ dir, ...item })
        const valid = await validateMermaidDiagramRequest({
          source: item.source,
          semanticMode: "source-backed",
          semanticEvidencePath: file,
          semanticQuery: async () => result(),
        })
        expect(valid.semanticStatus).toBe("valid")
      }

      const stateSource = ["stateDiagram-v2", "  idle", "  busy", "  idle -->|start| busy"].join("\n")
      const file = await scenario({
        dir,
        source: stateSource,
        code: "enum state { idle, busy };\nvoid start(void) { if (state == idle) state = busy; }\n",
        nodes: [
          { id: "idle", symbol: "idle" },
          { id: "busy", symbol: "busy" },
        ],
        edge: { relation: "state-transition", fromSymbol: "idle", toSymbol: "busy", event: "start" },
      })
      const base = result()
      const valid = await validateMermaidDiagramRequest({
        source: stateSource,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => base,
      })
      expect(valid.semanticStatus).toBe("valid")
      expect(valid.issues).toEqual([])

      await scenario({
        dir,
        source: stateSource,
        code: "enum state { idle, busy };\nvoid start(void) { log_state(idle); state = busy; }\n",
        nodes: [
          { id: "idle", symbol: "idle" },
          { id: "busy", symbol: "busy" },
        ],
        edge: { relation: "state-transition", fromSymbol: "idle", toSymbol: "busy", event: "start" },
      })
      const mentioned = await validateMermaidDiagramRequest({
        source: stateSource,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => base,
      })
      expect(mentioned.semanticStatus).toBe("invalid")
      expect(mentioned.issues.some((item) => item.code === "semantic-relation-unproven")).toBe(true)
    })
  })

  test("proves helper-mediated state transitions only with an explicit guarded call chain", async () => {
    await within(async (dir) => {
      const diagram = ["stateDiagram-v2", "  waiting", "  runnable", "  waiting -->|wake| runnable"].join("\n")
      const code = [
        "enum state { waiting, runnable };",
        "static void make_runnable(struct context *ctx) {",
        "  ctx->state = runnable;",
        "}",
        "void wake(struct context *ctx) {",
        "  if (ctx->state != waiting) return;",
        "  make_runnable(ctx);",
        "}",
      ].join("\n")
      await fs.writeFile(path.join(dir, "code.c"), `${code}\n`, "utf8")
      const value = {
        version: 1,
        diagramId: "helper-transition",
        diagramType: "state-machine",
        scopePath: ".",
        sourceHash: createHash("sha256").update(diagram).digest("hex"),
        language: "c",
        nodes: [
          { id: "waiting", symbol: "waiting", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
          { id: "runnable", symbol: "runnable", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
        ],
        edges: [
          {
            id: "wake",
            from: "waiting",
            to: "runnable",
            relation: "state-transition",
            fromSymbol: "waiting",
            toSymbol: "runnable",
            event: "wake",
            evidence: [
              { path: "code.c", startLine: 2, endLine: 4 },
              { path: "code.c", startLine: 5, endLine: 8 },
            ],
          },
        ],
      }
      const file = path.join(dir, "diagram-claims.json")
      await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const valid = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => ({ ...result(), stateTransitions: [] }),
      })
      expect(valid.semanticStatus).toBe("valid")

      value.edges[0]!.evidence = [
        { path: "code.c", startLine: 2, endLine: 4 },
        { path: "code.c", startLine: 5, endLine: 6 },
      ]
      await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
      const disconnected = await validateMermaidDiagramRequest({
        source: diagram,
        semanticMode: "source-backed",
        semanticEvidencePath: "diagram-claims.json",
        semanticQuery: async () => ({ ...result(), stateTransitions: [] }),
      })
      expect(disconnected.semanticStatus).toBe("invalid")
      expect(disconnected.issues.some((item) => item.code === "semantic-relation-unproven")).toBe(true)
    })
  })

  test("requires subgraph ownership claims and exact call-site overlap", async () => {
    await within(async (dir) => {
      const nested = [
        "flowchart TD",
        '  subgraph owner["owner"]',
        '    caller["caller"]',
        '    callee["callee"]',
        "    caller --> callee",
        "  end",
      ].join("\n")
      const file = await claims(dir, {}, { sourceHash: createHash("sha256").update(nested).digest("hex") })
      const container = await validateMermaidDiagramRequest({
        source: nested,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(container.semanticStatus).toBe("invalid")
      expect(container.issues.some((item) => item.code === "semantic-container-unclaimed")).toBe(true)

      const code = "void caller(void); void callee(void);\nvoid caller(void) { callee(); }\n"
      await fs.writeFile(path.join(dir, "code.c"), code, "utf8")
      const manifest = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"))
      manifest.sourceHash = createHash("sha256").update(source).digest("hex")
      manifest.edges[0].evidence = [{ path: "code.c", startLine: 1, endLine: 1 }]
      manifest.nodes = [
        { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 1, endLine: 2 }] },
        { id: "callee", symbol: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 2 }] },
      ]
      await fs.writeFile(path.join(dir, file), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      const overlap = await validateMermaidDiagramRequest({
        source,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
        semanticQuery: async () => result(),
      })
      expect(overlap.semanticStatus).toBe("invalid")
      expect(overlap.issues.some((item) => item.code === "semantic-relation-unproven")).toBe(true)
    })
  })

  test("allows an unproven relation only when visibly marked pending confirmation", async () => {
    await within(async (dir) => {
      const pending = source.replace("caller --> callee", "caller -->|待确认| callee")
      const file = await claims(
        dir,
        { relation: "unknown", status: "unknown" },
        {
          sourceHash: createHash("sha256").update(pending).digest("hex"),
          nodes: [
            { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
            { id: "callee", symbol: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
          ],
        },
      )
      const valid = await validateMermaidDiagramRequest({
        source: pending,
        semanticMode: "source-backed",
        semanticEvidencePath: file,
      })
      expect(valid.semanticStatus).toBe("valid-with-unknowns")
    })
  })

  test("does not call a renderer after semantic rejection", async () => {
    await within(async (dir) => {
      const file = await claims(dir, { fromSymbol: "callee", toSymbol: "caller" })
      let requests = 0
      const server = createServer((_request, response) => {
        requests += 1
        response.writeHead(500).end()
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("server did not bind")
      try {
        const rendered = await renderMermaidDiagram({
          source,
          semanticMode: "source-backed",
          semanticEvidencePath: file,
          remoteEndpoint: `http://127.0.0.1:${address.port}`,
        })
        expect(rendered.rendered).toBe(false)
        expect(rendered.semanticStatus).toBe("invalid")
        expect(requests).toBe(0)
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
      }
    })
  })

  test("renders a source-backed batch from workspace paths and persists compact resumable results", async () => {
    await within(async (dir) => {
      const diagram = ["flowchart TD", '  caller["caller"]', '  callee["callee"]', "  caller -->|待确认| callee"].join(
        "\n",
      )
      await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) { callee(); }\n", "utf8")
      const items = await Promise.all(
        ["architecture", "business"].map(async (name) => {
          const sourcePath = `${name}.mmd`
          const evidencePath = `${name}-claims.json`
          await fs.writeFile(path.join(dir, sourcePath), diagram, "utf8")
          await fs.writeFile(
            path.join(dir, evidencePath),
            `${JSON.stringify(
              {
                version: 1,
                diagramId: name,
                diagramType: "focused",
                scopePath: ".",
                sourceHash:
                  name === "architecture" ? "$MMD_SHA256" : createHash("sha256").update(diagram).digest("hex"),
                language: "c",
                nodes: [
                  { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
                  { id: "callee", symbol: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
                ],
                edges: [
                  {
                    id: `${name}-edge`,
                    from: "caller",
                    to: "callee",
                    relation: "unknown",
                    status: "unknown",
                    evidence: [{ path: "code.c", startLine: 1, endLine: 2 }],
                  },
                ],
              },
              null,
              2,
            )}\n`,
            "utf8",
          )
          return { diagramId: name, sourcePath, semanticEvidencePath: evidencePath }
        }),
      )
      await fs.writeFile(
        path.join(dir, "batch.json"),
        `${JSON.stringify({ version: 1, resultPath: "batch/results.json", items }, null, 2)}\n`,
        "utf8",
      )
      let requests = 0
      const server = createServer((_request, response) => {
        requests += 1
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({ pngBase64: png, width: 480, height: 280, pixelWidth: 1440, pixelHeight: 840, scale: 3 }),
        )
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("server did not bind")
      try {
        const batch = await renderSourceBackedMermaidBatch({
          manifestPath: "batch.json",
          remoteEndpoint: `http://127.0.0.1:${address.port}`,
          semanticSessionId: randomUUID(),
        })
        expect(requests).toBe(2)
        expect(batch).toMatchObject({
          requestedCount: 2,
          processedCount: 2,
          renderedCount: 2,
          readyCount: 2,
          invalidCount: 0,
          splitRequiredCount: 0,
          complete: true,
          resolvedSplitDiagramIds: [],
          resultPath: "batch/results.json",
        })
        expect(batch.items.map((item) => item.semanticStatus)).toEqual(["valid-with-unknowns", "valid-with-unknowns"])
        expect(batch.items.every((item) => item.pngPath && item.documentReady)).toBe(true)
        expect(JSON.parse(await fs.readFile(path.join(dir, batch.resultPath), "utf8")).complete).toBe(true)
        expect(JSON.parse(await fs.readFile(path.join(dir, "architecture-claims.json"), "utf8")).sourceHash).toBe(
          "$MMD_SHA256",
        )
        await renderSourceBackedMermaidBatch({
          manifestPath: "batch.json",
          remoteEndpoint: `http://127.0.0.1:${address.port}`,
          semanticSessionId: randomUUID(),
        })
        const history = await fs.readdir(path.join(dir, "batch/.history"))
        expect(history).toHaveLength(1)
        expect(history[0]).toMatch(/^results\.[0-9a-f]{12}\.results\.json$/)
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
      }
    })
  })

  test("records a pending split parent resolved by a readable replacement batch", async () => {
    await within(async (dir) => {
      const session = randomUUID()
      const diagram = ["flowchart TD", '  caller["caller"]', '  callee["callee"]', "  caller -->|待确认| callee"].join(
        "\n",
      )
      const fingerprint = {
        diagramId: "parent",
        nodeIds: ["caller", "callee"],
        nodes: [
          { id: "caller", symbol: "caller" },
          { id: "callee", symbol: "callee" },
        ],
        edges: [
          {
            from: "caller",
            to: "callee",
            relation: "unknown" as const,
            fromSymbol: "caller",
            toSymbol: "callee",
          },
        ],
      }
      SemanticGuard.hold(session, fingerprint)
      const child = SemanticGuard.pendingDetails(session)[0].suggestedChildren[0].suggestedDiagramId
      await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) { callee(); }\n", "utf8")
      await fs.writeFile(path.join(dir, `${child}.mmd`), diagram, "utf8")
      await fs.writeFile(
        path.join(dir, `${child}-claims.json`),
        `${JSON.stringify(
          {
            version: 1,
            diagramId: child,
            splitFromDiagramId: "parent",
            diagramType: "focused",
            scopePath: ".",
            sourceHash: createHash("sha256").update(diagram).digest("hex"),
            language: "c",
            nodes: [
              { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
              { id: "callee", symbol: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
            ],
            edges: [
              {
                id: "edge",
                from: "caller",
                to: "callee",
                relation: "unknown",
                status: "unknown",
                evidence: [{ path: "code.c", startLine: 1, endLine: 2 }],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      await fs.writeFile(
        path.join(dir, "repair.json"),
        `${JSON.stringify(
          {
            version: 1,
            items: [
              {
                diagramId: child,
                sourcePath: `${child}.mmd`,
                semanticEvidencePath: `${child}-claims.json`,
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            pngBase64: png,
            width: 480,
            height: 280,
            pixelWidth: 1440,
            pixelHeight: 840,
            scale: 3,
          }),
        )
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("server did not bind")
      try {
        const batch = await renderSourceBackedMermaidBatch({
          manifestPath: "repair.json",
          remoteEndpoint: `http://127.0.0.1:${address.port}`,
          semanticSessionId: session,
        })
        expect(batch.complete).toBe(true)
        expect(batch.resolvedSplitDiagramIds).toEqual(["parent"])
        expect(batch.pendingSplitDiagramIds).toEqual([])
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
      }
    })
  })

  test("rejects a stale full batch before consuming attempts while a split repair is pending", async () => {
    await within(async (dir) => {
      const session = randomUUID()
      SemanticGuard.hold(session, {
        diagramId: "parent",
        nodeIds: ["entry", "done"],
        edges: [{ from: "entry", to: "done", relation: "dependency" }],
      })
      await fs.writeFile(
        path.join(dir, "stale.json"),
        `${JSON.stringify({
          version: 1,
          items: [
            {
              diagramId: "unrelated",
              sourcePath: "unrelated.mmd",
              semanticEvidencePath: "unrelated-claims.json",
            },
          ],
        })}\n`,
        "utf8",
      )
      await expect(
        renderSourceBackedMermaidBatch({
          manifestPath: "stale.json",
          semanticSessionId: session,
        }),
      ).rejects.toThrow("The next batch must be repair-only")
      expect(SemanticGuard.validate(session, "unrelated-claims.json")).toBeUndefined()
      expect(SemanticGuard.render(session, "unrelated-claims.json")).toBeUndefined()
    })
  })

  test("roots batch artifacts at basePath while preserving workspace source evidence", async () => {
    await within(async (dir) => {
      const diagram = [
        "flowchart TD",
        '  subgraph owner["owner"]',
        '    caller["caller"]',
        '    callee["callee"]',
        "    caller -->|待确认| callee",
        "  end",
      ].join("\n")
      await fs.mkdir(path.join(dir, "src"), { recursive: true })
      await fs.mkdir(path.join(dir, "work/02-source-evidence"), { recursive: true })
      await fs.mkdir(path.join(dir, "work/04-diagrams"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "src/code.c"),
        "void callee(void) {}\nvoid caller(void) { callee(); }\n",
        "utf8",
      )
      await fs.writeFile(
        path.join(dir, "work/02-source-evidence/design-unit-census.json"),
        `${JSON.stringify({ version: 1, targetDesignUnitId: "target", designUnits: [{ id: "target", name: "Target", kind: "target" }] })}\n`,
        "utf8",
      )
      await fs.writeFile(path.join(dir, "work/04-diagrams/diagram.mmd"), diagram, "utf8")
      await fs.writeFile(
        path.join(dir, "work/04-diagrams/claims.json"),
        `${JSON.stringify(
          {
            version: 1,
            diagramId: "rooted",
            diagramType: "focused",
            scopePath: "src",
            designUnitCensusPath: "02-source-evidence/design-unit-census.json",
            sourceHash: "$MMD_SHA256",
            language: "c",
            nodes: [
              { id: "caller", symbol: "caller", evidence: [{ path: "src/code.c", startLine: 2, endLine: 2 }] },
              { id: "callee", symbol: "callee", evidence: [{ path: "src/code.c", startLine: 1, endLine: 1 }] },
            ],
            edges: [
              {
                id: "edge",
                from: "caller",
                to: "callee",
                relation: "unknown",
                status: "unknown",
                evidence: [{ path: "src/code.c", startLine: 1, endLine: 2 }],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      await fs.writeFile(
        path.join(dir, "work/batch.json"),
        `${JSON.stringify(
          {
            version: 1,
            basePath: "work",
            resultPath: "04-diagrams/results.json",
            items: [
              {
                diagramId: "rooted",
                sourcePath: "04-diagrams/diagram.mmd",
                semanticEvidencePath: "04-diagrams/claims.json",
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({ pngBase64: png, width: 480, height: 280, pixelWidth: 1440, pixelHeight: 840, scale: 3 }),
        )
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("server did not bind")
      try {
        const batch = await renderSourceBackedMermaidBatch({
          manifestPath: "work/batch.json",
          remoteEndpoint: `http://127.0.0.1:${address.port}`,
          semanticSessionId: randomUUID(),
        })
        expect(batch).toMatchObject({
          basePath: "work",
          resultPath: "work/04-diagrams/results.json",
          complete: true,
          readyCount: 1,
        })
        const claim = JSON.parse(await fs.readFile(path.join(dir, "work/04-diagrams/claims.json"), "utf8"))
        expect(claim.scopePath).toBe("src")
        expect(claim.designUnitCensusPath).toBe("work/02-source-evidence/design-unit-census.json")
        expect(claim.nodes[0].evidence[0].path).toBe("src/code.c")
        expect(claim.nodes.map((item: { container?: string }) => item.container)).toEqual(["owner", "owner"])
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
      }
    })
  })

  test("rejects batch item traversal outside basePath", async () => {
    await within(async (dir) => {
      await fs.mkdir(path.join(dir, "work"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "work/batch.json"),
        `${JSON.stringify({
          version: 1,
          basePath: "work",
          items: [{ diagramId: "escape", sourcePath: "../escape.mmd", semanticEvidencePath: "claims.json" }],
        })}\n`,
        "utf8",
      )
      expect(
        renderSourceBackedMermaidBatch({
          manifestPath: "work/batch.json",
          semanticSessionId: randomUUID(),
        }),
      ).rejects.toThrow("batch sourcePath must stay inside batch basePath")
    })
  })

  test("rejects a batch claim ID mismatch before contacting the renderer", async () => {
    await within(async (dir) => {
      await fs.writeFile(path.join(dir, "diagram.mmd"), source, "utf8")
      await fs.writeFile(
        path.join(dir, "claims.json"),
        `${JSON.stringify({ version: 1, diagramId: "other" }, null, 2)}\n`,
        "utf8",
      )
      await fs.writeFile(
        path.join(dir, "batch.json"),
        `${JSON.stringify(
          {
            version: 1,
            items: [
              {
                diagramId: "expected",
                sourcePath: "diagram.mmd",
                semanticEvidencePath: "claims.json",
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      let requests = 0
      const server = createServer((_request, response) => {
        requests += 1
        response.writeHead(500).end()
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("server did not bind")
      try {
        const batch = await renderSourceBackedMermaidBatch({
          manifestPath: "batch.json",
          remoteEndpoint: `http://127.0.0.1:${address.port}`,
          semanticSessionId: randomUUID(),
        })
        expect(requests).toBe(0)
        expect(batch.complete).toBe(false)
        expect(batch.invalidCount).toBe(1)
        expect(batch.items[0]?.issues[0]?.code).toBe("semantic-batch-diagram-id-mismatch")
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
      }
    })
  })

  test("records an invalid batch item and continues with later diagrams", async () => {
    await within(async (dir) => {
      const diagram = ["flowchart TD", '  caller["caller"]', '  callee["callee"]', "  caller -->|待确认| callee"].join(
        "\n",
      )
      await fs.writeFile(path.join(dir, "bad.mmd"), source, "utf8")
      await fs.writeFile(path.join(dir, "bad-claims.json"), "{invalid", "utf8")
      await fs.writeFile(path.join(dir, "good.mmd"), diagram, "utf8")
      await fs.writeFile(path.join(dir, "code.c"), "void callee(void) {}\nvoid caller(void) { callee(); }\n", "utf8")
      await fs.writeFile(
        path.join(dir, "diagram-claims.json"),
        `${JSON.stringify(
          {
            version: 1,
            diagramId: "arch-1",
            diagramType: "focused",
            scopePath: ".",
            sourceHash: createHash("sha256").update(diagram).digest("hex"),
            language: "c",
            nodes: [
              { id: "caller", symbol: "caller", evidence: [{ path: "code.c", startLine: 2, endLine: 2 }] },
              { id: "callee", symbol: "callee", evidence: [{ path: "code.c", startLine: 1, endLine: 1 }] },
            ],
            edges: [
              {
                id: "edge-1",
                from: "caller",
                to: "callee",
                relation: "unknown",
                status: "unknown",
                evidence: [{ path: "code.c", startLine: 1, endLine: 2 }],
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      await fs.writeFile(
        path.join(dir, "batch.json"),
        `${JSON.stringify(
          {
            version: 1,
            items: [
              {
                diagramId: "bad",
                sourcePath: "bad.mmd",
                semanticEvidencePath: "bad-claims.json",
              },
              {
                diagramId: "arch-1",
                sourcePath: "good.mmd",
                semanticEvidencePath: "diagram-claims.json",
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      let requests = 0
      const server = createServer((_request, response) => {
        requests += 1
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            pngBase64: png,
            width: 480,
            height: 280,
            pixelWidth: 1440,
            pixelHeight: 840,
            scale: 3,
          }),
        )
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("server did not bind")
      try {
        const batch = await renderSourceBackedMermaidBatch({
          manifestPath: "batch.json",
          remoteEndpoint: `http://127.0.0.1:${address.port}`,
          semanticSessionId: randomUUID(),
        })
        expect(requests).toBe(1)
        expect(batch).toMatchObject({
          requestedCount: 2,
          processedCount: 2,
          renderedCount: 1,
          readyCount: 1,
          invalidCount: 1,
          complete: false,
        })
        expect(batch.items[0]?.issues[0]?.code).toBe("semantic-batch-item-failed")
        expect(batch.items[1]?.documentReady).toBe(true)
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
      }
    })
  })
})
