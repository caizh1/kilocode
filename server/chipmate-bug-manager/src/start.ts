import { resolve } from "node:path"
import { build } from "./app.js"
import { Store } from "./db.js"

const port = Number(process.env.CHIPMATE_BUG_PORT ?? "8321")
const host = process.env.CHIPMATE_BUG_HOST ?? "127.0.0.1"
const path = process.env.CHIPMATE_BUG_DB ?? resolve(process.cwd(), ".runtime/chipmate-bugs.sqlite")
const worker = process.env.CHIPMATE_WORKER_TOKEN ?? ""
const release = process.env.CHIPMATE_RELEASE_BASE
if (!release) throw new Error("CHIPMATE_RELEASE_BASE 必须设置为当前已发布的 ChipMate 版本")
const store = new Store(path)
store.seedVersion(release)
const app = await build({ store, workerToken: worker })
const state = { stopping: false }

await app.listen({ host, port })

async function stop() {
  if (state.stopping) return
  state.stopping = true
  await app.close()
  store.close()
}

process.once("SIGINT", () => void stop())
process.once("SIGTERM", () => void stop())
