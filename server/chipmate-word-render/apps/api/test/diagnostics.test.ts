import assert from "node:assert/strict"
import test from "node:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import JSZip from "jszip"
import { MarketDb } from "@chipmate/market-db"
import { build } from "../src/index.ts"
import { authentication, deviceTokens } from "./auth-fixture.ts"
import { inspectDiagnostics } from "../src/diagnostics-archive.ts"
import { buildBundle } from "../../../../../packages/chipmate-vscode/src/services/diagnostics/bundle.ts"

async function setup(options: { quota?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "chipmate-diagnostics-test-"))
  let now = Date.now()
  const db = new MarketDb({ dir: join(root, "db") })
  const auth = await authentication(db, () => now)
  const app = build(db, {
    auth,
    now: () => now,
    reviewRoot: join(root, "reviews"),
    diagnostics: { root: join(root, "private"), free: 0, ...options },
  })
  await app.ready()
  const alice = await deviceTokens(app, "alice"),
    bob = await deviceTokens(app, "bob")
  const headers = (token = alice.accessToken) => ({ authorization: `Bearer ${token}` })
  const bundle = await buildBundle(
    {
      root: join(root, "client"),
      salt: "隔离测试",
      version: "1.2.19",
      platform: "win32-x64",
      from: new Date(now - 3600000).toISOString(),
      to: new Date(now).toISOString(),
      description: "文档转换失败",
      environment: { platform: "win32", apiKey: "never-export-test-secret" },
      records: [],
      sources: [{ name: "文档诊断", status: "ok" }],
      supplements: {
        documents: {
          diagnostics: Array.from({ length: 12 }, (_, index) => ({
            time: new Date(now).toISOString(),
            category: "extractor-runtime",
            message: `第 ${index + 1} 个错误 ENOENT`,
            file: `/home/private/work/${index}.pdf`,
          })),
        },
      },
    },
    new AbortController().signal,
  )
  const payload = await readFile(bundle.path)
  const upload = (
    data: Buffer = payload,
    id = bundle.id,
    token = alice.accessToken,
    hash = createHash("sha256").update(data).digest("hex"),
  ) =>
    app.inject({
      method: "POST",
      url: "/api/v1/diagnostics/bundles",
      headers: {
        ...headers(token),
        "content-type": "application/vnd.chipmate.diagnostics+zip",
        "content-length": String(data.length),
        "idempotency-key": id,
        "x-content-sha256": hash,
        "x-user-id": bob.user.id,
      },
      payload: data,
    })
  return {
    root,
    db,
    app,
    auth,
    alice,
    bob,
    headers,
    bundle,
    payload,
    upload,
    advance(ms: number) {
      now += ms
    },
    async close() {
      await app.close()
      await db.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test("真实客户端 ZIP 经设备授权上传、按编号查询下载并核对 SHA-256；全文档诊断不止五条", async () => {
  const f = await setup()
  try {
    const response = await f.upload()
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(response.json().ownerId, f.alice.user.id, "伪造提交人不能影响归属")
    const detail = await f.app.inject({ url: `/api/v1/diagnostics/bundles/${f.bundle.id}`, headers: f.headers() })
    assert.equal(detail.json().status, "submitted")
    const download = await f.app.inject({
      url: `/api/v1/diagnostics/bundles/${f.bundle.id}/archive`,
      headers: f.headers(),
    })
    assert.equal(download.statusCode, 200)
    assert.equal(createHash("sha256").update(download.rawPayload).digest("hex"), f.bundle.sha256)
    const archive = await JSZip.loadAsync(download.rawPayload)
    const documents = await archive.file("状态/documents.json")!.async("string")
    assert.equal(JSON.parse(documents).diagnostics.length, 12)
    assert.ok(!documents.includes("/home/private"))
    assert.ok(!archive.file("会话.json"))
    assert.ok(!(await archive.file("环境.json")!.async("string")).includes("never-export-test-secret"))
    assert.equal(
      (await f.app.inject({ url: "/api/v1/diagnostics/bundles", headers: f.headers() })).json().items.length,
      1,
    )
    assert.equal((await f.upload()).statusCode, 200, "相同内容重传返回原记录")
    assert.equal((await f.upload(Buffer.from("different"))).statusCode, 409)
  } finally {
    await f.close()
  }
})

test("匿名、跨用户及伪造管理员不能读取；现有应急管理员可读取；到期立即拒绝", async () => {
  const f = await setup()
  try {
    assert.equal((await f.upload()).statusCode, 201)
    for (const suffix of ["", "/archive"]) {
      const url = `/api/v1/diagnostics/bundles/${f.bundle.id}${suffix}`
      assert.equal((await f.app.inject({ url })).statusCode, 401)
      assert.equal(
        (await f.app.inject({ url, headers: { ...f.headers(f.bob.accessToken), "x-is-admin": "true" } })).statusCode,
        404,
      )
    }
    assert.equal(
      (await f.app.inject({ url: "/api/v1/diagnostics/bundles", headers: f.headers(f.bob.accessToken) })).json().items
        .length,
      0,
    )
    const admin = await f.app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/session",
      payload: { key: "break-glass-test-key" },
    })
    const cookie = String(admin.headers["set-cookie"]).split(";", 1)[0]!
    assert.equal(
      (await f.app.inject({ url: `/api/v1/diagnostics/bundles/${f.bundle.id}/archive`, headers: { cookie } }))
        .statusCode,
      200,
    )
    f.advance(7 * 86400000 + 1)
    const renewed = await deviceTokens(f.app, "alice")
    assert.equal(
      (
        await f.app.inject({
          url: `/api/v1/diagnostics/bundles/${f.bundle.id}`,
          headers: f.headers(renewed.accessToken),
        })
      ).statusCode,
      404,
    )
    assert.equal(
      (await f.app.inject({ url: "/api/v1/diagnostics/bundles", headers: f.headers(renewed.accessToken) })).json().items
        .length,
      0,
    )
  } finally {
    await f.close()
  }
})

test("错误校验值、损坏归档、编号冲突与容量不足不留下半成品", async () => {
  const f = await setup()
  try {
    assert.equal((await f.upload(f.payload, f.bundle.id, f.alice.accessToken, "0".repeat(64))).statusCode, 400)
    assert.equal((await f.upload(Buffer.from("不是 ZIP"))).statusCode, 400)
    assert.equal((await f.upload(f.payload, randomUUID())).statusCode, 400)
    assert.deepEqual(await readdir(join(f.root, "private")), [])
    assert.equal(
      (await f.app.inject({ url: "/api/v1/diagnostics/bundles", headers: f.headers() })).json().items.length,
      0,
    )
  } finally {
    await f.close()
  }
  const full = await setup({ quota: 1 })
  try {
    assert.equal((await full.upload()).statusCode, 503)
    assert.deepEqual(await readdir(join(full.root, "private")), [])
  } finally {
    await full.close()
  }
})

test("删除必需摘要或修改内容但不更新清单时归档校验必须失败", async () => {
  const f = await setup()
  try {
    for (const mutate of [(zip: JSZip) => zip.remove("摘要.md"), (zip: JSZip) => zip.file("环境.json", "篡改内容")]) {
      const archive = await JSZip.loadAsync(f.payload)
      mutate(archive)
      const data = await archive.generateAsync({ type: "nodebuffer" })
      assert.equal((await f.upload(data)).statusCode, 400)
    }
    const zip = new JSZip()
    zip.file("safe.json", "{}")
    const data = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" })
    // 等长替换中央目录和本地头，构造真实路径穿越，绕过 ZIP 写入器的保护。
    const attacked = Buffer.from(data.toString("binary").replaceAll("safe.json", "../x.json"), "binary")
    const path = join(f.root, "穿越.zip")
    await writeFile(path, attacked)
    await assert.rejects(inspectDiagnostics(path, new AbortController().signal), /路径|文件|归档|invalid relative path/)
  } finally {
    await f.close()
  }
})

test("服务启动回收孤立归档和未完成上传，完整记录在重启后仍能下载", async () => {
  const f = await setup()
  try {
    assert.equal((await f.upload()).statusCode, 201)
    await f.app.close()
    await writeFile(join(f.root, "private", `${randomUUID()}.part`), "中断上传")
    await writeFile(join(f.root, "private", `${randomUUID()}.zip`), "孤立文件")
    const app = build(f.db, { auth: f.auth, diagnostics: { root: join(f.root, "private"), free: 0 } })
    try {
      await app.ready()
      assert.deepEqual(await readdir(join(f.root, "private")), [`${f.bundle.id}.zip`])
      assert.equal(
        (await app.inject({ url: `/api/v1/diagnostics/bundles/${f.bundle.id}/archive`, headers: f.headers() }))
          .statusCode,
        200,
      )
    } finally {
      await app.close()
    }
  } finally {
    await f.close()
  }
})

test("压缩炸弹在解压前被展开预算拦截", async () => {
  const f = await setup()
  try {
    const zip = new JSZip()
    zip.file("large.json", "{}")
    const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
    // 中央目录声明超过预算，必须在读取内容前拒绝。
    const header = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    assert.ok(header >= 0)
    data.writeUInt32LE(101 * 1024 * 1024, header + 24)
    const path = join(f.root, "展开预算.zip")
    await writeFile(path, data)
    await assert.rejects(inspectDiagnostics(path, new AbortController().signal), /预算|大小|size/)
  } finally {
    await f.close()
  }
})
