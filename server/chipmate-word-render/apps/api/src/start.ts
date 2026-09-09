import { build } from "./index.ts"
import { bootstrap } from "./market.ts"
import { AuthSecrets } from "./auth-secrets.ts"

const port = Number(process.env.PORT || 6001)
const db = await bootstrap()
const app = build(db, { auth: { secrets: AuthSecrets.fromEnvironment() } })
const state = { stopping: false }

await app.listen({ host: "0.0.0.0", port })
console.log(`chipmate-word-render-fastify listening on 0.0.0.0:${port}`)

async function stop() {
  if (state.stopping) return
  state.stopping = true
  await app.close()
  await db?.close()
}

process.once("SIGINT", () => void stop())
process.once("SIGTERM", () => void stop())
