import assert from "node:assert/strict"
import test from "node:test"
import { trend } from "../src/trend.ts"

const NOW = new Date("2026-07-22T12:00:00.000Z")

test("builds a continuous normalized 30-day download trend", () => {
  const chart = trend([
    { date: "2026-07-17", downloads: 2, favorites: 0 },
    { date: "2026-07-20", downloads: 1, favorites: 0 },
    { date: "2026-07-21", downloads: 17, favorites: 0 },
    { date: "2026-07-22", downloads: 3, favorites: 0 },
  ], NOW)

  assert.equal(chart.points.length, 30)
  assert.equal(chart.points[0]?.date, "2026-06-23")
  assert.equal(chart.points[29]?.date, "2026-07-22")
  assert.equal(chart.total, 23)
  assert.equal(chart.peak, 17)
  assert.equal(chart.points.find((point) => point.date === "2026-07-18")?.height, 0)
  assert.equal(chart.points.find((point) => point.date === "2026-07-20")?.height, 8)
  assert.equal(chart.points.find((point) => point.date === "2026-07-21")?.height, 100)
  assert.ok(Math.abs((chart.points.find((point) => point.date === "2026-07-17")?.height ?? 0) - 11.7647) < 0.001)
  assert.ok(Math.abs((chart.points.find((point) => point.date === "2026-07-22")?.height ?? 0) - 17.6471) < 0.001)
})

test("keeps an empty trend at zero without drawing minimum-height bars", () => {
  const chart = trend([], NOW)

  assert.equal(chart.total, 0)
  assert.equal(chart.peak, 0)
  assert.equal(chart.points.length, 30)
  assert.ok(chart.points.every((point) => point.downloads === 0 && point.height === 0))
})

test("ignores dates outside the UTC window and handles cross-month peaks", () => {
  const chart = trend([
    { date: "2026-06-22", downloads: 99_999, favorites: 0 },
    { date: "2026-06-23", downloads: 5, favorites: 0 },
    { date: "2026-07-22", downloads: 10_000, favorites: 0 },
    { date: "2026-07-23", downloads: 99_999, favorites: 0 },
  ], NOW)

  assert.equal(chart.total, 10_005)
  assert.equal(chart.peak, 10_000)
  assert.equal(chart.points[0]?.height, 8)
  assert.equal(chart.points[29]?.height, 100)
})
