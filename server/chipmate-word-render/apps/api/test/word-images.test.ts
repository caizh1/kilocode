import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFile, readdir } from "node:fs/promises"
import os from "node:os"
import test from "node:test"
import JSZip from "jszip"
import { build } from "../src/index.ts"
import { wordImagesFixture } from "./word-images-fixture.ts"

const require = createRequire(import.meta.url)
const legacy = require("../../../server.js") as {
  materializeTocPageNumbers(bytes: Buffer, pages: number[]): Promise<Buffer>
}

test("真实 Fastify 纯转换：旧目录反例、分页、范围、取消及原接口隔离", { timeout: 120000 }, async () => {
  const app = build()
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  const bytes = await wordImagesFixture()
  const original = Buffer.from(bytes)
  const send = (extra = {}, signal?: AbortSignal) =>
    fetch(origin + "/convert/word-to-images", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "设计.docx", docxBase64: bytes.toString("base64"), ...extra }),
      ...(signal ? { signal } : {}),
    })
  try {
    await assert.rejects(
      legacy.materializeTocPageNumbers(bytes, Array(20).fill(1)),
      /TOC entry count 0 does not match PDF outline count 20/,
    )
    const first = await send({ maxPages: 1 })
    const result = await first.json()
    assert.equal(first.status, 200, JSON.stringify(result))
    assert.equal(result.renderer.kind, "word-to-images")
    assert.equal(result.returnedPageCount, 1)
    assert.equal(result.pages[0].page, 1)
    assert.ok(result.pageCount >= 2)
    assert.equal(result.nextPage, 2)
    assert.equal(result.pdf, undefined)
    assert.equal(result.updatedDocxBase64, undefined)
    assert.equal(result.fieldRefreshStatus, undefined)
    assert.equal(Buffer.from(result.pages[0].base64, "base64").subarray(1, 4).toString(), "PNG")
    const last = await (await send({ startPage: result.pageCount, maxPages: 10 })).json()
    assert.equal(last.pages[0].page, result.pageCount)
    assert.equal(last.returnedPageCount, 1)
    assert.equal(last.nextPage, null)
    assert.equal((await send({ startPage: 9999 })).status, 422)
    assert.equal((await send({ maxPages: 101 })).status, 400)
    assert.equal((await send({ docxBase64: "%%%" })).status, 400)
    assert.equal((await send({ docxBase64: Buffer.from("损坏的文档").toString("base64") })).status, 400)
    const blank = await JSZip.loadAsync(bytes)
    blank.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>')
    const empty = await (await send({ docxBase64: await blank.generateAsync({ type: "base64" }) })).json()
    assert.equal(empty.pageCount, 1)
    assert.equal(empty.pages[0].page, 1)
    assert.ok(empty.issues.some((issue: { code: string }) => issue.code === "blank-page"))
    assert.equal((await send({ timeoutMs: 1 })).status, 504)
    const parallel = await Promise.all([send({ startPage: 1, maxPages: 1 }), send({ startPage: 2, maxPages: 1 })])
    const batches = await Promise.all(parallel.map((response) => response.json()))
    assert.deepEqual(
      batches.map((batch) => batch.pages.map((page: { page: number }) => page.page)),
      [[1], [2]],
    )
    const before = (await readdir(os.tmpdir())).filter((name) => name.startsWith("chipmate-word-images-"))
    const controller = new AbortController()
    const interrupted = send({}, controller.signal)
    // 观察实际转换目录出现后取消，而不是假定固定延迟足够。
    for (let i = 0; i < 200; i++) {
      const active = (await readdir(os.tmpdir())).filter(
        (name) => name.startsWith("chipmate-word-images-") && !before.includes(name),
      )
      if (active.length) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    controller.abort()
    await assert.rejects(interrupted)
    for (let i = 0; i < 200; i++) {
      const active = (await readdir(os.tmpdir())).filter(
        (name) => name.startsWith("chipmate-word-images-") && !before.includes(name),
      )
      if (!active.length) break
      if (i === 199) assert.fail("取消后遗留转换目录")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.deepEqual(bytes, original)
    const health = await (await fetch(origin + "/health")).json()
    assert.ok(health.endpoints.includes("/convert/word-to-images"))
    assert.ok(health.endpoints.includes("/render/word"))
    const module = await readFile(new URL("../../../word-to-images.js", import.meta.url), "utf8")
    for (const forbidden of [
      "refreshWordFields(",
      "materializeTocPageNumbers(",
      "refreshWordTocFromPdfLayout(",
      "handleRenderWord(",
    ])
      assert.ok(!module.includes(forbidden))
  } finally {
    await app.close()
  }
})
