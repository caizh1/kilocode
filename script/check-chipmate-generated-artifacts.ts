#!/usr/bin/env bun
// chipmate_change - new file

/**
 * Guards generated ChipMate config dependency artifacts.
 *
 * ChipMate loads project config from .chipmate/ and .chipmate/ and installs
 * @chipmate/plugin there at runtime. npm writes package.json, lockfiles,
 * .gitignore, and node_modules as generated local state. These paths must stay
 * untracked so background installs do not create recurring branch diffs.
 */

import { spawnSync } from "node:child_process"

const paths = [
  ".chipmate/.gitignore",
  ".chipmate/package.json",
  ".chipmate/package-lock.json",
  ".chipmate/pnpm-lock.yaml",
  ".chipmate/bun.lock",
  ".chipmate/yarn.lock",
  ".chipmate/node_modules",
  ".chipmate/.gitignore",
  ".chipmate/package.json",
  ".chipmate/package-lock.json",
  ".chipmate/pnpm-lock.yaml",
  ".chipmate/bun.lock",
  ".chipmate/yarn.lock",
  ".chipmate/node_modules",
]

const git = spawnSync("git", ["ls-files", "-z", "--", ...paths], { encoding: "utf8" })

if (git.status !== 0) {
  console.error(git.stderr.trim() || "git ls-files failed")
  process.exit(1)
}

const bad = git.stdout.split("\0").filter(Boolean).sort()

if (bad.length === 0) {
  console.log("check-chipmate-generated-artifacts: ok")
  process.exit(0)
}

console.error("Generated ChipMate config dependency artifacts are tracked:")
for (const file of bad) console.error(`  ${file}`)
console.error("")
console.error("These files are created by runtime dependency installs in .chipmate/ and .chipmate/.")
console.error("Remove them from git and keep them ignored.")
process.exit(1)
