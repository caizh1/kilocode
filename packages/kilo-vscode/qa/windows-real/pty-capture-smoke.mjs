#!/usr/bin/env node

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const index = item.indexOf("=")
    return index === -1 ? [item.replace(/^--/, ""), "true"] : [item.slice(2, index), item.slice(index + 1)]
  }),
)
if (!args.cli || !args.script || !args.root || !args.output) {
  throw new Error("--cli, --script, --root, and --output are required")
}

const port = Number(args.port ?? 42125)
const token = "0123456789abcdef0123456789abcdef"
const password = "secret"
const auth = Buffer.from(`kilo:${password}`).toString("base64")
const windows = process.platform === "win32"
const input = windows ? "Get-Location" : "pwd"
const count = Number(args.count ?? 100)
const output = []
const errors = []
mkdirSync(args.root, { recursive: true })

const child = spawn(args.cli, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: args.root,
  env: {
    ...process.env,
    KILO_DISABLE_MODELS_FETCH: "1",
    KILO_DISABLE_PROJECT_CONFIG: "1",
    KILO_CONFIG_CONTENT: '{"enabled_providers":["anthropic"]}',
    KILO_SERVER_PASSWORD: password,
  },
  windowsHide: true,
})
child.stdout.on("data", (data) => output.push(String(data)))
child.stderr.on("data", (data) => errors.push(String(data)))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const capture = (id) => `\x18\x12${Array.from(id.replaceAll("-", ""), (digit) => `\x18${digit}`).join("")}\x18\x10`

async function until(check, timeout, message) {
  const limit = Date.now() + timeout
  while (Date.now() < limit) {
    const value = await check()
    if (value) return value
    await wait(100)
  }
  throw new Error(message)
}

let socket
let pty
let transcript = ""
try {
  await until(
    async () => {
      if (child.exitCode !== null) throw new Error(`CLI exited before ready: ${child.exitCode}`)
      return fetch(`http://127.0.0.1:${port}/global/health`, {
        headers: { authorization: `Basic ${auth}` },
      }).then(
        (response) => response.ok,
        () => false,
      )
    },
    20_000,
    "CLI did not become ready",
  )
  const response = await fetch(`http://127.0.0.1:${port}/pty`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/json",
      "x-kilo-directory": args.root,
    },
    body: JSON.stringify({
      command: windows ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" : "/usr/bin/env",
      args: windows
        ? ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", args.script]
        : ["bash", "--rcfile", args.script, "-i"],
      cwd: args.root,
      title: "ChipMate PTY Capture Smoke",
      env: { KILO_AGENT_CONSOLE: "1", KILO_AGENT_CONSOLE_TOKEN: token },
    }),
  })
  if (!response.ok) throw new Error(`PTY create failed: ${response.status} ${await response.text()}`)
  pty = await response.json()
  socket = new WebSocket(
    `ws://127.0.0.1:${port}/pty/${encodeURIComponent(pty.id)}/connect?directory=${encodeURIComponent(args.root)}&cursor=-1&auth_token=${encodeURIComponent(auth)}`,
  )
  socket.binaryType = "arraybuffer"
  socket.addEventListener("message", (event) => {
    const bytes = typeof event.data === "string" ? Buffer.from(event.data) : Buffer.from(event.data)
    if (bytes[0] === 0) return
    transcript += bytes.toString("utf8")
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })
  await until(
    () => transcript.includes(`]6973;${token};prompt;`),
    10_000,
    "PowerShell integration did not request input arming",
  )
  const echoed = transcript.length
  socket.send("X")
  await until(() => transcript.slice(echoed).includes("X"), 2_000, "PTY websocket input did not echo in the Shell")
  socket.send("\x7f")
  await until(
    () => {
      socket.send("\x18\x01")
      return transcript.includes(`]6973;${token};ready;`)
    },
    5_000,
    "PowerShell input did not become ready",
  )
  socket.send(`${windows ? "Write-Output CHIPMATE_BASIC" : "printf 'CHIPMATE_BASIC\\n'"}\x18\x05`)
  await until(() => transcript.includes("CHIPMATE_BASIC"), 5_000, "PTY websocket input did not reach PowerShell")
  await until(
    () => transcript.includes(`]6973;${token};end;0;`),
    5_000,
    "PowerShell did not return to a clean prompt after basic input",
  )
  await until(
    () => {
      socket.send("\x18\x01")
      return transcript.split(`]6973;${token};ready;`).length >= 3
    },
    5_000,
    "PowerShell input did not re-arm after basic input",
  )
  const request = randomUUID()
  socket.send(`${input}${capture(request)}`)
  const marker = new RegExp(`]6973;${token};input;(${request});1;`)
  await until(() => marker.test(transcript), 5_000, "PowerShell capture marker did not arrive")
  const encoded = Buffer.from(input).toString("base64")
  const match = transcript.match(marker)
  const expected = match ? `${match[0]}${encoded}` : `${marker.source}${encoded}`
  const pass = transcript.includes(expected)
  if (!pass) throw new Error("PowerShell capture marker payload did not match the input")
  socket.send("\x18\x15")
  const agent = "[QA:TOOL-CALL] 请提出一个安全命令"
  const agentID = randomUUID()
  socket.send(`${agent}${capture(agentID)}`)
  const agentMarker = `]6973;${token};input;${agentID};0;${Buffer.from(agent).toString("base64")}`
  await until(() => transcript.includes(agentMarker), 5_000, "Agent input capture marker did not arrive")
  const ends = transcript.split(`]6973;${token};end;0;`).length
  socket.send("\x18\x19\x18\x05")
  await until(
    () => transcript.split(`]6973;${token};end;0;`).length > ends,
    5_000,
    "Agent input did not finish the current PowerShell editing cycle",
  )
  socket.send("\x18\x01")
  await until(
    () => transcript.includes(`]6973;${token};applied;${agentID};agent`),
    5_000,
    "Agent input application acknowledgement did not arrive",
  )
  const next = windows ? "Get-ChildItem" : "ls"
  const nextID = randomUUID()
  socket.send(`${next}${capture(nextID)}`)
  const nextMarker = `]6973;${token};input;${nextID};1;${Buffer.from(next).toString("base64")}`
  await until(() => transcript.includes(nextMarker), 5_000, "Capture after an Agent editing cycle did not arrive")
  socket.send("\x18\x15")
  const probe =
    "Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+p' -ScriptBlock { }; Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+q' -ScriptBlock { $Line=''; $Cursor=0; [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$Line,[ref]$Cursor); $Encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Line)); __chipmate_emit \"probe;$Encoded\" }"
  const beforeProbe = transcript.split(`]6973;${token};end;0;`).length
  socket.send(`${probe}\x18\x05`)
  await until(
    () => transcript.split(`]6973;${token};end;0;`).length > beforeProbe,
    5_000,
    "PowerShell did not install the timeout retention probe",
  )
  socket.send("\x18\x01")
  const held = "capture timeout must retain this line"
  socket.send(`${held}${capture(randomUUID())}`)
  await wait(2500)
  socket.send("\x18\x11")
  const heldMarker = `]6973;${token};probe;${Buffer.from(held).toString("base64")}`
  await until(() => transcript.includes(heldMarker), 5_000, "Timed-out capture changed the PSReadLine buffer")
  socket.send("\x18\x15")
  const restore = "Set-PSReadLineKeyHandler -Chord 'Ctrl+x,Ctrl+p' -ScriptBlock { __chipmate_request_apply }"
  const beforeRestore = transcript.split(`]6973;${token};end;0;`).length
  socket.send(`${restore}\x18\x05`)
  await until(
    () => transcript.split(`]6973;${token};end;0;`).length > beforeRestore,
    5_000,
    "PowerShell did not restore the capture handler",
  )
  socket.send("\x18\x01")
  const pattern = new RegExp(`]6973;${token};input;([0-9a-f-]{36});([01]);([^\\u0007]+)\\u0007`, "g")
  const captured = () => Array.from(transcript.matchAll(pattern))
  const initial = captured().length
  const seen = new Set()
  socket.send("\x18\x15")
  for (let index = 0; index < count; index += 1) {
    const line = `请检查提交 ${index + 1}`
    const id = randomUUID()
    socket.send(`${line}${capture(id)}`)
    await until(
      () => captured().length >= initial + index + 1,
      5_000,
      `PowerShell capture ${index + 1}/${count} did not arrive`,
    )
    const item = captured()[initial + index]
    if (!item) throw new Error(`PowerShell capture ${index + 1}/${count} was missing`)
    if (item[1] !== id) throw new Error(`PowerShell capture ${index + 1}/${count} returned the wrong request ID`)
    if (seen.has(item[1])) throw new Error(`PowerShell capture reused request ID ${item[1]}`)
    seen.add(item[1])
    if (item[2] !== "0") throw new Error(`PowerShell capture ${index + 1}/${count} was misclassified as a command`)
    if (Buffer.from(item[3], "base64").toString("utf8") !== line) {
      throw new Error(`PowerShell capture ${index + 1}/${count} changed the input`)
    }
    socket.send("\x18\x15")
  }
  await wait(500)
  const total = captured().length - initial
  if (total !== count) throw new Error(`PowerShell capture count was ${total}/${count}`)
  writeFileSync(
    args.output,
    `${JSON.stringify(
      {
        status: pass ? "PASS" : "FAIL",
        request: match?.[1],
        input,
        expected,
        retained: transcript.includes(heldMarker),
        stress: {
          expected: count,
          captured: total,
          unique: seen.size,
        },
        transcript,
        stdout: output.join(""),
        stderr: errors.join(""),
      },
      null,
      2,
    )}\n`,
  )
  if (!pass) process.exitCode = 1
} catch (error) {
  writeFileSync(
    args.output,
    `${JSON.stringify(
      {
        status: "FAIL",
        error: error instanceof Error ? error.stack : String(error),
        transcript,
        stdout: output.join(""),
        stderr: errors.join(""),
      },
      null,
      2,
    )}\n`,
  )
  process.exitCode = 1
} finally {
  socket?.close()
  if (pty?.id) {
    await fetch(
      `http://127.0.0.1:${port}/pty/${encodeURIComponent(pty.id)}?directory=${encodeURIComponent(args.root)}`,
      { method: "DELETE", headers: { authorization: `Basic ${auth}` } },
    ).catch(() => undefined)
  }
  child.kill()
  await until(() => child.exitCode !== null, 5000, "CLI did not exit").catch(() => child.kill("SIGKILL"))
}
