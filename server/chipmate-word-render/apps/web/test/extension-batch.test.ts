import assert from "node:assert/strict"
import test from "node:test"
import { gzipSync, strToU8, zipSync } from "fflate"
import {
  BATCH_BYTES,
  BATCH_LIMIT,
  FILE_LIMIT,
  materialize,
  partition,
  scanInputs,
  type BatchItem,
} from "../src/extension-batch.ts"

test("scans direct files and folders while ignoring unrelated content", async () => {
  const direct = new File(["direct"], "direct.vsix")
  const nested = new File(["nested"], "nested.VSIX")
  const note = new File(["ignore"], "notes.txt")
  const scan = await scanInputs([
    { file: direct, path: direct.name },
    { file: nested, path: "releases/linux/nested.VSIX" },
    { file: note, path: "releases/notes.txt" },
  ])
  assert.equal(scan.items.length, 2)
  assert.deepEqual(scan.items.map((item) => item.kind), ["file", "folder"])
  assert.equal(scan.ignored, 1)
  assert.equal(scan.errors.length, 0)
})

test("finds only VSIX entries in ZIP and emits only their bytes", async () => {
  const zip = zipSync({
    "linux/alpha.vsix": strToU8("alpha"),
    "windows/beta.VSIX": strToU8("beta"),
    "docs/readme.txt": strToU8("ignore"),
    "nested/archive.zip": strToU8("not-recursed"),
  })
  const file = binary(zip, "bundle.zip")
  const scan = await scanInputs([{ file, path: file.name }])
  assert.deepEqual(scan.items.map((item) => item.name), ["alpha.vsix", "beta.VSIX"])
  assert.equal(scan.ignored, 2)
  const emitted: Array<{ item: BatchItem; text: string }> = []
  await materialize(
    scan,
    scan.items,
    async (item, blob) => { emitted.push({ item, text: await blob.text() }) },
    (item, error) => assert.fail(`${item.name}: ${error}`),
  )
  assert.deepEqual(emitted.map((item) => item.text), ["alpha", "beta"])
})

test("streams TAR.GZ and TGZ entries without selecting unrelated files", async () => {
  for (const name of ["bundle.tar.gz", "bundle.tgz"]) {
    const file = binary(gzipSync(tar([
      ["deep/linux/plugin.vsix", strToU8("linux")],
      ["deep/readme.md", strToU8("ignore")],
    ])), name)
    const scan = await scanInputs([{ file, path: file.name }])
    assert.equal(scan.items.length, 1)
    assert.equal(scan.items[0]?.path, `${name}/deep/linux/plugin.vsix`)
    assert.equal(scan.ignored, 1)
    const output: string[] = []
    await materialize(
      scan,
      scan.items,
      async (_item, blob) => { output.push(await blob.text()) },
      (_item, error) => assert.fail(error),
    )
    assert.deepEqual(output, ["linux"])
  }
})

test("reads GNU long names and PAX paths from TAR.GZ", async () => {
  const long = `${"long-segment/".repeat(10)}gnu-plugin.vsix`
  const paxPath = "pax/releases/pax-plugin.vsix"
  const archive = archiveTar([
    block("././@LongLink", strToU8(`${long}\x00`), "L"),
    block("gnu-placeholder", strToU8("gnu"), "0"),
    block("PaxHeader", strToU8(paxRecord("path", paxPath)), "x"),
    block("pax-placeholder", strToU8("pax"), "0"),
  ])
  const file = binary(gzipSync(archive), "metadata.tar.gz")
  const scan = await scanInputs([{ file, path: file.name }])
  assert.deepEqual(scan.items.map((item) => item.name), ["gnu-plugin.vsix", "pax-plugin.vsix"])
  const output: string[] = []
  await materialize(
    scan,
    scan.items,
    async (_item, blob) => { output.push(await blob.text()) },
    (_item, error) => assert.fail(error),
  )
  assert.deepEqual(output, ["gnu", "pax"])
})

test("rejects unsafe archive paths and does not expose candidates", async () => {
  const zip = binary(zipSync({ "../escape.vsix": strToU8("unsafe") }), "unsafe.zip")
  const scan = await scanInputs([{ file: zip, path: zip.name }])
  assert.equal(scan.items.length, 0)
  assert.equal(scan.errors.length, 1)
  assert.match(scan.errors[0]?.reason ?? "", /危险路径/)
})

test("ignores encrypted ZIP entries before upload", async () => {
  const data = zipSync({ "secret.vsix": strToU8("secret") })
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  view.setUint16(6, view.getUint16(6, true) | 1, true)
  const central = find(data, 0x02014b50)
  view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true)
  const file = binary(data, "encrypted.zip")
  const scan = await scanInputs([{ file, path: file.name }])
  assert.equal(scan.items.length, 0)
  assert.equal(scan.ignored, 1)
  assert.match(scan.notes[0]?.reason ?? "", /加密 ZIP/)
})

test("partitions unlimited selections into stable logical batches", async () => {
  const inputs = Array.from({ length: BATCH_LIMIT + 1 }, (_, index) => {
    const file = new File([String(index)], `plugin-${index}.vsix`)
    return { file, path: file.name }
  })
  const scan = await scanInputs(inputs)
  assert.equal(scan.items.length, 21)
  assert.equal(BATCH_LIMIT, 20)
  assert.equal(BATCH_BYTES, 10 * 1024 * 1024 * 1024)
  const groups = partition(scan.items)
  assert.deepEqual(groups.map((group) => group.items.length), [20, 1])
  assert.deepEqual(groups.flatMap((group) => group.items.map((item) => item.id)), scan.items.map((item) => item.id))
})

test("materializes all logical batches with one pass over each archive source", async () => {
  const entries = Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`plugins/plugin-${index}.vsix`, strToU8(String(index))]))
  const file = new CountingFile(zipSync(entries), "many.zip")
  const scan = await scanInputs([{ file, path: file.name }])
  const groups = partition(scan.items)
  assert.equal(groups.length, 3)
  const before = file.slices
  const output: string[] = []
  const memory = { active: 0, maximum: 0 }
  await materialize(
    scan,
    groups.flatMap((group) => group.items),
    async (_item, blob) => {
      memory.active += 1
      memory.maximum = Math.max(memory.maximum, memory.active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      output.push(await blob.text())
      memory.active -= 1
    },
    (_item, error) => assert.fail(error),
  )
  assert.equal(output.length, 41)
  assert.equal(memory.maximum, 1)
  assert.ok(file.slices - before <= Math.ceil(file.size / (64 * 1024)) + 1)
})

test("accepts the 512 MiB boundary and ignores a larger direct VSIX without allocating it", async () => {
  const valid = new SizedFile("valid.vsix", FILE_LIMIT)
  const large = new SizedFile("large.vsix", FILE_LIMIT + 1)
  const scan = await scanInputs([{ file: valid, path: valid.name }, { file: large, path: large.name }])
  assert.equal(scan.items.length, 1)
  assert.equal(scan.items[0]?.size, FILE_LIMIT)
  assert.match(scan.notes[0]?.reason ?? "", /512 MiB/)
})

test("ignores a suspiciously compressed VSIX entry", async () => {
  const data = new Uint8Array(11 * 1024 * 1024)
  const file = binary(zipSync({ "bomb.vsix": data }, { level: 9 }), "bomb.zip")
  const scan = await scanInputs([{ file, path: file.name }])
  assert.equal(scan.items.length, 0)
  assert.match(scan.notes[0]?.reason ?? "", /压缩比异常/)
})

function binary(data: Uint8Array, name: string): File {
  return new File([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], name)
}

class SizedFile extends File {
  constructor(name: string, private readonly logical: number) {
    super([], name)
  }

  override get size() {
    return this.logical
  }
}

class CountingFile extends File {
  slices = 0

  constructor(data: Uint8Array, name: string) {
    super([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], name)
  }

  override slice(start?: number, end?: number, contentType?: string) {
    this.slices += 1
    return super.slice(start, end, contentType)
  }
}

function tar(entries: Array<[string, Uint8Array]>): Uint8Array {
  return archiveTar(entries.map(([name, data]) => block(name, data, "0")))
}

function block(name: string, data: Uint8Array, type: string): Uint8Array[] {
  const header = new Uint8Array(512)
  field(header, 0, 100, name)
  field(header, 100, 8, "0000644\0")
  field(header, 108, 8, "0000000\0")
  field(header, 116, 8, "0000000\0")
  field(header, 124, 12, `${data.length.toString(8).padStart(11, "0")}\0`)
  field(header, 136, 12, "00000000000\0")
  header.fill(32, 148, 156)
  header[156] = type.charCodeAt(0)
  field(header, 257, 6, "ustar\x00")
  field(header, 263, 2, "00")
  const sum = header.reduce((total, value) => total + value, 0)
  field(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `)
  const padding = (512 - (data.length % 512)) % 512
  return padding ? [header, data, new Uint8Array(padding)] : [header, data]
}

function archiveTar(parts: Uint8Array[][]): Uint8Array {
  const chunks = [...parts.flat(), new Uint8Array(1024)]
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function paxRecord(key: string, value: string): string {
  const body = `${key}=${value}\n`
  let length = body.length + 3
  while (`${length} ${body}`.length !== length) length = `${length} ${body}`.length
  return `${length} ${body}`
}

function field(target: Uint8Array, offset: number, size: number, value: string) {
  target.set(strToU8(value).subarray(0, size), offset)
}

function find(data: Uint8Array, signature: number): number {
  for (let index = 0; index <= data.length - 4; index += 1) {
    if (new DataView(data.buffer, data.byteOffset + index, 4).getUint32(0, true) === signature) return index
  }
  throw new Error("ZIP signature not found")
}
