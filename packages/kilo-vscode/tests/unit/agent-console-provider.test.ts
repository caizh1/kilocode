import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

describe("AgentManagerProvider console mode", () => {
  test("keeps the typed open-mode replay contract for existing and newly mounted panels", () => {
    const file = path.join(import.meta.dir, "../../src/agent-manager/AgentManagerProvider.ts")
    const source = fs.readFileSync(file, "utf8")

    expect(source).toContain('this.postToWebview({ type: "agentManager.openMode", mode: this.mode })')
    expect(source).toContain('public openPanel(options: AgentManagerOpenOptions = { mode: "manager" }): void')
    expect(source).toContain("this.mode = options.mode")
  })
})
