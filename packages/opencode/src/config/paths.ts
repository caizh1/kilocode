export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProductProfile } from "@/chipmate/product-profile" // chipmate_change

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  if (ProductProfile.chipmate) return [] // chipmate_change
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  if (ProductProfile.chipmate) {
    // chipmate_change start
    return unique([
      ProductProfile.config()!,
      ...(!Flag.CHIPMATE_DISABLE_PROJECT_CONFIG
        ? yield* afs.up({ targets: [...ProductProfile.dirs], start: directory, stop: worktree })
        : []),
    ])
  } // chipmate_change end
  return unique([
    Global.Path.config,
    ...(!Flag.CHIPMATE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".chipmate"], // chipmate_change
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [".chipmate"], // chipmate_change
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.CHIPMATE_CONFIG_DIR ? [Flag.CHIPMATE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}
