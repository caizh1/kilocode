import { expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Agent } from "../../src/agent/agent"
import { RenderMermaidDiagramTool } from "../../src/kilocode/tool/mermaid-documents"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"

const rt = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

test("render_mermaid_diagram does not replace an explicitly requested format", async () => {
  const tool = await rt.runPromise(
    Effect.gen(function* () {
      const info = yield* RenderMermaidDiagramTool
      return yield* Tool.init(info)
    }),
  )

  expect(tool.description).toContain("only when the user explicitly requests Mermaid")
  expect(tool.description).toContain("or does not specify another diagram language or renderer")
  expect(tool.description).toContain("Never use this tool as a fallback")
  expect(tool.description).toContain("UML/PlantUML, Graphviz, or draw.io")
  expect(tool.description).toContain("do not probe local PlantUML, Java, or Graphviz availability")
  expect(tool.description).toContain("do not convert the request to Mermaid")
  expect(tool.description).toContain("use render_plantuml_diagram when validation or rendering is requested")
  expect(tool.description).toContain("normal Code file-writing tool when only PlantUML source is requested")
  expect(tool.description).toContain("semanticMode validates claims")
  expect(tool.description).toContain("cannot omit semanticMode to bypass an invalid result")
})
