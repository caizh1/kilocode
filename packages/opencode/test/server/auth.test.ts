import { afterEach, describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "../../src/server/auth"

const original = {
  CHIPMATE_SERVER_PASSWORD: Flag.CHIPMATE_SERVER_PASSWORD,
  CHIPMATE_SERVER_USERNAME: Flag.CHIPMATE_SERVER_USERNAME,
}

afterEach(() => {
  Flag.CHIPMATE_SERVER_PASSWORD = original.CHIPMATE_SERVER_PASSWORD
  Flag.CHIPMATE_SERVER_USERNAME = original.CHIPMATE_SERVER_USERNAME
})

describe("ServerAuth", () => {
  test("does not emit auth headers without a password", () => {
    Flag.CHIPMATE_SERVER_PASSWORD = undefined
    Flag.CHIPMATE_SERVER_USERNAME = "alice"

    expect(ServerAuth.header()).toBeUndefined()
    expect(ServerAuth.headers()).toBeUndefined()
  })

  test("defaults to the chipmate username", () => {
    // chipmate_change
    Flag.CHIPMATE_SERVER_PASSWORD = "secret"
    Flag.CHIPMATE_SERVER_USERNAME = undefined

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("chipmate:secret").toString("base64")}`, // chipmate_change
    })
  })

  test("uses the configured username", () => {
    Flag.CHIPMATE_SERVER_PASSWORD = "secret"
    Flag.CHIPMATE_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    })
  })

  test("prefers explicit credentials", () => {
    Flag.CHIPMATE_SERVER_PASSWORD = "secret"
    Flag.CHIPMATE_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers({ password: "cli-secret", username: "bob" })).toEqual({
      Authorization: `Basic ${Buffer.from("bob:cli-secret").toString("base64")}`,
    })
  })

  test("validates decoded credentials against effect config", () => {
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "chipmate", password: Redacted.make("secret") }, config)).toBe(false) // chipmate_change
  })
})
