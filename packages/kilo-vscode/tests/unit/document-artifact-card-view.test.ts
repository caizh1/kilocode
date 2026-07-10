import { describe, expect, test } from "bun:test"
import type { ToolPart } from "../../webview-ui/src/types/messages"
import { documentArtifactCardFromToolPart } from "../../webview-ui/src/components/chat/document-artifact-card"

describe("documentArtifactCardFromToolPart", () => {
  test("extracts Word render artifact links and distinguishes warning from failed", () => {
    const card = documentArtifactCardFromToolPart({
      id: "part-1",
      type: "tool",
      tool: "render_word_document",
      state: {
        status: "completed",
        input: {},
        title: "Word Document Rendered",
        metadata: {
          artifactDir: ".kilo/artifacts/render-1",
          pdfPath: ".kilo/artifacts/render-1/design.pdf",
          diagnosticsPath: ".kilo/artifacts/render-1/render-diagnostics.json",
        },
        output: JSON.stringify({
          artifactDir: ".kilo/artifacts/render-1",
          pdfPath: ".kilo/artifacts/render-1/design.pdf",
          pagePngPaths: [".kilo/artifacts/render-1/rendered/page-001.png"],
          pagePngWebviewUris: ["vscode-webview://safe/page-001.png"],
          diagnosticsPath: ".kilo/artifacts/render-1/render-diagnostics.json",
          warnings: ["blank-page: Renderer marked page 1 as blank."],
        }),
      },
    } satisfies ToolPart)

    expect(card?.quality).toBe("warning")
    expect(card?.links.some((link) => link.kind === "pdf")).toBe(true)
    expect(card?.links.find((link) => link.kind === "page-png")?.webviewUri).toBe("vscode-webview://safe/page-001.png")
    expect(card?.links.some((link) => link.kind === "diagnostics")).toBe(true)
  })

  test("extracts Mermaid artifact links and marks errors as failed", () => {
    const card = documentArtifactCardFromToolPart({
      id: "part-2",
      type: "tool",
      tool: "render_mermaid_diagram",
      state: {
        status: "completed",
        input: {},
        title: "Mermaid Diagram Render Failed",
        metadata: {
          artifactDir: ".kilo/artifacts/mermaid-1",
          sourcePath: ".kilo/artifacts/mermaid-1/flow.mmd",
          diagnosticsPath: ".kilo/artifacts/mermaid-1/mermaid-diagnostics.json",
        },
        output: JSON.stringify({
          artifactDir: ".kilo/artifacts/mermaid-1",
          sourcePath: ".kilo/artifacts/mermaid-1/flow.mmd",
          diagnosticsPath: ".kilo/artifacts/mermaid-1/mermaid-diagnostics.json",
          warnings: ["mermaid-render-failed: bad syntax"],
        }),
      },
    } satisfies ToolPart)

    expect(card?.quality).toBe("failed")
    expect(card?.links.some((link) => link.kind === "source")).toBe(true)
    expect(card?.links.some((link) => link.kind === "diagnostics")).toBe(true)
  })
})
