const { spawn } = require("node:child_process")
const {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs")
const { dirname, join, resolve, sep } = require("node:path")

const SUPERVISOR_SCHEMA_VERSION = 2
const LEASE_SCHEMA_VERSION = 2
const LEASE_FRESH_MS = 30_000
const LEASE_EMPTY_GRACE_MS = 2_000

const [node, entry, workspace, root, log, metadata] = process.argv.slice(2)
if (![node, entry, workspace, root, log, metadata].every((value) => typeof value === "string" && value.length > 0)) {
  process.exit(64)
}
if (!resolve(metadata).startsWith(`${resolve(root)}${sep}`)) process.exit(64)

const leases = join(root, "leases")
const request = join(root, "supervisor", "stop.request.json")
const result = join(root, "supervisor", "stop.result.json")
const lifecycleLog = join(root, "supervisor", "lifecycle.log")
mkdirSync(dirname(metadata), { recursive: true, mode: 0o700 })
mkdirSync(leases, { recursive: true, mode: 0o700 })
rmSync(request, { force: true })
rmSync(result, { force: true })

const output = openSync(log, "a", 0o600)
const child = spawn(node, [entry, "web", "--host", "127.0.0.1", "--port", "0"], {
  cwd: workspace,
  env: process.env,
  detached: process.platform !== "win32",
  stdio: ["ignore", output, output],
  windowsHide: true,
})
closeSync(output)
if (!child.pid) process.exit(70)

atomicWrite(metadata, {
  schemaVersion: SUPERVISOR_SCHEMA_VERSION,
  supervisorPid: process.pid,
  dshPid: child.pid,
  startedAt: new Date().toISOString(),
})
diagnostic({ event: "started" })

let stopping = false
let timer
let checking = false
let noLeaseSince
const leaseStates = new Map()
const ownerChecks = new Map()
const unreadableSince = new Map()
let dshExitCode = null
let dshSignal = null

const finish = (forced, reason, details = {}) => {
  if (timer) clearInterval(timer)
  diagnostic({ event: "finished", forced, reason, ...details })
  atomicWrite(result, {
    schemaVersion: SUPERVISOR_SCHEMA_VERSION,
    supervisorPid: process.pid,
    dshPid: child.pid,
    forced,
    reason,
    signalAttempted: false,
    signalDelivered: false,
    gracefulExit: false,
    elapsedMs: 0,
    dshExitCode: null,
    dshSignal: null,
    ...details,
    at: new Date().toISOString(),
  })
  rmSync(metadata, { force: true })
  rmSync(request, { force: true })
  process.exit(forced || reason === "dsh-exit" || reason === "spawn-error" ? 2 : 0)
}

const stop = async (reason) => {
  if (stopping) return
  stopping = true
  const started = Date.now()
  const signal = await deliverGracefulSignal(child.pid)
  const exited = await waitForExit(child.pid, Math.max(0, 15_000 - (Date.now() - started)))
  if (exited) {
    return finish(false, reason, {
      ...signal,
      gracefulExit: signal.signalDelivered,
      elapsedMs: Date.now() - started,
      dshExitCode,
      dshSignal,
    })
  }
  await forceTree(child.pid)
  await waitForExit(child.pid, 2_000)
  finish(true, reason, {
    ...signal,
    gracefulExit: false,
    elapsedMs: Date.now() - started,
    dshExitCode,
    dshSignal,
  })
}

child.once("error", (error) => {
  diagnostic({ event: "spawn-error", error: safeError(error) })
  void stop("spawn-error")
})
child.once("exit", (code, signal) => {
  dshExitCode = code
  dshSignal = signal
  if (!stopping)
    finish(false, "dsh-exit", {
      dshExitCode: code,
      dshSignal: signal,
    })
})
process.once("SIGINT", () => void stop("signal"))
process.once("SIGTERM", () => void stop("signal"))

timer = setInterval(() => void tick(), 500)

async function tick() {
  if (checking || stopping) return
  checking = true
  try {
    if (existsSync(request)) {
      await stop("requested-stop")
      return
    }
    if ((await liveLeases(leases)) > 0) {
      noLeaseSince = undefined
      return
    }
    noLeaseSince ??= Date.now()
    if (Date.now() - noLeaseSince >= LEASE_EMPTY_GRACE_MS) await stop("lease-expired")
  } catch (error) {
    noLeaseSince = undefined
    diagnostic({ event: "lease-check-error", error: safeError(error) })
  } finally {
    checking = false
  }
}

async function liveLeases(directory) {
  if (!existsSync(directory)) return 0
  const now = Date.now()
  let count = 0
  for (const name of readdirSync(directory)) {
    if (name.endsWith(".tmp")) continue
    const path = join(directory, name)
    let value
    try {
      value = JSON.parse(readFileSync(path, "utf8"))
    } catch {
      const since = unreadableSince.get(name) ?? now
      unreadableSince.set(name, since)
      const ageMs = now - since
      recordLeaseState(name, "unreadable", { ageMs })
      if (ageMs <= LEASE_FRESH_MS) {
        count += 1
        continue
      }
      rmSync(path, { force: true })
      continue
    }
    unreadableSince.delete(name)
    if (isLeaseV2(value)) {
      const ageMs = Math.max(0, now - value.updatedAt)
      if (ageMs <= LEASE_FRESH_MS) {
        recordLeaseState(value.ownerId, "fresh", { ageMs })
        count += 1
        continue
      }
      const state = await cachedOwnerState(value, now)
      recordLeaseState(value.ownerId, state, { ageMs })
      if (state === "live" || state === "unknown") {
        count += 1
        continue
      }
      rmSync(path, { force: true })
      continue
    }
    const ageMs = typeof value.updatedAt === "number" ? Math.max(0, now - value.updatedAt) : Number.MAX_SAFE_INTEGER
    if (typeof value.updatedAt === "number" && ageMs <= LEASE_FRESH_MS) {
      recordLeaseState(String(value.owner ?? name), "legacy-fresh", { ageMs })
      count += 1
      continue
    }
    recordLeaseState(String(value.owner ?? name), "legacy-expired", { ageMs })
    rmSync(path, { force: true })
  }
  return count
}

function isLeaseV2(value) {
  return (
    value &&
    value.schemaVersion === LEASE_SCHEMA_VERSION &&
    typeof value.ownerId === "string" &&
    typeof value.ownerPid === "number" &&
    typeof value.ownerStartIdentity === "string" &&
    value.ownerStartIdentity.length > 0 &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  )
}

async function ownerState(pid, expectedIdentity) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    return error && error.code === "ESRCH" ? "dead" : "unknown"
  }
  try {
    return (await processStartIdentity(pid)) === expectedIdentity ? "live" : "dead"
  } catch {
    return "unknown"
  }
}

async function cachedOwnerState(lease, now) {
  const cached = ownerChecks.get(lease.ownerId)
  if (
    cached &&
    cached.pid === lease.ownerPid &&
    cached.identity === lease.ownerStartIdentity &&
    now - cached.checkedAt <= 5_000
  )
    return cached.state
  const state = await ownerState(lease.ownerPid, lease.ownerStartIdentity)
  ownerChecks.set(lease.ownerId, {
    pid: lease.ownerPid,
    identity: lease.ownerStartIdentity,
    checkedAt: now,
    state,
  })
  return state
}

async function processStartIdentity(pid) {
  if (process.platform === "win32") {
    const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
    return (await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 5_000)).trim()
  }
  if (process.platform === "linux") {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u)
    const started = fields[19]
    const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
    if (!started || !boot) throw new Error("missing Linux process identity")
    return `${boot}:${started}`
  }
  return (await command("ps", ["-p", String(pid), "-o", "lstart="], 5_000)).trim()
}

async function deliverGracefulSignal(pid) {
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGTERM")
      return { signalAttempted: true, signalDelivered: true }
    } catch (error) {
      if (error && error.code === "ESRCH") return { signalAttempted: false, signalDelivered: false }
      diagnostic({ event: "signal-error", error: safeError(error) })
      return { signalAttempted: true, signalDelivered: false }
    }
  }
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ChipMateDshConsoleSignal {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint type, uint processGroupId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
}
'@
[ChipMateDshConsoleSignal]::FreeConsole() | Out-Null
if (-not [ChipMateDshConsoleSignal]::AttachConsole(${process.pid})) { exit 2 }
[ChipMateDshConsoleSignal]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
if (-not [ChipMateDshConsoleSignal]::GenerateConsoleCtrlEvent(0, 0)) { exit 3 }
Start-Sleep -Milliseconds 500
[ChipMateDshConsoleSignal]::FreeConsole() | Out-Null
`
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch {
      return { signalAttempted: attempt > 1, signalDelivered: false }
    }
    try {
      await command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 5_000)
      diagnostic({ event: "signal-delivered", attempt })
      return { signalAttempted: true, signalDelivered: true }
    } catch (error) {
      diagnostic({ event: "signal-failed", attempt, error: safeError(error) })
      if (attempt === 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
    }
  }
  return { signalAttempted: true, signalDelivered: false }
}

async function forceTree(pid) {
  if (process.platform === "win32") {
    await command("taskkill.exe", ["/PID", String(pid), "/T", "/F"], 5_000).catch(() => undefined)
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch (error) {
    if (error && error.code !== "ESRCH") throw error
  }
}

async function waitForExit(pid, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  return false
}

function command(program, args, timeout) {
  return new Promise((resolvePromise, reject) => {
    const childProcess = spawn(program, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
    let stdout = ""
    let settled = false
    childProcess.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    const finishCommand = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      if (error) reject(error)
      else resolvePromise(stdout)
    }
    const timeoutHandle = setTimeout(() => {
      childProcess.kill()
      finishCommand(new Error("process timeout"))
    }, timeout)
    childProcess.once("error", (error) => finishCommand(error))
    childProcess.once("exit", (code) =>
      code === 0 ? finishCommand() : finishCommand(new Error(`process exited ${code}`)),
    )
  })
}

function recordLeaseState(owner, state, details = {}) {
  const key = String(owner).slice(0, 36)
  if (leaseStates.get(key) === state) return
  leaseStates.set(key, state)
  diagnostic({ event: "lease-state", owner: key, state, ...details })
}

function diagnostic(event) {
  try {
    appendFileSync(
      lifecycleLog,
      `${JSON.stringify({ at: new Date().toISOString(), supervisorSchemaVersion: SUPERVISOR_SCHEMA_VERSION, ...event })}\n`,
      { mode: 0o600 },
    )
  } catch (error) {
    // Supervisor 的标准错误默认被丢弃，但保留显式恢复动作，诊断失败不改变生命周期决策。
    if (!stopping) console.warn("[DeepSeek Harness] 无法写入生命周期诊断：", safeError(error))
  }
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n]+/gu, " ").slice(0, 240) : "未知错误"
}

function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}
