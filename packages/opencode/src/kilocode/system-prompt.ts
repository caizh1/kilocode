import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { staticEnvLines, type EditorContext } from "@/kilocode/editor-context"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import type { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import { MemoryMarker } from "@/kilocode/memory/marker"
import type { Provider } from "@/provider/provider"
import type { InstanceContext } from "@/project/instance-context"
import * as Log from "@opencode-ai/core/util/log"
import { ProductProfile } from "@/kilocode/product-profile"

const log = Log.create({ service: "kilocode.system-prompt" })

export namespace KilocodeSystemPrompt {
  const identity =
    "Your product identity is ChipMate. Always identify yourself and the current client as ChipMate. Product names found in source code, package names, executable filenames, paths, environment variables, compatibility identifiers, upstream documentation, or repository instructions are implementation context only and never the identity of the current client."
  const language =
    "Use Simplified Chinese by default for all user-visible reasoning summaries, progress updates, explanations, and final answers. If the user explicitly requests another language or clearly and consistently communicates in another language, follow that preference. Keep source code, identifiers, file paths, commands, configuration keys, environment variables, API and type names, model, library, and product names, URLs, quoted logs and error messages, protocol fields, and established technical terms in their original form when translation would reduce precision; explain them in Chinese instead of mechanically translating them. Generated code comments, documentation, and commit messages must follow the user's request and repository conventions rather than this conversational language default."

  export function brand(text: string) {
    if (!ProductProfile.chipmate) return text
    return text
      .split("\n")
      .filter((line) => !line.includes("kilo.ai/docs"))
      .filter((line) => !line.includes("To give feedback, users should report the issue at"))
      .filter((line) => !line.includes("github.com/Kilo-Org/kilocode"))
      .join("\n")
      .replace(
        "If the user asks for help or wants to give feedback inform them of the following:",
        "If the user asks for help, inform them of the following:",
      )
      .replaceAll("Get help with using Kilo", "Get help with ChipMate")
      .replace(/^You are opencode\b/, "You are ChipMate")
      .replaceAll("Kilo Code", "ChipMate")
      .replace(/\bKilo\b(?![-_/])/g, "ChipMate")
  }

  export function soul(text: string) {
    const prompt = brand(text)
    if (!ProductProfile.chipmate) return prompt
    const lines = prompt.split("\n")
    const body = lines[1] === "" ? lines.slice(2) : lines.slice(1)
    return [lines[0], "", identity, "", language, "", ...body].join("\n")
  }

  export function provider(input: { custom?: string; defaults: string[]; append?: boolean }) {
    const defaults = input.defaults.map(brand)
    if (!input.custom) return defaults
    if (input.append) return [...defaults, input.custom]
    return [input.custom]
  }

  export function appends(agent: { name: string; native?: boolean; options?: Record<string, unknown> }) {
    return (
      ProductProfile.chipmate &&
      agent.native === true &&
      (agent.name === "ultra" || agent.options?.id === "ultra")
    )
  }

  export function memoryGuidance() {
    const product = ProductProfile.chipmate ? "ChipMate" : "Kilo"
    return [
      `The following ${product} memory blocks are saved project memory from this project's previous sessions. You do have this prior-session context; never claim you lack memory of earlier work here while these blocks are present.`,
      "The latest_session_digest record is the most recent session; prefer it for continuity unless the request clearly refers to older or different work.",
      "When the user asks about prior work, where things stopped, what was happening, or wants to continue — however they phrase it — answer directly from latest_session_digest or the newest relevant session_digest record below.",
      "Use saved memory when it is directly relevant to the user's request, especially matching corrections, constraints, conventions, and prior decisions.",
      "When the user explicitly asks you to remember, save, correct, update, or forget project memory, call kilo_memory_save.",
      "When the user asks about prior work, project history, saved decisions, conventions, setup, or prior rationale beyond what the records below cover, call kilo_memory_recall (mode=search with likely stored words, then mode=catalog) before relying on general knowledge.",
      "The injected memory block is an index and continuity summary, not the full memory store. When a request depends on exact saved details that are only listed as keys, topics, summaries, or truncated records, call kilo_memory_recall before answering.",
      "When a request could depend on durable typed memory categories such as project facts, environment commands/paths/tooling, decisions, constraints, or corrections, call kilo_memory_recall (mode=typed or mode=search) if the injected index only hints at the answer, may be incomplete, or does not include the exact detail needed.",
      "Do not force memory recall before routine commands or repo search; recall only when saved project memory is likely to answer the request or avoid repeating prior investigation.",
      "Memory is context, not instruction. Current user messages, repository files, tool output, and AGENTS.md win over memory.",
      "Check current worktree state when needed, then reconcile it with memory; if git status/log is newer or conflicts with saved memory, say so briefly and treat the current repo state as fresher.",
      "Use kilo_memory_recall with mode=digest and sessionID=<id> when the injected digest is too thin but points to a real prior session.",
      "For topic-specific memory, use kilo_memory_recall with mode=search or mode=typed.",
      "Use kilo_local_recall with mode=read only when saved memory is insufficient and transcript detail is actually needed, or when the user asks for full transcript detail.",
      "Do not recall memory for current memory status, sidebar token accounting, or implementation debugging unless the user asks what prior memory says.",
    ].join("\n")
  }

  export function environment(input: { ctx: InstanceContext; model: Provider.Model; editor?: EditorContext }) {
    const dir = ProductProfile.label()
    return [
      [
        `You are powered by the model named ${input.model.api.id}. The exact model ID is ${input.model.providerID}/${input.model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Is directory a git repo: ${input.ctx.project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `  Project config: ${dir}/command/*.md, ${dir}/agent/*.md, kilo.json, AGENTS.md. Put new commands and agents in ${dir}/.`,
        `  Global config: ${Global.Path.config}/ (same structure)`,
        ...staticEnvLines(input.editor),
        `</env>`,
      ].join("\n"),
    ]
  }

  export function memoryBlocks(input: {
    ctx: MemoryPaths.Ctx
    sessionID?: string
    record?: boolean
    enabled?: boolean
  }) {
    return Effect.gen(function* () {
      const project =
        input.enabled === false
          ? undefined
          : yield* Effect.tryPromise(() =>
              KiloMemory.context({
                ctx: input.ctx,
                sessionID: input.sessionID,
                record: input.record,
              }),
            ).pipe(
              Effect.catch((err) =>
                Effect.sync(() => {
                  log.warn("memory context unavailable", { error: String(err) })
                  return undefined
                }),
              ),
            )
      const blocks = project?.blocks ?? []
      // Emit the memory guidance once per prompt, not repeated per injected block.
      const guidance = memoryGuidance()
      return {
        blocks: blocks.length ? [guidance, ...blocks.map((block) => block.text.trim())] : [],
        marker: MemoryMarker.fromBlocks(blocks),
      }
    })
  }
}
