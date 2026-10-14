import * as vscode from "vscode"
import { sanitize } from "@opencode-ai/core/chipmate/diagnostics/redact"
import type { ModelFetchDiagnostic } from "../../shared/fetch-models-diagnostics"
import { diagnostic, diagnosticStore } from "./record"

/** 同一份脱敏数据写入扩展输出和诊断包，以请求编号关联远程环境中的失败。 */
export function providerModelsDiagnostic(requestId: string, providerID: unknown, baseURL: string, directory?: string) {
  try {
    return createDiagnostic(requestId, providerID, baseURL, directory)
  } catch {
    console.warn("[ChipMate New] 模型列表诊断初始化失败，原请求继续处理")
    return {}
  }
}

function createDiagnostic(requestId: string, providerID: unknown, baseURL: string, directory?: string) {
  const salt = diagnosticStore()?.context.salt
  const target = URL.canParse(baseURL) ? new URL(baseURL) : undefined
  const http = vscode.workspace.getConfiguration("http")
  const environment = {
    requestId,
    providerID: typeof providerID === "string" ? providerID : undefined,
    hostname: target?.hostname,
    port: target ? Number(target.port || (target.protocol === "https:" ? 443 : 80)) : undefined,
    platform: process.platform,
    arch: process.arch,
    remoteName: vscode.env.remoteName ?? "local",
    vscodeVersion: vscode.version,
    extensionVersion: vscode.extensions.getExtension("chipmate.chipmate")?.packageJSON.version,
    version: process.versions.node,
    hasProxy: Boolean(
      http.get("proxy") ||
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy,
    ),
    strictSSL: http.get("proxyStrictSSL", true),
    extraCaConfigured: Boolean(
      vscode.workspace.getConfiguration("chipmate.v2").get("extraCaCerts") || process.env.NODE_EXTRA_CA_CERTS,
    ),
  }
  return {
    salt,
    diagnostic(event: ModelFetchDiagnostic) {
      const data = sanitize({
        ...environment,
        ...event,
        diagnostics: [
          { stage: "VS Code 代理", state: http.get("proxySupport", "unknown"), enabled: http.get("systemCertificates", true) },
          { stage: "扩展宿主证书", extraCaConfigured: Boolean(process.env.NODE_EXTRA_CA_CERTS), strictSSL: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" },
          { stage: "CLI 额外证书配置", extraCaConfigured: Boolean(vscode.workspace.getConfiguration("chipmate.v2").get("extraCaCerts")) },
        ],
      }, salt)
      const name = `提供商模型列表${event.phase}`
      diagnostic(
        name,
        { ...(data as Record<string, unknown>), directory },
        event.phase === "失败" ? "ERROR" : "INFO",
        "provider.models",
      )
      const write = event.phase === "失败" ? console.error : console.log
      write(`[ChipMate New] ${name}`, JSON.stringify(data))
    },
  }
}
