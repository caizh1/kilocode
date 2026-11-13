import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { editorOwner } from "../editor-ownership"
import type { Scope } from "./store"

type Client = { id: string; scope: Scope; expires: number }
const clients = new Map<string, Client>()
export function registerClient(id: string, profile: string, directory: string): Client {
  const scope = {
    key: createHash("sha256")
      .update(JSON.stringify([process.env.CHIPMATE_SHARED_EDITOR_ACCOUNT ?? "local", profile]))
      .digest("hex"),
    directory: realpathSync(directory),
  }
  const client = { id: `${id}:${scope.directory}`, scope, expires: Date.now() + 30_000 }
  clients.set(client.id, client)
  return client
}
export function clientFor(id: string, directory: string) {
  const client = clients.get(`${id}:${realpathSync(directory)}`)
  if (!client || client.expires < Date.now()) throw new Error("当前项目的定时服务未连接，请保持项目窗口打开")
  return client
}
export function sessionClient(session: string, directory: string) {
  const id = editorOwner(session)
  if (id) return clientFor(id, directory)
  const candidates = [...clients.values()].filter(
    (item) => item.scope.directory === realpathSync(directory) && item.expires > Date.now(),
  )
  if (candidates.length !== 1) throw new Error("无法确定执行窗口，请从当前项目窗口操作")
  return candidates[0]
}
export function removeClient(client: Client) {
  clients.delete(client.id)
}
