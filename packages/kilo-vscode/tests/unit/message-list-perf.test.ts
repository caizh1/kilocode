import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("MessageList long-session performance guards", () => {
  const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "MessageList.tsx")
  const src = readFileSync(path, "utf8")

  it("passes a stable historical array and stable keys to the virtualizer", () => {
    expect(src).toMatch(/const virtual = createMemo\([\s\S]*?stabilize\(partition\(\)\.virtual, prev\)\)/)
    expect(src).toMatch(/const keys = createMemo\([\s\S]*?stabilize\(virtual\(\)\.map\(\(row\) => row\.key\), prev\)\)/)
    expect(src).toContain("data={virtual()}")
  })

  it("cancels both scroll-restore frames and disconnects the layout observer on cleanup", () => {
    expect(src).toContain("cancelAnimationFrame(restoreFrame)")
    expect(src).toContain("cancelAnimationFrame(restoreFrameInner)")
    expect(src).toMatch(/onCleanup\(\(\) => \{\s*cancelRestore\(\)\s*save\(session\.currentSessionID\(\)\)/)
    expect(src).toMatch(/onCleanup\(\(\) => \{\s*resize\?\.disconnect\(\)/)
  })

  it("continues to cancel both transcript-highlight frames on cleanup", () => {
    expect(src).toContain("cancelAnimationFrame(highlightFrame)")
    expect(src).toContain("cancelAnimationFrame(highlightFrameInner)")
  })
})
