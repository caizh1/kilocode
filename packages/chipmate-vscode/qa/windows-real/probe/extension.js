const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const vscode = require("vscode")

let controlTimer
let controlBusy = false
let controlId = ""

const required = [
  "chipmate.v2.plusButtonClicked",
  "chipmate.v2.agentManagerOpen",
  "chipmate.v2.sidebarTitle.agentTerminalOpen",
  "chipmate.v2.settingsButtonClicked",
  "chipmate.v2.openInTab",
  "chipmate.v2.showMemory",
  "chipmate.v2.documents.openArtifact",
  "chipmate.v2.documents.openArtifactFolder",
  "chipmate.v2.documents.exportDiagnostics",
  "chipmate.v2.agentTerminal.open",
  "chipmate.v2.autocomplete.generateSuggestions",
  "chipmate.v2.autocomplete.cancelSuggestions",
  "chipmate.v2.qwenAutocomplete.showLogs",
  "chipmate.v2.qwenAutocomplete.exportDiagnostics",
  "chipmate.v2.generateTerminalCommand",
  "chipmate.v2.terminalFixCommand",
]

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8")
    fs.renameSync(temporary, file)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

async function activate() {
  const out = process.env.CHIPMATE_QA_PROBE_OUT
  const control = process.env.CHIPMATE_QA_CONTROL_FILE
  const reply = process.env.CHIPMATE_QA_CONTROL_OUT
  if (!out && (!control || !reply)) return
  const result = {
    schemaVersion: 1,
    activationId: crypto.randomUUID(),
    extensionHostPid: process.pid,
    at: new Date().toISOString(),
    status: "FAIL",
    extension: {},
    commands: {},
    configuration: {},
    errors: [],
  }
  try {
    const extension = vscode.extensions.getExtension("chipmate.chipmate")
    if (!extension) throw new Error("installed chipmate.chipmate extension is not discoverable")
    await extension.activate()
    result.extension = {
      id: extension.id,
      version: extension.packageJSON.version,
      path: extension.extensionPath,
      uri: extension.extensionUri.toString(),
      uriFsPath: extension.extensionUri.fsPath,
      target: extension.packageJSON.chipmatePackageTarget ?? null,
      active: extension.isActive,
      development: extension.extensionMode === vscode.ExtensionMode.Development,
    }
    if (result.extension.development) result.errors.push("subject extension must not run in development mode")
    const expected = process.env.CHIPMATE_QA_EXPECTED_VERSION
    if (expected && result.extension.version !== expected)
      result.errors.push(`expected version ${expected}, got ${result.extension.version}`)

    const commands = new Set(await vscode.commands.getCommands(true))
    result.commands.required = Object.fromEntries(required.map((id) => [id, commands.has(id)]))
    for (const [id, present] of Object.entries(result.commands.required)) {
      if (!present) result.errors.push(`missing command ${id}`)
    }

    const config = vscode.workspace.getConfiguration()
    const keys = [
      "chipmate.v2.documents.artifacts.root",
      "chipmate.v2.documents.tools.enabled",
      "chipmate.v2.autocomplete.enabled",
      "chipmate.v2.autocomplete.provider",
      "chipmate.v2.autocomplete.qwen.model",
      "chipmate.v2.documents.wordRender.remoteEndpoint",
    ]
    result.configuration = Object.fromEntries(keys.map((key) => [key, config.get(key)]))
    const contributes = extension.packageJSON.contributes ?? {}
    const views = contributes.views?.["chipmate-v2-activitybar"] ?? []
    if (!views.some((item) => item.id === "chipmate.v2.SidebarProvider"))
      result.errors.push("missing chipmate.v2.SidebarProvider view")
    const profiles = contributes.terminal?.profiles ?? []
    if (profiles.some((item) => item.id === "chipmate.v2.agentTerminal"))
      result.errors.push("legacy chipmate.v2.agentTerminal profile must be absent")
    result.status = result.errors.length ? "FAIL" : "PASS"
  } catch (err) {
    result.errors.push(err instanceof Error ? (err.stack ?? err.message) : String(err))
  }
  if (out) {
    writeJsonAtomically(out, result)
  }
  if (control && reply && result.status === "PASS") {
    fs.mkdirSync(path.dirname(reply), { recursive: true })
    controlTimer = setInterval(async () => {
      if (controlBusy || !fs.existsSync(control)) return
      controlBusy = true
      try {
        const request = JSON.parse(fs.readFileSync(control, "utf8"))
        if (!request.id || request.id === controlId || !request.command) return
        controlId = request.id
        const response = { id: request.id, command: request.command, status: "FAIL", error: "" }
        try {
          await vscode.commands.executeCommand(request.command, ...(request.args ?? []))
          response.status = "PASS"
        } catch (err) {
          response.error = err instanceof Error ? (err.stack ?? err.message) : String(err)
        }
        writeJsonAtomically(reply, response)
      } catch (err) {
        console.error("ChipMate QA control failed", err)
      } finally {
        controlBusy = false
      }
    }, 100)
  }
  if (process.env.CHIPMATE_QA_PROBE_QUIT === "1") {
    setTimeout(() => vscode.commands.executeCommand("workbench.action.quit"), 300)
  }
}

function deactivate() {
  if (controlTimer) clearInterval(controlTimer)
}

module.exports = { activate, deactivate }
