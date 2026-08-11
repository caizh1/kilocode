const fs = require("node:fs")
const path = require("node:path")
const vscode = require("vscode")

let timer
let nonce = ""

async function activate() {
  const root = process.env.CHIPMATE_LOW_END_PROBE_ROOT
  if (!root) return
  fs.mkdirSync(root, { recursive: true })
  const ready = path.join(root, "ready.json")
  const control = path.join(root, "control.json")
  const response = path.join(root, "response.json")
  const started = Number(process.env.CHIPMATE_LOW_END_STARTED_AT ?? Date.now())
  const begin = performance.now()
  const subject = vscode.extensions.getExtension("chipmate.chipmate")
  const result = {
    at: new Date().toISOString(),
    status: "FAIL",
    activationMs: 0,
    coldStartMs: Date.now() - started,
    errors: [],
  }
  if (!subject) {
    result.errors.push("installed chipmate.chipmate extension is not discoverable")
    fs.writeFileSync(ready, `${JSON.stringify(result, null, 2)}\n`)
    return
  }
  await subject
    .activate()
    .catch((error) => result.errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error)))
  result.activationMs = performance.now() - begin
  result.coldStartMs = Date.now() - started
  result.extension = {
    id: subject.id,
    version: subject.packageJSON.version,
    path: subject.extensionPath,
    active: subject.isActive,
    development: subject.extensionMode === vscode.ExtensionMode.Development,
  }
  if (result.extension.development) result.errors.push("subject extension must be installed, not development mode")
  result.status = result.errors.length ? "FAIL" : "PASS"
  fs.writeFileSync(ready, `${JSON.stringify(result, null, 2)}\n`)
  timer = setInterval(async () => {
    const input = read(control)
    if (!input || input.nonce === nonce) return
    nonce = input.nonce
    const startedAt = performance.now()
    const payload = { nonce, action: input.action, status: "PASS", durationMs: 0, error: null }
    try {
      if (input.action === "openSettings") {
        await vscode.commands.executeCommand("workbench.view.extension.chipmate-v2-activitybar")
        await vscode.commands.executeCommand("chipmate.v2.settingsButtonClicked")
      } else if (input.action === "openAgentManager") {
        await vscode.commands.executeCommand("chipmate.v2.agentManagerOpen")
      } else if (input.action === "quit") {
        clearInterval(timer)
        payload.durationMs = performance.now() - startedAt
        fs.writeFileSync(response, `${JSON.stringify(payload, null, 2)}\n`)
        setTimeout(() => void vscode.commands.executeCommand("workbench.action.closeWindow"), 0)
        return
      } else {
        throw new Error(`unsupported probe action: ${input.action}`)
      }
    } catch (error) {
      payload.status = "FAIL"
      payload.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
    }
    payload.durationMs = performance.now() - startedAt
    fs.writeFileSync(response, `${JSON.stringify(payload, null, 2)}\n`)
  }, 100)
}

function read(file) {
  if (!fs.existsSync(file)) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (error) {
    console.error("[ChipMate New] low-end probe control read failed", error)
    return undefined
  }
}

function deactivate() {
  if (timer) clearInterval(timer)
}

module.exports = { activate, deactivate }
