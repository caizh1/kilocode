import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = mkdtempSync(join(tmpdir(), "chipmate-update-server-"))
const vsix = join(root, "修复 包.vsix")
const log = join(root, "requests.json")
writeFileSync(vsix, "fixture")
const child = spawn(process.execPath, [
  fileURLToPath(new URL("./update-server.mjs", import.meta.url)),
  `--vsix=${vsix}`,
  "--version=1.0.10",
  "--port=0",
  `--log=${log}`,
])

try {
  const line = await first(child.stdout)
  const ready = JSON.parse(line)
  const base = `http://127.0.0.1:${ready.port}`
  const manifest = await fetch(`${base}/packages/manifest.json`).then((res) => res.json())
  const item = manifest.latestByTarget["win32-x64-baseline"]
  assert.equal(item.version, "1.0.10")
  assert.equal(item.sizeBytes, 7)
  assert.equal(item.sha256, createHash("sha256").update("fixture").digest("hex"))
  assert.equal(await fetch(`${base}${item.url}`).then((res) => res.text()), "fixture")

  await fetch(`${base}/__qa/mode?value=cross-origin`, { method: "POST" })
  const blocked = await fetch(`${base}/packages/manifest.json`).then((res) => res.json())
  assert.match(blocked.latestByTarget["win32-x64-baseline"].url, /^http:/)
  assert.match(readFileSync(log, "utf8"), /manifest\.json/)
  const runner = readFileSync(fileURLToPath(new URL("./run.ps1", import.meta.url)), "utf8")
  assert.match(runner, /extensions-中文 path/)
  assert.match(runner, /user-中文 path/)
  assert.match(runner, /Start-GuiSubject -Probe -AllowMotion/)
  assert.match(runner, /ProviderMock = Start-MockProvider/)
  assert.match(runner, /first-reload-spinner-chat-request/)
  const motion = readFileSync(fileURLToPath(new URL("./cdp-chat-motion.mjs", import.meta.url)), "utf8")
  assert.match(motion, /prefers-reduced-motion/)
  assert.match(motion, /spinner-motion-ready/)
  assert.match(motion, /spinner-pixels-change/)
} finally {
  child.kill()
  rmSync(root, { recursive: true, force: true })
}

function first(stream) {
  return new Promise((resolve, reject) => {
    let data = ""
    stream.on("data", (chunk) => {
      data += chunk
      const index = data.indexOf("\n")
      if (index < 0) return
      resolve(data.slice(0, index))
    })
    stream.on("error", reject)
    child.on("exit", (code) => reject(new Error(`更新服务提前退出：${code}`)))
  })
}
