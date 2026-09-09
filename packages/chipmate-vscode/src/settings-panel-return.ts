import { sameSessionSurfaceKey, type SessionSurfaceKey, type SessionSurfaceState } from "./shared/session-surface"
import type * as vscode from "vscode"

export type SettingsReturnTarget = {
  id: string
  restore: () => void | Promise<void>
}

type MainEditorPanel = {
  viewColumn?: vscode.ViewColumn
  reveal: (column?: vscode.ViewColumn, preserveFocus?: boolean) => void
}

type MainEditorProvider = {
  getPinnedSurfaceKey: () => SessionSurfaceKey | undefined
  waitForReady: () => Promise<void>
  postMessage: (message: Record<string, unknown> & { type: string }) => void
}

type MainEditorSurfaces = {
  stateForSurface: (surfaceId: string) => SessionSurfaceState | undefined
  bindSurface: (surfaceId: string, key: SessionSurfaceKey) => unknown
}

export async function restoreMainEditorAfterSettings(input: {
  panel: MainEditorPanel
  provider: MainEditorProvider
  key: SessionSurfaceKey
  ownerSurfaceId: string
  tabPanels: ReadonlyMap<MainEditorPanel, MainEditorProvider>
  sessionSurfaces: MainEditorSurfaces
}): Promise<void> {
  if (input.tabPanels.get(input.panel) !== input.provider) return
  const current = input.sessionSurfaces.stateForSurface(input.ownerSurfaceId)
  const key = input.provider.getPinnedSurfaceKey()
  if (
    !current ||
    current.ownerSurfaceId !== input.ownerSurfaceId ||
    !key ||
    !sameSessionSurfaceKey(key, input.key) ||
    !sameSessionSurfaceKey(current.key, input.key)
  )
    return

  input.panel.reveal(input.panel.viewColumn, false)
  await input.provider.waitForReady()

  if (input.tabPanels.get(input.panel) !== input.provider) return
  const restored = input.sessionSurfaces.stateForSurface(input.ownerSurfaceId)
  if (
    !restored ||
    restored.ownerSurfaceId !== input.ownerSurfaceId ||
    !sameSessionSurfaceKey(restored.key, input.key)
  )
    return
  input.provider.postMessage({ type: "navigate", view: "newTask" })
  input.provider.postMessage({ type: "sessionSurface.select", key: input.key })
  input.sessionSurfaces.bindSurface(input.ownerSurfaceId, input.key)
}

/**
 * Tracks whether closing a standalone Settings panel should return to the
 * ChipMate main-editor surface that opened it.
 */
export class SettingsPanelReturnState {
  private target: SettingsReturnTarget | undefined
  private active = false
  private explicitClose = false

  setTarget(target: SettingsReturnTarget | undefined): void {
    this.target = target
  }

  setActive(active: boolean): void {
    this.active = active
  }

  requestClose(): void {
    this.explicitClose = true
  }

  consume(disposing: boolean): SettingsReturnTarget | undefined {
    const target = !disposing && (this.active || this.explicitClose) ? this.target : undefined
    this.target = undefined
    this.active = false
    this.explicitClose = false
    return target
  }
}
