import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import path from "path"
import { randomUUID } from "crypto" // kilocode_change
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Schema } from "effect"
import { ScopedCache } from "effect" // kilocode_change
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "@/permission"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Config } from "@/config/config"
import { FrontmatterError } from "@opencode-ai/core/v1/config/error"
import { ConfigMarkdown } from "@/config/markdown"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Glob } from "@opencode-ai/core/util/glob"
import { Discovery } from "./discovery"
import { lstat, mkdir, rename, rm, writeFile } from "fs/promises" // kilocode_change
import { BUILTIN_SKILLS } from "../kilocode/skills/builtin" // kilocode_change
import { primaryPaths } from "../kilocode/primary-worktree" // kilocode_change
import { ProductProfile } from "../kilocode/product-profile" // kilocode_change
import { Git } from "@/git" // kilocode_change
import { isRecord } from "@/util/record"
import { Flag } from "@opencode-ai/core/flag/flag" // kilocode_change
import { validateInstalledSkill } from "@/kilocode/skill/identity" // kilocode_change
import { escapeHtml } from "@/util/html"
import { trustedInProject } from "../kilocode/skill/trust" // kilocode_change

const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
// kilocode_change start
export const BUILTIN_LOCATION = "builtin"
// kilocode_change end
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const KILO_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
  content: Schema.String,
  trusted: Schema.optional(Schema.Boolean), // kilocode_change - gate skill shell injection to trusted sources
})
export type Info = Schema.Schema.Type<typeof Info>

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

function isSkillFrontmatter(data: unknown): data is { name: string; description?: string } {
  return (
    isRecord(data) &&
    typeof data.name === "string" &&
    (data.description === undefined || typeof data.description === "string")
  )
}

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("SkillInvalidError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Issue)),
}) {}

export class NameMismatchError extends Schema.TaggedErrorClass<NameMismatchError>()("SkillNameMismatchError", {
  path: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Skill.NotFoundError", {
  name: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Skill "${this.name}" not found. Available skills: ${this.available.join(", ") || "none"}`
  }
}

type State = {
  skills: Record<string, Info>
  dirs: Set<string>
}

// kilocode_change start - retain markdown trust provenance through discovery
type Match = {
  path: string
  scanRoot: string
  trusted: boolean
  root?: string
  sourceRoot?: string
}

type DiscoveryState = {
  matches: Match[]
  dirs: string[]
}

type ScanState = {
  matches: Map<string, Match>
  dirs: Set<string>
}
// kilocode_change end

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly require: (name: string) => Effect.Effect<Info, NotFoundError>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  readonly refresh: (scope: "project" | "global") => Effect.Effect<void> // kilocode_change
  readonly remove: (location: string, scope: "project" | "global") => Effect.Effect<void, Error> // kilocode_change
}

// kilocode_change start
const add = Effect.fnUntraced(function* (state: State, match: Match, events: EventV2Bridge.Service["Service"]) {
  const source = match.sourceRoot ?? match.root
  // kilocode_change end
  const md = yield* Effect.tryPromise({
    // kilocode_change start - project skills cannot read env or files outside the project root
    try: () =>
      ConfigMarkdown.parse(match.path, {
        trusted: match.trusted,
        fileScope: match.trusted || !match.root ? undefined : { root: match.root, source: match.path },
        sourceScope: match.trusted || !source ? undefined : { root: source, source: match.path },
      }),
    // kilocode_change end
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = FrontmatterError.isInstance(err) ? err.data.message : `Failed to parse skill ${match.path}` // kilocode_change
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        yield* Effect.logError("failed to load skill", { skill: match.path, error: err }) // kilocode_change
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) return

  // kilocode_change start - ChipMate uses one canonical identity across CLI and Marketplace
  if (ProductProfile.chipmate) {
    const identity = yield* Effect.tryPromise({
      try: () => validateInstalledSkill(match.path, md.data.name),
      catch: (err) => err,
    }).pipe(
      Effect.catch((err) =>
        Effect.logWarning("invalid ChipMate skill identity", { skill: match.path, err }).pipe(
          Effect.as(undefined),
        ),
      ),
    )
    if (!identity?.valid) {
      const message = identity?.message ?? `Failed to validate Skill identity: ${match.path}`
      const { Session } = yield* Effect.promise(() => import("@/session/session"))
      yield* events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      yield* Effect.logWarning("ignored invalid ChipMate skill", { skill: match.path, message })
      return
    }
  }
  // kilocode_change end

  if (state.skills[md.data.name]) {
    yield* Effect.logWarning("duplicate skill name", {
      name: md.data.name,
      existing: state.skills[md.data.name].location,
      duplicate: match.path, // kilocode_change
    })
  }

  state.dirs.add(path.dirname(match.path)) // kilocode_change
  state.skills[md.data.name] = {
    name: md.data.name,
    description: md.data.description,
    location: match.path, // kilocode_change
    content: md.content,
    trusted: match.trusted, // kilocode_change
  }
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string; trusted?: boolean; root?: string; sourceRoot?: string; projectRoot?: string }, // kilocode_change
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      return Effect.logError(`failed to scan ${opts.scope} skills`, { dir: root, error: error }).pipe(
        Effect.as([] as string[]),
      )
    }),
  )

  for (const match of matches) {
    // kilocode_change start - a trusted match whose realpath resolves inside the project (e.g. a
    // symlink from ~/.agents/skills into the repo) must not mint trust for project-controlled content
    const trusted = (opts?.trusted ?? false) && !trustedInProject(match, opts?.projectRoot)
    state.matches.set(match, {
      path: match,
      scanRoot: root,
      trusted,
      root: trusted ? opts?.root : (opts?.root ?? opts?.projectRoot),
      sourceRoot: trusted ? opts?.sourceRoot : (opts?.sourceRoot ?? opts?.projectRoot),
    })
    // kilocode_change end
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: FSUtil.Interface,
  global: Global.Interface,
  disableExternalSkills: boolean,
  disableClaudeCodeSkills: boolean,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Map(), dirs: new Set() } // kilocode_change
  const projectRoot = worktree === "/" ? directory : worktree // kilocode_change - project substitution boundary

  // kilocode_change start - ChipMate discovers only its fixed global and current-project Skill roots
  if (ProductProfile.chipmate) {
    const global = ProductProfile.config()!
    yield* scan(state, global, "skills/*/SKILL.md", { scope: "global", trusted: true })
    if (!Flag.KILO_DISABLE_PROJECT_CONFIG) {
      const local = ProductProfile.project(projectRoot)
      yield* scan(state, local, "skills/*/SKILL.md", {
        scope: "project",
        root: projectRoot,
        sourceRoot: projectRoot,
      })
    }
    return { matches: Array.from(state.matches.values()), dirs: Array.from(state.dirs) }
  }
  // kilocode_change end

  const externalDirs: string[] = []
  if (!disableExternalSkills) {
    if (!disableClaudeCodeSkills) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global", trusted: true, projectRoot }) // kilocode_change
    }

    // kilocode_change start
    const local = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: projectRoot })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))
    const fallbacks = yield* primaryPaths(directory, worktree, externalDirs) // kilocode_change
    const upDirs = [...fallbacks, ...local]
    // kilocode_change end

    for (const root of upDirs) {
      const scope = fallbacks.includes(root) ? path.dirname(root) : projectRoot // kilocode_change
      // kilocode_change start
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, {
        dot: true,
        scope: "project",
        root: projectRoot,
        sourceRoot: scope,
      })
      // kilocode_change end
    }
  }

  // kilocode_change start - include primary-checkout Kilo config roots for worktree sessions
  const primary = new Set(yield* primaryPaths(directory, worktree, [...ProductProfile.dirs]))
  const configDirs = yield* config.directories()
  // kilocode_change end
  for (const dir of configDirs) {
    // kilocode_change start - global and explicit KILO_CONFIG_DIR skills are trusted; project and primary-checkout
    // skills remain confined to the active project boundary.
    const rel = path.relative(projectRoot, dir)
    const local = primary.has(dir) || rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
    const trusted = dir === Flag.KILO_CONFIG_DIR || !local
    const sourceRoot = primary.has(dir) ? path.dirname(dir) : projectRoot
    yield* scan(state, dir, KILO_SKILL_PATTERN, {
      trusted,
      root: trusted ? undefined : projectRoot,
      sourceRoot: trusted ? undefined : sourceRoot,
      projectRoot,
    })
    // kilocode_change end
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      yield* Effect.logWarning("skill path not found", { path: dir })
      continue
    }

    // kilocode_change start - trust follows the config source that declared the path, never the selected path.
    const origin = cfg.skill_path_origins?.[item]
    const trusted = origin?.trusted === true && path.isAbsolute(expanded)
    yield* scan(state, dir, SKILL_PATTERN, {
      trusted,
      root: trusted ? undefined : (origin?.root ?? projectRoot),
      projectRoot,
    })
    // kilocode_change end
  }

  for (const url of cfg.skills?.urls ?? []) {
    const pulledDirs = yield* discovery.pull(url)
    for (const dir of pulledDirs) {
      yield* scan(state, dir, SKILL_PATTERN, { root: dir }) // kilocode_change - downloaded markdown is untrusted
    }
  }

  return {
    matches: Array.from(state.matches.values()), // kilocode_change
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (
  state: State,
  discovered: DiscoveryState,
  events: EventV2Bridge.Service["Service"],
) {
  // kilocode_change start - seed built-in skills before discovery so user skills can override
  for (const skill of BUILTIN_SKILLS) {
    const location = yield* Effect.promise(() => materializeBuiltinSkill(skill))
    if (location !== BUILTIN_LOCATION) state.dirs.add(path.dirname(location))
    state.skills[skill.name] = {
      name: skill.name,
      description: skill.description,
      location,
      content: skill.content,
      trusted: true, // kilocode_change - builtin skills ship in the binary
    }
  }
  // kilocode_change end

  for (const match of discovered.matches) yield* add(state, match, events) // kilocode_change

  yield* Effect.logInfo("init", { count: Object.keys(state.skills).length })
})

// kilocode_change start - materialize complex built-in skills so references/scripts/templates are readable offline
async function materializeBuiltinSkill(skill: (typeof BUILTIN_SKILLS)[number]): Promise<string> {
  if (!skill.files || Object.keys(skill.files).length === 0) return BUILTIN_LOCATION

  const root = path.join(Global.Path.cache, "builtin-skills", skill.name)
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, "SKILL.md"), skill.content, "utf8")

  for (const [relative, content] of Object.entries(skill.files)) {
    if (!isSafeBuiltinSkillRelativePath(relative)) continue
    const target = path.join(root, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, "utf8")
  }

  return path.join(root, "SKILL.md")
}

function isSafeBuiltinSkillRelativePath(relative: string): boolean {
  if (!relative || path.isAbsolute(relative)) return false
  const normalized = path.normalize(relative)
  if (normalized.startsWith("..") || normalized.includes(`..${path.sep}`)) return false
  return normalized === relative
}
// kilocode_change end

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const events = yield* EventV2Bridge.Service
    const fsys = yield* FSUtil.Service
    const global = yield* Global.Service
    const flags = yield* RuntimeFlags.Service
    const git = yield* Git.Service // kilocode_change
    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(
          config,
          discovery,
          fsys,
          global,
          flags.disableExternalSkills,
          flags.disableClaudeCodeSkills,
          ctx.directory,
          ctx.worktree, // kilocode_change
        ).pipe(Effect.provideService(Git.Service, git)) // kilocode_change
      }),
    )
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const s: State = { skills: {}, dirs: new Set() }
        yield* loadSkills(s, yield* InstanceState.get(discovered), events)
        return s
      }),
    )

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name]
    })

    const require = Effect.fn("Skill.require")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const info = s.skills[name]
      if (info) return info
      return yield* new NotFoundError({ name, available: Object.keys(s.skills).toSorted() })
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    // kilocode_change start - refresh only Skill discovery/state without disposing the workspace instance
    const refresh = Effect.fn("Skill.refresh")(function* (scope: "project" | "global") {
      if (scope === "global") {
        yield* ScopedCache.invalidateAll(discovered.cache)
        yield* ScopedCache.invalidateAll(state.cache)
        return
      }
      yield* InstanceState.invalidate(discovered)
      yield* InstanceState.invalidate(state)
    })

    // remove only a currently discovered user skill and refresh both caches atomically
    const remove = Effect.fn("Skill.remove")(function* (location: string, scope: "project" | "global") {
      const resolved = path.resolve(location)
      const current = yield* InstanceState.get(state)
      const item = Object.values(current.skills).find(
        (skill) => skill.location !== BUILTIN_LOCATION && path.resolve(skill.location) === resolved,
      )
      if (!item) return yield* Effect.fail(new Error("skill is not currently discovered or is not removable"))

      const dir = path.dirname(resolved)
      const ctx = yield* InstanceState.context
      const roots = [
        ctx.directory,
        ctx.project.worktree,
        global.home,
        global.config,
        global.data,
        global.cache,
        global.state,
        ...(yield* config.directories()),
        path.parse(dir).root,
      ].map((root) => path.resolve(root))
      if (roots.includes(dir)) return yield* Effect.fail(new Error("cannot remove a protected parent directory"))
      const key = (value: string) =>
        value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "")
      if (!key(item.name) || key(path.basename(dir)) !== key(item.name)) {
        return yield* Effect.fail(new Error("skill directory must match the skill name"))
      }
      const matches = (yield* InstanceState.get(discovered)).matches
      const match = matches.find((match) => path.resolve(match.path) === resolved)
      if (!match) return yield* Effect.fail(new Error("skill is not present in the current discovery snapshot"))
      const nested = matches.some((match) => {
        if (path.resolve(match.path) === resolved) return false
        const relative = path.relative(dir, path.resolve(match.path))
        return (
          relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
        )
      })
      if (nested) return yield* Effect.fail(new Error("skill directory contains another discovered skill"))
      for (const cache of [path.join(global.cache, "builtin-skills"), path.join(global.cache, "skills")]) {
        const relative = path.relative(cache, dir)
        if (
          relative === "" ||
          (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
        ) {
          return yield* Effect.fail(new Error("cannot remove cached skill content"))
        }
      }
      if (path.basename(resolved) !== "SKILL.md") {
        return yield* Effect.fail(new Error("skill location must point to SKILL.md"))
      }
      const root = path.resolve(match.scanRoot)
      const relative = path.relative(root, dir)
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return yield* Effect.fail(new Error("skill directory escaped its discovery root"))
      }
      const chain = relative
        .split(path.sep)
        .filter(Boolean)
        .reduce<string[]>((items, part) => [...items, path.join(items.at(-1) ?? root, part)], [root])
      const stats = yield* Effect.tryPromise({
        try: () => Promise.all([...chain.map((item) => lstat(item)), lstat(resolved)]),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      })
      if (stats.some((stat) => stat.isSymbolicLink())) {
        return yield* Effect.fail(new Error("cannot remove a skill through a symbolic link"))
      }

      const tomb = path.join(dir, `.SKILL.md.removing-${randomUUID()}`)
      yield* Effect.tryPromise({
        try: () => rename(resolved, tomb),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      })

      yield* Effect.gen(function* () {
        yield* refresh(scope)
        const fresh = yield* InstanceState.get(state)
        if (Object.values(fresh.skills).some((skill) => path.resolve(skill.location) === resolved)) {
          return yield* Effect.fail(new Error("skill remained discoverable after removal"))
        }
      }).pipe(
        Effect.catch((err) =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () => rename(tomb, resolved),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            })
            yield* refresh(scope)
            return yield* Effect.fail(err)
          }),
        ),
      )

      yield* Effect.tryPromise({
        try: async () => {
          await rm(dir, { recursive: true, force: false })
          await lstat(dir).then(
            () => Promise.reject(new Error("skill directory still exists after removal")),
            (err: NodeJS.ErrnoException) => {
              if (err.code !== "ENOENT") return Promise.reject(err)
            },
          )
        },
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(
        Effect.catch((err) =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () => rename(tomb, resolved),
              catch: (cause) =>
                new Error(
                  `failed to remove skill directory: ${err.message}; rollback failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
            })
            yield* refresh(scope)
            return yield* Effect.fail(new Error(`failed to remove skill directory: ${err.message}`))
          }),
        ),
      )
    })
    // kilocode_change end

    return Service.of({ get, require, all, dirs, available, refresh, remove }) // kilocode_change
  }),
)

export function fmt(list: Info[], opts: { verbose: boolean }) {
  const described = list.filter((skill) => skill.description !== undefined)
  if (described.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...described
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${escapeHtml(skill.location)}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n")
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Discovery.node, Config.node, EventV2Bridge.node, FSUtil.node, Global.node, RuntimeFlags.node, Git.node], // kilocode_change
})
export const defaultLayer = Layer.suspend(() => AppNodeBuilder.build(node))

export * as Skill from "."
