import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ensurePopplerForTarget, popplerBinary, popplerDir } from "../../script/poppler-helper"

const dirs: string[] = []
let previous: string | undefined

async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "chipmate-poppler-"))
  dirs.push(dir)
  return dir
}

beforeEach(() => {
  previous = process.env.POPPLER_WINDOWS_DIR
})

afterEach(async () => {
  if (previous === undefined) {
    delete process.env.POPPLER_WINDOWS_DIR
  } else {
    process.env.POPPLER_WINDOWS_DIR = previous
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
    await writeFile(path.join(bin, "pdftotext.exe"), "exe")
    await writeFile(path.join(bin, "poppler.dll"), "dll")
    await writeFile(path.join(bin, "pdfinfo.exe"), "other")
    await writeFile(path.join(data, "Bulgarian"), "data")
    process.env.POPPLER_WINDOWS_DIR = src

    await ensurePopplerForTarget("win32-x64", dest)

    expect(existsSync(popplerBinary(dest))).toBe(true)
    expect(existsSync(path.join(popplerDir(dest), "poppler.dll"))).toBe(true)
    expect(existsSync(path.join(popplerDir(dest), "pdfinfo.exe"))).toBe(false)
    expect(existsSync(path.join(popplerDir(dest), "share", "poppler", "nameToUnicode", "Bulgarian"))).toBe(true)
  })

  it("ignores non-Windows targets", async () => {
    const dir = await temp()

    await ensurePopplerForTarget("darwin-arm64", dir)

    expect(existsSync(popplerDir(dir))).toBe(false)
  })
})
