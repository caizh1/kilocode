import { existsSync } from "node:fs"
import { join } from "node:path"
import { MarketDb } from "@chipmate/market-db"

export async function bootstrap() {
  const dir = process.env.MARKET_DB_ROOT?.trim()
  if (!dir) return undefined
  const source = process.env.MARKET_IMPORT_ROOT?.trim() || "/packages/skill-market"
  const output = process.env.MARKET_LEGACY_ROOT?.trim() || "/packages/skill-market/.legacy-latest"
  const db = new MarketDb({ dir })
  try {
    const health = await db.health()
    const imported = existsSync(join(source, "skills.json")) ? await db.importLegacy(source) : undefined
    const exported = await db.exportLegacy(output)
    console.log(
      `[chipmate-market] sqlite v${health.schemaVersion}, imported=${imported?.imported ?? 0}, unchanged=${imported?.unchanged ?? 0}, latest=${exported.count}`,
    )
    return db
  } catch (err) {
    console.error("[chipmate-market] startup degraded; render and packages remain available:", err)
    await db.close()
    return undefined
  }
}
