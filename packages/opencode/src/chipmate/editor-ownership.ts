import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiError } from "effect/unstable/httpapi"
import { GlobalBus, type GlobalEvent } from "../bus/global"

type EditorClientService = {
  hasClient(client: string | undefined): boolean
  onClientLeft(listener: (client: string) => void): unknown
}
let service: EditorClientService | undefined
export function registerEditorClientService(value: EditorClientService | undefined) {
  service = value
}
function editorService() {
  return service
}

/** 仅保留在途执行的归属；完成后删除，不成为新的聊天历史缓存。 */
export class SessionOwnership {
  private readonly roots = new Map<string, { client: string; count: number; children: Set<string>; gone: PromiseWithResolvers<void> }>()
  private readonly children = new Map<string, string>()
  get active() { return this.roots.size > 0 }
  owner(session: string) { return this.roots.get(this.children.get(session) ?? session)?.client }
  acquire(session: string, client: string) {
    const root = this.children.get(session) ?? session
    const existing = this.roots.get(root)
    if (existing && existing.client !== client) throw new Error("会话正在另一个窗口执行")
    const entry = existing ?? { client, count: 0, children: new Set<string>(), gone: Promise.withResolvers<void>() }
    entry.count++
    this.roots.set(root, entry)
    let released = false
    const release = () => {
      if (released) return
      released = true
      if (--entry.count) return
      this.roots.delete(root)
      entry.gone.resolve()
      for (const child of entry.children) this.children.delete(child)
    }
    return { release, cancelled: entry.gone.promise }
  }
  cancelClient(client: string) {
    for (const entry of this.roots.values()) if (entry.client === client) entry.gone.resolve()
  }
  inherit(session: string, parent: string) {
    const root = this.children.get(parent) ?? parent
    const entry = this.roots.get(root)
    if (!entry) return
    this.children.set(session, root)
    entry.children.add(session)
  }
}

const ownership = new SessionOwnership()
export function hasEditorExecutions() { return ownership.active }
export function editorOwner(session: string) { return ownership.owner(session) }
const watched = new WeakSet<object>()
/** 新的规划后续会话独立持有归属，不随原会话本轮结束而丢失。 */
export function inheritEditorExecution(session: string, parent: string, cancel: () => void) {
  const client = ownership.owner(parent)
  if (!client) return () => {}
  const lease = ownership.acquire(session, client)
  let released = false
  void lease.cancelled.then(() => { if (!released) cancel() })
  return () => { released = true; lease.release() }
}
export function inheritEditorSession(session: string, parent: string) { ownership.inherit(session, parent) }
GlobalBus.on("event", (event: GlobalEvent) => {
  const payload = event.payload as { type?: string; properties?: { info?: { id?: string; parentID?: string } } }
  if (payload.type !== "session.created") return
  const info = payload.properties?.info
  if (info?.id && info.parentID) ownership.inherit(info.id, info.parentID)
})

export const runInEditor = (session: string, cancel: Effect.Effect<void>) => <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const service = editorService()
  if (!service) return yield* work
  if (!watched.has(service)) {
    watched.add(service)
    service.onClientLeft((client) => ownership.cancelClient(client))
  }
  const request = yield* HttpServerRequest.HttpServerRequest
  const client = request.headers["x-chipmate-client-id"]
  if (!service.hasClient(client)) return yield* Effect.fail(new HttpApiError.BadRequest({}))
  return yield* Effect.acquireUseRelease(
    Effect.try({ try: () => ownership.acquire(session, client!), catch: () => new HttpApiError.BadRequest({}) }),
    // HTTP handler 可处于不可中断区；竞速的两侧必须允许结束后中断另一侧。
    (lease) => Effect.raceFirst(work.pipe(Effect.interruptible), Effect.promise(() => lease.cancelled).pipe(Effect.andThen(cancel), Effect.andThen(Effect.interrupt), Effect.interruptible)),
    (lease) => Effect.sync(lease.release),
  )
})

export const canAnswerInEditor = Effect.fn(function* (session: string) {
  const service = editorService()
  if (!service) return true
  const request = yield* HttpServerRequest.HttpServerRequest
  const client = request.headers["x-chipmate-client-id"]
  return service.hasClient(client) && ownership.owner(session) === client
})

export function editorEventVisible(event: GlobalEvent, client: string | undefined) {
  if (!editorService()) return true
  const payload = event.payload as { type?: string; properties?: { sessionID?: string } }
  if (payload.type !== "permission.asked" && payload.type !== "question.asked") return true
  const session = payload.properties?.sessionID
  return Boolean(session && editorService()?.hasClient(client) && ownership.owner(session) === client)
}
