import assert from "node:assert/strict"
import test from "node:test"
import { next, previous, query } from "../src/state.ts"

test("theme choice cycles deterministically", () => {
  assert.equal(next("system"), "dark")
  assert.equal(next("dark"), "light")
  assert.equal(next("light"), "system")
})

test("catalog query preserves only supported filters and paging", () => {
  const url = new URL("https://market.test/skills?q=evidence&category=documents&cursor=24&ignored=1")
  assert.equal(query(url, "downloads").toString(), "limit=24&sort=downloads&q=evidence&category=documents&cursor=24")
  assert.equal(previous("48"), "24")
  assert.equal(previous("24"), "")
  assert.equal(previous(""), "")
})
