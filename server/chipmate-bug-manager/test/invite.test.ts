import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { build } from "../src/app.js"
import { Store } from "../src/db.js"
import { digest } from "../src/security.js"

const worker = "chipmate-worker-token-for-invite-tests-000000"
const defaultCode = "CM-0123456789ABCDEF01234567"

async function fixture() {
  const store = new Store(":memory:")
  store.seedVersion("1.0.10")
  store.createDefaultInvite(digest(defaultCode), defaultCode.slice(0, 7))
  const app = await build({ store, workerToken: worker, secureCookie: false, logger: false })
  return {
    store,
    app,
    async close() {
      await app.close()
      store.close()
    },
  }
}

async function register(
  app: Awaited<ReturnType<typeof build>>,
  username: string,
  code = defaultCode,
) {
  return app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      username,
      password: "safe-registration-password",
      inviteCode: code,
    },
  })
}

function session(response: Awaited<ReturnType<Awaited<ReturnType<typeof build>>["inject"]>>) {
  const header = response.headers["set-cookie"]
  const cookie = Array.isArray(header) ? header[0] : header
  assert.ok(cookie)
  return {
    cookie: cookie.split(";")[0]!,
    csrf: response.json<{ csrf: string }>().csrf,
  }
}

describe("ChipMate 邀请码注册", () => {
  test("并发注册最多成功 3 人，随后邀请码失效", async () => {
    const current = await fixture()
    try {
      const responses = await Promise.all(
        ["member-a", "member-b", "member-c", "member-d"].map((username) => register(current.app, username)),
      )
      assert.deepEqual(
        responses.map((response) => response.statusCode).sort(),
        [201, 201, 201, 403],
      )
      const invite = current.store.defaultInvite()
      assert.equal(invite?.used_count, 3)
      assert.ok(invite?.exhausted_at)
      const users = current.store.db.prepare("SELECT role FROM users ORDER BY id").all() as Array<{ role: string }>
      assert.equal(users.length, 3)
      assert.ok(users.every((user) => user.role === "reporter"))
    } finally {
      await current.close()
    }
  })

  test("用户名冲突不会消耗额外名额", async () => {
    const current = await fixture()
    try {
      assert.equal((await register(current.app, "same-member")).statusCode, 201)
      const duplicate = await register(current.app, "same-member")
      assert.equal(duplicate.statusCode, 409)
      assert.equal(current.store.defaultInvite()?.used_count, 1)
    } finally {
      await current.close()
    }
  })

  test("每个用户只能创建 1 个可邀请 3 人的邀请码", async () => {
    const current = await fixture()
    try {
      const registered = await register(current.app, "inviter")
      assert.equal(registered.statusCode, 201)
      const auth = session(registered)
      const missingCsrf = await current.app.inject({
        method: "POST",
        url: "/api/invites",
        headers: { cookie: auth.cookie },
        payload: {},
      })
      assert.equal(missingCsrf.statusCode, 403)
      const created = await current.app.inject({
        method: "POST",
        url: "/api/invites",
        headers: { cookie: auth.cookie, "x-csrf-token": auth.csrf },
        payload: {},
      })
      assert.equal(created.statusCode, 201)
      const code = created.json<{ invite: { code: string; maxUses: number } }>().invite.code
      assert.match(code, /^CM-[A-F0-9]{24}$/)
      assert.equal(created.json<{ invite: { maxUses: number } }>().invite.maxUses, 3)
      const duplicate = await current.app.inject({
        method: "POST",
        url: "/api/invites",
        headers: { cookie: auth.cookie, "x-csrf-token": auth.csrf },
        payload: {},
      })
      assert.equal(duplicate.statusCode, 409)
      const stored = current.store.inviteForCreator(
        current.store.userByName("inviter")!.id,
      )
      assert.notEqual(stored?.code_hash, code)
      assert.equal(stored?.code_hash, digest(code))
      const auditText = current.store.db
        .prepare("SELECT detail FROM audits WHERE subject_type = 'invite'")
        .all()
        .map((row) => String((row as { detail: string }).detail))
        .join("\n")
      assert.equal(auditText.includes(code), false)
    } finally {
      await current.close()
    }
  })

  test("无效邀请码不能注册，也不会创建用户", async () => {
    const current = await fixture()
    try {
      const response = await register(current.app, "outsider", "CM-FFFFFFFFFFFFFFFFFFFFFFFF")
      assert.equal(response.statusCode, 403)
      assert.equal(current.store.userByName("outsider"), undefined)
      assert.equal(current.store.defaultInvite()?.used_count, 0)
    } finally {
      await current.close()
    }
  })
})
