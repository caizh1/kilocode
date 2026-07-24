/* global Buffer, console, fetch, process */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { extractPlantUmlMetadata } = require("../server.js")
const origin = process.env.CHIPMATE_SERVER_ORIGIN || "http://127.0.0.1:6001"

async function post(source, timeoutMs = 60_000) {
  const response = await fetch(`${origin}/render/plantuml`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, timeoutMs }),
  })
  return response.json()
}

const classSource = "@startuml\nclass Controller\nController --> Service\n@enduml"
const sequenceSource = "@startuml\n张三 -> 系统: 认证请求\n系统 --> 张三: 成功\n@enduml"
const health = await fetch(`${origin}/health`).then((response) => response.json())
const rendered = await post(classSource)
const sequence = await post(sequenceSource)
const invalid = await post('@startuml\nnote "unterminated\n@enduml')
const multiple = await post(`${classSource}\n${classSource}`)
const oversized = await post(`@startuml\nnote "${"x".repeat(132_000)}"\n@enduml`)
const sandbox = await post("@startuml\n!include /etc/passwd\nAlice -> Bob\n@enduml")

assert.equal(typeof health.tools?.java, "string")
assert.match(health.tools?.graphviz || "", /graphviz version/i)
assert.equal(typeof health.tools?.plantuml, "string")
for (const [name, value] of [
  ["class", rendered],
  ["sequence", sequence],
]) {
  assert.equal(value.ok, true, `${name} render failed: ${JSON.stringify(value)}`)
  assert.equal(value.metadata?.verified, true, `${name} metadata was not verified`)
}
for (const [name, value] of [
  ["invalid", invalid],
  ["multiple", multiple],
  ["oversized", oversized],
  ["sandbox", sandbox],
]) {
  assert.equal(value.ok, false, `${name} unexpectedly rendered`)
}

const png = Buffer.from(rendered.png.base64, "base64")
const saved = Buffer.from(`data:image/png;base64,${rendered.png.base64}`.split(",", 2)[1], "base64")
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
assert.equal(digest(saved), digest(png))
const metadata = extractPlantUmlMetadata(saved, 128 * 1024)
assert.equal(metadata?.source, classSource)

console.log(
  JSON.stringify(
    {
      health: {
        available: health.capabilities.plantuml.available,
        java: Boolean(health.tools.java),
        graphviz: Boolean(health.tools.graphviz),
        version: health.tools.plantuml,
      },
      class: {
        width: rendered.width,
        height: rendered.height,
        bytes: png.length,
        sha256: digest(png),
        source: metadata.source,
      },
      sequence: {
        width: sequence.width,
        height: sequence.height,
        verified: sequence.metadata.verified,
      },
      failures: Object.fromEntries(
        [
          ["invalid", invalid],
          ["multiple", multiple],
          ["oversized", oversized],
          ["sandbox", sandbox],
        ].map(([name, value]) => [name, value.issues?.[0]?.code]),
      ),
    },
    null,
    2,
  ),
)
