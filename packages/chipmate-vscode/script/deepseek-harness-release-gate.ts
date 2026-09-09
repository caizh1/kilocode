export type DeepSeekHarnessReleaseGate = {
  releaseValidated: boolean
  manualValidationCandidate: boolean
  manualOnly: boolean
  internal: boolean
  windowsX64Only: boolean
  targets: readonly string[]
}

export function verifyDeepSeekHarnessReleaseGate(input: DeepSeekHarnessReleaseGate): void {
  if (input.releaseValidated) return
  if (!input.manualValidationCandidate) {
    throw new Error(
      "ChipMate DeepSeek Harness 尚未完成 Windows/Linux 真实机与质量对照验收，禁止正式打包或发布 ChipMate",
    )
  }
  if (!input.manualOnly || !input.internal) {
    throw new Error("--manual-validation-candidate 只允许与 --manual-only-oversized 和 --internal-offline 同时使用。")
  }
  const target = input.targets.length === 1 ? input.targets[0] : undefined
  if (target !== "win32-x64-baseline" && target !== "linux-x64-baseline") {
    throw new Error("--manual-validation-candidate 只允许单独构建 Windows/Linux x64 baseline。")
  }
  if (target === "win32-x64-baseline" && !input.windowsX64Only) {
    throw new Error("Windows 手动验证候选包必须使用 --windows-x64-only。")
  }
}
