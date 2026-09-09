import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  buildFreshReleaseCli,
  releaseCliArguments,
  releaseCliEnvironment,
  releaseCliPackages,
  verifyReleaseCliReceipt,
  writeReleaseCliReceipt,
} from "../../script/release-cli-build"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("交付包全新 release CLI 门禁", () => {
  it("只构建 VSIX 目标，并在非纯 x64 Windows 包中补齐 ARM64 CLI", () => {
    const target = [{ target: "win32-x64-baseline", cliDir: "@chipmate/cli-windows-x64-baseline", binary: "chipmate.exe" }]
    expect(releaseCliPackages(target, true)).toEqual([
      { name: "@chipmate/cli-windows-x64-baseline", binary: "chipmate.exe" },
    ])
    expect(releaseCliPackages(target, false)).toEqual([
      { name: "@chipmate/cli-windows-x64-baseline", binary: "chipmate.exe" },
      { name: "@chipmate/cli-windows-arm64", binary: "chipmate.exe" },
    ])
  })

  it("固定 release、版本、渠道和禁止上传的 CLI 构建参数", () => {
    const packages = [{ name: "@chipmate/cli-windows-x64-baseline", binary: "chipmate.exe" }]
    expect(releaseCliArguments(packages)).toEqual([
      "script/build.ts",
      "--targets=@chipmate/cli-windows-x64-baseline",
      "--skip-install",
      "--skip-release-upload",
    ])
    expect(releaseCliEnvironment("1.2.4", false, { CHIPMATE_BUMP: "patch" })).toMatchObject({
      CHIPMATE_VERSION: "1.2.4",
      CHIPMATE_RELEASE: "1",
      CHIPMATE_CHANNEL: "latest",
    })
    expect(releaseCliEnvironment("1.2.5", true, {})).toMatchObject({ CHIPMATE_CHANNEL: "rc" })
    expect(releaseCliEnvironment("1.2.4", false, { CHIPMATE_BUMP: "patch" })).not.toHaveProperty("CHIPMATE_BUMP")
  })

  it("凭证绑定版本、目标和实际 CLI 哈希，文件变化后失败关闭", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-release-cli-"))
    roots.push(root)
    const packages = [{ name: "@chipmate/cli-windows-x64-baseline", binary: "chipmate.exe" }]
    const bin = path.join(root, packages[0].name, "bin")
    await fs.mkdir(bin, { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(bin, "chipmate.exe"), "release cli"),
      fs.writeFile(path.join(bin, "chipmate-indexer.exe"), "release indexer"),
      fs.writeFile(path.join(bin, "models-snapshot.json"), "{}"),
    ])

    await writeReleaseCliReceipt({ distDir: root, version: "1.2.4", packages })
    await expect(verifyReleaseCliReceipt({ distDir: root, version: "1.2.4", packages })).resolves.toMatchObject({
      release: true,
      version: "1.2.4",
    })
    await expect(verifyReleaseCliReceipt({ distDir: root, version: "1.2.5", packages })).rejects.toThrow(
      "构建凭证版本不匹配",
    )

    await fs.writeFile(path.join(bin, "chipmate.exe"), "changed cli")
    await expect(verifyReleaseCliReceipt({ distDir: root, version: "1.2.4", packages })).rejects.toThrow(
      "构建凭证与实际文件不一致",
    )
  })

  it("拒绝 release CLI 中残留 source map", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-release-cli-map-"))
    roots.push(root)
    const packages = [{ name: "@chipmate/cli-windows-x64-baseline", binary: "chipmate.exe" }]
    const bin = path.join(root, packages[0].name, "bin")
    await fs.mkdir(bin, { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(bin, "chipmate.exe"), "release cli"),
      fs.writeFile(path.join(bin, "chipmate-indexer.exe"), "release indexer"),
      fs.writeFile(path.join(bin, "models-snapshot.json"), "{}"),
      fs.writeFile(path.join(bin, "chipmate.exe.map"), "source map"),
    ])
    await expect(writeReleaseCliReceipt({ distDir: root, version: "1.2.4", packages })).rejects.toThrow(
      "不得包含 source map",
    )
  })

  it("拒绝通过 CLI_DIST_DIR 复用外部构建", async () => {
    await expect(
      buildFreshReleaseCli({
        opencodeDir: "/repo/packages/opencode",
        distDir: "/tmp/external-cli-dist",
        version: "1.2.4",
        prerelease: false,
        targets: [
          {
            target: "win32-x64-baseline",
            cliDir: "@chipmate/cli-windows-x64-baseline",
            binary: "chipmate.exe",
          },
        ],
        windowsX64Only: true,
      }),
    ).rejects.toThrow("禁止通过 CLI_DIST_DIR 复用外部 CLI")
  })
})
