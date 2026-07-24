import type { ExtensionAnalytics } from "@chipmate/market-contracts"

const DAY = 24 * 60 * 60 * 1_000
const DAYS = 30

type Point = ExtensionAnalytics["trend"][number]

export function trend(items: Point[], now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const map = new Map(items.map((item) => [item.date, item]))
  const points = Array.from({ length: DAYS }, (_, index) => {
    const date = new Date(end - (DAYS - index - 1) * DAY).toISOString().slice(0, 10)
    return map.get(date) ?? { date, downloads: 0, favorites: 0 }
  })
  const peak = Math.max(0, ...points.map((point) => point.downloads))
  const total = points.reduce((sum, point) => sum + point.downloads, 0)
  return {
    peak,
    total,
    points: points.map((point) => ({
      ...point,
      height: point.downloads === 0 || peak === 0 ? 0 : Math.min(100, Math.max(8, (point.downloads / peak) * 100)),
    })),
  }
}
