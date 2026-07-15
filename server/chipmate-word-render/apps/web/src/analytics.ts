import { uuid } from "./id"

type Name =
  | "market_impression"
  | "market_search"
  | "market_filter"
  | "skill_open"
  | "skill_file_preview"
  | "skill_favorite"
  | "skill_install_intent"
  | "publication_start"
  | "publication_validation_failed"
  | "publication_ai_repair"
  | "publication_success"

interface Input {
  skillId?: string
  revision?: number
  context?: Record<string, string | number | boolean>
}

interface Item extends Input {
  name: Name
  surface: "web"
  userId: string
  clientId: string
  occurredAt: string
}

const queue: Item[] = []
const seen = new Map<string, number>()
const delay = { timer: undefined as ReturnType<typeof setTimeout> | undefined }
const state = { client: undefined as string | undefined }
const warnings = new Set<string>()

export function track(name: Name, input: Input = {}) {
  const csrf = sessionStorage.getItem("chipmate-market-csrf")
  if (!csrf) return
  const client = safeClient()
  if (!client) return
  const key = JSON.stringify([name, input.skillId, input.revision, input.context])
  const now = Date.now()
  if (now - (seen.get(key) ?? 0) < 1_000) return
  seen.set(key, now)
  queue.push({
    name,
    surface: "web",
    userId: "server-derived-user",
    clientId: client,
    occurredAt: new Date(now).toISOString(),
    ...input,
  })
  if (queue.length >= 20) return void flush()
  delay.timer ??= setTimeout(() => void flush(), 750)
}

export async function flush() {
  if (delay.timer) clearTimeout(delay.timer)
  delay.timer = undefined
  const csrf = sessionStorage.getItem("chipmate-market-csrf")
  if (!csrf || queue.length === 0) return
  const items = queue.splice(0, 100)
  try {
    const response = await fetch("/api/v1/events/batch", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { accept: "application/json", "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify(items),
    })
    if (!response.ok) throw new Error(`event batch failed: HTTP ${response.status}`)
  } catch (err) {
    console.warn("[chipmate-market] analytics batch dropped", err)
  }
  if (queue.length > 0) delay.timer = setTimeout(() => void flush(), 750)
}

function clientId() {
  if (state.client) return state.client
  const key = "chipmate-market-client"
  const saved = read(key)
  if (saved && saved.length >= 16 && saved.length <= 128) {
    state.client = saved
    return saved
  }
  const value = uuid()
  state.client = value
  write(key, value)
  return value
}

function safeClient() {
  try {
    return clientId()
  } catch (err) {
    warn("random", "分析事件已停用：无法生成安全的客户端标识。", err)
    return undefined
  }
}

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch (err) {
    warn("read", "分析客户端标识无法读取，将在当前页面临时使用。", err)
    return undefined
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch (err) {
    warn("write", "分析客户端标识无法持久化，将仅在当前页面使用。", err)
  }
}

function warn(code: string, message: string, err: unknown) {
  if (warnings.has(code)) return
  warnings.add(code)
  console.warn(`[chipmate-market] ${message}`, err)
}

addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush()
})
