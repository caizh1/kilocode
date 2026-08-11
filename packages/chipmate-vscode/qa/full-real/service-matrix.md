# ChipMate Service 真实用户操作原子矩阵

- 原子断言：78
- 所有远端对象必须使用 `qa-e2e-<runId>` 前缀。
- 健康门禁失败时，依赖远端的断言一律 BLOCKED。

| ID | 套件 | 单一判定 | 身份 | 副作用 |
|---|---|---|---|---|
| `SVC-HEALTH-01` | health | GET /health 返回 ChipMate 服务身份与 ok=true | anonymous | none |
| `SVC-HEALTH-02` | health | health 报告 Chromium、Mermaid、LibreOffice 与 Poppler 工具 | anonymous | none |
| `SVC-HEALTH-03` | health | GET /api/v1/capabilities 返回 aligned-v1 能力 | anonymous | none |
| `SVC-HEALTH-04` | health | GET /api/v1/status 返回可判定服务状态 | anonymous | none |
| `SVC-HEALTH-05` | health | 真实 Chrome 根页面完成加载且控制台无致命错误 | anonymous | none |
| `SVC-HEALTH-06` | health | 市场 SSE 首次连接返回状态事件 | anonymous | none |
| `SVC-HEALTH-07` | health | SSE 使用 Last-Event-ID 重连后补偿目录版本 | anonymous | none |
| `SVC-HEALTH-08` | health | legacy 与 aligned 状态中的目录版本相容 | anonymous | none |
| `SVC-PACKAGE-01` | packages | 更新 manifest 使用 schema v2 | anonymous | none |
| `SVC-PACKAGE-02` | packages | manifest 包含 darwin-arm64 与 win32-x64-baseline 目标 | anonymous | none |
| `SVC-PACKAGE-03` | packages | 0.0.88 条目的 SHA-256 与冻结 VSIX 一致 | anonymous | none |
| `SVC-PACKAGE-04` | packages | 包下载 URL 与 ChipMate Server 同源 | anonymous | none |
| `SVC-PACKAGE-05` | packages | 完整下载响应大小和 SHA-256 与 manifest 一致 | anonymous | download |
| `SVC-PACKAGE-06` | packages | 不兼容 target 不出现在当前平台更新候选中 | anonymous | none |
| `SVC-AUTH-01` | auth | 匿名用户可以浏览公开市场 | anonymous | none |
| `SVC-AUTH-02` | auth | owner QA Key 创建 Web Session | owner | session |
| `SVC-AUTH-03` | auth | owner Session 的 /auth/me 返回 owner 身份 | owner | none |
| `SVC-AUTH-04` | auth | non-owner QA Key 创建独立 Web Session | non-owner | session |
| `SVC-AUTH-05` | auth | 错误 QA Key 被拒绝且不创建 Session | invalid | none |
| `SVC-AUTH-06` | auth | 缺失或错误 CSRF 的写请求被拒绝 | owner | none |
| `SVC-AUTH-07` | auth | 退出登录后旧 Session 不再可用 | owner | session |
| `SVC-AUTH-08` | auth | 认证与服务日志不包含 QA Key | owner | none |
| `SVC-SKILL-01` | skills | Skill 首页显示远端目录 | anonymous | none |
| `SVC-SKILL-02` | skills | 搜索只返回匹配 Skill | anonymous | none |
| `SVC-SKILL-03` | skills | 分类、排序和游标分页可组合使用 | anonymous | none |
| `SVC-SKILL-04` | skills | Skill 详情显示作者、版本和风险状态 | anonymous | none |
| `SVC-SKILL-05` | skills | release 列表与不可变 revision 详情一致 | anonymous | none |
| `SVC-SKILL-06` | skills | 文件列表和单文件内容与发布快照一致 | anonymous | none |
| `SVC-SKILL-07` | skills | Skill 归档下载成功并记录下载 | anonymous | download |
| `SVC-SKILL-08` | skills | owner 收藏后个人收藏列表立即更新 | owner | favorite |
| `SVC-SKILL-09` | skills | 取消收藏后个人收藏列表恢复 | owner | favorite |
| `SVC-SKILL-10` | skills | 安装 intent 由 Web Session 创建 | owner | intent |
| `SVC-SKILL-11` | skills | 安装 intent 由同一 owner Bearer 身份消费 | owner | installation |
| `SVC-SKILL-12` | skills | 相同 intent 重放被拒绝 | owner | none |
| `SVC-SKILL-13` | skills | 发布安全 qa-e2e Skill 产生 validation run | owner | publication |
| `SVC-SKILL-14` | skills | 确定性修复以 patch 形式显示且原始夹具不被改写 | owner | publication |
| `SVC-SKILL-15` | skills | 应用确认后生成不可变 revision | owner | publication |
| `SVC-SKILL-16` | skills | 相同幂等输入不会生成重复 revision | owner | publication |
| `SVC-SKILL-17` | skills | non-owner 不能下架 owner Skill | non-owner | none |
| `SVC-SKILL-18` | skills | owner 可以下架测试 Skill 且历史 revision 保留 | owner | publication |
| `SVC-SKILL-19` | skills | 撤销发布恢复发布前状态 | owner | publication |
| `SVC-SKILL-20` | skills | 个人发布页只显示当前 owner 的记录 | owner | none |
| `SVC-EXT-01` | extensions | Extension Market 首页显示远端目录 | anonymous | none |
| `SVC-EXT-02` | extensions | 扩展搜索、平台与排序筛选可组合使用 | anonymous | none |
| `SVC-EXT-03` | extensions | 扩展详情显示版本、target、SHA 和大小 | anonymous | none |
| `SVC-EXT-04` | extensions | 扩展完整下载成功且拒绝 Range | anonymous | download |
| `SVC-EXT-05` | extensions | owner 收藏扩展后个人列表更新 | owner | favorite |
| `SVC-EXT-06` | extensions | 取消扩展收藏后个人列表恢复 | owner | favorite |
| `SVC-EXT-07` | extensions | owner 创建扩展评价 | owner | review |
| `SVC-EXT-08` | extensions | owner 修改同一扩展评价 | owner | review |
| `SVC-EXT-09` | extensions | owner 删除自己的扩展评价 | owner | review |
| `SVC-EXT-10` | extensions | 单个安全测试 VSIX 流式上传并发布 | owner | artifact |
| `SVC-EXT-11` | extensions | 多文件、文件夹、ZIP 与 TAR.GZ 只提取 VSIX | owner | artifact |
| `SVC-EXT-12` | extensions | 批量上传按最多 20 个逻辑批次串行执行 | owner | artifact |
| `SVC-EXT-13` | extensions | 取消上传后不再开始新 artifact | owner | artifact |
| `SVC-EXT-14` | extensions | 认证恢复后只续传未完成 artifact | owner | artifact |
| `SVC-EXT-15` | extensions | 个人上传、收藏、评价和发布列表相互一致 | owner | none |
| `SVC-EXT-16` | extensions | non-owner 不能删除 owner artifact | non-owner | none |
| `SVC-EXT-17` | extensions | owner 删除自有 qa-e2e artifact 后目录不再返回 | owner | artifact |
| `SVC-EXT-18` | extensions | 扩展市场匿名聚合分析不泄露身份 | anonymous | none |
| `SVC-RENDER-01` | render | 合法 Mermaid 返回 PNG、width 与 height | anonymous | render |
| `SVC-RENDER-02` | render | Mermaid PNG 裁剪边界不丢失节点 | anonymous | render |
| `SVC-RENDER-03` | render | 非法 Mermaid 返回可判定错误且服务保持健康 | anonymous | none |
| `SVC-RENDER-04` | render | 超限 Mermaid 源码在渲染前被拒绝 | anonymous | none |
| `SVC-RENDER-05` | render | 真实 DOCX 返回 PDF 和逐页 PNG | anonymous | render |
| `SVC-RENDER-06` | render | Word 响应报告字段刷新和目录计数 | anonymous | render |
| `SVC-RENDER-07` | render | 刷新验证成功时返回 updatedDocxBase64 | anonymous | render |
| `SVC-RENDER-08` | render | updated DOCX 可再次打开并保持中文内容 | anonymous | render |
| `SVC-RENDER-09` | render | 无目录 DOCX 明确返回 not-required | anonymous | render |
| `SVC-RENDER-10` | render | DOCX、页数或响应超限在预算内失败 | anonymous | none |
| `SVC-FAIL-01` | failures | 危险路径和符号链接归档在落盘前被拒绝 | owner | none |
| `SVC-FAIL-02` | failures | 包含疑似密钥的 Skill 进入安全拒绝状态 | owner | none |
| `SVC-FAIL-03` | failures | 超限 Skill 和 VSIX 返回稳定错误码 | owner | none |
| `SVC-FAIL-04` | failures | 重复幂等键和不同内容返回冲突 | owner | none |
| `SVC-FAIL-05` | failures | 远端中断时客户端显示错误且恢复后可重试 | anonymous | none |
| `SVC-FAIL-06` | failures | 429 遵循 Retry-After 且不产生点击风暴 | owner | none |
| `SVC-FAIL-07` | failures | 所有证据和服务日志均不包含 QA Key | owner | none |
| `SVC-FAIL-08` | failures | 清理后 qa-e2e 对象不再出现在任何个人或公开列表 | owner | none |
