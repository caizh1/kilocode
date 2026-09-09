import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { runPatentCenterAction, testPatentServer } from "../../src/services/patent-center"
import {
  normalizePatentServerBaseUrl,
  validPatentRadarSetting,
} from "../../src/shared/patent-center"

describe("专利中心设置", () => {
  it("允许内网 HTTP 和 HTTPS", () => {
    expect(normalizePatentServerBaseUrl("https://patent.example.test:6020/")).toBe(
      "https://patent.example.test:6020",
    )
    expect(normalizePatentServerBaseUrl("http://127.0.0.1:6020")).toBe("http://127.0.0.1:6020")
    expect(normalizePatentServerBaseUrl("http://patent.example.test:6020")).toBe("http://patent.example.test:6020")
    expect(() => normalizePatentServerBaseUrl("ftp://patent.example.test:6020")).toThrow("只允许使用 HTTP 或 HTTPS")
    expect(() => normalizePatentServerBaseUrl("https://user:secret@patent.example.test:6020")).toThrow(
      "不能包含账号或密码",
    )
    expect(() => normalizePatentServerBaseUrl("https://patent.example.test:6020/api/v1")).toThrow("不能包含 API 路径")
  })

  it("只接受完整的 Provider 模型选择", () => {
    expect(validPatentRadarSetting("analysisModel", { providerID: "chipmate", modelID: "deepseek-v4-flash" })).toBeTrue()
    expect(validPatentRadarSetting("analysisModel", null)).toBeTrue()
    expect(validPatentRadarSetting("analysisModel", { providerID: "chipmate", modelID: "" })).toBeFalse()
    expect(validPatentRadarSetting("analysisModel", { providerID: "chipmate", modelID: "model", host: "extra" })).toBeFalse()
  })

  it("拒绝未知字段和越界扫描周期", () => {
    expect(validPatentRadarSetting("enabled", true)).toBeTrue()
    expect(validPatentRadarSetting("serverBaseUrl", "")).toBeTrue()
    expect(validPatentRadarSetting("scheduleDays", 7)).toBeTrue()
    expect(validPatentRadarSetting("scheduleDays", 0)).toBeFalse()
    expect(validPatentRadarSetting("scheduleDays", 366)).toBeFalse()
    expect(validPatentRadarSetting("unknown", true)).toBeFalse()
  })

  it("扫描动作把设置页当前模型显式传给命令", async () => {
    const original = vscode.commands.executeCommand
    const calls: unknown[][] = []
    ;(vscode.commands as unknown as { executeCommand: (...args: unknown[]) => Promise<void> }).executeCommand = async (
      ...args
    ) => {
      calls.push(args)
    }
    try {
      const result = await runPatentCenterAction("scan", { providerID: "chipmate", modelID: "deepseek-v4-flash" })
      expect(calls).toEqual([
        [
          "chipmate.v2.patentRadar.scan",
          { analysisModel: { providerID: "chipmate", modelID: "deepseek-v4-flash" } },
        ],
      ])
      expect(result).toEqual({ run: null, cancelled: false })
    } finally {
      ;(vscode.commands as unknown as { executeCommand: typeof original }).executeCommand = original
    }
  })

  it("模块扫描从专利中心进入同一模型选择和模块范围流程", async () => {
    const original = vscode.commands.executeCommand
    const calls: unknown[][] = []
    ;(vscode.commands as unknown as { executeCommand: (...args: unknown[]) => Promise<void> }).executeCommand = async (
      ...args
    ) => {
      calls.push(args)
    }
    try {
      const result = await runPatentCenterAction("scanModule", { providerID: "chipmate", modelID: "deepseek-v4-flash" })
      expect(calls).toEqual([
        [
          "chipmate.v2.patentRadar.scanModule",
          { analysisModel: { providerID: "chipmate", modelID: "deepseek-v4-flash" } },
        ],
      ])
      expect(result).toEqual({ run: null, cancelled: true })
    } finally {
      ;(vscode.commands as unknown as { executeCommand: typeof original }).executeCommand = original
    }
  })

  it("没有已连接 Provider 模型时不启动扫描", async () => {
    const originalCommand = vscode.commands.executeCommand
    const originalError = vscode.window.showErrorMessage
    let called = false
    let message = ""
    ;(vscode.commands as unknown as { executeCommand: (...args: unknown[]) => Promise<void> }).executeCommand = async () => {
      called = true
    }
    ;(vscode.window as unknown as { showErrorMessage: (value: string) => Promise<void> }).showErrorMessage = async (
      value,
    ) => {
      message = value
    }
    try {
      const result = await runPatentCenterAction("scan")
      expect(called).toBeFalse()
      expect(message).toContain("请先连接 Provider")
      expect(result.error).toContain("请先连接 Provider")
    } finally {
      ;(vscode.commands as unknown as { executeCommand: typeof originalCommand }).executeCommand = originalCommand
      ;(vscode.window as unknown as { showErrorMessage: typeof originalError }).showErrorMessage = originalError
    }
  })

  it("连接测试同时校验服务身份和语料水位", async () => {
    const calls: string[] = []
    const load = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith("/health")) return json({ ok: true, service: "chipmate-patent-server" })
      return json({
        service: "chipmate-patent-server",
        state: "READY",
        generation: "generation-7",
        publishedAt: "2026-08-27T00:00:00.000Z",
        vectorCoverage: 0.96,
        quarantinedBatches: 0,
        warnings: [],
        jurisdictions: ["CN", "JP", "KR", "US", "EP", "RU"].map((jurisdiction) => ({
          jurisdiction,
          documents: 100,
          historicalBaseline: true,
          coverageThrough: "2026-08-26",
        })),
      })
    }) as typeof fetch

    const result = await testPatentServer("https://patent.example.test:6020", 5000, load)

    expect(result.status).toBe("success")
    expect(result.corpus).toMatchObject({
      state: "READY",
      documents: 600,
      readyJurisdictions: 6,
      totalJurisdictions: 6,
      vectorCoverage: 0.96,
    })
    expect(calls).toEqual([
      "https://patent.example.test:6020/health",
      "https://patent.example.test:6020/api/v1/corpus/status",
    ])
  })

  it("语料未就绪时关闭成功状态", async () => {
    const load = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/health")) return json({ ok: true, service: "chipmate-patent-server" })
      return json({
        service: "chipmate-patent-server",
        state: "DEGRADED",
        generation: "generation-8",
        publishedAt: null,
        vectorCoverage: 0.4,
        quarantinedBatches: 1,
        warnings: ["CN 尚未声明并导入完整历史基线。"],
        jurisdictions: [{ jurisdiction: "CN", documents: 10, historicalBaseline: false, coverageThrough: null }],
      })
    }) as typeof fetch

    const result = await testPatentServer("https://patent.example.test:6020", 5000, load)

    expect(result).toMatchObject({ status: "warning", code: "not-ready", corpus: { state: "DEGRADED" } })
  })
})

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
}
