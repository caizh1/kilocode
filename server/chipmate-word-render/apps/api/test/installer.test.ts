import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "../../..")
const installer = join(root, "install-render-server.sh")

async function run(args: string[], env: Record<string, string>, cwd?: string) {
  const child = spawn("bash", [installer, ...args], { cwd, env: { ...process.env, ...env } })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk) => stdout.push(chunk))
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (value) => resolve(value ?? 1))
  })
  return { code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-installer-"))
  const bin = join(dir, "bin")
  const log = join(dir, "docker.log")
  const archive = join(dir, "image.tar")
  await mkdir(bin, { recursive: true })
  await writeFile(archive, "image")
  await writeFile(
    join(bin, "docker"),
    `#!/bin/sh
set -eu
if [ "$1" = "inspect" ] && [ "\${2:-}" != "--format" ]; then exit 0; fi
if [ "$1" = "inspect" ] && [ "\${2:-}" = "--format" ]; then
  printf '%s\n' 'PATH=/usr/bin' 'NEW_API_BASE_URL=http://new-api.internal' 'NEW_API_ADMIN_ACCESS_TOKEN=admin-secret' 'NEW_API_USER_ID=7' 'EXTENSION_MARKET_ENABLED=1' 'EXTENSION_MARKET_ROOT=/data/skill-market/extensions' 'EXTENSION_DROP_SCAN_MS=5000' 'EXTENSION_UPLOAD_MAX_ACTIVE=12'
  exit 0
fi
if [ "$1" = "load" ]; then echo "load $*" >> "$DOCKER_LOG"; echo 'Loaded image: chipmate-word-render:0.1.8'; exit 0; fi
if [ "$1" = "images" ]; then echo 'chipmate-word-render:0.1.8'; exit 0; fi
if [ "$1" = "rm" ]; then echo 'rm' >> "$DOCKER_LOG"; exit 0; fi
if [ "$1" = "run" ]; then
  printf 'run' >> "$DOCKER_LOG"
  envfile=''
  previous=''
  for value in "$@"; do
    printf ' %s' "$value" >> "$DOCKER_LOG"
    if [ "$previous" = "--env-file" ]; then envfile="$value"; fi
    previous="$value"
  done
  printf '\n' >> "$DOCKER_LOG"
  if [ -n "$envfile" ]; then cat "$envfile" >> "$DOCKER_LOG"; fi
  echo container-id
  exit 0
fi
if [ "$1" = "logs" ]; then exit 0; fi
exit 1
`,
  )
  await writeFile(join(bin, "curl"), "#!/bin/sh\necho '{\"ok\":true}'\n")
  await chmod(join(bin, "docker"), 0o755)
  await chmod(join(bin, "curl"), 0o755)
  return { dir, bin, log, archive }
}

test("inherits resolver and extension directory settings while starting the market disabled", async () => {
  const item = await fixture()
  try {
    const result = await run([item.archive], {
      PATH: `${item.bin}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: item.log,
      PACKAGE_ROOT_ON_HOST: join(item.dir, "packages"),
      DATA_ROOT_ON_HOST: join(item.dir, "data"),
      SKILL_MARKET_SEED_ROOT: join(item.dir, "missing-seed"),
    })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /preserving existing New API resolver configuration/)
    const log = await readFile(item.log, "utf8")
    assert.match(log, /--env-file/)
    assert.match(log, /NEW_API_BASE_URL=http:\/\/new-api\.internal/)
    assert.match(log, /NEW_API_ADMIN_ACCESS_TOKEN=admin-secret/)
    assert.match(log, /NEW_API_USER_ID=7/)
    assert.doesNotMatch(log, /EXTENSION_MARKET_ENABLED=1/)
    assert.match(log, /EXTENSION_MARKET_ROOT=\/data\/skill-market\/extensions/)
    assert.match(log, /EXTENSION_DROP_SCAN_MS=5000/)
    assert.match(log, /EXTENSION_UPLOAD_MAX_ACTIVE=12/)
    assert.match(log, /--env EXTENSION_MARKET_ENABLED=0/)
    assert.doesNotMatch(log, /PATH=\/usr\/bin/)
  } finally {
    await rm(item.dir, { recursive: true, force: true })
  }
})

test("rejects a missing explicit environment file before removing the old container", async () => {
  const item = await fixture()
  try {
    const result = await run([item.archive], {
      PATH: `${item.bin}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: item.log,
      ENV_FILE: join(item.dir, "missing.env"),
    })
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /ENV_FILE does not exist/)
    await assert.rejects(readFile(item.log, "utf8"), { code: "ENOENT" })
  } finally {
    await rm(item.dir, { recursive: true, force: true })
  }
})

test("auto discovery selects the highest semantic archive version", async () => {
  const item = await fixture()
  try {
    for (const version of ["0.1.9", "0.1.10", "0.1.11"]) {
      await writeFile(join(item.dir, `chipmate-word-render-${version}-linux-amd64.docker.tar`), version)
    }
    const result = await run([], {
      PATH: `${item.bin}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: item.log,
      PACKAGE_ROOT_ON_HOST: join(item.dir, "packages"),
      DATA_ROOT_ON_HOST: join(item.dir, "data"),
      SKILL_MARKET_SEED_ROOT: join(item.dir, "missing-seed"),
    }, item.dir)
    assert.equal(result.code, 0, result.stderr)
    const log = await readFile(item.log, "utf8")
    assert.match(log, /chipmate-word-render-0\.1\.11-linux-amd64\.docker\.tar/)
    assert.doesNotMatch(log, /load .*0\.1\.9-linux-amd64/)
  } finally {
    await rm(item.dir, { recursive: true, force: true })
  }
})
