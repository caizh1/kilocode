// 真实传输故障夹具。由父测试在无代理的隔离进程中运行，不修改用户网络设置。
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:https"
import * as Log from "@opencode-ai/core/util/log"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { RequestTrace, requestErrorMetadata } from "../../../src/chipmate/provider/request-diagnostics"
import { ChipMateSessionProcessor } from "../../../src/chipmate/session/processor"
import { SessionRetry } from "../../../src/session/retry"

await Log.init({ print: false })
async function failure(url: string) {
  const trace = new RequestTrace({ sessionID: "传输验收", providerID: "test", modelID: "test" })
  try {
    await trace.transport(fetch, url)
  } catch (error) {
    const parsed = ChipMateSessionProcessor.parseError(error, {
      providerID: ProviderV2.ID.make("test"),
      aborted: false,
    })
    return { 诊断: requestErrorMetadata(error), 错误: parsed, 可重试: Boolean(SessionRetry.retryable(parsed)) }
  }
  throw new Error("故障接口不应成功返回")
}
const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("端口分配") })
const url = probe.url.toString()
await probe.stop(true)
const refused = await failure(url)
const directory = await mkdtemp(join(tmpdir(), "chipmate-cert-test-"))
try {
  const key = join(directory, "验收私钥.pem")
  const cert = join(directory, "验收证书.pem")
  const generated = Bun.spawnSync(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdout: "ignore", stderr: "ignore" },
  )
  if (generated.exitCode !== 0) throw new Error("无法生成本地验收证书")
  const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (_req, res) =>
    res.end("不应到达"),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("无法取得证书验收端口")
    const certificate = await failure(`https://127.0.0.1:${address.port}`)
    console.log(JSON.stringify({ 拒绝: refused, 证书: certificate }))
  } finally {
    server.closeAllConnections()
    server.close()
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
