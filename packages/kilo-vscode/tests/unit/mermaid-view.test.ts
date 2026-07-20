import { describe, expect, test } from "bun:test"
import { clampMermaidZoom, fitMermaidZoom } from "../../../ui/src/kilocode/markdown-mermaid-zoom"

describe("Mermaid viewer zoom", () => {
  test("clamps and snaps zoom to quarter steps", () => {
    expect(clampMermaidZoom(Number.NaN)).toBe(1)
    expect(clampMermaidZoom(0)).toBe(0.25)
    expect(clampMermaidZoom(0.62)).toBe(0.5)
    expect(clampMermaidZoom(0.63)).toBe(0.75)
    expect(clampMermaidZoom(10)).toBe(6)
  })

  test("fits diagrams without enlarging them beyond 100 percent", () => {
    expect(fitMermaidZoom({ width: 400, height: 300 }, { width: 800, height: 300 })).toBe(0.5)
    expect(fitMermaidZoom({ width: 1600, height: 900 }, { width: 800, height: 300 })).toBe(1)
    expect(fitMermaidZoom({ width: 0, height: 900 }, { width: 800, height: 300 })).toBe(1)
  })
})
