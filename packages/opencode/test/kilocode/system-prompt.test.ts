import { describe, expect, test } from "bun:test"
import path from "node:path"
import { z } from "zod"
import { SystemPrompt } from "../../src/session/system"
import { environmentDetails } from "../../src/kilocode/editor-context"
import { KilocodeSystemPrompt } from "../../src/kilocode/system-prompt"
import { ProviderTest } from "../fake/provider"

import PROMPT_ANTHROPIC from "../../src/session/prompt/anthropic.txt"
import PROMPT_DEFAULT from "../../src/session/prompt/default.txt"
import PROMPT_BEAST from "../../src/session/prompt/beast.txt"
import PROMPT_CODEX from "../../src/session/prompt/codex.txt"
import PROMPT_GEMINI from "../../src/session/prompt/gemini.txt"
import PROMPT_GPT from "../../src/session/prompt/gpt.txt"
import PROMPT_GPT55 from "../../src/session/prompt/kilocode-gpt-5.5.txt"
import PROMPT_KIMI from "../../src/session/prompt/kimi.txt"
import PROMPT_LING from "../../src/session/prompt/ling.txt"
import PROMPT_TRINITY from "../../src/session/prompt/trinity.txt"

const root = path.resolve(import.meta.dir, "../..")

async function run(env: Record<string, string>, code: string) {
  const child = Bun.spawn([process.execPath, "-e", code], {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), code: status }
}

describe("SystemPrompt.provider", () => {
  describe("model.prompt override", () => {
    test("anthropic prompt is selected when model.prompt is 'anthropic'", () => {
      const model = ProviderTest.model({ prompt: "anthropic" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_ANTHROPIC])
    })

    test("default prompt is selected when model.prompt is 'anthropic_without_todo'", () => {
      const model = ProviderTest.model({ prompt: "anthropic_without_todo" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_DEFAULT])
    })

    test("beast prompt is selected when model.prompt is 'beast'", () => {
      const model = ProviderTest.model({ prompt: "beast" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_BEAST])
    })

    test("codex prompt is selected when model.prompt is 'codex'", () => {
      const model = ProviderTest.model({ prompt: "codex" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_CODEX])
    })

    test("GPT-5.5 prompt is selected from prompt metadata", () => {
      const model = ProviderTest.model({
        prompt: "gpt55",
        api: { id: "provider-specific-model", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_GPT55])
    })

    test("gemini prompt is selected when model.prompt is 'gemini'", () => {
      const model = ProviderTest.model({ prompt: "gemini" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_GEMINI])
      expect(PROMPT_GEMINI).toContain("filePath argument")
      expect(PROMPT_GEMINI).not.toContain("file_path argument")
    })

    test("trinity prompt is selected when model.prompt is 'trinity'", () => {
      const model = ProviderTest.model({ prompt: "trinity" })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_TRINITY])
    })

    test("model.prompt takes precedence over model.api.id heuristic", () => {
      // A model whose api.id contains "claude" (which would match anthropic via heuristic)
      // but has prompt set to "beast" — prompt should win
      const model = ProviderTest.model({
        prompt: "beast",
        api: { id: "anthropic/claude-4-opus", url: "https://example.com", npm: "@ai-sdk/anthropic" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_BEAST])
    })

    test("model.api.id heuristic is used when model.prompt is undefined", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "anthropic/claude-4-opus", url: "https://example.com", npm: "@ai-sdk/anthropic" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_ANTHROPIC])
    })

    test("Ling fallback runs after upstream model id heuristics", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "gpt-5-ling", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_GPT])
    })

    test("Ling fallback is selected after upstream heuristics miss", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "ling-2", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_LING])
    })

    test("GPT-5.5 model ids are not prompt-special without metadata", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "gpt-5.5", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_GPT])
    })

    test("codex prompt metadata still wins for GPT-5.5 model ids", () => {
      const model = ProviderTest.model({
        prompt: "codex",
        api: { id: "gpt-5.5", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_CODEX])
    })

    test("older Codex model ids keep the Codex prompt", () => {
      const model = ProviderTest.model({
        prompt: undefined,
        api: { id: "gpt-5.1-codex", url: "https://example.com", npm: "@ai-sdk/openai" },
      })
      const result = SystemPrompt.provider(model)
      expect(result).toEqual([PROMPT_CODEX])
    })
  })
})

describe("environmentDetails", () => {
  test("includes cwd and worktree in dynamic context", () => {
    const result = environmentDetails({
      directory: "/repo/.kilo/worktrees/feature",
      worktree: "/repo/.kilo/worktrees/feature",
      activeFile: "src/app.ts",
    })

    expect(result).toContain("Working directory: /repo/.kilo/worktrees/feature")
    expect(result).toContain("Workspace root folder: /repo/.kilo/worktrees/feature")
    expect(result).toContain("Active file: src/app.ts")
  })
})

describe("ChipMate product prompts", () => {
  const policy =
    "Use Simplified Chinese by default for all user-visible reasoning summaries, progress updates, explanations, and final answers."
  const schema = z.object({
    soul: z.string(),
    soulRaw: z.string(),
    instructions: z.string(),
    prompts: z.array(z.string()),
    plan: z.string(),
    review: z.string(),
    memory: z.string(),
    custom: z.string(),
    technical: z.string(),
    standard: z.string(),
    standardMessage: z.object({ role: z.string(), content: z.string() }),
    oauth: z.string(),
    oauthRoles: z.array(z.string()),
    customRequest: z.string(),
    base: z.string(),
    ultraRaw: z.string(),
    ultra: z.string(),
    ultraOauth: z.string(),
    ultraCustom: z.string(),
    ultraOrder: z.array(z.string()),
    codeOrder: z.array(z.string()),
    agents: z.array(z.string()),
    modes: z.array(z.string()),
  })
  const code = [
    'import { Effect } from "effect"',
    'import { SystemPrompt } from "./src/session/system.ts"',
    'import { LLMRequestPrep } from "./src/session/llm/request.ts"',
    'import { KilocodeSystemPrompt } from "./src/kilocode/system-prompt.ts"',
    'import { KiloSessionPrompt } from "./src/kilocode/session/prompt.ts"',
    'import { reviewCommand } from "./src/kilocode/review/command.ts"',
    'import { ProviderTest } from "./test/fake/provider.ts"',
    'import SOUL from "./src/kilocode/soul.txt"',
    'import PLAN from "./src/kilocode/session/native-plan-prompt.txt"',
    'import ANTHROPIC from "./src/session/prompt/anthropic.txt"',
    'import BEAST from "./src/session/prompt/beast.txt"',
    'import CODEX from "./src/session/prompt/codex.txt"',
    'import DEFAULT from "./src/session/prompt/default.txt"',
    'import GEMINI from "./src/session/prompt/gemini.txt"',
    'import GPT from "./src/session/prompt/gpt.txt"',
    'import GPT55 from "./src/session/prompt/kilocode-gpt-5.5.txt"',
    'import KIMI from "./src/session/prompt/kimi.txt"',
    'import LING from "./src/session/prompt/ling.txt"',
    'import TRINITY from "./src/session/prompt/trinity.txt"',
    'import ULTRA from "./src/kilocode/agent/ultra.txt"',
    "const raw = [ANTHROPIC, BEAST, CODEX, DEFAULT, GEMINI, GPT, GPT55, KIMI, LING, TRINITY]",
    "const prompts = raw.map(KilocodeSystemPrompt.brand)",
    "const plan = KilocodeSystemPrompt.brand(PLAN)",
    "const review = reviewCommand().template",
    "const memory = KilocodeSystemPrompt.memoryGuidance()",
    'const custom = "Custom agent keeps Kilo as user-authored text"',
    'const technical = "Keep KILO_CONFIG, kilo.jsonc, kilocode_change, kilo_memory_save, and https://github.com/Kilo-Org/example"',
    "const model = ProviderTest.model()",
    'const provider = ProviderTest.info({ id: "openai" }, model)',
    "const plugin = { trigger: (_name, _input, output) => Effect.succeed(output) }",
    'const agent = { name: "build", mode: "primary", permission: [], options: {} }',
    'const user = { id: "msg_user-chipmate", sessionID: "session-chipmate", role: "user", time: { created: 0 }, agent: "build", model: { providerID: "openai", modelID: model.id }, system: "User-owned system text mentions Kilo" }',
    'const base = { user, sessionID: "session-chipmate", model, agent, system: ["Project instructions describe Kilo CLI and technical kilo.jsonc context"], messages: [{ role: "user", content: "hello" }], tools: {}, provider, plugin, flags: { outputTokenMax: undefined, client: "vscode" }, isWorkflow: false }',
    "const standard = await Effect.runPromise(LLMRequestPrep.prepare({ ...base, auth: undefined }))",
    'const auth = { type: "oauth", refresh: "r", access: "a", expires: Date.now() + 10_000 }',
    "const oauth = await Effect.runPromise(LLMRequestPrep.prepare({ ...base, auth }))",
    'const customRequest = await Effect.runPromise(LLMRequestPrep.prepare({ ...base, agent: { ...agent, name: "custom", prompt: custom }, auth: undefined }))',
    'const ultraAgent = { ...agent, name: "ultra", native: true, prompt: ULTRA }',
    'const order = { env: ["ENV"], mem: ["MEMORY"], instructions: ["AGENTS"], skills: "SKILLS" }',
    "const ultraOrder = KiloSessionPrompt.system({ ...order, agent: ultraAgent })",
    'const codeOrder = KiloSessionPrompt.system({ ...order, agent: { ...agent, name: "code", native: true } })',
    "const ultra = await Effect.runPromise(LLMRequestPrep.prepare({ ...base, agent: ultraAgent, auth: undefined }))",
    "const ultraOauth = await Effect.runPromise(LLMRequestPrep.prepare({ ...base, agent: ultraAgent, auth }))",
    "const ultraCustom = await Effect.runPromise(LLMRequestPrep.prepare({ ...base, agent: { ...ultraAgent, prompt: custom }, auth: undefined }))",
    'const agents = await Promise.all(["ask", "code", "plan"].map((name) => Effect.runPromise(LLMRequestPrep.prepare({ ...base, agent: { ...agent, name }, auth: undefined }))))',
    "const modes = await Promise.all([plan, review, memory].map((entry) => Effect.runPromise(LLMRequestPrep.prepare({ ...base, system: [entry], auth: undefined }))))",
    "console.log(JSON.stringify({ soul: SystemPrompt.soul(), soulRaw: SOUL.trim(), instructions: SystemPrompt.instructions(), prompts, plan, review, memory, custom: KilocodeSystemPrompt.provider({ custom, defaults: [DEFAULT] })[0], technical: KilocodeSystemPrompt.brand(technical), standard: standard.system[0], standardMessage: standard.messages[0], oauth: String(oauth.params.options.instructions), oauthRoles: oauth.messages.map((message) => message.role), customRequest: customRequest.system[0], base: KilocodeSystemPrompt.provider({ defaults: SystemPrompt.provider(model) })[0], ultraRaw: ULTRA, ultra: ultra.system[0], ultraOauth: String(ultraOauth.params.options.instructions), ultraCustom: ultraCustom.system[0], ultraOrder, codeOrder, agents: agents.map((request) => request.system[0]), modes: modes.map((request) => request.system[0]) }))",
  ].join(";")

  test("brands every built-in model-facing entry only for ChipMate", async () => {
    const result = await run(
      {
        KILO_PRODUCT_PROFILE: "chipmate-v2",
        KILO_STORAGE_ROOT: "/tmp/chipmate-system-prompt-test",
        KILO_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-system-prompt-test",
      },
      code,
    )

    expect(result.code, result.stderr).toBe(0)
    const output = schema.parse(JSON.parse(result.stdout))
    const prompts = [output.soul, output.instructions, ...output.prompts, output.plan, output.review, output.memory]
    for (const prompt of prompts) {
      expect(prompt).toContain("ChipMate")
      expect(prompt).not.toMatch(/^You are (?:Kilo|Kilo Code|opencode)\b/m)
      expect(prompt).not.toMatch(/\bKilo(?: Code)?\b/)
      expect(prompt).not.toContain("https://kilo.ai/docs")
      expect(prompt).not.toContain("github.com/Kilo-Org/kilocode")
    }
    expect(output.soul).toContain("Your product identity is ChipMate")
    expect(output.soul).toContain(policy)
    expect(output.soul).toContain("If the user explicitly requests another language")
    expect(output.soul).toContain("Keep source code, identifiers, file paths, commands")
    expect(output.soul).toContain("explain them in Chinese instead of mechanically translating them")
    expect(output.soul).toContain("Generated code comments, documentation, and commit messages must follow")
    expect(output.prompts[0]).toContain("ctrl+p to list available actions")
    expect(output.prompts[3]).toContain("/help: Get help with ChipMate")
    expect(output.prompts[8]).toContain("/help: Get help with ChipMate")
    expect(output.custom).toBe("Custom agent keeps Kilo as user-authored text")
    expect(output.technical).toBe(
      "Keep KILO_CONFIG, kilo.jsonc, kilocode_change, kilo_memory_save, and https://github.com/Kilo-Org/example",
    )
    expect(output.standard).toMatch(/^You are ChipMate\b/)
    expect(output.standardMessage).toEqual({ role: "system", content: output.standard })
    expect(output.oauth).toMatch(/^You are ChipMate\b/)
    expect(output.oauthRoles).toEqual(["user"])
    for (const prompt of [output.standard, output.oauth]) {
      expect(prompt).toContain("Project instructions describe Kilo CLI and technical kilo.jsonc context")
      expect(prompt).toContain("User-owned system text mentions Kilo")
      expect(prompt).not.toMatch(/^You are (?:Kilo|Kilo Code|opencode)\b/m)
    }
    expect(output.customRequest).toContain("Custom agent keeps Kilo as user-authored text")
    expect(output.customRequest).not.toContain(output.base)
    for (const prompt of [output.ultra, output.ultraOauth]) {
      expect(prompt).toContain(output.base)
      expect(prompt).toContain(output.ultraRaw)
      expect(prompt.indexOf(output.base)).toBeLessThan(prompt.indexOf(output.ultraRaw))
      expect(prompt.split(output.ultraRaw)).toHaveLength(2)
    }
    expect(output.ultraCustom).toContain(output.base)
    expect(output.ultraCustom).toContain("Custom agent keeps Kilo as user-authored text")
    expect(output.ultraCustom.indexOf(output.base)).toBeLessThan(
      output.ultraCustom.indexOf("Custom agent keeps Kilo as user-authored text"),
    )
    expect(output.ultraRaw).toContain("For every user turn")
    expect(output.ultraRaw).toContain("without exception")
    expect(output.ultraRaw).toContain("exactly three blind investigations in one parallel wave")
    expect(output.ultraRaw).toContain("Each Explore subagent is independent and read-only")
    expect(output.ultraRaw).toContain("After three valid reports")
    expect(output.ultraRaw).toContain("fourth independent adjudicator")
    expect(output.ultraRaw).toContain("runtime seals and delivers it without another model rewrite")
    expect(output.ultraRaw).not.toContain("Reproduce complete boolean guards")
    expect(output.ultraRaw).not.toContain("Avoid ornamental counts")
    expect(output.ultraRaw).toContain("short contiguous source excerpts")
    expect(output.ultraRaw).toContain("fifth independent verifier")
    expect(output.ultraRaw).toContain("Never treat agreement as evidence")
    expect(output.ultraRaw).toContain("Never start more than five Council investigations")
    expect(output.ultraRaw).toContain("call `ultra_submit_arbitration`")
    expect(output.ultraRaw).toContain("Document RAG are optional evidence sources")
    expect(output.ultraRaw).toContain("contract-failure disclosure")
    expect(output.ultraOrder).toEqual(["ENV", "AGENTS", "SKILLS", "MEMORY"])
    expect(output.codeOrder).toEqual(["ENV", "MEMORY", "AGENTS", "SKILLS"])
    expect(output.modes[0]).toContain(output.plan)
    expect(output.modes[1]).toContain(output.review)
    expect(output.modes[2]).toContain(output.memory)
    for (const prompt of [output.standard, output.oauth, output.customRequest, ...output.agents, ...output.modes]) {
      expect(prompt).not.toContain("Diagram output rules:")
      expect(prompt).not.toContain("fenced `plantuml` code block")
      expect(prompt.split(policy)).toHaveLength(2)
    }
  })

  test("keeps native Kilo prompts byte-for-byte compatible", async () => {
    const result = await run(
      {
        KILO_PRODUCT_PROFILE: "",
        KILO_STORAGE_ROOT: "",
        KILO_VSCODE_GLOBAL_STORAGE: "",
      },
      code,
    )

    expect(result.code, result.stderr).toBe(0)
    const output = schema.parse(JSON.parse(result.stdout))
    expect(output.soul).toBe(output.soulRaw)
    expect(output.instructions).toBe(PROMPT_CODEX.trim())
    expect(output.prompts).toEqual([
      PROMPT_ANTHROPIC,
      PROMPT_BEAST,
      PROMPT_CODEX,
      PROMPT_DEFAULT,
      PROMPT_GEMINI,
      PROMPT_GPT,
      PROMPT_GPT55,
      PROMPT_KIMI,
      PROMPT_LING,
      PROMPT_TRINITY,
    ])
    expect(output.plan).toMatch(/You are Kilo Code\b/)
    expect(output.review).toMatch(/^You are Kilo Code\b/)
    expect(output.memory).toMatch(/^The following Kilo memory blocks\b/)
    expect(output.ultra).toContain(output.ultraRaw)
    expect(output.ultra).not.toContain(output.base)
    expect(output.ultraCustom).toContain("Custom agent keeps Kilo as user-authored text")
    expect(output.ultraCustom).not.toContain(output.base)
    expect(output.ultraOrder).toEqual(["ENV", "MEMORY", "AGENTS", "SKILLS"])
    expect(output.codeOrder).toEqual(["ENV", "MEMORY", "AGENTS", "SKILLS"])
    for (const prompt of [output.standard, output.oauth, output.customRequest, ...output.agents, ...output.modes]) {
      expect(prompt).not.toContain("Diagram output rules:")
      expect(prompt).not.toContain("fenced `plantuml` code block")
    }
  })
})
