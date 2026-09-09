import { afterEach, describe, expect, it } from "bun:test"
import { $ } from "bun"
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  auditLinuxPoppler,
  runLinuxPoppler,
  verifyLinuxPoppler,
  verifyLinuxPopplerVsix,
  writeLinuxPopplerManifest,
} from "../../script/poppler-linux-helper"
import { linuxPdfChinese, linuxPdfFixture } from "../../script/poppler-linux-fixture"
import { ensurePopplerForTarget } from "../../script/poppler-helper"

const source = process.env.CHIPMATE_TEST_LINUX_POPPLER_DIR
const directories: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "Linux PDF 中文 空格 "))
  directories.push(root)
  cpSync(resolve(source!), root, { recursive: true })
  return root
}

afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true })
})

// 真实组件集成测试，需先通过 ensurePopplerForTarget 生成组件；不以伪造 ELF 代替运行证据。
describe.skipIf(!source)("Linux Poppler 真实组件打包和反例验证", () => {
  it("在无网络、未安装 Poppler 的容器中提取中英文并保留分页", async () => {
    await verifyLinuxPoppler(fixture())
  }, 90_000)

  it("通过正式打包入口复制离线组件", async () => {
    const root = fixture()
    const previous = process.env.POPPLER_LINUX_X64_DIR
    const destination = mkdtempSync(join(tmpdir(), "Linux 离线复制 "))
    directories.push(destination)
    try {
      process.env.POPPLER_LINUX_X64_DIR = root
      await ensurePopplerForTarget("linux-x64", destination)
      auditLinuxPoppler(join(destination, "poppler"))
    } finally {
      if (previous === undefined) delete process.env.POPPLER_LINUX_X64_DIR
      else process.env.POPPLER_LINUX_X64_DIR = previous
    }
  }, 90_000)

  it("归档后从包内重新解压并验证执行权限、依赖及提取行为", async () => {
    const root = fixture()
    const directory = mkdtempSync(join(tmpdir(), "Linux 包审计 "))
    directories.push(directory)
    const destination = join(directory, "extension", "bin", "poppler")
    mkdirSync(destination, { recursive: true })
    cpSync(root, destination, { recursive: true })
    const archive = join(directory, "组件审计夹具.vsix")
    await $`zip -qr ${archive} extension`.cwd(directory).quiet()
    await verifyLinuxPopplerVsix(archive)
  }, 90_000)

  it("拒绝未打入组件的归档，覆盖原有 Linux 漏包行为", async () => {
    const directory = mkdtempSync(join(tmpdir(), "Linux 缺失组件 "))
    directories.push(directory)
    writeFileSync(join(directory, "说明.txt"), "原有 Linux 包没有 PDF 提取组件")
    const archive = join(directory, "缺失组件.vsix")
    await $`zip -q ${archive} ${"说明.txt"}`.cwd(directory).quiet()
    await expect(verifyLinuxPopplerVsix(archive)).rejects.toThrow("内容缺失")
  })

  it("拒绝文件损坏、无执行权限和错误架构", () => {
    const root = fixture()
    chmodSync(join(root, "pdftotext"), 0o644)
    expect(() => auditLinuxPoppler(root)).toThrow("执行权限")
    chmodSync(join(root, "pdftotext"), 0o755)
    const binary = join(root, "pdftotext.bin")
    const bytes = readFileSync(binary)
    bytes.writeUInt16LE(183, 18)
    writeFileSync(binary, bytes)
    expect(() => auditLinuxPoppler(root)).toThrow("文件校验失败")
    writeLinuxPopplerManifest(root)
    expect(() => auditLinuxPoppler(root)).toThrow("不是 x64 ELF")
  })

  it("拒绝逃逸到宿主机的符号链接", () => {
    const root = fixture()
    symlinkSync("/usr/lib/libpoppler.so", join(root, "lib", "外部依赖.so"))
    expect(() => auditLinuxPoppler(root)).toThrow("符号链接")
  })

  it("删掉真实依赖并重写清单后仍拒绝，不能被构建机的系统库掩盖", async () => {
    const root = fixture()
    const library = readdirSync(join(root, "lib")).find((file) => file.startsWith("libstdc++"))
    expect(library).toBeDefined()
    rmSync(join(root, "lib", library!))
    writeLinuxPopplerManifest(root)
    await expect(verifyLinuxPoppler(root)).rejects.toThrow("依赖不完整")
  }, 90_000)

  it("中文夹具能识别遗漏编码数据的错误组件", async () => {
    const root = fixture()
    rmSync(join(root, "share", "poppler"), { recursive: true })
    writeFileSync(join(root, "中文.pdf"), linuxPdfFixture())
    const result = await runLinuxPoppler(root, ["$ROOT/pdftotext", "-layout", "$ROOT/中文.pdf", "-"])
    expect(result.stdout).not.toContain(linuxPdfChinese)
    expect(result.stderr).toContain("Missing language pack")
  }, 90_000)
})
