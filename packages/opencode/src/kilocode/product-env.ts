import path from "node:path"
import { ProductProfile } from "./product-profile"

const MARKER = "KILO_VSCODE_BUNDLED_BIN"
const ROUTING = ["KILO_PRODUCT_PROFILE", "KILO_STORAGE_ROOT", "KILO_VSCODE_GLOBAL_STORAGE"] as const
const PRIVATE = [...ROUTING, "KILO_SERVER_PASSWORD", "KILO_SERVER_USERNAME", "KILO_PARENT_PID", MARKER] as const
const backend = Object.freeze({
  profile: process.env.KILO_PRODUCT_PROFILE,
  bin: process.env[MARKER],
  routing: Object.fromEntries(ROUTING.map((key) => [key, process.env[key]])) as NodeJS.ProcessEnv,
})

function equal(left: string, right: string, platform: NodeJS.Platform) {
  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

function remove(env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform) {
  for (const name of Object.keys(env)) {
    if (equal(name, key, platform)) delete env[name]
  }
}

function withoutBin(value: string, bin: string, platform: NodeJS.Platform) {
  const api = platform === "win32" ? path.win32 : path.posix
  if (!api.isAbsolute(bin)) return value
  const expected = api.normalize(bin)
  return value
    .split(api.delimiter)
    .filter((item) => !item || !equal(api.normalize(item), expected, platform))
    .join(api.delimiter)
}

export function cleanEnv<T extends NodeJS.ProcessEnv>(
  source: T,
  base: Readonly<{ profile?: string; bin?: string }> = backend,
  platform: NodeJS.Platform = process.platform,
): T {
  const env: NodeJS.ProcessEnv = { ...source }
  if (base.profile === ProductProfile.CHIPMATE && base.bin) {
    for (const key of Object.keys(env)) {
      if (!equal(key, "PATH", platform) || env[key] === undefined) continue
      env[key] = withoutBin(env[key], base.bin, platform)
    }
  }
  for (const key of PRIVATE) remove(env, key, platform)
  return env as T
}

export function userEnv<T extends NodeJS.ProcessEnv>(source: T): T {
  return cleanEnv(source)
}

export function userOptions<const T extends { env?: NodeJS.ProcessEnv | null; [key: string]: unknown }>(opts: T) {
  const source = opts.env === null ? {} : { ...process.env, ...opts.env }
  return { ...opts, env: userEnv(source), extendEnv: false as const }
}

export function selfEnv(): NodeJS.ProcessEnv {
  if (backend.profile !== ProductProfile.CHIPMATE) return {}
  return Object.fromEntries(Object.entries(backend.routing).filter((entry): entry is [string, string] => !!entry[1]))
}
