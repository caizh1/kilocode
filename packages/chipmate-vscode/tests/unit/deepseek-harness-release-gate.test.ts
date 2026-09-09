import { describe, expect, it } from "bun:test"
import { verifyDeepSeekHarnessReleaseGate } from "../../script/deepseek-harness-release-gate"

const candidate = {
  releaseValidated: false,
  manualValidationCandidate: true,
  manualOnly: true,
  internal: true,
  windowsX64Only: true,
  targets: ["win32-x64-baseline"],
} as const

describe("ChipMate DeepSeek Harness 发布门禁", () => {
  it("允许受限的 Windows x64 手动实机验证候选包", () => {
    expect(() => verifyDeepSeekHarnessReleaseGate(candidate)).not.toThrow()
  })

  it("允许受限的 Linux x64 手动实机验证候选包", () => {
    expect(() =>
      verifyDeepSeekHarnessReleaseGate({
        ...candidate,
        windowsX64Only: false,
        targets: ["linux-x64-baseline"],
      }),
    ).not.toThrow()
  })

  it("正式验收未通过时拒绝普通发布", () => {
    expect(() =>
      verifyDeepSeekHarnessReleaseGate({ ...candidate, manualValidationCandidate: false }),
    ).toThrow("尚未完成 Windows/Linux 真实机与质量对照验收")
  })

  it("拒绝把手动验证通道用于其他平台或非内网包", () => {
    expect(() => verifyDeepSeekHarnessReleaseGate({ ...candidate, internal: false })).toThrow(
      "只允许与 --manual-only-oversized 和 --internal-offline 同时使用",
    )
    expect(() => verifyDeepSeekHarnessReleaseGate({ ...candidate, manualOnly: false })).toThrow(
      "只允许与 --manual-only-oversized 和 --internal-offline 同时使用",
    )
    expect(() =>
      verifyDeepSeekHarnessReleaseGate({ ...candidate, targets: ["darwin-arm64"] }),
    ).toThrow("只允许单独构建 Windows/Linux x64 baseline")
    expect(() =>
      verifyDeepSeekHarnessReleaseGate({ ...candidate, targets: ["win32-x64-baseline", "linux-x64-baseline"] }),
    ).toThrow("只允许单独构建 Windows/Linux x64 baseline")
  })

  it("仅对 Windows 候选包强制纯 x64 标记", () => {
    expect(() => verifyDeepSeekHarnessReleaseGate({ ...candidate, windowsX64Only: false })).toThrow(
      "Windows 手动验证候选包必须使用 --windows-x64-only",
    )
  })

  it("正式验收通过后不需要手动候选通道", () => {
    expect(() =>
      verifyDeepSeekHarnessReleaseGate({
        ...candidate,
        releaseValidated: true,
        manualValidationCandidate: false,
      }),
    ).not.toThrow()
  })
})
