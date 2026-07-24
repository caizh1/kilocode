import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { writeSync } from "node:fs"

const load = createRequire(process.execPath)
const root = join(dirname(process.execPath), "node-pty-arm64", "lib", "index.js")
const pty = load(root) as typeof import("@lydell/node-pty")
const shell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
const proc = pty.spawn(shell, ["-NoLogo", "-NoExit"], {
  cwd: process.cwd(),
  cols: 100,
  rows: 30,
  env: process.env,
})
const arm = proc as typeof proc & {
  _agent: {
    _input?: number
  }
}

let data = ""
let started = false
proc.onData((chunk) => {
  data += chunk
  process.stdout.write(chunk)
  if (started) return
  if (!data.includes("PS ")) return
  started = true
  setTimeout(() => {
    const fd = arm._agent._input
    process.stderr.write(`CHIPMATE_INPUT_FD=${String(fd)}\n`)
    if (typeof fd !== "number" || fd < 0) {
      process.exitCode = 2
      proc.kill()
      return
    }
    const size = writeSync(fd, Buffer.from("Write-Output CHIPMATE_FD_WRITE\r", "utf8"))
    process.stderr.write(`CHIPMATE_FD_BYTES=${size}\n`)
  }, 2_000)
})
proc.onExit(() => {
  process.stderr.write(`CHIPMATE_FD_SEEN=${String(data.includes("CHIPMATE_FD_WRITE"))}\n`)
})

setTimeout(() => {
  if (!data.includes("CHIPMATE_FD_WRITE")) process.exitCode = 1
  proc.kill()
}, 6_000)
