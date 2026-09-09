export const LEGACY_UPDATE_MAX_BYTES = 268_435_456

export function verifyLegacyUpdatePackageSize(target: string, size: number, manualOnlyOversized = false): void {
  if (target !== "win32-x64-baseline" || size <= LEGACY_UPDATE_MAX_BYTES) return
  if (manualOnlyOversized) return
  throw new Error(
    `Windows VSIX ${size} bytes exceeds the legacy auto-update limit ${LEGACY_UPDATE_MAX_BYTES} bytes. Use an audited local-only LanceDB native build before publishing.`,
  )
}
