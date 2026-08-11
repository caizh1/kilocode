import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { markNoIndex } from "./chipmate/spotlight" // chipmate_change
import { ensureRealDir } from "./chipmate/global" // chipmate_change
import { Product } from "./chipmate/product" // chipmate_change
import { Flag } from "./flag/flag"
import { makeGlobalNode } from "./effect/app-node"

const app = "chipmate" // chipmate_change
// chipmate_change start
// Defensively strip newline characters from the resolved XDG paths.
// If `$HOME` (or any `$XDG_*_HOME` override) has a trailing newline in
// the user's shell — e.g. because a shell snippet did `export HOME=$(cmd)`
// against a command with an implicit newline — the unsanitised path
// makes `fs.mkdir` try to create `/Users/<name>\n` and fail with EACCES,
// which breaks every `chipmate` invocation at startup (including the SDK
// regen that runs during `bun run extension`).
const clean = (p: string | undefined) => p?.replace(/[\r\n]+/g, "")
const root = Product.root() // chipmate_change
const data = root ? path.join(root, "data") : path.join(clean(xdgData)!, app) // chipmate_change
const cache = root ? path.join(root, "cache") : path.join(clean(xdgCache)!, app) // chipmate_change
const config = root ? path.join(root, "config") : path.join(clean(xdgConfig)!, app) // chipmate_change
const state = root ? path.join(root, "state") : path.join(clean(xdgState)!, app) // chipmate_change
// chipmate_change end
const tmp = root ? path.join(root, "tmp") : path.join(os.tmpdir(), app) // chipmate_change

const paths = {
  get home() {
    return (process.env.CHIPMATE_TEST_HOME ?? os.homedir()).trim() // chipmate_change — defensive trim, see above
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

await Promise.all([
  ensureRealDir(Path.data), // chipmate_change
  ensureRealDir(Path.config), // chipmate_change
  ensureRealDir(Path.state), // chipmate_change
  ensureRealDir(Path.tmp), // chipmate_change
  ensureRealDir(Path.log), // chipmate_change
  ensureRealDir(Path.bin), // chipmate_change
  ensureRealDir(Path.repos), // chipmate_change
])

// chipmate_change start - keep generated ChipMate data out of macOS Spotlight
await Promise.all([Path.data, Path.cache, Path.state].map(markNoIndex))
// chipmate_change end

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.CHIPMATE_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
