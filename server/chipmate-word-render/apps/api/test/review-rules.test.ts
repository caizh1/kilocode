import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import JSZip from "jszip"
import { build } from "../src/index.ts"
import { parseRulePack, RulePackValidationError } from "../src/review-rulepack.ts"
import { ReviewRuleStore } from "../src/review-rules.ts"

const actual = process.env.ACTUAL_CODING_STANDARD_DOCX?.trim()

test("parses the current team coding standard into unique MUST rules", { skip: !actual }, async () => {
  assert.ok(actual)
  const source = await readFile(actual)
  const pack = await parseRulePack(source, "0.3.1")
  assert.equal(pack.status, "DRAFT")
  assert.match(pack.sourceHash, /^[0-9a-f]{64}$/)
  assert.equal(pack.rules.length, 63)
  assert.equal(pack.rules.filter((rule) => rule.level === "MUST").length, 44)
  assert.equal(new Set(pack.rules.map((rule) => rule.id)).size, pack.rules.length)
  assert.deepEqual(
    ["C-001", "C-037", "C-100"].map((id) => pack.rules.some((rule) => rule.id === id)),
    [true, true, true],
  )
  assert.ok(pack.rules.every((rule) => rule.languages.length === 1 && rule.languages[0] === "c"))
  assert.equal(pack.rules.find((rule) => rule.id === "C-014")?.check, "mechanical")
  assert.equal(pack.rules.find((rule) => rule.id === "C-036")?.check, "semantic")
  assert.equal(pack.rules.find((rule) => rule.id === "C-011")?.check, "semantic")
})

test("rejects invalid versions and duplicate detailed rule IDs", async () => {
  const source = await docx([card("C-014", "禁止行尾空白"), card("C-014", "重复规则")])
  await assert.rejects(() => parseRulePack(source, "version-one"), RulePackValidationError)
  await assert.rejects(() => parseRulePack(source, "1.0.0"), /Duplicate rule ID: C-014/)
})

test("keeps packs immutable, increments changed rule revisions, and pins a published version", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-review-rules-"))
  const clock = { value: Date.parse("2026-07-27T00:00:00.000Z") }
  const store = new ReviewRuleStore(root, () => clock.value)
  try {
    const first = await store.import(
      await docx([card("C-014", "禁止行尾空白"), card("C-015", "赋值运算符两侧留空格")]),
      "1.0.0",
    )
    const published = await store.publish(first.contentHash)
    assert.equal(published.status, "PUBLISHED")
    assert.equal((await store.latest())?.version, "1.0.0")
    const pinned = structuredClone(await store.latest())

    const second = await store.import(
      await docx([card("C-014", "禁止所有行尾空白"), card("C-018", "后缀运算符必须紧邻操作数")]),
      "1.1.0",
    )
    assert.equal(second.rules[0]?.revision, 2)
    assert.equal(second.rules.find((rule) => rule.id === "C-018")?.revision, 1)
    assert.equal(second.rules.some((rule) => rule.id === "C-015"), false)
    assert.equal(first.rules.some((rule) => rule.id === "C-015"), true)
    assert.equal((await store.latest())?.version, "1.0.0")
    clock.value += 1_000
    await store.publish(second.contentHash)
    assert.equal((await store.latest())?.version, "1.1.0")
    assert.equal(pinned?.version, "1.0.0")

    await assert.rejects(
      async () => store.import(await docx([card("C-014", "同版本改义")]), "1.1.0"),
      /already exists with different content/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("serves upload, publish, and latest RulePack routes without a UI dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-review-api-"))
  const app = build(undefined, {
    reviewRoot: root,
    reviewAuthorize: async () => undefined,
  })
  try {
    const source = await docx([card("C-014", "禁止行尾空白")])
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/review-rule-packs",
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x-rulepack-version": "1.0.0",
      },
      payload: source,
    })
    assert.equal(upload.statusCode, 201)
    const hash = upload.json().contentHash as string
    const none = await app.inject({ method: "GET", url: "/api/v1/review-rule-packs/latest" })
    assert.equal(none.statusCode, 404)
    const publish = await app.inject({
      method: "POST",
      url: `/api/v1/review-rule-packs/${hash}/publish`,
    })
    assert.equal(publish.statusCode, 200)
    const latest = await app.inject({ method: "GET", url: "/api/v1/review-rule-packs/latest" })
    assert.equal(latest.statusCode, 200)
    assert.equal(latest.json().version, "1.0.0")
    assert.equal(latest.headers["cache-control"], "no-store")
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})

function card(id: string, description: string) {
  return [
    "返回规则速查",
    `${id} 测试规则`,
    "强制级别",
    "必须",
    "适用范围",
    "表达式与基本语句",
    "规则说明",
    description,
    "例外情况",
    "无。",
  ]
}

async function docx(cards: string[][]) {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  const body = cards
    .flat()
    .map((value) => `<w:p><w:r><w:t>${xml(value)}</w:t></w:r></w:p>`)
    .join("")
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }))
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
