import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  ensurePopplerForTarget,
  popplerBinary,
  popplerDir,
  verifyPopplerForTarget,
} from "../../script/poppler-helper"

const dirs: string[] = []
let previous: string | undefined
let previousRuntime: string | undefined

async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "chipmate-poppler-"))
  dirs.push(dir)
  return dir
}

function peX64(): Buffer {
  const value = Buffer.alloc(256)
  value.write("MZ", 0, "ascii")
  value.writeUInt32LE(128, 0x3c)
  value.write("PE\0\0", 128, "binary")
  value.writeUInt16LE(0x8664, 132)
  return value
}

beforeEach(() => {
  previous = process.env.POPPLER_WINDOWS_DIR
  previousRuntime = process.env.CHIPMATE_INTERNAL_VC_RUNTIME_WIN32_X64_DIR
})

afterEach(async () => {
  if (previous === undefined) {
    delete process.env.POPPLER_WINDOWS_DIR
  } else {
    process.env.POPPLER_WINDOWS_DIR = previous
  }
  if (previousRuntime === undefined) {
    delete process.env.CHIPMATE_INTERNAL_VC_RUNTIME_WIN32_X64_DIR
  } else {
    process.env.CHIPMATE_INTERNAL_VC_RUNTIME_WIN32_X64_DIR = previousRuntime
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("poppler helper", () => {
  it("copies pdftotext runtime from a preseeded Poppler directory", async () => {
    const dir = await temp()
    const src = path.join(dir, "src", "Library")
    const bin = path.join(src, "bin")
    const data = path.join(src, "share", "poppler", "nameToUnicode")
    const dest = path.join(dir, "dest")
    await mkdir(bin, { recursive: true })
    await mkdir(data, { recursive: true })
    await writeFile(path.join(bin, "pdftotext.exe"), peX64())
    await writeFile(path.join(bin, "poppler.dll"), peX64())
    await writeFile(path.join(bin, "pdfinfo.exe"), "other")
    await writeFile(path.join(data, "Bulgarian"), "data")
    const runtime = path.join(dir, "runtime")
    await mkdir(runtime, { recursive: true })
    for (const file of ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) {
      await writeFile(path.join(runtime, file), peX64())
    }
    process.env.POPPLER_WINDOWS_DIR = src
    process.env.CHIPMATE_INTERNAL_VC_RUNTIME_WIN32_X64_DIR = runtime

    await ensurePopplerForTarget("win32-x64", dest)

    expect(existsSync(popplerBinary(dest))).toBe(true)
    expect(existsSync(path.join(popplerDir(dest), "poppler.dll"))).toBe(true)
    expect(existsSync(path.join(popplerDir(dest), "vcruntime140_1.dll"))).toBe(true)
    expect(existsSync(path.join(popplerDir(dest), "pdfinfo.exe"))).toBe(false)
    expect(existsSync(path.join(popplerDir(dest), "share", "poppler", "nameToUnicode", "Bulgarian"))).toBe(true)
  })

  it("ignores non-Windows targets", async () => {
    const dir = await temp()

    await ensurePopplerForTarget("darwin-arm64", dir)

    expect(existsSync(popplerDir(dir))).toBe(false)
  })

  it("executes a Chinese-path PDF runtime preflight on Windows", async () => {
    const dir = await temp()
    const runtime = popplerDir(dir)
    await mkdir(path.join(runtime, "share", "poppler"), { recursive: true })
    await writeFile(popplerBinary(dir), peX64())
    await writeFile(path.join(runtime, "poppler.dll"), peX64())
    for (const file of ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) {
      await writeFile(path.join(runtime, file), peX64())
    }
    let fixture = ""

    await verifyPopplerForTarget(dir, "win32", async (_exe, pdf) => {
      fixture = pdf
      const contents = await readFile(pdf, "ascii")
      const declared = Number(contents.match(/\/Length (\d+)/)?.[1])
      const stream = contents.slice(contents.indexOf("stream\n") + 7, contents.indexOf("endstream"))
      expect(declared).toBe(Buffer.byteLength(stream, "ascii"))
      return { exitCode: 0, stdout: "CHIPMATE_PDF_PREFLIGHT_OK", stderr: "" }
    })

    expect(fixture).toContain("Poppler 预检 中文 路径")
    expect(fixture).toContain("最小 PDF 夹具.pdf")
    expect(existsSync(path.dirname(fixture))).toBe(false)
  })

  it("fails the Windows runtime gate with exit and bounded stderr details", async () => {
    const dir = await temp()
    const runtime = popplerDir(dir)
    await mkdir(path.join(runtime, "share", "poppler"), { recursive: true })
    await writeFile(popplerBinary(dir), peX64())
    await writeFile(path.join(runtime, "poppler.dll"), peX64())
    for (const file of ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) {
      await writeFile(path.join(runtime, file), peX64())
    }

    await expect(
      verifyPopplerForTarget(dir, "win32", async () => ({
        exitCode: 53,
        signal: "SIGABRT",
        stdout: "",
        stderr: "\u001b[31mfailed token=secret-value\u001b[0m",
      })),
    ).rejects.toThrow("exitCode=53; signal=SIGABRT; stderr=failed token=[已隐藏凭据]")
  })

  it("rejects a Windows package without the complete app-local VC++ Runtime", async () => {
    const dir = await temp()
    const runtime = popplerDir(dir)
    await mkdir(path.join(runtime, "share", "poppler"), { recursive: true })
    await writeFile(popplerBinary(dir), peX64())
    await writeFile(path.join(runtime, "poppler.dll"), peX64())

    await expect(verifyPopplerForTarget(dir)).rejects.toThrow("missing app-local VC++ Runtime")
  })
})
