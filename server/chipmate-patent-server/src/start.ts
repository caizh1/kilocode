import { buildApi } from "./api.js"
import { runtime } from "./runtime.js"

const appRuntime = await runtime({ initializeRawStore: false })
const app = buildApi(appRuntime.config, appRuntime.database, appRuntime.search)
let stopping = false

await app.listen({ host: appRuntime.config.host, port: appRuntime.config.port })
console.log(`[Patent Server] 只读接口已监听 ${appRuntime.config.host}:${appRuntime.config.port}`)

async function stop() {
  if (stopping) return
  stopping = true
  await app.close()
  await appRuntime.database.close()
}

process.once("SIGINT", () => void stop())
process.once("SIGTERM", () => void stop())
