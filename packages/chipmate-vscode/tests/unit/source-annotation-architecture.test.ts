import { createHash } from "node:crypto"
import path from "node:path"
import { describe, expect, it } from "bun:test"
import { isGitDiffSourceAnnotationAnchorAllowed } from "../../src/services/source-annotations/diff-scope"

const root = path.resolve(import.meta.dir, "../..")
const frozen = new Map([
  ["src/services/code-comments/function-target.ts", "604d1257475da303fa7830d32e26003d3eae991ea10dbf866625b383edd606a7"],
  ["src/services/code-comments/protocol.ts", "9a256c0ed9bc6d0e9f68c9a6ff046aa474d06b7cce0af246da85cf706a50b18c"],
  ["src/services/code-comments/validator.ts", "37b612aba579d82760e6d5ce8ffc2df38b8c049dcb6060a416a044ab85aa611f"],
  ["src/services/code-comments/orchestrator.ts", "8fe71dcc7c7f4ddab4432cd112ecd2adf5bf4a2e0d16a3ecdccc8001387cb303"],
])

describe("可扩展源码注释架构边界", () => {
  it("冻结函数目标、Prompt、校验和编排器的兼容基线", async () => {
    for (const [file, expected] of frozen) {
      const source = await Bun.file(path.join(root, file)).text()
      expect(createHash("sha256").update(source).digest("hex"), file).toBe(expected)
    }
  })

  it("函数核心不反向依赖声明或外层协调器", async () => {
    for (const file of frozen.keys()) {
      const source = await Bun.file(path.join(root, file)).text()
      expect(source).not.toContain("declaration-comments")
      expect(source).not.toContain("source-annotations")
    }
  })

  it("声明流水线不复用函数目标、Prompt、校验器或编排器", async () => {
    const files = ["target.ts", "protocol.ts", "validator.ts", "orchestrator.ts"]
    for (const file of files) {
      const source = await Bun.file(path.join(root, "src/services/declaration-comments", file)).text()
      expect(source).not.toMatch(/code-comments\/(?:function-target|protocol|validator|orchestrator)/u)
    }
  })

  it("文件头和逻辑块流水线不依赖冻结函数核心或彼此反向依赖", async () => {
    for (const directory of ["file-header-comments", "logic-block-comments"]) {
      for (const file of ["target.ts", "protocol.ts", "validator.ts", "orchestrator.ts"]) {
        const source = await Bun.file(path.join(root, "src/services", directory, file)).text()
        expect(source).not.toMatch(/code-comments\/(?:function-target|protocol|validator|orchestrator)/u)
        expect(source).not.toMatch(/ReviewComment|EmbeddedReview|code\.review/iu)
      }
    }
  })

  it("Git Diff 契约只允许变更后行或全新声明头附近的源码锚点", () => {
    const scope = {
      baseline: "旧源码",
      current: "新源码",
      changedAfterLines: new Set([12, 13]),
      hunkRanges: [{ startLine: 12, endLine: 18 }],
    }
    expect(isGitDiffSourceAnnotationAnchorAllowed({ line: 12, scope })).toBe(true)
    expect(isGitDiffSourceAnnotationAnchorAllowed({ line: 11, scope })).toBe(false)
    expect(isGitDiffSourceAnnotationAnchorAllowed({ line: 11, scope, newDeclarationHeader: true })).toBe(true)
    expect(isGitDiffSourceAnnotationAnchorAllowed({ line: 30, scope, newDeclarationHeader: true })).toBe(false)
  })

  it("源码注释产物协议不依赖 ReviewComment 或 Embedded Review", async () => {
    const source = await Bun.file(path.join(root, "src/services/source-annotations/types.ts")).text()
    expect(source).not.toMatch(/ReviewComment|EmbeddedReview|code.review/iu)
  })
})
