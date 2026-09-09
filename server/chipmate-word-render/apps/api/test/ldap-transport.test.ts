import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after, before, type TestContext } from "node:test"
import { createSecureContext, createServer as createTlsServer, TLSSocket } from "node:tls"
import { BerReader, BerWriter } from "ldapts"
import { MarketDb } from "@chipmate/market-db"
import { AuthSecrets } from "../src/auth-secrets.ts"
import { build } from "../src/index.ts"
import { LdapAuthenticator, type LdapConfig, type LdapSecurity } from "../src/ldap.ts"

let directory: string
let certificate: { key: Buffer; cert: Buffer }
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "chipmate-ldap-transport-"))
  // 仅生成短期测试证书，不使用部署证书或真实凭据。
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")], { stdio: "ignore" })
  certificate = { key: await readFile(join(directory, "key.pem")), cert: await readFile(join(directory, "cert.pem")) }
})
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

for (const verifyCertificate of [true, false]) {
  test(`Unencrypted 在证书校验为 ${verifyCertificate} 时仍发送明文 LDAP Bind`, { timeout: 10000 }, async (t) => {
    const fixture = await directoryServer(t, "unencrypted")
    await new LdapAuthenticator().test({ ...fixture.config, verifyCertificate }, "测试密码")
    assert.deepEqual(fixture.events, ["明文 Bind"])
    assert.deepEqual(fixture.errors, [])
  })
}

for (const security of ["starttls", "ldaps"] as const) {
  test(`${security} 完成真正的 TLS 握手后才发送 Bind`, { timeout: 10000 }, async (t) => {
    const fixture = await directoryServer(t, security)
    await new LdapAuthenticator().test({ ...fixture.config, verifyCertificate: false }, "测试密码")
    assert.deepEqual(fixture.events, security === "starttls" ? ["StartTLS", "TLS Bind"] : ["TLS Bind"])
    assert.deepEqual(fixture.errors, [])
  })

  test(`${security} 启用证书校验时拒绝不受信证书且不降级发送密码`, { timeout: 10000 }, async (t) => {
    const fixture = await directoryServer(t, security)
    await assert.rejects(new LdapAuthenticator().test(fixture.config, "测试密码"), (err: unknown) => {
      assert.ok(err instanceof Error && err.cause instanceof Error)
      assert.equal((err.cause as NodeJS.ErrnoException).code, "DEPTH_ZERO_SELF_SIGNED_CERT")
      return true
    })
    assert.deepEqual(fixture.events, security === "starttls" ? ["StartTLS"] : [])
  })
}

test("服务端拒绝 StartTLS 后不尝试明文 Bind", { timeout: 10000 }, async (t) => {
  const fixture = await directoryServer(t, "starttls", true)
  await assert.rejects(new LdapAuthenticator().test(fixture.config, "测试密码"))
  assert.deepEqual(fixture.events, ["StartTLS"])
})

test("未知加密方式被拒绝，不能静默使用明文连接", async (t) => {
  const fixture = await directoryServer(t, "unencrypted")
  await assert.rejects(
    new LdapAuthenticator().test({ ...fixture.config, security: "invalid" as LdapSecurity }, "测试密码"),
    { code: "LDAP_CONFIG_INVALID", message: "LDAP 加密方式无效。" },
  )
  assert.deepEqual(fixture.events, [])
})

test("网页应急登录后的 LDAP 测试接口通过真实明文连接绑定", { timeout: 15000 }, async (t) => {
  const fixture = await directoryServer(t, "unencrypted")
  const directory = await mkdtemp(join(tmpdir(), "chipmate-ldap-api-"))
  const db = new MarketDb({ dir: join(directory, "db") })
  const app = build(db, { auth: { secrets: new AuthSecrets("m".repeat(48), "测试应急密钥") } })
  t.after(async () => { await app.close(); await db.close(); await rm(directory, { recursive: true, force: true }) })
  const unlock = await app.inject({ method: "POST", url: "/api/v1/admin/auth/session", payload: { key: "测试应急密钥" } })
  assert.equal(unlock.statusCode, 200)
  const response = await app.inject({
    method: "POST", url: "/api/v1/admin/auth/ldap/test",
    headers: {
      cookie: String(unlock.headers["set-cookie"]).split(";", 1)[0]!,
      "x-csrf-token": String(unlock.headers["x-csrf-token"]), host: "market.test", origin: "http://market.test",
    },
    payload: { config: fixture.config, bindPassword: "测试密码" },
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().ok, true)
  assert.deepEqual(fixture.events, ["明文 Bind"])
  assert.deepEqual(fixture.errors, [])
})

// 仅实现测试需要的 Bind/StartTLS/Unbind，不替代生产客户端，也不模拟 AD 策略。
async function directoryServer(t: TestContext, security: LdapSecurity, rejectUpgrade = false) {
  const events: string[] = []
  const errors: Error[] = []
  const sockets = new Set<Socket>()
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", (err) => { errors.push(err) })
  }
  const attach = (socket: Socket, encrypted: boolean) => {
    let pending: Buffer = Buffer.alloc(0)
    const data = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      try {
        while (pending.length) {
          assert.equal(pending[0], 0x30, "应先收到 LDAP 报文，不应收到隐式 TLS 握手")
          const reader = new BerReader(pending)
          if (reader.readSequence() === null || reader.remain < reader.length) return
          const length = reader.offset + reader.length
          const id = reader.readInt()
          const operation = reader.readSequence()
          assert.ok(id !== null)
          pending = pending.subarray(length)
          if (operation === 0x42) { socket.end(); return }
          if (operation === 0x77) {
            assert.equal(security, "starttls")
            assert.equal(encrypted, false)
            assert.equal(reader.readString(0x80), "1.3.6.1.4.1.1466.20037")
            events.push("StartTLS")
            socket.write(response(id, 0x78, rejectUpgrade ? 52 : 0))
            if (rejectUpgrade) return
            socket.removeListener("data", data)
            const secured = new TLSSocket(socket, { isServer: true, secureContext: createSecureContext(certificate) })
            track(secured)
            attach(secured, true)
            return
          }
          assert.equal(operation, 0x60)
          assert.equal(reader.readInt(), 3)
          assert.equal(reader.readString(), "CN=fixture,DC=test")
          assert.equal(reader.readString(0x80), "测试密码")
          assert.equal(encrypted, security !== "unencrypted", "密码只能在所选协议中发送")
          events.push(encrypted ? "TLS Bind" : "明文 Bind")
          socket.write(response(id, 0x61, 0))
        }
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
        socket.destroy()
      }
    }
    socket.on("data", data)
  }
  const server = security === "ldaps"
    ? createTlsServer(certificate, (socket) => { track(socket); attach(socket, true) })
    : createServer((socket) => { track(socket); attach(socket, false) })
  server.on("connection", (socket: Socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const config: LdapConfig = {
    enabled: true, name: "本地协议测试", host: "localhost", port: address.port, security,
    verifyCertificate: true, bindDn: "CN=fixture,DC=test", userSearchBase: "DC=test", userFilter: "(uid=%s)",
    usernameAttribute: "uid", emailAttribute: "mail", attributesInBindContext: false, insecureAcknowledged: true,
  }
  return { config, events, errors }
}

function response(id: number, operation: number, status: number) {
  const writer = new BerWriter()
  writer.startSequence()
  writer.writeInt(id)
  writer.startSequence(operation)
  writer.writeEnumeration(status)
  writer.writeString("")
  writer.writeString("")
  writer.endSequence()
  writer.endSequence()
  return writer.buffer
}
