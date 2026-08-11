import path from "path"
import * as Readiness from "./workflow-readiness"

export type Message = {
  info: {
    id: string
    role: string
  }
  parts: Array<{
    type: string
    text?: string
    ignored?: boolean
    auto?: boolean
    tool?: string
    state?: {
      status?: string
      input?: {
        name?: unknown
      }
      metadata?: {
        artifactDir?: unknown
        jobId?: unknown
        name?: unknown
        failed?: unknown
      }
    }
  }>
}

const NAME = "source-backed-detail-design"
const REVISION = "SBDD_JOB_REVISION=2026-08-chunked-v1"
const LIMIT = 256
type State = {
  anchor: string
  root?: string
  continued: boolean
  activation: "skill-tool" | "skill-command"
  jobId?: string
}

const active = new Map<string, State>()
const armed = new Set<string>()

export function armCommand(session: string, skill: string, source?: "command" | "mcp" | "skill") {
  if (skill !== NAME || source !== "skill") return
  armed.add(session)
}

export function disarmCommand(session: string) {
  armed.delete(session)
}

export function needs(session: string, messages: Message[]) {
  if (active.has(session)) return false
  const user = messages.findLast(actual)
  return Boolean(user && continuation(user))
}

export function recover(session: string, history: Message[], messages: Message[]) {
  const seen = new Set<string>(history.map((message) => message.info.id))
  restore(session, [...history, ...messages.filter((message) => !seen.has(message.info.id))])
}

export function sync(session: string, messages: Message[]) {
  const user = messages.findLast(actual)
  if (user && armed.delete(session)) {
    active.set(session, {
      anchor: user.info.id,
      continued: false,
      activation: "skill-command",
    })
    trim()
    return
  }
  if (!user || !continuation(user)) {
    active.delete(session)
    return
  }
  const found = declaration(messages)
  if (!found || !loaded(messages)) {
    active.delete(session)
    return
  }
  const tail = messages.slice(found.index + 1).filter(actual)
  if (!tail.length || tail.some((item) => !continuation(item))) {
    active.delete(session)
    return
  }
  active.set(session, {
    anchor: user.info.id,
    root: found.root,
    continued: true,
    activation: "skill-tool",
    jobId: found.jobId,
  })
}

export function activate(session: string, skill: string, messages: Message[]) {
  if (skill !== NAME) return
  const user = messages.findLast(actual)
  if (!user) return
  const prior = current(session, messages)
  const root = prior?.root ?? (continuation(user) ? declared(messages) : undefined)
  active.delete(session)
  active.set(session, {
    anchor: user.info.id,
    root,
    continued: prior?.continued === true || continuation(user),
    activation: prior?.activation ?? "skill-tool",
    jobId: prior?.jobId,
  })
  trim()
}

export function shell(session: string, messages: Message[]) {
  return Boolean(current(session, messages))
}

export function sourceBacked(session: string, messages: Message[]) {
  return Boolean(current(session, messages))
}

export function root(session: string, messages: Message[]) {
  return current(session, messages)?.root
}

export function figures(session: string, messages: Message[]) {
  return current(session, messages)?.continued === true
}

export function activation(session: string, messages: Message[]) {
  return current(session, messages)?.activation
}

export function job(session: string, messages: Message[]) {
  return current(session, messages)?.jobId
}

export function declare(session: string, messages: Message[], root: string) {
  const state = current(session, messages)
  if (!state) return
  active.set(session, { ...state, root })
}

export function bind(session: string, messages: Message[], input: { root: string; jobId: string }) {
  const state = current(session, messages)
  if (!state) return
  active.set(session, { ...state, root: input.root, jobId: input.jobId })
}

export function mutation(session: string, messages: Message[], workspace: string, file: string) {
  const state = current(session, messages)
  if (!state) return
  if (!state.root) {
    return "Declare the canonical artifact root with declare_artifact before writing or editing source-backed document work-package files."
  }
  const root = path.resolve(workspace, state.root)
  const target = path.resolve(file)
  const relative = path.relative(root, target)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return
  return `The active source-backed-detail-design workflow may mutate files only inside its declared artifact root: ${state.root}`
}

export function artifact(session: string, messages: Message[], workspace: string, file: string) {
  const state = current(session, messages)
  if (!state?.root) return
  const root = path.resolve(workspace, state.root)
  const base = path.dirname(root)
  if (path.basename(base) !== "artifacts") return
  const target = path.resolve(file)
  const within = path.relative(base, target)
  if (within.startsWith("..") || path.isAbsolute(within)) return
  const owned = path.relative(root, target)
  if (owned === "" || (!owned.startsWith("..") && !path.isAbsolute(owned))) return
  return `The active source-backed-detail-design workflow must resume from its canonical artifact root: ${state.root}. Do not inspect or reuse a sibling artifact from another run.`
}

export async function stage(session: string, messages: Message[], workspace: string, file: string) {
  const state = current(session, messages)
  if (!state?.root) return
  if (state.jobId) return
  const root = path.resolve(workspace, state.root)
  const target = path.resolve(file)
  const relative = path.relative(root, target).replaceAll("\\", "/")
  if (relative !== "04-diagrams" && !relative.startsWith("04-diagrams/")) return
  if (!state.continued) {
    return "Diagram authoring is blocked in the initial source-backed turn. Persist the prose checkpoint, end this turn, and resume figures only after the user's uninterrupted continuation."
  }
  const ready = await Readiness.prose(workspace, state.root)
  if (ready.issues.length) {
    return `Diagram authoring is blocked until every frozen DesignUnit has fourteen separate prose topics and an owner-complete business-flow census. ${ready.issues.slice(0, 20).join("; ")}`
  }
  const missing = await Readiness.checkpoints(ready.root)
  if (!missing.length) return
  return `Diagram authoring is blocked until the prose checkpoint is durable. ${missing.join("; ")}`
}

export async function checkpoint(
  session: string,
  messages: Message[],
  workspace: string,
  file: string,
  content: string,
) {
  const state = current(session, messages)
  if (!state?.root) return
  if (state.jobId) return
  const root = path.resolve(workspace, state.root)
  const target = path.resolve(file)
  const relative = path.relative(root, target).replaceAll("\\", "/")
  if (!["resume-state.md", "review-notes.md", "continue-prompt.md", "orchestration-manifest.json"].includes(relative)) {
    return
  }
  const claimsReady =
    /prose[_ -]?complete/i.test(content) ||
    /missingTopicCount\s*[:=]\s*0\b/i.test(content) ||
    /flowCensusStatus\s*[:=]\s*PASS\b/i.test(content)
  if (!claimsReady) return
  const ready = await Readiness.prose(workspace, state.root)
  if (!ready.issues.length) return
  return `Checkpoint rejected because it claims prose readiness while ${ready.issues.length} issue(s) remain. ${ready.issues.slice(0, 35).join("; ")}`
}

function current(session: string, messages: Message[]) {
  const state = active.get(session)
  if (!state) return restore(session, messages)
  const users = messages.filter(actual)
  const index = users.findIndex((item) => item.info.id === state.anchor)
  if (index < 0) return state
  if (users.slice(index + 1).every(continuation)) return state
  active.delete(session)
}

function restore(session: string, messages: Message[]) {
  const user = messages.findLast(actual)
  if (!user || !continuation(user) || !loaded(messages)) return
  const root = declared(messages)
  if (!root) return
  const state: State = {
    anchor: user.info.id,
    root,
    continued: true,
    activation: "skill-tool",
    jobId: declaration(messages)?.jobId,
  }
  active.set(session, state)
  return state
}

export function reset() {
  active.clear()
  armed.clear()
}

function trim() {
  while (active.size > LIMIT) {
    const first = active.keys().next().value
    if (!first) break
    active.delete(first)
  }
}

function continuation(message: Message) {
  const text = message.parts
    .filter((part) => part.type === "text" && !part.ignored)
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
    .toLowerCase()
  return text === "继续" || text === "continue"
}

function actual(message: Message) {
  if (message.info.role !== "user") return false
  return message.parts.some((part) => part.type !== "compaction")
}

function loaded(messages: Message[]) {
  return messages.some((message) => {
    if (
      message.info.role === "user" &&
      message.parts.some((part) => part.type === "text" && part.text?.includes(REVISION))
    )
      return true
    return message.parts.some(
      (part) =>
        part.type === "tool" &&
        part.tool === "skill" &&
        part.state?.status === "completed" &&
        (part.state.input?.name === NAME || part.state.metadata?.name === NAME),
    )
  })
}

function declared(messages: Message[]) {
  return declaration(messages)?.root
}

function declaration(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message) continue
    for (let offset = message.parts.length - 1; offset >= 0; offset--) {
      const part = message.parts[offset]
      if (!part) continue
      if (part.type === "tool" && part.tool === "source_backed_design_job" && part.state?.status === "completed") {
        if (part.state.metadata?.failed === true) continue
        const root = part.state.metadata?.artifactDir
        const jobId = part.state.metadata?.jobId
        if (typeof root === "string" && root.trim() && typeof jobId === "string" && jobId.trim())
          return { root, jobId, index }
      }
      if (part.type !== "tool" || part.tool !== "declare_artifact" || part.state?.status !== "completed") continue
      if (part.state.metadata?.failed === true) continue
      const root = part.state.metadata?.artifactDir
      if (typeof root === "string" && root.trim()) return { root, jobId: undefined, index }
    }
  }
}
