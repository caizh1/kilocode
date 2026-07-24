import { describe, expect, test } from "bun:test"
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"
import { deflateSync } from "node:zlib"
import { open } from "../../src/kilocode/tool/read-docx"

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

async function document(png: Uint8Array) {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add(
    "[Content_Types].xml",
    new TextReader(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
  )
  await writer.add(
    "_rels/.rels",
    new TextReader(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
  )
  await writer.add(
    "word/document.xml",
    new TextReader(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Architecture notes</w:t></w:r></w:p></w:body></w:document>',
    ),
  )
  await writer.add("word/media/image1.png", new Uint8ArrayReader(png))
  return Buffer.from(await writer.close())
}

async function text(bytes: Buffer) {
  const stream = await open("architecture.docx", bytes)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

describe("read_docx PlantUML extraction", () => {
  test("appends embedded PlantUML source with its media path", async () => {
    const value = await text(await document(image()))

    expect(value).toContain("Architecture notes")
    expect(value).toContain("[Embedded PlantUML diagram: word/media/image1.png]")
    expect(value).toContain(source)
  })

  test("keeps document text readable when PlantUML metadata is damaged", async () => {
    const broken = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("iTXt", Buffer.from("plantuml\0\u0001\u0000\u0000\u0000broken", "latin1")),
      chunk("IEND", Buffer.alloc(0)),
    ])
    const value = await text(await document(broken))

    expect(value).toContain("Architecture notes")
    expect(value).toContain("DOCX extraction warnings")
  })
})
