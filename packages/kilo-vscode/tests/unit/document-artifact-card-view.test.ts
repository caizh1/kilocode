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
          rendered: false,
          artifactDir: ".kilo/artifacts/mermaid-1",
          sourcePath: ".kilo/artifacts/mermaid-1/flow.mmd",
          diagnosticsPath: ".kilo/artifacts/mermaid-1/mermaid-diagnostics.json",
          diagnostics: [{ severity: "error", code: "mermaid-render-failed", message: "bad syntax" }],
          warnings: ["mermaid-render-failed: bad syntax"],
        }),
      },
    } satisfies ToolPart)

    expect(card?.quality).toBe("failed")
    expect(card?.links.some((link) => link.kind === "source")).toBe(true)
    expect(card?.links.some((link) => link.kind === "diagnostics")).toBe(true)
  })

  test("marks a clean legacy Mermaid render as ok without an explicit quality field", () => {
    const card = documentArtifactCardFromToolPart({
      id: "part-3",
      type: "tool",
      tool: "render_mermaid_diagram",
      state: {
        status: "completed",
        input: {},
        title: "Mermaid Diagram Rendered",
        metadata: {
          rendered: true,
          artifactDir: ".kilo/artifacts/mermaid-2",
          pngPath: ".kilo/artifacts/mermaid-2/flow.png",
        },
        output: JSON.stringify({
          rendered: true,
          artifactDir: ".kilo/artifacts/mermaid-2",
          pngPath: ".kilo/artifacts/mermaid-2/flow.png",
          diagnostics: [],
          issues: [],
          warnings: [],
        }),
      },
    } satisfies ToolPart)

    expect(card?.quality).toBe("ok")
  })

  test("keeps a successful fallback Mermaid render at warning instead of failed", () => {
    const warning = "mermaid-render-remote-failed: Remote render failed; local mmdc fallback succeeded."
    const card = documentArtifactCardFromToolPart({
      id: "part-4",
      type: "tool",
      tool: "render_mermaid_diagram",
      state: {
        status: "completed",
        input: {},
        title: "Mermaid Diagram Rendered",
        metadata: {
          rendered: true,
          artifactDir: ".kilo/artifacts/mermaid-3",
          warnings: [warning],
        },
        output: JSON.stringify({
          rendered: true,
          artifactDir: ".kilo/artifacts/mermaid-3",
          diagnostics: [{ severity: "warning", code: "mermaid-render-remote-failed", message: warning }],
          warnings: [warning],
        }),
      },
    } satisfies ToolPart)

    expect(card?.quality).toBe("warning")
    expect(card?.warnings).toEqual([warning])
  })

  test("shows separately saved PlantUML source and PNG with PlantUML labels", () => {
    const card = documentArtifactCardFromToolPart({
      id: "part-plantuml",
      type: "tool",
      tool: "render_plantuml_diagram",
      state: {
        status: "completed",
        input: {},
        title: "PlantUML Diagram Rendered",
        metadata: {
          rendered: true,
          sourcePath: "docs/cortex-r8.puml",
          pngPath: "docs/cortex-r8.png",
          quality: "ok",
        },
        output: JSON.stringify({
          rendered: true,
          sourcePath: "docs/cortex-r8.puml",
          pngPath: "docs/cortex-r8.png",
          issues: [],
        }),
      },
    } satisfies ToolPart)

    expect(card?.quality).toBe("ok")
    expect(card?.links).toEqual([
      { kind: "source", label: "Open PlantUML source", path: "docs/cortex-r8.puml" },
      { kind: "page-png", label: "Open PlantUML PNG", path: "docs/cortex-r8.png" },
    ])
  })
})
