import { describe, it, expect } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { ChipMateActionProvider } = await import("../../src/services/code-actions/code-action-provider")

const provider = new ChipMateActionProvider()

function makeRange(isEmpty: boolean) {
  return { isEmpty }
}

function makeContext(diagnosticCount: number) {
  return { diagnostics: Array.from({ length: diagnosticCount }) }
}

describe("ChipMateActionProvider", () => {
  describe("provideCodeActions", () => {
    it("returns empty array when range is empty", () => {
      const result = provider.provideCodeActions({} as never, makeRange(true) as never, makeContext(0) as never)
      expect(result).toEqual([])
    })

    it("returns empty array when range is empty even with diagnostics", () => {
      const result = provider.provideCodeActions({} as never, makeRange(true) as never, makeContext(3) as never)
      expect(result).toEqual([])
    })

    it("offers high-confidence comments at an empty cursor in C/C++", () => {
      const result = provider.provideCodeActions(
        { languageId: "cpp" } as never,
        makeRange(true) as never,
        makeContext(0) as never,
      )

      expect(result).toHaveLength(1)
      expect(result[0]?.command?.command).toBe("chipmate.v2.generateCommentsForCurrentFunction")
    })

    it("offers batch comments for a non-empty C/C++ selection", () => {
      const result = provider.provideCodeActions(
        { languageId: "c" } as never,
        makeRange(false) as never,
        makeContext(0) as never,
      )

      expect(result.map((action) => action.command?.command)).toContain(
        "chipmate.v2.generateCommentsForSelectedFunctions",
      )
    })

    describe("non-empty range, no diagnostics", () => {
      it("returns Add, Explain, Improve actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        const titles = result.map((a) => a.title)
        expect(titles).toContain("Add to ChipMate")
        expect(titles).toContain("Explain with ChipMate")
        expect(titles).toContain("Improve with ChipMate")
      })

      it("does not include Fix action", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        expect(result.map((a) => a.title)).not.toContain("Fix with ChipMate")
      })

      it("returns exactly 3 actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        expect(result).toHaveLength(3)
      })

      it("uses correct command IDs", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        const commands = result.map((a) => a.command?.command)
        expect(commands).toContain("chipmate.v2.addToContext")
        expect(commands).toContain("chipmate.v2.explainCode")
        expect(commands).toContain("chipmate.v2.improveCode")
      })

      it("no action is preferred", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(0) as never)
        expect(result.every((a) => !a.isPreferred)).toBe(true)
      })
    })

    describe("non-empty range, with diagnostics", () => {
      it("returns Add and Fix actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(2) as never)
        const titles = result.map((a) => a.title)
        expect(titles).toContain("Add to ChipMate")
        expect(titles).toContain("Fix with ChipMate")
      })

      it("does not include Explain or Improve actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        const titles = result.map((a) => a.title)
        expect(titles).not.toContain("Explain with ChipMate")
        expect(titles).not.toContain("Improve with ChipMate")
      })

      it("returns exactly 2 actions", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        expect(result).toHaveLength(2)
      })

      it("Fix action is preferred", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        const fix = result.find((a) => a.title === "Fix with ChipMate")
        expect(fix?.isPreferred).toBe(true)
      })

      it("Fix action uses QuickFix kind", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        const fix = result.find((a) => a.title === "Fix with ChipMate")
        expect(fix?.kind.value).toBe("quickfix")
      })

      it("uses correct Fix command ID", () => {
        const result = provider.provideCodeActions({} as never, makeRange(false) as never, makeContext(1) as never)
        const fix = result.find((a) => a.title === "Fix with ChipMate")
        expect(fix?.command?.command).toBe("chipmate.v2.fixCode")
      })
    })
  })
})
