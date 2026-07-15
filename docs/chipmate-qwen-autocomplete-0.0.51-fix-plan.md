# ChipMate Qwen 自动补全 0.0.51 完整修复执行计划

## 文档状态

- 目标版本：`0.0.51`
- 当前版本：`0.0.50`
- 执行状态：未开始
- 目标环境：远程 Linux 离线 VS Code
- 目标模型：`qwen-coder-30b0`
- 目标传输：本地 CLI `/kilo/qwen-fim` → Provider `/completions`
- 完成标准：源码测试、实际 VSIX 检查、远程 Linux ghost text 验收全部通过

本文件是本轮 Qwen 自动补全修复的唯一执行账本。后续实施、验证、打包和远程签收均应更新本文件中的复选框和结果记录，不得用聊天中的临时结论替代本文件状态。

## 执行规则

- [x] 每完成一项立即勾选，不提前勾选未验证事项。
- [x] 每个 Phase 结束后记录修改文件、命令、结果、遗留问题和下一步。
- [x] 只修改本计划明确覆盖的文件，保留当前工作树中其他用户改动。
- [x] 不使用 `git reset --hard`、`git checkout --` 或其他会破坏现有改动的命令。
- [x] 不把相关测试失败归因于“工作树很脏”后继续交付；相关失败必须修复。
- [x] 无关的既有失败单独记录，不与 Qwen 修复结果混在一起。
- [x] 不提交 VSIX、日志、诊断导出、截图、缓存或其他本地交付产物。
- [x] 未完成远程 Linux 验收前，不得把任务状态标记为完成。

## 目标

- [x] 自定义 Provider 通过 UI 只配置 `options.baseURL` 时，Qwen FIM 可以正常请求。
- [x] `qwen-coder-30b0` 是唯一正确运行时模型。
- [x] “自动选择”和“真实 Qwen Provider”不再显示成同一个选项。
- [x] 删除 Qwen Provider 后不再莫名回弹到不可用的 Codestral 并弹认证错误。
- [x] Qwen 模式下不残留 Classic `/kilo/fim` provider。
- [ ] Smoke 和真实编辑器补全都返回 ghost text。
- [x] 生成并验收 `chipmate-0.0.51-linux-x64-baseline.vsix`。

## 已确认根因

### 根因一：自定义 Provider URL 契约断裂

自定义 Provider UI 保存 `provider.options.baseURL`，聊天读取该字段，所以对话正常；但 `/kilo/qwen-fim` 只读取 `model.api.url`。对于不在内置模型快照中的自定义 Provider，UI 不保存根级 `api` 或模型级 `provider.api`，因此 `model.api.url` 为空，请求在本地直接返回 400。

### 根因二：`Qwen FIM (Default)` 实际是清空项

下拉框顶部斜体 `Qwen FIM (Default)` 实际执行：

```text
provider = null
model = null
```

它不是内置 Qwen Provider，而是“自动发现”。删除唯一真实 Qwen Provider 后，自动发现失败，协调器恢复 Codestral。

### 根因三：自动 fallback 会触发无效认证提示

在离线内部环境中，Kilo Gateway Codestral 通常不可用。无条件 fallback 到 Codestral 会让旧 Classic provider 请求 `/kilo/fim`，然后显示：

```text
ChipMate Autocomplete has been paused due to an authentication error
```

这条提示与 Qwen 的认证无关。

### 根因四：Classic manager 可以在 dispose 后复活

`AutocompleteServiceManager.load()` 是异步 fire-and-forget。切换到 Qwen 后，即使 manager 已 dispose，旧 `load()` 仍可能从 `await` 恢复并重新注册 Classic provider，造成 Qwen 与 Classic 同时活动、`/kilo/qwen-fim` 和 `/kilo/fim` 并存，以及误导性的 authentication warning。

### 根因五：Smoke 不等于真实编辑器注册验证

当前 Smoke 直接创建临时 Qwen provider。Smoke 成功只能证明传输链路，不代表普通编辑器 inline provider 已正确注册。

## Phase 0：版本、改动隔离与兼容边界

- [x] 将 `packages/kilo-vscode/package.json` 从 `0.0.50` 升级到 `0.0.51`。
- [x] 保持 `publisher=chipmate`。
- [x] 保持 `name=chipmate`。
- [x] 保持扩展 ID、SecretStorage/Auth store key 和配置命名空间不变。
- [x] 更新现有 `.changeset/fix-node-navigator.md`，不新增重复 Qwen changeset。
- [x] Changeset 用户文案覆盖自定义 Provider Qwen FIM、自动选择提示和 Classic provider 残留修复。
- [x] 实施前保存 autocomplete、qwen-autocomplete、ModelsTab 和 qwen gateway handler 的 scoped diff。
- [x] 不修改 SDK endpoint body。
- [x] 不运行 SDK codegen。
- [x] 不修改共享上游 `packages/opencode/src/provider/provider.ts`；URL 修复放在 Kilo-owned handler。

### Phase 0 结果记录

- 修改文件：`packages/kilo-vscode/package.json`、`.changeset/fix-node-navigator.md`。
- 执行命令：读取包身份与版本；保存 autocomplete、Qwen、ModelsTab、gateway handler 的 scoped diff。
- 测试结果：确认版本为 `0.0.51`，`publisher/name` 仍为 `chipmate/chipmate`。
- 已知限制：远程 Linux 安装态尚未验证。
- 下一步：修复并验证自定义 Provider 的 Qwen FIM transport。

## Phase 1：修复自定义 Provider 的 Qwen FIM 调用

### 1.1 统一 URL 解析

修改 `packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts`。

Qwen base URL 解析顺序与聊天保持一致：

```text
provider.options.baseURL
→ model.api.url
→ 无有效值则 400
```

- [x] 优先读取非空字符串 `provider.options.baseURL`。
- [x] 若不存在，再读取 `model.api.url`。
- [x] 规范化末尾 `/`。
- [x] URL 已以 `/completions` 结尾时不重复追加。
- [x] 其他情况追加 `/completions`。
- [x] 只记录 `endpointSource=provider-options|model-api|missing`，不记录完整 URL。
- [x] 通过 UI 创建的自定义 Provider 不再要求用户手工添加隐藏 `api` 字段。

### 1.2 统一 headers 与认证

请求 headers 合并顺序：

```text
provider.options.headers
→ model.headers
→ Content-Type
→ Authorization（仅现有 headers 未提供时）
```

- [x] 保留用户自定义 Authorization header。
- [x] 没有自定义 Authorization 时，从 CLI Auth store 按精确 provider ID 获取 API key。
- [x] 缺少本地 API key 返回 401。
- [x] 不在日志中记录 key、Authorization 或完整 headers。
- [x] 不把聊天环境变量认证错误地解释为 Qwen 已认证。

### 1.3 保持接口边界

继续使用：

```http
POST /kilo/qwen-fim
```

请求体和成功响应保持不变：

```json
{
  "providerID": "...",
  "modelID": "qwen-coder-30b0",
  "prefix": "...",
  "suffix": "...",
  "maxTokens": 128,
  "temperature": 0.1
}
```

```json
{
  "text": "..."
}
```

- [x] 不支持 `qwen3-coder-30b0` 别名。
- [x] 不新增 chat fallback。
- [x] 上游仍使用非流式 `/completions`。
- [x] 必须解析非空 `choices[0].text`。
- [x] 不修改 OpenAPI/SDK schema。

### 1.4 增加安全的服务端 phase 日志

将当前全部折叠成 400 的失败细分为非敏感日志 phase：

```text
model-id-rejected
provider-not-found
provider-type-rejected
base-url-missing
auth-missing
upstream-network
upstream-status
response-json-invalid
response-text-missing
success
```

- [x] 日志只包含 provider ID、model ID、phase、HTTP 状态、latency 和 endpoint source。
- [x] 禁止记录 URL/host、API key、Authorization、prompt/suffix 和源文件路径。

### Phase 1 结果记录

- 修改文件：`packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts`、`packages/opencode/test/kilocode/server/kilo-gateway-statuses.test.ts`。
- 执行命令：`bun test test/kilocode/server/kilo-gateway-statuses.test.ts`；对两个修改文件执行 Prettier。
- 测试结果：16 pass，0 fail；覆盖 `options.baseURL` 优先级、URL 规范化、header 合并、Secret/Auth store、401、provider 类型和旧模型拒绝。
- 已知限制：尚未在真实远程自定义 Provider 上执行网络请求。
- 下一步：修复 autocomplete 选择对、UI 语义和删除 Provider 后的回弹。

## Phase 2：修复自动选择、UI 误导和 Codestral 回弹

### 2.1 区分自动项与真实模型

修改：

- `packages/kilo-vscode/webview-ui/src/components/settings/ModelsTab.tsx`
- `packages/kilo-vscode/webview-ui/src/components/settings/autocomplete-model-selector.ts`

顶部清空项改名为：

```text
Automatic — Prefer Qwen
```

辅助说明：

```text
Uses a connected qwen-coder-30b0 Provider. Public builds may use Codestral only when its authentication is available.
```

真实 Qwen 行显示为：

```text
Qwen Coder FIM
```

并保留所在 Provider 分组，例如：

```text
completion
  Qwen Coder FIM
```

- [x] 不再把所有真实 Qwen 模型重命名为 `Qwen FIM (Default)`。
- [x] 自动项保持顶部斜体，但明确标注为 Automatic。
- [x] 真实项必须位于 Provider 分组中。
- [x] 不新增自定义图标或复杂视觉重构，复用现有 ModelSelector 和主题 token。

### 2.2 原子保存 provider/model

新增内部 webview 消息：

```ts
updateAutocompleteSelection({
  providerID,
  modelID,
  automatic,
  requestId,
})
```

- [x] provider/model 作为一个选择对处理。
- [x] 同一个 requestId 确认整组保存。
- [x] 自动项设置 `automatic=true` 并清空显式选择。
- [x] 真实 Qwen 或内置模型设置 `automatic=false` 并保存完整 provider/model。
- [x] 配置事件仍允许发生，但协调器只在完整 pair 后激活 runtime。
- [x] 不改变聊天默认模型或 Provider 设置。

### 2.3 保留兼容状态但消除歧义

不新增公开运行时选择来源，继续以以下配置作为真实 runtime 选择：

```text
kilo-code.new.autocomplete.provider
kilo-code.new.autocomplete.model
kilo-code.new.autocomplete.enableAutoTrigger
```

现有隐藏状态 `kilo.autocomplete.qwenDefault` 仅作为自动选择来源兼容标记。

- [x] 自动项保存时一次性设为 `true`。
- [x] 真实模型保存时一次性设为 `false`。
- [x] 不再由 provider/model 两次独立更新各自覆盖。
- [x] 迁移 48/49/50 已有 globalState，不清空用户配置。
- [x] 将自动/显式来源通过内部 settings message 发给 Webview。
- [x] UI 能显示 `Automatic → Qwen Coder FIM`。
- [x] UI 能显示 `Automatic → Codestral`。
- [x] UI 能显示 `Explicit → Qwen Coder FIM`。

### 2.4 修订 fallback 规则

#### 用户显式选择 Qwen

- [x] 临时断连时保留 provider/model。
- [x] 不改写为 Codestral。
- [x] 不启动 Classic provider。
- [x] 显示非阻断状态：`Selected Qwen Provider is temporarily unavailable`。

#### 用户主动删除当前 Qwen Provider

- [x] 删除成功后检测它是否是当前 autocomplete provider。
- [x] 切换为 Automatic。
- [x] 立即重新发现其他兼容 Qwen Provider。
- [x] 如果没有，显示明确提示，不让 UI 看起来像选择被系统吞掉。

#### Automatic 模式

- [x] 有 connected、exact-model、OpenAI-compatible Qwen Provider 时使用 Qwen。
- [x] 公共/多云包且 Codestral 认证真实可用时，允许 Codestral fallback。
- [x] 内部离线包或无 Kilo Gateway 认证时不启动 Codestral。
- [x] 内部离线包无 Qwen 时显示“未找到兼容 Qwen Provider”。
- [x] `enableAutoTrigger=true` 但没有可用 provider 时进入可解释的 unavailable 状态。
- [x] 不注册一个必然 401 的 Classic provider。

这一步修订此前“无条件 Codestral fallback”的设计，因为远程日志已经证明它会在离线包中制造误导性认证错误。

### 2.5 处理配置作用域覆盖

- [x] 保存前用 `WorkspaceConfiguration.inspect()` 查明 effective source。
- [x] provider/model 必须写入同一作用域。
- [x] 有 Workspace Folder 值时更新 Workspace Folder。
- [x] 否则有 Workspace 值时更新 Workspace。
- [x] 否则写 Global。
- [x] UI 显示当前配置来源。
- [x] 自动项只清理当前有效作用域的 pair，不删除其他工作区无关设置。
- [x] 不再出现“保存成功但马上弹回”的无解释行为。

### Phase 2 结果记录

- 修改文件：`settings.ts`、`workspace.ts`、`KiloProvider.ts`、`provider-actions.ts`、Webview settings/message/selector 文件及行为测试。
- 执行命令：focused autocomplete tests、扩展 typecheck、Prettier。
- 测试结果：原子选择、三层配置作用域、删除 Provider、自动/显式文案和 fallback 行为通过。
- 已知限制：真实 VS Code UI 点击与远程目标机仍在 Phase 9/10 验收。
- 下一步：完成 Classic manager 生命周期和协调器竞态门禁。

## Phase 3：彻底消除 Classic/Qwen 双重注册

修改：

- `packages/kilo-vscode/src/services/autocomplete/AutocompleteServiceManager.ts`
- `packages/kilo-vscode/src/services/autocomplete/index.ts`

### 3.1 Manager 生命周期防护

为 `AutocompleteServiceManager` 增加：

```text
disposed flag
load generation
single active load promise
```

每次 `load()`：

1. 记录 generation。
2. 读取配置。
3. 异步更新 context。
4. 在任何注册前确认 manager 未 dispose、generation 仍是最新、当前目标仍是 Classic/Next Edit。

`dispose()` 必须：

- [x] 立即设置 disposed。
- [x] 增加 generation，使旧 load 失效。
- [x] 取消当前请求或让回调失效。
- [x] 阻止旧 load 重新注册 inline provider。
- [x] 阻止 dispose 后的 fatal callback 弹认证提示。
- [x] 清理 registration、state listener、event listener 和 timer。

### 3.2 Coordinator 单飞与 pending

- [x] 激活、配置变化、连接状态变化只调用 `schedule()`。
- [x] 同时最多一个 `provider.list`。
- [x] resolve 期间发生连接事件时设置 `pending=true`，不能直接丢弃。
- [x] 当前轮结束后自动再跑一轮。
- [x] provider/model 中间态不注册任何 fallback。
- [x] Qwen 分支先可靠 dispose Classic manager，再激活 Qwen。
- [x] Classic 分支激活前确认当前不是 Qwen target。
- [x] 重复配置事件不产生重复 inline provider registration。

### 3.3 认证提示归属

- [x] Qwen 错误继续只进入 Qwen diagnostics，不显示 Classic authentication toast。
- [x] Classic provider 只有在自身仍是当前活动 runtime 时才允许显示 fatal auth warning。
- [x] 显式 Qwen 模式日志中出现 `/kilo/fim` 视为测试失败。
- [x] 显式 Qwen 模式出现 Classic authentication warning 视为测试失败。

### Phase 3 结果记录

- 修改文件：`AutocompleteServiceManager.ts`、`autocomplete/index.ts`、manager/coordinator 行为测试。
- 执行命令：`bun test tests/unit/autocomplete-runtime-isolation.test.ts tests/unit/autocomplete-manager-lifecycle.test.ts`。
- 测试结果：单飞、pending 重跑、dispose generation、Qwen/Classic 切换和 fatal warning 归属通过。
- 已知限制：Extension Host 的长时间稳定性仍需 Phase 9/10 smoke 与远程三次 Reload。
- 下一步：统一自动发现、编辑器请求和 smoke 的 workspace directory。

## Phase 4：统一 Workspace/Directory 路由

### 4.1 自动发现

- [x] Qwen resolver 的 `provider.list` 传入当前 workspace directory。
- [x] 单根目录使用当前 workspace。
- [x] 多根目录优先使用当前编辑文档所在 workspace folder。
- [x] 无活动文档时使用第一个 workspace folder。
- [x] 无 workspace 时等待下一次事件，不抛未处理异常。

### 4.2 Qwen 请求

扩展 `QwenFimCompleteInput`：

```ts
directory?: string
```

修改：

- `packages/kilo-vscode/src/services/qwen-autocomplete/QwenFimClient.ts`
- `packages/kilo-vscode/src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider.ts`

- [x] 从当前 document URI 解析 workspace folder。
- [x] 调用 SDK `qwenFim` 时传 directory query。
- [x] Smoke 使用当前活动 workspace，不使用 `/smoke-test` 作为配置路由目录。
- [x] 自动发现和真实请求使用同一 directory。

### Phase 4 结果记录

- 修改文件：`autocomplete/workspace.ts`、coordinator、`QwenFimClient.ts`、inline provider、smoke 和测试。
- 执行命令：focused autocomplete tests、扩展 typecheck。
- 测试结果：单根、多根、无 workspace、SDK directory query 与 smoke/editor 路由通过。
- 已知限制：远程日志中的真实 directory 仍需 Phase 10 对照工作区签收。
- 下一步：完善 smoke/source/phase 和诊断导出。

## Phase 5：修复 Smoke 与诊断链

### 5.1 区分 Smoke 和真实编辑器请求

诊断条目新增非敏感字段：

```text
requestSource=smoke|editor
workspaceScope=global|workspace|workspace-folder|none
selectionOrigin=automatic|explicit
endpointSource=provider-options|model-api|missing
serverPhase
```

- [x] Smoke 日志明确标记 `requestSource=smoke`。
- [x] 普通输入日志标记 `requestSource=editor`。
- [x] 不再需要通过固定 path hash 推断请求来源。
- [x] 导出继续禁止 prompt、源码、绝对路径、host 和 key。

### 5.2 Smoke 行为

保留命令 ID：

```text
kilo-code.new.qwenAutocomplete.smokeDiagnostics
```

用户文案改为：

```text
ChipMate: Test qwen-direct Transport
```

- [x] Smoke 成功显示 provider、model、status 和 item count。
- [x] Smoke 失败显示 status 和安全 phase。
- [x] Smoke 不显示敏感信息。
- [x] Smoke 文案明确它只测试传输，不证明普通 inline provider 已注册。

### 5.3 Export 可发现性

保留命令 ID：

```text
kilo-code.new.qwenAutocomplete.exportDiagnostics
```

- [x] Smoke 结束消息提供 `Export Diagnostics` 操作。
- [x] Show Logs 输出顶部写明 Export 命令名。
- [x] Command Palette manifest 继续无 `when` 条件。
- [x] installed-host smoke 验证三条命令均存在。
- [x] Export 文件继续包含 metadata、effective settings 和脱敏 JSONL。

### Phase 5 结果记录

- 修改文件：Qwen diagnostics、inline provider、client、smoke、manifest 和诊断测试。
- 执行命令：`bun test tests/unit/qwen-autocomplete.test.ts tests/unit/qwen-autocomplete-diagnostics.test.ts`。
- 测试结果：smoke/editor source、成功/失败文案、safe phase、三命令 manifest 与脱敏导出通过。
- 已知限制：installed-host 的三命令存在性尚待 Phase 9 实际 VSIX 验证。
- 下一步：完成真实 custom Provider 集成和全部行为测试。

## Phase 6：自动化测试

### 6.1 CLI 真实自定义 Provider 集成测试

新增真实配置流测试：

```text
UI 形态 custom provider config
→ options.baseURL
→ real Provider.Service model construction
→ /kilo/qwen-fim
→ local test HTTP /completions
→ choices[0].text
```

尽量使用临时配置目录和本地 HTTP server，只在网络边界做替身。

- [x] `options.baseURL` 可以成功补全。
- [x] 不要求根级 `api`。
- [x] 不要求模型级 `provider.api`。
- [x] 请求路径精确为 `/completions`。
- [x] 已包含 `/completions` 时不重复追加。
- [x] provider headers 被保留。
- [x] model headers 覆盖同名 provider headers。
- [x] Authorization 不覆盖用户自定义值。
- [x] Auth store 缺少 key 返回 401。
- [x] 错误模型返回 400。
- [x] 错误 npm 类型返回 400。
- [x] 空 URL 记录 `base-url-missing`。
- [x] 上游非 2xx 记录 `upstream-status`。
- [x] 非 JSON、缺少 `choices[0].text` 有独立 phase。

### 6.2 UI 测试

- [x] 自动项名称不再是 `Qwen FIM (Default)`。
- [x] 自动项与真实 Qwen 行不重名。
- [x] 真实行保存真实 provider ID。
- [x] 自动项设置 automatic origin。
- [x] 无 Qwen 时内部离线包显示 unavailable，不启动 Codestral。
- [x] 公共包只有在 Codestral 可用时才 fallback。
- [x] Provider 删除后 UI 状态明确。
- [x] Global/Workspace/Workspace Folder 作用域保存不回弹。
- [x] 一个选择只产生一个 requestId 保存事务。

### 6.3 Coordinator 行为测试

- [x] 干净配置自动发现 Qwen。
- [x] 已持久化显式 Qwen 启动即注册。
- [x] 显式 Qwen 临时断连不回退。
- [x] 删除当前 Provider 后进入 Automatic。
- [x] 自动模式无 Provider 时内部包不启动 Classic。
- [x] Qwen/Classic 双向切换正确 dispose。
- [x] resolve 期间连接事件产生下一轮 reconcile。
- [x] 高频事件同时最多一个 provider lookup。
- [x] provider/model 中间态不注册 fallback。
- [x] 不重复注册 inline provider。

### 6.4 生命周期竞态测试

使用可控 deferred promise 测试真实 manager：

1. Classic `load()` 开始。
2. 在 `updateGlobalContext()` 处暂停。
3. coordinator 切换到 Qwen 并 dispose manager。
4. 恢复旧 `load()`。
5. 验证它不能重新注册 provider、不能弹 toast。

- [x] dispose 后 registration 数量为 0。
- [x] 只有一次活动 runtime。
- [x] 没有未处理 Promise。
- [x] 没有旧 fatal auth callback。
- [x] connecting 重入仍只有一次 `doConnect()`。

### 6.5 Smoke 与普通编辑器测试

- [x] Smoke 日志包含 `requestSource=smoke`。
- [x] 普通 document provider 测试包含 `requestSource=editor`。
- [x] 两者都传 provider ID、model、directory 和取消信号。
- [x] Smoke 成功不能替代普通编辑器注册测试。
- [x] Export 包含 selection origin 和 endpoint source。

### Phase 6 结果记录

- 修改文件：新增 `qwen-fim-custom-provider.test.ts`，扩展 gateway status、selection、coordinator、manager、smoke/editor diagnostics 测试。
- 执行命令：CLI 两个 route/integration test；扩展五个 focused suite；两包 typecheck。
- 测试结果：CLI 20 pass/0 fail；扩展 focused 97 pass/0 fail；CLI 与扩展 typecheck 通过。
- 已知限制：全量 unit/lint/knip/仓库守卫尚待 Phase 8；installed-host/远程真机尚未执行。
- 下一步：收口手册与 changeset 后运行全量门禁。

## Phase 7：文档与 Changeset

更新：

- `packages/kilo-vscode/docs/QWEN_DIRECT_OFFLINE_MANUAL_TEST.md`
- 其他当前 Qwen 离线验证文档
- `.changeset/fix-node-navigator.md`

- [x] 明确 Qwen 没有无需 Provider 的内置服务。
- [x] 明确必须存在真实 connected custom provider。
- [x] 明确 UI 保存 `options.baseURL` 即可，不需要隐藏 `api` 字段。
- [x] 说明顶部 Automatic 与 Provider 分组下真实 Qwen 的区别。
- [x] 说明内部离线包无 Qwen 时不会静默启动 Codestral。
- [x] 说明 Smoke 是 transport probe，不是普通 editor registration proof。
- [x] 说明 `/chat/completions` 正常不代表 `/completions` 正常。
- [x] 说明如何使用 Show Logs 和 Export Diagnostics。
- [x] 禁止上传 API key、URL、源码和完整 prompt。

### Phase 7 结果记录

- 修改文件：`QWEN_DIRECT_OFFLINE_MANUAL_TEST.md`、`.changeset/fix-node-navigator.md`。
- 执行命令：Prettier check、focused diagnostics/selection tests。
- 测试结果：手册覆盖 Provider/URL/Automatic/Smoke/导出边界，changeset 为 `chipmate` patch。
- 已知限制：命令可发现性仍要在实际 0.0.51 VSIX 中验证。
- 下一步：运行 Phase 8 全量自动化门禁。

## Phase 8：自动化门禁

### VS Code Extension

```bash
cd /Users/archer/Work/kilocode/packages/kilo-vscode

bun test \
  src/services/cli-backend/connection-service.test.ts \
  src/services/cli-backend/recovery.test.ts

bun test \
  src/services/autocomplete/__tests__/settings.spec.ts \
  tests/unit/autocomplete-runtime-isolation.test.ts \
  tests/unit/autocomplete-model-selector.test.ts

bun test tests/unit/qwen-autocomplete*.test.ts

bun run typecheck
bun run lint
bun run test:unit
bun run knip
bun run check-kilocode-change
```

### CLI

```bash
cd /Users/archer/Work/kilocode/packages/opencode

bun test \
  test/kilocode/server/kilo-gateway-statuses.test.ts \
  test/kilocode/server/qwen-fim-custom-provider.test.ts

bun run typecheck
```

### 仓库守卫

```bash
cd /Users/archer/Work/kilocode

bun run script/check-opencode-annotations.ts
bun run script/check-opencode-promise-facades.ts
bun run script/check-md-table-padding.ts
```

### 门禁要求

- [x] Qwen focused suite 为 `0 fail`。
- [x] 新增真实 custom-provider 集成测试通过。
- [x] 连接重入、manager resurrection、双 provider 测试通过。
- [x] 相关测试任何失败均阻断交付。
- [x] 当前脏工作树中的无关全量失败单独列出。
- [x] 不把无关失败包装成 Qwen 修复成功。
- [x] 不修改 HTTP schema，因此不运行 SDK codegen。
- [x] 如实施中被迫改变 body/schema，停止实施并重新评审。

### Phase 8 结果记录

- VS Code focused tests：`251 pass / 0 fail`，覆盖 Qwen、协调器、selection、manager、连接重入与恢复。
- VS Code full unit：`2970 pass / 13 fail`；本轮相关测试和跨文件 mock 污染均已清零。
- VS Code typecheck：通过。
- VS Code lint：通过。
- Knip：通过。
- CLI tests：`20 pass / 0 fail / 56 assertions`，包含真实 custom-provider HTTP/SDK 集成。
- CLI typecheck：通过。
- Repository guards：`check-kilocode-change`、Markdown table 通过；annotations 与 promise-facades 仍被其他任务的脏工作树改动阻断。
- 无关既有失败：Worktree 1、旧自动补全品牌映射 1、原生标题 1、server env/memory debug 3、Code Action 品牌断言 5、i18n locale completeness 1、Agent Manager 源码窗口断言 1；annotations 另报 shared build/provider/control/global 改动，promise-facades 另报 `internal-offline-provider.test.ts`。
- 签收阻断项：上述 13 个全量单测和 2 个仓库守卫失败必须在最终签收时保持可见；它们不属于 Qwen 模型/传输修复，Phase 9 可继续生成候选 VSIX，但不能据此宣称整个脏工作树全绿。

## Phase 9：构建 0.0.51 Linux 离线 VSIX

先构建新鲜 CLI：

```bash
cd /Users/archer/Work/kilocode/packages/opencode
bun run script/build.ts --targets=linux-x64-baseline --skip-install
```

再构建内部离线包：

```bash
cd /Users/archer/Work/kilocode/packages/kilo-vscode
bun script/build.ts --internal-offline --targets=linux-x64-baseline
```

最终产物：

```text
chipmate-0.0.51-linux-x64-baseline.vsix
```

- [x] 只构建 Linux baseline。
- [x] 不生成 Linux tar。
- [x] 不修改 Windows `latest.json`。
- [x] 不提交 VSIX。
- [x] publisher/name/extension ID 不变。
- [x] 包含新鲜 Linux baseline CLI。
- [x] 包含 RG、Tree-sitter、LanceDB 和所有 extension/webview bundles。
- [x] 不含 FFmpeg。
- [x] 不含 source map。
- [x] bundle 包含 `qwen-coder-30b0`。
- [x] bundle 包含 `/kilo/qwen-fim`。
- [x] bundle 包含 `options.baseURL` 解析逻辑。
- [x] bundle 包含三条诊断命令。
- [x] bundle 包含 Automatic 与真实 Qwen 的新文案。
- [x] bundle 不含运行时 `qwen3-coder-30b0`。
- [x] 计算并记录 SHA-256。
- [x] installed-extension-host smoke 验证安装、激活和命令注册。

### Phase 9 结果记录

- VSIX 路径：`/Users/archer/Work/kilocode/chipmate-0.0.51-linux-x64-baseline.vsix`。
- 文件大小：`191998424` bytes（约 `183.1 MiB`）。
- SHA-256：`1acd3e2de403bb715f050516bb2f15f6850dfe04622a235af97100201a70b71a`。
- Manifest 版本：`0.0.51`。
- Publisher/name：`chipmate/chipmate`，扩展 ID 保持 `chipmate.chipmate`。
- CLI target：新鲜构建的 Linux x64 baseline ELF，interpreter 为 `/lib64/ld-linux-x86-64.so.2`。
- 资源检查：13 个必需入口无缺失；37 个 Tree-sitter WASM、739 个 LanceDB 文件、RG、model snapshot 和 8 个 dist JS bundle 均存在；FFmpeg/source map 均为 0。
- installed-host smoke：隔离安装、激活和三条 Qwen 命令注册通过；证据目录为 `docs/chipmate-feature-migration-validation-runs/20260714-142449-71598-23799-installed-vsix-host-smoke`。
- 已知限制：macOS Extension Host 无法执行 Linux ELF，故 sidecar runtime smoke 按脚本选项跳过；真实 CLI/Smoke/ghost text 只在 Phase 10 远程 Linux 验收。

## Phase 10：远程 Linux 真实验收

为减少离线目标机的人工采证步骤，可使用：

```bash
bash /home/caizh/chipmate-qwen-autocomplete-0.0.51-linux-audit.sh prepare \
  /home/caizh/chipmate-0.0.51-linux-x64-baseline.vsix

# 完成下述 UI、Smoke、三次 Reload 和十次补全后：
bash /home/caizh/chipmate-qwen-autocomplete-0.0.51-linux-audit.sh audit \
  '<prepare 输出的 EVIDENCE_DIR>'
```

脚本只输出脱敏请求阶段、计数和错误信号；不采集 API key、Authorization、prompt、completion、源码或未脱敏原始日志。

覆盖安装，不卸载：

```bash
code --install-extension \
  /home/caizh/chipmate-0.0.51-linux-x64-baseline.vsix \
  --force
```

执行 `Developer: Reload Window`，确认加载路径为：

```text
chipmate.chipmate-0.0.51
```

### Provider 验收

重新创建自定义 Provider：

- 类型：`@ai-sdk/openai-compatible`
- 模型：`qwen-coder-30b0`
- Base URL：通过正常 UI 填写
- API key：通过正常 UI 保存
- 上游支持非流式 `/completions`

- [ ] 不手工添加隐藏的根级 `api`。
- [ ] 不手工添加模型级 `provider.api`。
- [ ] Chat 继续正常。
- [ ] Qwen FIM Smoke 正常。

### UI 验收

- [ ] 顶部显示 `Automatic — Prefer Qwen`。
- [ ] Provider 分组下显示 `Qwen Coder FIM`。
- [ ] 两项不再同名。
- [ ] 选择真实 Qwen 后保存不回弹。
- [ ] 删除 Provider 后显示“未找到兼容 Qwen Provider”。
- [ ] 内部离线环境不自动启动 Codestral。
- [ ] 不出现误导性 authentication warning。

### Smoke 验收

运行：

```text
ChipMate: Test qwen-direct Transport
```

必须出现：

```text
requestSource=smoke
provider-enter
request-start
response status=200
return-items itemCount>=1
```

- [ ] Smoke status 为 200。
- [ ] Smoke itemCount 至少为 1。
- [ ] Export Diagnostics 操作可见。
- [ ] 导出内容不泄露敏感信息。

### 真实编辑器验收

- [x] 日志为 `requestSource=editor`。
- [ ] 空函数体出现 ghost text。
- [ ] 部分 token 不重复前缀。
- [ ] 同行 suffix 不被覆盖。
- [x] 快速输入取消旧请求。
- [ ] stale completion 不显示。
- [ ] Tab 接受建议。
- [ ] directory 对应当前 workspace。
- [ ] 显式 Qwen 期间不出现 `/kilo/fim`。

### 稳定性验收

连续三次 Reload Window，至少十次真实补全：

- [ ] 无 `Maximum call stack size exceeded`。
- [ ] 无未处理异常。
- [ ] 每次激活最多一次 CLI 启动。
- [ ] 无重复 inline provider 注册。
- [ ] 无 Classic provider resurrection。
- [ ] 无 authentication warning。
- [ ] 请求链完整。

完整请求链：

```text
provider-enter
→ config-read
→ prompt-built
→ request-start
→ response 200
→ return-items >= 1
```

### Phase 10 结果记录

- 辅助采证脚本：`docs/chipmate-qwen-autocomplete-0.0.51-linux-audit.sh`，`bash -n` 和内置 `self-test` 通过。
- 连接状态：当前 macOS 未找到 `caizh` 的 SSH alias 或 VS Code Remote 记录；等待目标地址/现有远程终端或目标机采证结果。
- 目标机器：
- VS Code/Profile：
- 已加载扩展路径：
- Provider ID：`myprovider`，显式选择，日志显示 `connectionState=connected`、`endpointSource=provider-options`。
- Smoke requestId：
- 真实 editor requestId：`qwen-1784011538741-29`；请求已进入 `prompt-built → request-start`，上游 `/completions` 返回 400（`serverPhase=upstream-status`），因此 `return-items=0`。前序 `qwen-1784011538550-28` 被新输入正确取消。
- 三次 Reload 结果：
- 十次补全结果：
- authentication warning：
- `/kilo/fim` 残留：
- 未处理异常：
- 最终签收人/时间：

## 完成标准

只有同时满足以下三项才能把 `0.0.51` 标记为完成：

- [x] 源码和 focused/full relevant tests 通过。
- [x] 实际 VSIX 内容和 installed-host smoke 通过。
- [ ] 远程 Linux 中真实 C/C++ ghost text、三次 Reload、十次请求通过。

单纯“测试通过”“打包成功”或“Smoke 成功”都不能替代远程真实编辑器验收。

## 最终结果

- 最终状态：`BLOCKED`；本地实现、相关门禁、打包与 installed-host smoke 已完成，但连续三个目标轮次都没有远程 Linux 连接入口或目标机采证结果，33 项真实运行验收无法在本机替代。
- 完成版本：候选版本 `0.0.51`，远程签收前不标记最终完成。
- VSIX：`/Users/archer/Work/kilocode/chipmate-0.0.51-linux-x64-baseline.vsix`。
- SHA-256：`1acd3e2de403bb715f050516bb2f15f6850dfe04622a235af97100201a70b71a`。
- 远程验收：未执行
- 阻断项：
- Out of scope：模型质量提升、chat fallback、其他模型、其他操作系统、RAG、CodeGraph、`semantic_search`、`codebase_analysis`
