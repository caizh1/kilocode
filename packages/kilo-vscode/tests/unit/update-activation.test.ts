import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  LAST_ACTIVATION_KEY,
  PENDING_ACTIVATION_KEY,
  confirmPendingUpdateActivation,
  markPendingUpdateReloadRequested,
  recordUpdateWebviewReady,
  shouldRetryFirstReload,
  writePendingUpdateActivation,
  type PendingUpdateActivation,
} from "../../src/services/update-check/activation"

const TARGET = "win32-x64-baseline"

describe("ChipMate update activation receipt", () => {
  it("persists the target before reload, then confirms only the new extension host", async () => {
    const state = memento()
    const pending = receipt()
    const old = context("0.0.16", state)

    await writePendingUpdateActivation(old, pending)
    await markPendingUpdateReloadRequested(old, 2_000)

    expect(state.get<PendingUpdateActivation>(PENDING_ACTIVATION_KEY)).toMatchObject({
      expectedVersion: "0.0.17",
      reloadRequestedAt: 2_000,
      reloadAttempts: 1,
    })

    const current = context("0.0.17", state)
    const result = await confirmPendingUpdateActivation(current, 3_000)

    expect(result).toMatchObject({ status: "host-active", record: { hostActivatedAt: 3_000 } })
    expect(state.get(PENDING_ACTIVATION_KEY)).toBeUndefined()
    expect(state.get(LAST_ACTIVATION_KEY)).toMatchObject({
      expectedVersion: "0.0.17",
      target: TARGET,
      hostActivatedAt: 3_000,
    })
  })

  it("counts reload requests so only the first failed reload can be retried automatically", async () => {
    const state = memento()
    const old = context("0.0.16", state)
    await writePendingUpdateActivation(old, receipt())

    await markPendingUpdateReloadRequested(old, 2_000)
    const second = await markPendingUpdateReloadRequested(old, 3_000)

    expect(second).toMatchObject({ reloadRequestedAt: 3_000, reloadAttempts: 2 })
  })

  it("allows an automatic retry only for the first explicit Reload mismatch", async () => {
    const state = memento()
    const old = context("0.0.16", state)
    await writePendingUpdateActivation(old, receipt())

    expect(shouldRetryFirstReload(await confirmPendingUpdateActivation(old, 2_000))).toBe(false)

    await markPendingUpdateReloadRequested(old, 3_000)
    expect(shouldRetryFirstReload(await confirmPendingUpdateActivation(old, 4_000))).toBe(true)

    await markPendingUpdateReloadRequested(old, 5_000)
    expect(shouldRetryFirstReload(await confirmPendingUpdateActivation(old, 6_000))).toBe(false)
  })

  it("retains a pending receipt when the first Reload starts the old version", async () => {
    const state = memento()
    const old = context("0.0.16", state)
    await writePendingUpdateActivation(old, receipt())

    const result = await confirmPendingUpdateActivation(old, 4_000)

    expect(result).toMatchObject({
      status: "mismatch",
      actual: { version: "0.0.16", target: TARGET },
    })
    expect(state.get<PendingUpdateActivation>(PENDING_ACTIVATION_KEY)).toMatchObject({
      expectedVersion: "0.0.17",
      lastMismatch: { version: "0.0.16", target: TARGET, observedAt: 4_000 },
    })
    expect(state.get(LAST_ACTIVATION_KEY)).toBeUndefined()
  })

  it("does not confirm a matching host when the target differs", async () => {
    const state = memento()
    const old = context("0.0.16", state)
    await writePendingUpdateActivation(old, receipt())

    const result = await confirmPendingUpdateActivation(context("0.0.17", state, "linux-x64-baseline"), 5_000)

    expect(result).toMatchObject({ status: "mismatch", actual: { version: "0.0.17", target: "linux-x64-baseline" } })
    expect(state.get(PENDING_ACTIVATION_KEY)).toMatchObject({ expectedVersion: "0.0.17", target: TARGET })
  })

  it("records a webview receipt only for the confirmed current version and motion root", async () => {
    const state = memento()
    const old = context("0.0.16", state)
    await writePendingUpdateActivation(old, receipt())
    const current = context("0.0.17", state)
    await confirmPendingUpdateActivation(current, 6_000)

    expect(
      await recordUpdateWebviewReady(
        current,
        {
          version: "0.0.17",
          motionBaseUri: "vscode-webview-resource://chipmate/assets/loading-motion",
          reducedMotion: false,
        },
        7_000,
      ),
    ).toBe(true)
    expect(state.get(LAST_ACTIVATION_KEY)).toMatchObject({
      webviewReadyAt: 7_000,
      webviewVersion: "0.0.17",
      reducedMotion: false,
    })

    expect(
      await recordUpdateWebviewReady(current, { version: "0.0.16", motionBaseUri: "vscode-webview-resource://old" }, 8_000),
    ).toBe(false)
    expect(state.get(LAST_ACTIVATION_KEY)).toMatchObject({ webviewReadyAt: 7_000 })
  })

  it("clears a malformed pending receipt instead of treating it as activated", async () => {
    const state = memento()
    await state.update(PENDING_ACTIVATION_KEY, { expectedVersion: "not-a-version" })

    expect(await confirmPendingUpdateActivation(context("0.0.17", state), 9_000)).toEqual({ status: "invalid" })
    expect(state.get(PENDING_ACTIVATION_KEY)).toBeUndefined()
    expect(state.get(LAST_ACTIVATION_KEY)).toBeUndefined()
  })
})

function receipt(): PendingUpdateActivation {
  return {
    schemaVersion: 1,
    transactionId: "transaction-1",
    extensionId: "chipmate.chipmate",
    fromVersion: "0.0.16",
    expectedVersion: "0.0.17",
    target: TARGET,
    sha256: "a".repeat(64),
    installedAt: 1_000,
  }
}

function context(version: string, state: vscode.Memento, target = TARGET): vscode.ExtensionContext {
  return {
    globalState: state,
    extension: {
      packageJSON: {
        publisher: "chipmate",
        name: "chipmate",
        version,
        chipmatePackageTarget: target,
      },
    },
  } as unknown as vscode.ExtensionContext
}

function memento(): vscode.Memento {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string, fallback?: T) => (values.has(key) ? (values.get(key) as T) : fallback),
    update: async (key: string, value: unknown) => {
      if (value === undefined) values.delete(key)
      else values.set(key, value)
    },
    keys: () => [...values.keys()],
  } as unknown as vscode.Memento
}
