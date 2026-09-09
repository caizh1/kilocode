/**
 * Per-mode model selection persistence via the CLI's model.json.
 *
 * Reads/writes ~/.local/state/chipmate/model.json (same file the CLI TUI uses)
 * so per-mode model choices are shared between CLI and extension.
 */

import * as fs from "fs"
import * as path from "path"
import type { ChipMateClient } from "@chipmate/sdk/v2/client"
import { validateModelSelections } from "../provider-actions"

type PostMessage = (msg: unknown) => void

const cached = new WeakMap<object, string>()
let queue: Promise<void> = Promise.resolve()

async function resolve(client: ChipMateClient | null): Promise<string | undefined> {
  if (!client) return undefined
  const known = cached.get(client)
  if (known) return known
  try {
    const resp = await client.path.get()
    if (!resp?.data?.state) return undefined
    const target = path.join(resp.data.state, "model.json")
    cached.set(client, target)
    return target
  } catch {
    return undefined
  }
}

async function read(client: ChipMateClient | null): Promise<Record<string, unknown>> {
  const p = await resolve(client)
  if (!p) return {}
  try {
    const raw = await fs.promises.readFile(p, "utf-8")
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function replace(target: string, data: Record<string, unknown>): Promise<void> {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.promises.writeFile(temporary, JSON.stringify(data, null, 2))
    await fs.promises.rename(temporary, target)
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function mutate(
  client: ChipMateClient | null,
  update: (data: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  let output: Record<string, unknown> = {}
  const op = queue.then(async () => {
    const target = await resolve(client)
    if (!target) throw new Error("Model state path is unavailable")
    const existing = await read(client)
    update(existing)
    await replace(target, existing)
    output = existing
  })
  queue = op.catch(() => {})
  return op.then(() => output)
}

/**
 * Handle a model-state webview message. Returns true if handled.
 */
export async function handleMessage(
  type: string,
  message: Record<string, unknown>,
  client: ChipMateClient | null,
  post: PostMessage,
): Promise<boolean> {
  if (type === "persistModelSelection") {
    if (
      typeof message.agent !== "string" ||
      typeof message.providerID !== "string" ||
      typeof message.modelID !== "string"
    )
      return true
    await mutate(client, (data) => {
      const model = validateModelSelections(data.model)
      model[message.agent as string] = {
        providerID: message.providerID as string,
        modelID: message.modelID as string,
      }
      data.model = model
    })
    return true
  }
  if (type === "clearModelSelection") {
    if (typeof message.agent !== "string") return true
    await mutate(client, (data) => {
      const model = validateModelSelections(data.model)
      delete model[message.agent as string]
      data.model = model
    })
    return true
  }
  if (type === "requestModelSelections") {
    const data = await read(client)
    const selections = validateModelSelections(data.model)
    post({ type: "modelSelectionsLoaded", selections })
    return true
  }
  return false
}

export async function reset(client: ChipMateClient | null, post: PostMessage): Promise<void> {
  await mutate(client, (data) => {
    data.model = {}
  })
  post({ type: "modelSelectionsLoaded", selections: {} })
}
