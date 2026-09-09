import { describe, expect, test } from "bun:test"
import { join } from "node:path"

describe("文档优先联建的真实引擎故障矩阵", () => {
  test.each([
    "正常",
    "部分失败",
    "全部失败",
    "创建失败",
    "初始化失败",
    "写入失败",
    "共享服务失败",
    "关闭",
    "空目录",
    "worktree 等待",
  ])(
    "%s无需额外操作即可继续代码阶段",
    async (scenario) => {
      // 隔离原生数据库与故障注入，运行真实管理器、文档服务和代码扫描。
      const script = `
        import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
        import { tmpdir } from "node:os"
        import { join } from "node:path"
        import { CodeIndexManager } from "./src/indexing/manager.ts"
        import { CodeIndexOrchestrator } from "./src/indexing/orchestrator.ts"
        import { CodeIndexServiceFactory } from "./src/indexing/service-factory.ts"
        import { DocumentIndexService } from "./src/indexing/documents/service.ts"
        import { normalizeIndexingStatus } from "./src/status.ts"
        const scenario = ${JSON.stringify(scenario)}
        const root = await mkdtemp(join(tmpdir(), "联建故障验收-"))
        const workspace = join(root, "项目")
        await mkdir(join(workspace, "文档"), { recursive: true })
        await writeFile(join(workspace, "types.ts"), await readFile("./src/indexing/documents/types.ts"))
        await writeFile(join(workspace, "固件.c"), "// 固件请求处理的固定验收样本\\nint validate(int value) { return value > 0; }\\nint handle(int value) { if (!validate(value)) return -1; return value * 2; }\\n")
        if (!["全部失败", "空目录"].includes(scenario)) {
          await writeFile(join(workspace, "文档", "说明.md"), "索引调度先处理文档，再建立代码图谱和代码向量索引。")
        }
        if (["部分失败", "全部失败"].includes(scenario)) {
          await writeFile(join(workspace, "文档", "损坏.docx"), "这不是有效的文档压缩包")
        }
        const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
          if (scenario === "共享服务失败") return Response.json({ error: { message: "固定故障样本" } }, { status: 401 })
          const body = await request.json()
          const texts = Array.isArray(body.input) ? body.input : [body.input]
          return Response.json({ data: texts.map((_, index) => ({ index, embedding: [0.1, 0.2, 0.3] })), usage: { total_tokens: texts.length } })
        } })
        const factory = CodeIndexServiceFactory.prototype
        if (scenario === "创建失败") factory.createDocumentService = () => { throw new Error("文档创建固定故障") }
        if (["初始化失败", "写入失败"].includes(scenario)) {
          const original = factory.createDocumentVectorStore
          factory.createDocumentVectorStore = function(...args) {
            const store = original.apply(this, args)
            store[scenario === "初始化失败" ? "initialize" : "upsertPoints"] = async () => { throw new Error("文档存储固定故障") }
            return store
          }
        }
        let documentActive = false
        let documents = 0
        const start = DocumentIndexService.prototype.start
        DocumentIndexService.prototype.start = async function(...args) {
          documentActive = true
          documents += 1
          try { return await start.apply(this, args) } finally { documentActive = false }
        }
        let codes = 0
        const scan = CodeIndexOrchestrator.prototype.startIndexing
        CodeIndexOrchestrator.prototype.startIndexing = function(...args) {
          if (documentActive) throw new Error("代码在文档批次结束前启动")
          codes += 1
          return scan.apply(this, args)
        }
        const manager = new CodeIndexManager(workspace, join(root, "缓存"), scenario === "worktree 等待" ? join(root, "主工作区") : undefined)
        try {
          await manager.initialize({ enabled: true, embedderProvider: "openai-compatible", vectorStoreProvider: "lancedb",
            openAiCompatibleBaseUrl: "http://127.0.0.1:" + server.port + "/v1", modelId: "fixture-model", modelDimension: 3,
            documents: { enabled: scenario !== "关闭", paths: ["文档"] },
          })
          await manager._batch?.task
          const result = normalizeIndexingStatus(manager)
          if (codes !== 1) throw new Error("代码启动次数错误：" + codes)
          if (result.pipelines.codeGraph.state !== "Complete") throw new Error("代码图谱未完成：" + JSON.stringify(result))
          if (result.pipelines.codeGraph.validFileCount < 1) throw new Error("图谱未覆盖固定 C 样本")
          if (!["共享服务失败", "worktree 等待"].includes(scenario) && result.pipelines.rag.state !== "Complete") throw new Error("代码向量未完成：" + JSON.stringify(result))
          if (scenario === "worktree 等待" && (result.pipelines.rag.state !== "Standby" || result.pipelines.documents.state !== "Complete")) throw new Error("基线等待错误阻塞文档：" + JSON.stringify(result))
          if (["部分失败", "全部失败", "创建失败", "初始化失败", "写入失败", "共享服务失败"].includes(scenario) && result.pipelines.documents.errorCount === 0) {
            throw new Error("文档错误丢失：" + JSON.stringify(result))
          }
          console.log("验收通过：" + scenario + "；代码启动=" + codes + "；文档批次=" + documents)
        } finally {
          await manager.dispose()
          server.stop(true)
          await rm(root, { recursive: true, force: true })
        }
      `
      const child = Bun.spawn([process.execPath, "-e", script], {
        cwd: join(import.meta.dir, "../../.."),
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      })
      const timer = setTimeout(() => child.kill(), 25_000)
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        if (code !== 0) throw new Error(`${scenario}验收失败：\n${stdout}\n${stderr}`)
        expect(stdout).toContain(`验收通过：${scenario}`)
      } finally {
        clearTimeout(timer)
        if (child.exitCode === null) child.kill()
      }
    },
    30_000,
  )
})
