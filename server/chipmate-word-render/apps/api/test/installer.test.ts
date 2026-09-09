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
  printf '%s\n' 'PATH=/usr/bin' 'NEW_API_BASE_URL=http://new-api.internal' 'NEW_API_ADMIN_ACCESS_TOKEN=admin-secret' 'NEW_API_USER_ID=7' 'CHIPMATE_PUBLIC_BASE_URL=https://chipmate.example.com' 'EXTENSION_MARKET_ENABLED=1' 'EXTENSION_MARKET_ROOT=/data/skill-market/extensions' 'EXTENSION_OWNER_BINDINGS_JSON={"chipmate.chipmate":"Alice"}' 'EXTENSION_DROP_SCAN_MS=5000' 'EXTENSION_UPLOAD_MAX_ACTIVE=12'
  exit 0
fi
if [ "$1" = "load" ]; then echo "load $*" >> "$DOCKER_LOG"; echo 'Loaded image: chipmate-word-render:0.1.8'; exit 0; fi
if [ "$1" = "images" ]; then echo 'chipmate-word-render:0.1.8'; exit 0; fi
if [ "$1" = "rm" ]; then echo 'rm' >> "$DOCKER_LOG"; exit 0; fi
if [ "$1" = "stop" ] || [ "$1" = "rename" ] || [ "$1" = "start" ]; then echo "$*" >> "$DOCKER_LOG"; exit 0; fi
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
  await writeFile(
    join(bin, "curl"),
    "#!/bin/sh\nif [ \"${CURL_FAIL:-0}\" = \"1\" ]; then exit 1; fi\necho '{\"ok\":true}'\n",
  )
  await writeFile(join(bin, "sleep"), "#!/bin/sh\nexit 0\n")
  await chmod(join(bin, "docker"), 0o755)
  await chmod(join(bin, "curl"), 0o755)
  await chmod(join(bin, "sleep"), 0o755)
  return { dir, bin, log, archive }
}

test("generates authentication secrets and inherits only supported server configuration", async () => {
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
    assert.match(result.stdout, /generating LDAP configuration master key/)
    assert.match(result.stdout, /break-glass credential is stored/)
    assert.match(result.stdout, /preserving existing server URL, extension market, and review-rule configuration/)
    const log = await readFile(item.log, "utf8")
    assert.match(log, /--env-file/)
    assert.doesNotMatch(log, /NEW_API_BASE_URL/)
    assert.doesNotMatch(log, /NEW_API_ADMIN_ACCESS_TOKEN/)
    assert.doesNotMatch(log, /NEW_API_USER_ID/)
    assert.match(log, /CHIPMATE_PUBLIC_BASE_URL=https:\/\/chipmate\.example\.com/)
    assert.match(log, /EXTENSION_MARKET_ENABLED=1/)
    assert.match(log, /EXTENSION_MARKET_ROOT=\/data\/skill-market\/extensions/)
    assert.match(log, /EXTENSION_OWNER_BINDINGS_JSON=\{"chipmate\.chipmate":"Alice"\}/)
    assert.match(log, /EXTENSION_DROP_SCAN_MS=5000/)
    assert.match(log, /EXTENSION_UPLOAD_MAX_ACTIVE=12/)
    assert.match(log, /--env EXTENSION_MARKET_ENABLED=1/)
    assert.match(log, /master\.key:\/run\/secrets\/chipmate-auth-master-key:ro/)
    assert.match(log, /break-glass\.key:\/run\/secrets\/chipmate-auth-break-glass:ro/)
    assert.match(log, /--env CHIPMATE_AUTH_MASTER_KEY_FILE=\/run\/secrets\/chipmate-auth-master-key/)
    assert.match(log, /--env CHIPMATE_AUTH_BREAK_GLASS_KEY_FILE=\/run\/secrets\/chipmate-auth-break-glass/)
    assert.doesNotMatch(log, /PATH=\/usr\/bin/)
    const master = await readFile(join(item.dir, "data/auth/master.key"), "utf8")
    const breakGlass = await readFile(join(item.dir, "data/auth/break-glass.key"), "utf8")
    assert.ok(master.trim().length >= 32)
    assert.ok(breakGlass.trim().length >= 32)
    const runtimeMerge = log.indexOf("node /app/scripts/merge-runtime-packages.mjs")
    const oldServiceStop = log.indexOf("stop chipmate-word-render")
    assert.notEqual(runtimeMerge, -1)
    assert.notEqual(oldServiceStop, -1)
    assert.ok(runtimeMerge < oldServiceStop, "运行时必须在停止旧服务前完成合并")
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

test("restores the previous container when the new service fails health checks", async () => {
  const item = await fixture()
  try {
    const result = await run([item.archive], {
      PATH: `${item.bin}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: item.log,
      CURL_FAIL: "1",
      PACKAGE_ROOT_ON_HOST: join(item.dir, "packages"),
      DATA_ROOT_ON_HOST: join(item.dir, "data"),
      SKILL_MARKET_SEED_ROOT: join(item.dir, "missing-seed"),
    })
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /restoring the previous container/)
    const log = await readFile(item.log, "utf8")
    assert.match(log, /stop chipmate-word-render/)
    assert.match(log, /rename chipmate-word-render chipmate-word-render-rollback-/)
    assert.match(log, /rename chipmate-word-render-rollback-.* chipmate-word-render/)
    assert.match(log, /start chipmate-word-render/)
  } finally {
    await rm(item.dir, { recursive: true, force: true })
  }
})
