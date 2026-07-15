import assert from "node:assert/strict"
import test from "node:test"
import { uuid } from "../src/id.ts"

test("uuid uses the browser native implementation when available", () => {
  const value = "12345678-1234-4234-9234-123456789012"
  assert.equal(uuid({ randomUUID: () => value }), value)
})

test("uuid builds an RFC 4122 v4 identifier from getRandomValues on trusted HTTP", () => {
  const value = uuid({
    getRandomValues: (bytes) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index))
      return bytes
    },
  })
  assert.equal(value, "00010203-0405-4607-8809-0a0b0c0d0e0f")
  assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
})

test("uuid fails clearly when no secure random source exists", () => {
  assert.throws(() => uuid({}), /不支持安全随机数/)
})
