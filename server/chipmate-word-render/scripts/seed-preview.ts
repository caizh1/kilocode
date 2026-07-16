import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const runtime = resolve(root, ".runtime")
  const source = resolve(runtime, "source")
  const archive = resolve(
    root,
    "../../docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz",
  )

  const owned = ["source", "e2e-db", "e2e-legacy", "e2e-packages", "e2e-extensions", "e2e-results"]
  await Promise.all(owned.map((dir) => rm(resolve(runtime, dir), { recursive: true, force: true })))
  await mkdir(resolve(source, "skills"), { recursive: true })
  await copyFile(archive, resolve(source, "skills/source-backed-detail-design.tar.gz"))
  const items = [
    {
      id: "source-backed-detail-design",
      name: "Source-backed Detail Design",
      description: "基于真实源码证据生成模块详细设计，保留文件路径、行号与可审计依据。",
      category: "documents",
      tags: ["源码证据", "详细设计", "文档生成"],
      downloadCount: 12400,
    },
    {
      id: "api-contract-guardian",
      name: "API Contract Guardian",
      description: "检查接口输入、输出与兼容性边界，在交付前发现契约漂移。",
      category: "development",
      tags: ["API", "契约", "兼容性"],
      downloadCount: 10800,
      artwork: {
        type: "icon",
        url: "/assets/missing-preview-icon.png",
        mime: "image/png",
        width: 256,
        height: 256,
        sha256: "a".repeat(64),
      },
    },
    {
      id: "cpp-codebase-analysis",
      name: "C/C++ Codebase Analysis",
      description: "定位符号关系、调用链与关键状态流，辅助理解大型 C/C++ 工程。",
      category: "development",
      tags: ["C++", "调用链", "代码分析"],
      downloadCount: 9600,
    },
    {
      id: "architecture-decision-writer",
      name: "Architecture Decision Writer",
      description: "把关键技术取舍整理为可评审、可追踪的架构决策记录。",
      category: "development",
      tags: ["架构", "ADR", "评审"],
      downloadCount: 8750,
    },
    {
      id: "test-evidence-builder",
      name: "Test Evidence Builder",
      description: "汇总测试命令、结果与运行环境，形成可复核的交付证据。",
      category: "testing",
      tags: ["测试", "证据", "验收"],
      downloadCount: 7920,
    },
    {
      id: "security-review-checklist",
      name: "Security Review Checklist",
      description: "按风险等级检查权限、输入边界、凭据与发布配置。",
      category: "testing",
      tags: ["安全", "权限", "检查清单"],
      downloadCount: 7100,
    },
    {
      id: "mermaid-system-mapper",
      name: "Mermaid System Mapper",
      description: "将模块、依赖和运行时交互转换为清晰的 Mermaid 系统图。",
      category: "development",
      tags: ["Mermaid", "系统图", "依赖"],
      downloadCount: 6450,
    },
    {
      id: "migration-plan-auditor",
      name: "Migration Plan Auditor",
      description: "复核迁移阶段、门禁、回滚路径与未决风险，避免计划跳步。",
      category: "testing",
      tags: ["迁移", "门禁", "审计"],
      downloadCount: 5780,
    },
    {
      id: "release-notes-composer",
      name: "Release Notes Composer",
      description: "从用户可见变化中生成简洁、准确且可发布的版本说明。",
      category: "operations",
      tags: ["发布", "版本说明", "交付"],
      downloadCount: 4930,
    },
    {
      id: "repository-onboarding-guide",
      name: "Repository Onboarding Guide",
      description: "整理仓库结构、开发命令与常见边界，帮助新成员快速进入项目。",
      category: "operations",
      tags: ["仓库", "入门", "开发指南"],
      downloadCount: 4210,
    },
  ].map((item, index) => ({
    ...item,
    author: "ChipMate",
    content: "skills/source-backed-detail-design.tar.gz",
    version: "1.0.0",
    updatedAt: new Date(Date.UTC(2026, 6, 12, 0, 10 - index)).toISOString(),
  }))
  await writeFile(
    resolve(source, "skills.json"),
    `${JSON.stringify(
      {
        items,
      },
      null,
      2,
    )}\n`,
  )

  const drop = resolve(runtime, "e2e-extensions/drop")
  await mkdir(drop, { recursive: true })
  const extensions = [
    { publisher: "chipmate", name: "chipmate", displayName: "ChipMate", version: "0.0.67", target: "win32-x64", category: "Other", note: "团队 AI 编程助手" },
    { publisher: "ramaxel", name: "cpp-hybrid", displayName: "C/C++ Hybrid Retrieval", version: "2.4.0-beta.2", target: "linux-x64", category: "Programming Languages", note: "Graph + BM25 构建 A" },
    { publisher: "ramaxel", name: "cpp-hybrid", displayName: "C/C++ Hybrid Retrieval", version: "2.4.0-beta.2", target: "linux-x64", category: "Programming Languages", note: "Graph + BM25 构建 B" },
    { publisher: "ramaxel", name: "cpp-hybrid", displayName: "C/C++ Hybrid Retrieval", version: "2.3.0", target: "universal", category: "Programming Languages", note: "通用稳定版" },
    { publisher: "ramaxel", name: "rag-explorer", displayName: "RAG Index Explorer", version: "1.5.1", target: "universal", category: "Other", note: "查看索引与召回证据" },
    { publisher: "ramaxel", name: "mermaid-preview", displayName: "Mermaid Preview", version: "1.2.0", target: "darwin-arm64", category: "Other", note: "离线 Mermaid 预览" },
    { publisher: "ramaxel", name: "api-guardian", displayName: "API Contract Guardian", version: "3.0.0", target: "universal", category: "Linters", note: "接口契约漂移检查" },
  ]
  for (const [index, item] of extensions.entries()) {
    const zip = new JSZip()
    zip.file(
      "extension/package.json",
      JSON.stringify({
        publisher: item.publisher,
        name: item.name,
        displayName: item.displayName,
        description: item.note,
        version: item.version,
        engines: { vscode: "^1.95.0" },
        categories: [item.category],
        keywords: ["ChipMate", "VSIX", item.target],
      }),
    )
    zip.file(
      "extension.vsixmanifest",
      `<PackageManifest><Metadata><Identity Id="${item.name}" Publisher="${item.publisher}" Version="${item.version}" TargetPlatform="${item.target}" /></Metadata></PackageManifest>`,
    )
    zip.file("extension/README.md", `# ${item.displayName}\n\n${item.note}\n\n预览构建 ${index + 1}。`)
    const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
    await writeFile(resolve(drop, `${item.publisher}-${item.name}-${item.version}-${item.target}-${index + 1}.vsix`), data)
  }

  console.log(`Preview market seeded at ${source}; extension VSIX files seeded at ${drop}`)
}

void main()
