import { describe, expect, test } from "bun:test"
import { deflateSync } from "node:zlib"
import JSZip from "jszip"
import { extractDocxPlantUml } from "../../../../src/indexing/documents/plantuml"

const source = "@startuml\nAlice -> Bob: 认证请求\n@enduml"

function chunk(kind: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.byteLength)
  out.writeUInt32BE(data.byteLength, 0)
  out.write(kind, 4, 4, "ascii")
  Buffer.from(data).copy(out, 8)
  return out
}

function image(text = source) {
  const payload = Buffer.concat([
    Buffer.from("plantuml\0", "latin1"),
    Buffer.from([1, 0, 0, 0]),
    deflateSync(Buffer.from(`${text}\n\n1.2026.6`, "utf8")),
  ])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("iTXt", payload),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

async function document(...images: Uint8Array[]) {
  const zip = new JSZip()
  zip.file("word/document.xml", "<w:document/>")
  images.forEach((bytes, index) => zip.file(`word/media/image${index + 1}.png`, bytes))
  return zip.generateAsync({ type: "uint8array" })
}

function declared(input: Uint8Array, size: number) {
  const bytes = Buffer.from(input)
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue
    const length = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString("utf8")
    if (!/^word\/media\/[^/]+\.png$/i.test(name)) continue
    bytes.writeUInt32LE(size, offset + 24)
    return bytes
  }
  throw new Error("media central directory entry not found")
}

describe("DOCX PlantUML extraction", () => {
  test("extracts standard compressed PlantUML iTXt metadata", async () => {
    const result = await extractDocxPlantUml(await document(image()))

    expect(result.warnings).toEqual([])
    expect(result.truncated).toBe(false)
    expect(result.diagrams).toHaveLength(1)
    expect(result.diagrams[0]?.mediaPath).toBe("word/media/image1.png")
    expect(result.diagrams[0]?.source).toBe(source)
    expect(result.diagrams[0]?.version).toBe("1.2026.6")
    expect(result.diagrams[0]?.sha256).toHaveLength(64)
  })

  test("ignores ordinary PNGs and fails open for malformed PlantUML metadata", async () => {
    const malformed = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("iTXt", Buffer.from("plantuml\0\u0001\u0000\u0000\u0000broken", "latin1")),
      chunk("IEND", Buffer.alloc(0)),
    ])
    const result = await extractDocxPlantUml(await document(Buffer.from([0x89, 0x50]), malformed))

    expect(result.diagrams).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("word/media/image2.png")
  })

  test("enforces document source and image-count budgets", async () => {
    const result = await extractDocxPlantUml(await document(image(), image()), {
      maxImages: 1,
      maxTotalSourceBytes: 1,
    })

    expect(result.diagrams).toEqual([])
    expect(result.truncated).toBe(true)
    expect(result.warnings[0]).toContain("source budget")
  })

  test("bounds actual DEFLATE output when the central directory understates its size", async () => {
    const result = await extractDocxPlantUml(declared(await document(image()), 1))

    expect(result.diagrams).toEqual([])
    expect(result.truncated).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("word/media/image1.png")
  })

  test("rejects duplicate and over-budget PlantUML metadata without blocking the document", async () => {
    const original = image()
    const payload = original.subarray(8, original.length - 12)
    const duplicate = Buffer.concat([
      original.subarray(0, 8),
      payload,
      payload,
      chunk("IEND", Buffer.alloc(0)),
    ])
    const result = await extractDocxPlantUml(
      await document(duplicate, image(`@startuml\nnote "${"x".repeat(512)}"\n@enduml`)),
      { maxSourceBytes: 64 },
    )

    expect(result.diagrams).toEqual([])
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0]).toContain("multiple PlantUML metadata")
    expect(result.warnings[1]).toContain("source exceeds")
  })
})
