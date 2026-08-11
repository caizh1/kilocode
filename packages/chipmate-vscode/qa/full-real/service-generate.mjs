#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))

const groups = {
  health: [
    ["SVC-HEALTH-01", "GET /health 返回 ChipMate 服务身份与 ok=true", "anonymous", "GET", "/health", "none"],
    ["SVC-HEALTH-02", "health 报告 Chromium、Mermaid、LibreOffice 与 Poppler 工具", "anonymous", "GET", "/health", "none"],
    ["SVC-HEALTH-03", "GET /api/v1/capabilities 返回 aligned-v1 能力", "anonymous", "GET", "/api/v1/capabilities", "none"],
    ["SVC-HEALTH-04", "GET /api/v1/status 返回可判定服务状态", "anonymous", "GET", "/api/v1/status", "none"],
    ["SVC-HEALTH-05", "真实 Chrome 根页面完成加载且控制台无致命错误", "anonymous", "GET", "/", "none"],
    ["SVC-HEALTH-06", "市场 SSE 首次连接返回状态事件", "anonymous", "GET", "/api/v1/market/stream", "none"],
    ["SVC-HEALTH-07", "SSE 使用 Last-Event-ID 重连后补偿目录版本", "anonymous", "GET", "/api/v1/market/stream", "none"],
    ["SVC-HEALTH-08", "legacy 与 aligned 状态中的目录版本相容", "anonymous", "GET", "/marketplace/manifest.json", "none"],
  ],
  packages: [
    ["SVC-PACKAGE-01", "更新 manifest 使用 schema v2", "anonymous", "GET", "/packages/manifest.json", "none"],
    ["SVC-PACKAGE-02", "manifest 包含 darwin-arm64 与 win32-x64-baseline 目标", "anonymous", "GET", "/packages/manifest.json", "none"],
    ["SVC-PACKAGE-03", "0.0.88 条目的 SHA-256 与冻结 VSIX 一致", "anonymous", "GET", "/packages/manifest.json", "none"],
    ["SVC-PACKAGE-04", "包下载 URL 与 ChipMate Server 同源", "anonymous", "GET", "/packages/manifest.json", "none"],
    ["SVC-PACKAGE-05", "完整下载响应大小和 SHA-256 与 manifest 一致", "anonymous", "GET", "/packages/<file>", "download"],
    ["SVC-PACKAGE-06", "不兼容 target 不出现在当前平台更新候选中", "anonymous", "GET", "/packages/manifest.json", "none"],
  ],
  auth: [
    ["SVC-AUTH-01", "匿名用户可以浏览公开市场", "anonymous", "GET", "/api/v1/skills", "none"],
    ["SVC-AUTH-02", "owner QA Key 创建 Web Session", "owner", "POST", "/api/v1/auth/session", "session"],
    ["SVC-AUTH-03", "owner Session 的 /auth/me 返回 owner 身份", "owner", "GET", "/api/v1/auth/me", "none"],
    ["SVC-AUTH-04", "non-owner QA Key 创建独立 Web Session", "non-owner", "POST", "/api/v1/auth/session", "session"],
    ["SVC-AUTH-05", "错误 QA Key 被拒绝且不创建 Session", "invalid", "POST", "/api/v1/auth/session", "none"],
    ["SVC-AUTH-06", "缺失或错误 CSRF 的写请求被拒绝", "owner", "PUT", "/api/v1/favorites/<id>", "none"],
    ["SVC-AUTH-07", "退出登录后旧 Session 不再可用", "owner", "DELETE", "/api/v1/auth/session", "session"],
    ["SVC-AUTH-08", "认证与服务日志不包含 QA Key", "owner", "GET", "server-log", "none"],
  ],
  skills: [
    ["SVC-SKILL-01", "Skill 首页显示远端目录", "anonymous", "GET", "/skills", "none"],
    ["SVC-SKILL-02", "搜索只返回匹配 Skill", "anonymous", "GET", "/api/v1/skills?q=<query>", "none"],
    ["SVC-SKILL-03", "分类、排序和游标分页可组合使用", "anonymous", "GET", "/api/v1/skills", "none"],
    ["SVC-SKILL-04", "Skill 详情显示作者、版本和风险状态", "anonymous", "GET", "/api/v1/skills/<id>", "none"],
    ["SVC-SKILL-05", "release 列表与不可变 revision 详情一致", "anonymous", "GET", "/api/v1/skills/<id>/releases", "none"],
    ["SVC-SKILL-06", "文件列表和单文件内容与发布快照一致", "anonymous", "GET", "/api/v1/skills/<id>/files", "none"],
    ["SVC-SKILL-07", "Skill 归档下载成功并记录下载", "anonymous", "GET", "/marketplace/skills/<id>.tar.gz", "download"],
    ["SVC-SKILL-08", "owner 收藏后个人收藏列表立即更新", "owner", "PUT", "/api/v1/favorites/<id>", "favorite"],
    ["SVC-SKILL-09", "取消收藏后个人收藏列表恢复", "owner", "DELETE", "/api/v1/favorites/<id>", "favorite"],
    ["SVC-SKILL-10", "安装 intent 由 Web Session 创建", "owner", "POST", "/api/v1/skills/<id>/install-intents", "intent"],
    ["SVC-SKILL-11", "安装 intent 由同一 owner Bearer 身份消费", "owner", "POST", "/api/v1/install-intents/<token>/consume", "installation"],
    ["SVC-SKILL-12", "相同 intent 重放被拒绝", "owner", "POST", "/api/v1/install-intents/<token>/consume", "none"],
    ["SVC-SKILL-13", "发布安全 qa-e2e Skill 产生 validation run", "owner", "POST", "/api/v1/publications", "publication"],
    ["SVC-SKILL-14", "确定性修复以 patch 形式显示且原始夹具不被改写", "owner", "POST", "/api/v1/publications/<runId>/patches", "publication"],
    ["SVC-SKILL-15", "应用确认后生成不可变 revision", "owner", "POST", "/api/v1/publications/<runId>/apply", "publication"],
    ["SVC-SKILL-16", "相同幂等输入不会生成重复 revision", "owner", "POST", "/api/v1/publications", "publication"],
    ["SVC-SKILL-17", "non-owner 不能下架 owner Skill", "non-owner", "POST", "/api/v1/skills/<id>/unpublish", "none"],
    ["SVC-SKILL-18", "owner 可以下架测试 Skill 且历史 revision 保留", "owner", "POST", "/api/v1/skills/<id>/unpublish", "publication"],
    ["SVC-SKILL-19", "撤销发布恢复发布前状态", "owner", "POST", "/api/v1/publications/<runId>/undo", "publication"],
    ["SVC-SKILL-20", "个人发布页只显示当前 owner 的记录", "owner", "GET", "/api/v1/me/publications", "none"],
  ],
  extensions: [
    ["SVC-EXT-01", "Extension Market 首页显示远端目录", "anonymous", "GET", "/extensions", "none"],
    ["SVC-EXT-02", "扩展搜索、平台与排序筛选可组合使用", "anonymous", "GET", "/api/v1/extensions", "none"],
    ["SVC-EXT-03", "扩展详情显示版本、target、SHA 和大小", "anonymous", "GET", "/api/v1/extensions/<id>", "none"],
    ["SVC-EXT-04", "扩展完整下载成功且拒绝 Range", "anonymous", "GET", "/api/v1/extensions/<id>/artifacts/<artifactId>/download", "download"],
    ["SVC-EXT-05", "owner 收藏扩展后个人列表更新", "owner", "PUT", "/api/v1/extension-favorites/<id>", "favorite"],
    ["SVC-EXT-06", "取消扩展收藏后个人列表恢复", "owner", "DELETE", "/api/v1/extension-favorites/<id>", "favorite"],
    ["SVC-EXT-07", "owner 创建扩展评价", "owner", "PUT", "/api/v1/extensions/<id>/review", "review"],
    ["SVC-EXT-08", "owner 修改同一扩展评价", "owner", "PUT", "/api/v1/extensions/<id>/review", "review"],
    ["SVC-EXT-09", "owner 删除自己的扩展评价", "owner", "DELETE", "/api/v1/extensions/<id>/review", "review"],
    ["SVC-EXT-10", "单个安全测试 VSIX 流式上传并发布", "owner", "POST", "/api/v1/extension-publications", "artifact"],
    ["SVC-EXT-11", "多文件、文件夹、ZIP 与 TAR.GZ 只提取 VSIX", "owner", "POST", "/api/v1/extension-publications", "artifact"],
    ["SVC-EXT-12", "批量上传按最多 20 个逻辑批次串行执行", "owner", "POST", "/api/v1/extension-publications", "artifact"],
    ["SVC-EXT-13", "取消上传后不再开始新 artifact", "owner", "POST", "/api/v1/extension-publications", "artifact"],
    ["SVC-EXT-14", "认证恢复后只续传未完成 artifact", "owner", "POST", "/api/v1/extension-publications", "artifact"],
    ["SVC-EXT-15", "个人上传、收藏、评价和发布列表相互一致", "owner", "GET", "/api/v1/me/extensions/uploads", "none"],
    ["SVC-EXT-16", "non-owner 不能删除 owner artifact", "non-owner", "DELETE", "/api/v1/extension-artifacts/<artifactId>", "none"],
    ["SVC-EXT-17", "owner 删除自有 qa-e2e artifact 后目录不再返回", "owner", "DELETE", "/api/v1/extension-artifacts/<artifactId>", "artifact"],
    ["SVC-EXT-18", "扩展市场匿名聚合分析不泄露身份", "anonymous", "GET", "/api/v1/analytics/extensions/overview", "none"],
  ],
  render: [
    ["SVC-RENDER-01", "合法 Mermaid 返回 PNG、width 与 height", "anonymous", "POST", "/render/mermaid", "render"],
    ["SVC-RENDER-02", "Mermaid PNG 裁剪边界不丢失节点", "anonymous", "POST", "/render/mermaid", "render"],
    ["SVC-RENDER-03", "非法 Mermaid 返回可判定错误且服务保持健康", "anonymous", "POST", "/render/mermaid", "none"],
    ["SVC-RENDER-04", "超限 Mermaid 源码在渲染前被拒绝", "anonymous", "POST", "/render/mermaid", "none"],
    ["SVC-RENDER-05", "真实 DOCX 返回 PDF 和逐页 PNG", "anonymous", "POST", "/render/word", "render"],
    ["SVC-RENDER-06", "Word 响应报告字段刷新和目录计数", "anonymous", "POST", "/render/word", "render"],
    ["SVC-RENDER-07", "刷新验证成功时返回 updatedDocxBase64", "anonymous", "POST", "/render/word", "render"],
    ["SVC-RENDER-08", "updated DOCX 可再次打开并保持中文内容", "anonymous", "POST", "/render/word", "render"],
    ["SVC-RENDER-09", "无目录 DOCX 明确返回 not-required", "anonymous", "POST", "/render/word", "render"],
    ["SVC-RENDER-10", "DOCX、页数或响应超限在预算内失败", "anonymous", "POST", "/render/word", "none"],
  ],
  failures: [
    ["SVC-FAIL-01", "危险路径和符号链接归档在落盘前被拒绝", "owner", "POST", "/api/v1/publications", "none"],
    ["SVC-FAIL-02", "包含疑似密钥的 Skill 进入安全拒绝状态", "owner", "POST", "/api/v1/publications", "none"],
    ["SVC-FAIL-03", "超限 Skill 和 VSIX 返回稳定错误码", "owner", "POST", "upload limits", "none"],
    ["SVC-FAIL-04", "重复幂等键和不同内容返回冲突", "owner", "POST", "idempotency", "none"],
    ["SVC-FAIL-05", "远端中断时客户端显示错误且恢复后可重试", "anonymous", "GET", "/health", "none"],
    ["SVC-FAIL-06", "429 遵循 Retry-After 且不产生点击风暴", "owner", "POST", "/api/v1/auth/session", "none"],
    ["SVC-FAIL-07", "所有证据和服务日志均不包含 QA Key", "owner", "GET", "evidence scan", "none"],
    ["SVC-FAIL-08", "清理后 qa-e2e 对象不再出现在任何个人或公开列表", "owner", "GET", "cleanup audit", "none"],
  ],
}

const cleanup = {
  none: [],
  download: ["删除本地下载副本"],
  session: ["退出 QA Web Session"],
  favorite: ["恢复收藏前状态"],
  intent: ["等待 intent 过期或消费"],
  installation: ["删除 qa-e2e 安装记录"],
  publication: ["撤销或下架 qa-e2e 发布"],
  review: ["删除 qa-e2e 评价"],
  artifact: ["经动作时确认后删除自有 qa-e2e artifact"],
  render: ["删除本地渲染输出"],
}

const evidence = ["screenshot", "http-transcript", "mutation-ledger"]
const cases = Object.entries(groups).flatMap(([suite, rows]) =>
  rows.map(([id, title, auth, method, path, effect]) => ({
    id,
    suite,
    title,
    preconditions: ["远端 /health 可在 5 秒内响应", auth === "anonymous" ? "不登录" : `${auth} QA 身份可用`],
    action: `${method} ${path}`,
    expected: title,
    auth,
    method,
    path,
    sideEffect: effect,
    cleanup: cleanup[effect],
    evidence,
  })),
)

mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, "service-cases.json"), `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), cases }, null, 2)}\n`)
const rows = cases
  .map((item) => `| \`${item.id}\` | ${item.suite} | ${item.title} | ${item.auth} | ${item.sideEffect} |`)
  .join("\n")
writeFileSync(
  join(dir, "service-matrix.md"),
  `# ChipMate Service 真实用户操作原子矩阵\n\n- 原子断言：${cases.length}\n- 所有远端对象必须使用 \`qa-e2e-<runId>\` 前缀。\n- 健康门禁失败时，依赖远端的断言一律 BLOCKED。\n\n| ID | 套件 | 单一判定 | 身份 | 副作用 |\n|---|---|---|---|---|\n${rows}\n`,
)
process.stdout.write(`${JSON.stringify({ assertions: cases.length, suites: Object.keys(groups).length })}\n`)
