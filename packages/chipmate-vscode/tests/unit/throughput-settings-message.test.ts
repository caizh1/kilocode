import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { buildThroughputSettingMessage } from "../../src/chipmate-provider/throughput-settings"

type Stub = {
  getConfiguration: (section?: string) => {
    get: <T>(key: string, fallback?: T) => T | undefined
  }
}

const original = vscode.workspace.getConfiguration

function stubConfig(state: Map<string, unknown>) {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => {
    if (section !== "chipmate.v2") {
      return { get: <T>(_key: string, fallback?: T) => fallback }
    }
    return {
      get: <T>(key: string, fallback?: T) => (state.has(key) ? (state.get(key) as T) : fallback),
    }
  }
}

afterEach(() => {
  ;(vscode.workspace as unknown as Stub).getConfiguration = original as Stub["getConfiguration"]
})

describe("buildThroughputSettingMessage", () => {
  let state: Map<string, unknown>

  beforeEach(() => {
    state = new Map()
    stubConfig(state)
  })

  it("hides token throughput by default", () => {
    expect(buildThroughputSettingMessage().visible).toBe(false)
  })

  it("returns the persisted ChipMate preference", () => {
    state.set("showTokenThroughput", true)

    expect(buildThroughputSettingMessage().visible).toBe(true)
  })
})
