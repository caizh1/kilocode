import path from "path"
import { randomUUID } from "crypto" // kilocode_change
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Schema } from "effect"
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
import * as Log from "@opencode-ai/core/util/log"
import { Discovery } from "./discovery"
import { mkdir, rename, rm, writeFile } from "fs/promises" // kilocode_change
import { BUILTIN_SKILLS } from "../kilocode/skills/builtin" // kilocode_change
import { primaryPaths } from "../kilocode/primary-worktree" // kilocode_change
import { ProductProfile } from "../kilocode/product-profile" // kilocode_change
import { Git } from "@/git" // kilocode_change
import { isRecord } from "@/util/record"
import { Flag } from "@opencode-ai/core/flag/flag" // kilocode_change

const log = Log.create({ service: "skill" })
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
  readonly remove: (location: string) => Effect.Effect<void, Error> // kilocode_change
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
        log.error("failed to load skill", { skill: match.path, err }) // kilocode_change
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) return

  if (state.skills[md.data.name]) {
    log.warn("duplicate skill name", {
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
  }
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string; trusted?: boolean; root?: string; sourceRoot?: string }, // kilocode_change
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
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      return Effect.succeed([] as string[])
    }),
  )

  for (const match of matches) {
    // kilocode_change start
    state.matches.set(match, {
      path: match,
      trusted: opts?.trusted ?? false,
      root: opts?.root,
      sourceRoot: opts?.sourceRoot,
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

  const externalDirs: string[] = []
  if (!disableExternalSkills) {
    if (!disableClaudeCodeSkills) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global", trusted: true }) // kilocode_change
    }

    // kilocode_change start
    const local = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
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

  const configDirs = yield* config.directories()
  const primary = new Set(yield* primaryPaths(directory, worktree, [...ProductProfile.dirs])) // kilocode_change
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
    })
    // kilocode_change end
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      log.warn("skill path not found", { path: dir })
      continue
    }

    // kilocode_change start - trust follows the config source that declared the path, never the selected path.
    const origin = cfg.skill_path_origins?.[item]
    const trusted = origin?.trusted === true && path.isAbsolute(expanded)
    yield* scan(state, dir, SKILL_PATTERN, { trusted, root: trusted ? undefined : (origin?.root ?? projectRoot) })
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
    }
  }
  // kilocode_change end

  for (const match of discovered.matches) yield* add(state, match, events) // kilocode_change

  log.info("init", { count: Object.keys(state.skills).length })
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

export const layer = Layer.effect(
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

    // kilocode_change start - remove only a currently discovered user skill and refresh both caches atomically
    const invalidate = Effect.fn("Skill.invalidate")(function* () {
      yield* InstanceState.invalidate(discovered)
      yield* InstanceState.invalidate(state)
    })

    const remove = Effect.fn("Skill.remove")(function* (location: string) {
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
      if (path.basename(dir).toLowerCase() !== item.name.toLowerCase()) {
        return yield* Effect.fail(new Error("skill directory must match the skill name"))
      }
      const nested = Object.values(current.skills).some((skill) => {
        if (skill.location === item.location || skill.location === BUILTIN_LOCATION) return false
        const relative = path.relative(dir, path.resolve(skill.location))
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
      })
      if (nested) return yield* Effect.fail(new Error("skill directory contains another discovered skill"))
      const builtin = path.join(global.cache, "builtin-skills")
      const relative = path.relative(builtin, dir)
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        return yield* Effect.fail(new Error("cannot remove built-in skill"))
      }
      if (path.basename(resolved) !== "SKILL.md") {
        return yield* Effect.fail(new Error("skill location must point to SKILL.md"))
      }

      const tomb = path.join(dir, `.SKILL.md.removing-${randomUUID()}`)
      yield* Effect.tryPromise({
        try: () => rename(resolved, tomb),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      })

      yield* Effect.gen(function* () {
        yield* invalidate()
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
            yield* invalidate()
            return yield* Effect.fail(err)
          }),
        ),
      )

      yield* Effect.tryPromise({
        try: () => rm(dir, { recursive: true, force: true }),
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() => log.warn("failed to clean removed skill tombstone", { path: tomb, error: err })),
        ),
      )
    })
    // kilocode_change end

    return Service.of({ get, require, all, dirs, available, remove }) // kilocode_change
  }),
)

// kilocode_change start - preserve the concrete layer type across Kilo's Agent/Skill cycle
export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  // kilocode_change end
  Layer.provide(Git.defaultLayer), // kilocode_change
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
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
          `    <location>${pathToFileURL(skill.location).href}</location>`,
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

export * as Skill from "."
