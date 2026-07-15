# Continue Qwen Coder 补全差异矩阵（2026-07-14）

状态：首轮差异补齐已实施；`T04`、`A02`、`A03`、`T02`、`A04`、`T07` 已通过单元、route 集成和类型检查，真实 Extension Host/目标模型验收仍待执行。

执行标记：第 6 节中的 `✅ 已完成` 项已经落地，下一轮不得重复实施；只继续处理 `⬜ 未完成`，或在用户确认后处理 `🟨 待决策`。`🚫 不实施` 表示已明确排除。

本文以旧迁移账本为历史基准，重新对齐当前 Kilo 工作树与 Continue 当前固定源码。它取代旧账本作为“当前事实矩阵”，但不覆盖或删除旧文档。本文只描述 Qwen Coder inline completion；Chat、RAG、Agent、Next Edit 和 UI 不在范围内。

## 1. 审计口径

| 基线 | 固定值 | 说明 |
|---|---|---|
| 旧迁移账本 | `packages/kilo-vscode/docs/CONTINUE_AUTOCOMPLETE_PARITY_LEDGER.md` | 历史计划和阶段记录，不再视为当前实现事实。 |
| 旧 Context 审计 | `packages/kilo-vscode/docs/CONTINUE_AUTOCOMPLETE_CONTEXT_AUDIT.md` | 保留来源分析，重新判定 live capability。 |
| 旧 Prompt 审计 | `packages/kilo-vscode/docs/CONTINUE_AUTOCOMPLETE_PROMPT_RENDERING_AUDIT.md` | 保留模板/token 公式，废弃阶段性 current-state 描述。 |
| Kilo Git 基线 | `d567827207018deef65cf0af450cd9ecd7325835`，分支 `codex/v7.3.42-dev` | 本次比较使用该 HEAD 之上的当前未提交工作树，而不是只比较 HEAD。 |
| Kilo 审计路径指纹 | `ab375d5931bd6a5bee7b4f5900ba8a6367c361c41660928db018f89d4c7fc9e2` | 由 Qwen provider、统一 selector/coordinator 和 CLI Qwen FIM 路由的文件内容清单计算；工作树继续变化后需重算。 |
| Continue 历史基线 | `eaa23c5a9de86049dff765f635c18f61d1d043bb` | 旧账本固定的提交，只用于说明历史。 |
| Continue 当前基线 | [`d0a3c0b626b5bebc3bef4742eec05a0242be0bab`](https://github.com/continuedev/continue/tree/d0a3c0b626b5bebc3bef4742eec05a0242be0bab) | 2026-07-14 通过官方仓库 `main` 锁定。 |

Continue 的 `core/autocomplete` tree 在两个提交上均为 `0264a5d296463fd6d31b07e4bede03fb6abca4f6`。对 `core/autocomplete/**`、`core/util/parameters.ts`、`core/llm/**`、`core/indexing/ignore.ts`、`extensions/vscode/src/autocomplete/**` 和 autocomplete schema 的提交间 diff 为空。因此，Continue 算法没有在这两个基线间漂移；本次矩阵变化主要来自 Kilo 当前工作树已经演进，而不是 Continue 新增了另一套 Qwen 流水线。

### 明确排除

按当前模型约束，以下项目不计入待补差异：

- 请求字段 `stream: true`；Kilo 保持 `stream: false`。
- `CompletionStreamer` 的分块消费方式。
- `GeneratorReuseManager`、pending generator reuse 和 typed-prefix streaming reuse。
- 依赖流中途取消的 `fullStop`。
- `showWhateverWeHaveAtXMs`、首块/部分结果显示等 streaming-only 行为。

排除 streaming 不等于排除非流式请求仍可使用的 `stop`、采样参数、取消、总请求 timeout、prompt、postprocess 或编辑器生命周期。

## 2. 状态和优先级

| 状态 | 含义 |
|---|---|
| `MATCH` | 当前有效语义对齐；不要求逐字复制。 |
| `ADAPTER` | Kilo 的架构、安全或隐私适配；建议保留并测试。 |
| `EXTRA` | Kilo 比 Continue 当前有效运行态更强或更严格。 |
| `GAP` | 非 streaming 的可执行差异，后续可直接补齐。 |
| `DECISION` | 确有差异，但必须先确认产品范围、默认值或隐私政策。 |
| `DORMANT` | 配置或代码存在，但不影响 live runtime；需接线、弃用或删去误导。 |
| `SHARED-RISK` | Kilo 与 Continue 当前行为相同，但两者共有风险；不能误算 Kilo parity gap。 |
| `EXCLUDED` | 本次按用户约束排除。 |

优先级：`P0` 为下一轮首先修复；`P1` 为直接影响用户行为或默认质量；`P2` 为完整性、可观测性或维护风险；`P3` 为延后能力。`—` 表示无 parity 动作。

本轮共审计 50 个原子行为：首轮补齐后剩余 4 个 `GAP`（1 个 P1、3 个 P2），另有 8 个 `DECISION`、3 个 `DORMANT`、18 个 `MATCH`、9 个 `ADAPTER`、6 个 `EXTRA`、1 个 `SHARED-RISK` 和 1 个 `EXCLUDED`。这些计数只表示当前审计分类，不表示完成度百分比。

## 3. 旧计划到当前事实的变化

| 项目 | 旧文档结论 | 当前事实 | 处置 |
|---|---|---|---|
| Continue source-of-truth | 固定 `eaa23c5a...`。 | 当前固定为 `d0a3c0b...`；审计路径算法无提交间变化。 | 旧提交降级为历史引用。 |
| 传输 | 扩展直接 fetch `/v1/completions`，扩展读取 endpoint/API key。 | 扩展经共享 `KiloConnectionService` 调 `/kilo/qwen-fim`；CLI 解析 provider、endpoint、headers 和 auth，再请求上游 `/completions`。 | 旧账本 15、60-62、95 行已失效。 |
| Runtime 激活 | 描述为全局 qwen-only，old manager 永不激活。 | 统一 coordinator 选择 Qwen 或 classic target；仅 Qwen target 保持 classic runtime 关闭。 | “永不激活”只能限定 Qwen target。 |
| Context | 多处描述为空 payload、仅 recently edited 或无 opened/import/root。 | Kilo 已有 recently edited/opened/import definitions/root path 四个 qwen-owned collector；全部默认关闭。 | 旧阶段状态不能继续作为 current-state。 |
| Stop | 旧账本因本地 stop token 列表存在而判为 semantic equivalent。 | 首轮补齐已把列表贯通 extension request、generated SDK、CLI schema 和上游 body，同时保留完整响应后的防御性截断。 | `T04` 已恢复为 `MATCH`。 |
| 限制列表/计数 | A/B/C/D 计数和 Phase 2/3 known limitations 混合了阶段记录。 | 当前 transport、context、selector 和 diagnostics 均已变化。 | 不继承旧计数，按本矩阵重算。 |
| 配置 | 旧 `kilo.autocomplete.enabled/provider/qwen.model` 被视为激活入口。 | Live target 来自 `kilo-code.new.autocomplete.provider/model`；`enableAutoTrigger` 只控制 automatic request gate，不再注销 provider。 | 旧 key 标为 dormant/compat；manual invoke 保留。 |

## 4. 证据索引

### Continue `d0a3c0b` 官方源码

| ID | 证据 |
|---|---|
| `U1` | [`core/autocomplete/CompletionProvider.ts:69-97, 115-147, 150-309`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/CompletionProvider.ts#L69-L309)：LLM 准备、options 合并、manual force、主生命周期、cache、outcome。 |
| `U2` | [`extensions/vscode/src/autocomplete/completionProvider.ts:168-291, 486-607`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/extensions/vscode/src/autocomplete/completionProvider.ts#L168-L607)：editor gate、multi-cursor、manual invoke、selected item、display、range 和 accept command。 |
| `U3` | [`core/util/parameters.ts:3-29`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/util/parameters.ts#L3-L29)：autocomplete 默认 options。 |
| `U4` | [`core/autocomplete/util/HelperVars.ts:41-110`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/util/HelperVars.ts#L41-L110)：current file、AST tree path、prefix/suffix token budget。 |
| `U5` | [`core/autocomplete/snippets/getAllSnippets.ts:17-29, 67-167, 220-266`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/snippets/getAllSnippets.ts#L17-L266)：payload、collector 和实际禁用项。 |
| `U6` | [`core/autocomplete/templating/filtering.ts:55-206`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/templating/filtering.ts#L55-L206)：source priority、去重和 snippet token fit。 |
| `U7` | [`core/autocomplete/templating/index.ts:75-97, 145-315`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/templating/index.ts#L75-L315)：空 suffix 归一化、stop merge、prompt build 和 context-length pruning。 |
| `U8` | [`core/autocomplete/templating/AutocompleteTemplate.ts:53-143, 517-529`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/templating/AutocompleteTemplate.ts#L53-L143)：Qwen single/multifile FIM 和模板选择。 |
| `U9` | [`core/llm/openaiTypeConverters.ts:210-268`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/llm/openaiTypeConverters.ts#L210-L268)，[`core/llm/llms/OpenAI.ts:423-512`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/llm/llms/OpenAI.ts#L423-L512)：OpenAI legacy completions body 和 endpoint。 |
| `U10` | [`core/autocomplete/util/AutocompleteLruCache.ts:24-225`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/util/AutocompleteLruCache.ts#L24-L225)：prefix LRU 和 SQLite persistence。 |
| `U11` | [`core/autocomplete/prefiltering/index.ts:42-82`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/prefiltering/index.ts#L42-L82)，[`core/indexing/ignore.ts:238-255`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/indexing/ignore.ts#L238-L255)：disable/ignore/security。 |
| `U12` | [`extensions/vscode/src/autocomplete/recentlyEdited.ts:26-45, 127-134`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/extensions/vscode/src/autocomplete/recentlyEdited.ts#L26-L134)：recently edited 订阅当前被注释，live payload 通常为空。 |
| `U13` | [`extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts:13-110`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/extensions/vscode/src/autocomplete/RecentlyVisitedRangesService.ts#L13-L110)：selection collector 存在，但当前入口没有注册其 callback。 |
| `U14` | [`core/autocomplete/postprocessing/index.ts:92-200`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/postprocessing/index.ts#L92-L200)，[`core/autocomplete/util/processSingleLineCompletion.ts:41-92`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/util/processSingleLineCompletion.ts#L41-L92)：postprocess 和 single-line range。 |
| `U15` | [`core/autocomplete/util/AutocompleteLoggingService.ts:33-123`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/util/AutocompleteLoggingService.ts#L33-L123)，[`extensions/vscode/src/commands.ts:474-479`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/extensions/vscode/src/commands.ts#L474-L479)：display/accept/reject 状态机和接受命令。 |
| `U16` | [`core/data/log.ts:71-117`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/data/log.ts#L71-L117)，[`packages/config-yaml/src/schemas/data/autocomplete/v0.2.0.ts:3-53`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/packages/config-yaml/src/schemas/data/autocomplete/v0.2.0.ts#L3-L53)：本地 all-level code-bearing log 和 noCode schema。 |
| `U17` | [`core/autocomplete/classification/shouldCompleteMultiline.ts:16-52`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/classification/shouldCompleteMultiline.ts#L16-L52)：multiline classifier 实际代码语义。 |
| `U18` | [`core/autocomplete/filtering/streamTransforms/StreamTransformPipeline.ts:18-82`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/filtering/streamTransforms/StreamTransformPipeline.ts#L18-L82)：stop、suffix、重复和语言过滤顺序。 |
| `U19` | [`core/llm/index.ts:421-475`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/llm/index.ts#L421-L475)：provider fetch 的 HTTP status/url/body error mapping。 |
| `U20` | [`core/llm/index.ts:231-244`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/llm/index.ts#L231-L244)，[`core/llm/constants.ts:1-10`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/llm/constants.ts#L1-L10)：model-derived/configurable max tokens 和 4096 fallback。 |
| `U21` | [`core/autocomplete/templating/getStopTokens.ts:4-31`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/templating/getStopTokens.ts#L4-L31)：公共 autocomplete stop token。 |
| `U22` | [`core/autocomplete/generation/CompletionStreamer.ts:16-83`](https://github.com/continuedev/continue/blob/d0a3c0b626b5bebc3bef4742eec05a0242be0bab/core/autocomplete/generation/CompletionStreamer.ts#L16-L83)：`modelTimeout`、fullStop 和 streaming filters。 |

### Kilo 当前工作树

| ID | 证据 |
|---|---|
| `K1` | `packages/kilo-vscode/src/services/autocomplete/index.ts:59-79,175-323,325-363`：统一 selector/coordinator、fallback 和 commands。 |
| `K2` | `packages/kilo-vscode/src/services/qwen-autocomplete/config.ts:26-74`；`packages/kilo-vscode/package.json:1029-1206`：live 选择配置、Qwen defaults 和 legacy keys。 |
| `K3` | `packages/kilo-vscode/src/services/qwen-autocomplete/index.ts:37-118`：Qwen provider/collector registration 生命周期。 |
| `K4` | `packages/kilo-vscode/src/services/qwen-autocomplete/KiloQwenInlineCompletionProvider.ts:153-461,463-575,651-688,856-948,955-1109,1182-1220`：gate、helper、context、prompt、cache、request、filter、render 和 stale check。 |
| `K5` | `packages/kilo-vscode/src/services/qwen-autocomplete/QwenFimClient.ts:16-50`：扩展到 CLI SDK 的 Qwen FIM contract。 |
| `K6` | `packages/opencode/src/kilocode/server/httpapi/groups/kilo-gateway.ts:151-162,307-319`；`packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts:200-337`：CLI schema、provider/auth 解析和上游请求。 |
| `K7` | `packages/kilo-vscode/src/services/qwen-autocomplete/qwenMultifileFimRenderer.ts:46-179`；`packages/kilo-vscode/src/services/qwen-autocomplete/fimTemplates.ts:6-30`：Qwen single/multifile prompt、预算、suffix helper 和 stop list。 |
| `K8` | `packages/kilo-vscode/src/services/qwen-autocomplete/snippets.ts:43-65,99-243,272-369`：payload、priority、token fit 和 opened-file formatting。 |
| `K9` | `packages/kilo-vscode/src/services/qwen-autocomplete/recentlyEdited.ts:45-109`；`recentlyOpened.ts:43-145`；`importDefinitions.ts:68-155`；`rootPathContext.ts:60-149`：四个 live collector/adapters。 |
| `K10` | `packages/kilo-vscode/src/services/qwen-autocomplete/prefilter.ts`；`language.ts`；`guard.ts`；`packages/kilo-vscode/src/services/autocomplete/shims/FileIgnoreController.ts`：C/C++、Python、Shell、Gitea Workflow selector、语言元数据和安全/ignore gate。 |
| `K11` | `packages/kilo-vscode/src/services/qwen-autocomplete/autocompleteLruCache.ts:23-115`：in-memory prefix LRU。 |
| `K12` | `packages/kilo-vscode/src/services/qwen-autocomplete/range.ts:8-39`；`multiline.ts:21-79`；`postprocess.ts`；`streamFilters.ts`：非流式 filter/postprocess/render adapters。 |

## 5. 主差异矩阵

### 5.1 激活、编辑器入口和生命周期

| ID | 能力 | Continue `d0a3` 有效行为 | Kilo 当前有效行为 | 状态 | 优先级 | 后续动作 | 证据 |
|---|---|---|---|---|---|---|---|
| `A01` | 模型选择 | 每次从 autocomplete role 懒取模型；model 名含 `qwen`+`coder` 时选择 Qwen multifile template。 | coordinator 只接受 connected OpenAI-compatible provider 中精确的 `qwen-coder-30b0`。 | `ADAPTER` | — | 保留精确产品 target；不要宣称通用 Qwen model parity。 | `U1`,`U8`,`K1` |
| `A02` | Provider 注册与自动触发 | provider 保持注册；status/disable 是运行时 gate。 | Qwen target 选中时 provider 保持注册；`enableAutoTrigger=false` 只让 automatic request 返回空，manual path 和 opt-in trackers 保留。 | `MATCH` | — | 保留 registration/manual 回归测试。 | `U2`,`K2`,`K3` |
| `A03` | Manual invoke | `triggerKind=Invoke` 传 `force=true`，只绕过 debounce。 | 显式读取 `triggerKind=Invoke`，保留安全/prefilter gate并跳过 debounce；automatic-off 时仍可请求。 | `MATCH` | — | 保留 manual-vs-automatic 单元测试，并补 Extension Host 验收。 | `U1`,`U2`,`K1`,`K4` |
| `A04` | Multi-cursor | `editor.selections.length > 1` 时拒绝。 | 同一活动文档存在多个 selection 时，在 prompt/CLI 请求前返回空。 | `MATCH` | — | 保留 no-request 单元测试，并补 Extension Host 验收。 | `U2`,`K4` |
| `A05` | `selectedCompletionInfo` | typed length 至少 4，候选必须以当前已输入文本开头；最终拼接 selected text。 | 相同校验和拼接语义。 | `MATCH` | — | 保留。 | `U2`,`K4` |
| `A06` | 文档范围 | 支持普通文件、untitled 和 notebook cell；排除 SCM，空 untitled 被 prefilter。 | 注册 file-scheme C/C++、Python、`.sh` 和 `.gitea/workflows` 下的 YAML；普通 YAML、untitled、notebook 和空 saved document 仍被拒绝。 | `ADAPTER` | — | 保留限定范围和行为测试；新增语言需显式扩展 selector、prefilter 和语言元数据。 | `U2`,`U11`,`K10` |
| `A07` | Cancel/stale | AbortSignal 取消；stream/outcome 在 abort 后不 postprocess。 | 取消前次 HTTP，贯穿 SDK/CLI；额外检查 request id、document version 和 cursor。 | `EXTRA` | — | 保留非流式 stale protection。 | `U1`,`K4`,`K6` |
| `A08` | Gate 顺序 | security → options → debounce（manual 可绕过）→ HelperVars → prefilter。 | enabled → prefilter → guard → selected validation → debounce。 | `ADAPTER` | — | 保留安全优先顺序，但补 A03 manual 语义。 | `U1`,`K4` |
| `A09` | Multi-root 配置作用域 | Continue 使用其统一 config/IDE abstraction。 | 主 provider 按 `document.uri` 读配置；registration 和 edited/opened/import trackers 默认 `read()` 不带 resource，可能读取 active/第一 folder 的配置。 | `GAP` | `P1` | collector 的 config read、注册和测试全部 resource-aware。 | `K2`,`K3`,`K9` |

### 5.2 Current file、context 和 token budget

必须区分“option/type/collector 存在”和“当前 VS Code runtime 真的产生并选择数据”。Continue 的 recently edited/visited 声明为 enabled，但对应采集入口当前未接通；不能把它们误报成 Kilo live gap。

| ID | 能力 | Continue `d0a3` 有效行为 | Kilo 当前有效行为 | 状态 | 优先级 | 后续动作 | 证据 |
|---|---|---|---|---|---|---|---|
| `C01` | Current-file prefix/suffix | 读取完整文件，按 1024/0.3/0.2 默认 token budget 裁 prefix/suffix。 | qwen-owned HelperVars/tokenizer adapter 使用相同公式。 | `MATCH` | — | 保留 source-mapped tests。 | `U3`,`U4`,`K4` |
| `C02` | AST tree path | HelperVars 构造 tree path，供 root-path context 使用。 | HelperVars 的 `treePath` 仍为空；root path tracker 在明确启用时另行解析。 | `ADAPTER` | — | 保留独立 adapter；文档不要称完整 HelperVars parity。 | `U4`,`K9` |
| `C03` | Recently opened | 默认启用；最多读取 tracked files，每文件 80ms，选择阶段最多 10 个候选/5 个输出并按 budget 裁切。 | collector、guard、format/selection 已实现，但 collection 和 injection 默认均关闭。 | `DECISION` | `P1` | 决定是否把它纳入 Qwen 默认 context profile；先做真实延迟/隐私验收。 | `U3`,`U5`,`U6`,`K2`,`K8`,`K9` |
| `C04` | Import definitions | `useImports=true`；active-editor cache warm 后按 cursor 周边符号取 definition snippets。 | qwen-owned VS Code/tree-sitter/fallback adapter 已实现，但 collection/injection 默认关闭。 | `DECISION` | `P1` | 与 C03 一起定义默认 profile；保留 C/C++ bounded reads。 | `U3`,`U5`,`K2`,`K9` |
| `C05` | Root path | 有 AST tree path 时收集 root-path snippets，并进入 base source。 | qwen-owned adapter 已实现，但 collection/injection 默认关闭。 | `DECISION` | `P1` | 与 C03 一起定义默认 profile；无 parser/query 时继续 fail closed。 | `U4`,`U5`,`U6`,`K2`,`K9` |
| `C06` | Recently edited | option 默认 true，但 VS Code text-change 订阅整段被注释，当前 payload 通常为空。 | opt-in collector 真正监听编辑并可注入。 | `EXTRA` | — | 不把 Continue 的声明默认值误当 live target；保留 opt-in。 | `U3`,`U12`,`K9` |
| `C07` | Recently visited | option 默认 true，但 service 的 selection callback 当前没有注册，cache 通常为空。 | payload type 存在但没有 collector，默认空。 | `MATCH` | — | 若未来 Continue 接回 collector，再重新审计。 | `U3`,`U13`,`K8` |
| `C08` | Clipboard | Continue 会采集，但默认 selection=false；用户可显式开启。 | payload type 存在，provider 永远填空。默认行为一致，opt-in 能力缺失。 | `DECISION` | `P3` | 仅在明确隐私策略后考虑，不进首轮补齐。 | `U3`,`U5`,`K8` |
| `C09` | Static context | Continue 有 experimental opt-in collector，默认关闭。 | payload type 存在但没有 collector。 | `DECISION` | `P3` | 延后；不影响默认 parity。 | `U3`,`U5`,`K8` |
| `C10` | Diff / IDE snippets | d0 的 diff collector 硬编码为空，IDE snippets 常量为 false。 | 两者 payload 均为空。 | `MATCH` | — | 不实现不存在的 upstream live capability。 | `U5`,`K8` |
| `C11` | Source priority/去重 | clipboard 1、opened 2、visited 3、edited 4、diff 5、base 99；base shuffle；按 filepath 去重和 token fit。 | selection priority/fit 基本映射；base deterministic；实际 injection 再偏好 edited → opened → imports → root。 | `ADAPTER` | — | 保留 deterministic/privacy adapter，并继续测试。 | `U6`,`K4`,`K8` |
| `C12` | 两层 budget | 先裁 current file，再填 snippets，最后按 model context length/reserved output/safety 比例重裁 prefix/suffix。 | current file 与 snippet budget 已映射；multifile 使用显式 `contextLength` 和 fail-closed hard gate。 | `ADAPTER` | — | 保留超预算 block；不要称逐字等价 generic renderer。 | `U4`,`U6`,`U7`,`K7`,`K8` |
| `C13` | 默认有效 context | opened/import/root 可产生数据；edited/visited/diff/IDE 当前通常为空；clipboard/static 默认不选。 | 四个已实现 source 全部默认关闭，`contextLength=0` 又阻止任何 snippet injection；默认是纯 single-file FIM。 | `DECISION` | `P1` | 下一轮先定默认 context profile 和 context-length 来源，再改默认值。 | `U3`,`U5`,`U12`,`U13`,`K2`,`K7`,`K9` |

### 5.3 Prompt、请求和 transport

| ID | 能力 | Continue `d0a3` 有效行为 | Kilo 当前有效行为 | 状态 | 优先级 | 后续动作 | 证据 |
|---|---|---|---|---|---|---|---|
| `T01` | Qwen FIM markers | Qwen coder 使用 repo/file/system-separator 和 `<\|fim_prefix\|>...<\|fim_suffix\|>...<\|fim_middle\|>`；无 snippets 时仍是 single-file FIM。 | active multifile prompt 语义对齐；inactive/blocked path 使用相同 single-file FIM markers。 | `MATCH` | — | 保留。 | `U8`,`K7` |
| `T02` | 空 suffix | 所有 prompt path 在 suffix 为空时统一改成 `\n`。 | 公共 suffix normalizer 覆盖 single-file、active multifile 和 injection-blocked fallback；三条 EOF 路径均有 literal tests。 | `MATCH` | — | 保留 EOF prompt contract tests。 | `U7`,`K7` |
| `T03` | Stop token 列表 | 合并 9 个 Qwen template stops 与 `/src/`、Python coding header、markdown fence。 | 本地有效列表对齐。 | `MATCH` | — | 保留列表 source tests。 | `U7`,`U8`,`U21`,`K7` |
| `T04` | Generation-side `stop` | `completionOptions.stop` 进入 OpenAI legacy `/completions` body，同时参与过滤。 | 有效 stop list 已贯通 types → generated SDK → CLI schema → upstream body；完整响应后仍执行防御性截断。 | `MATCH` | — | 保留 route body 精确断言和本地 post-filter。 | `U7`,`U9`,`K4`,`K5`,`K6`,`K7` |
| `T05` | Credential/endpoint 边界 | Continue LLM provider 在扩展/core 内直接请求 provider endpoint。 | 扩展不持有 provider secret；CLI 从 provider/auth 解析 endpoint/headers/key 后代理。 | `ADAPTER` | — | 保留 CLI secret boundary。 | `U9`,`K5`,`K6` |
| `T06` | Prompt/suffix transport | OpenAI 的 `supportsFim=false` 路径把完整 rendered FIM prompt 发到 `/completions`。 | rendered prompt 作为 `prefix` 交给 CLI；独立 `suffix` 固定为空，因为真实 suffix 已嵌入 prompt。 | `MATCH` | — | 文档明确，避免把 transport suffix 误判为代码 suffix 丢失。 | `U1`,`U9`,`K5`,`K6`,`K7` |
| `T07` | Temperature | autocomplete 在用户未配置时强制 `0.01`。 | manifest、extension config、benchmark config 和 CLI fallback 均为 `0.01`；显式用户配置仍可覆盖。 | `MATCH` | — | 保留 default/body tests；真实模型质量仍需单独验收。 | `U1`,`K2`,`K6` |
| `T08` | Output max tokens | 来自 LLM/model completion options；无模型值时 BaseLLM 默认 4096，可配置。 | 默认 128，限制 1-2048。 | `DECISION` | `P2` | 以当前 Qwen endpoint 的 latency/quality 上限确定显式值；不要把 128 称源码 parity。 | `U7`,`U20`,`K2`,`K6` |
| `T09` | `top_p`/penalties | 若配置，legacy body 可传 `top_p`、`frequency_penalty`、`presence_penalty`。 | extension config、CLI schema 和上游 body 均没有这些字段。 | `GAP` | `P2` | 仅在目标 endpoint 支持并确有配置需求时补；默认 unset 不影响当前请求。 | `U9`,`K5`,`K6` |
| `T10` | Timeout setting | Continue `modelTimeout` 用于 streaming processing/partial-result 控制。 | `qwen.modelTimeout=150` 只进入 config/diagnostics；真实 CLI 总请求 timeout 固定 30 秒。 | `DORMANT` | `P2` | 因 streaming 排除，不照搬 Continue 语义；改名/弃用，或定义并接线非流式 total timeout。 | `U3`,`U22`,`K2`,`K6` |
| `T11` | 上游错误语义 | provider fetch 保留原始 HTTP failure context。 | CLI 将所有上游非 2xx 折叠为本地 400；client 只看到 400 和 phase，无法区分 401/429/5xx retry class。 | `GAP` | `P2` | 返回结构化 `upstreamStatus`/error class，不泄露 response body。 | `U19`,`K5`,`K6` |
| `T12` | Streaming generation/reuse | Continue 使用 stream、GeneratorReuse、fullStop 和 partial filters。 | Kilo 固定 `stream:false`，完整响应后处理。 | `EXCLUDED` | — | 不实施；只保留非流式等价/防御性过滤。 | `U1`,`K4`,`K6` |

### 5.4 Filter、postprocess、render、cache 和 telemetry

| ID | 能力 | Continue `d0a3` 有效行为 | Kilo 当前有效行为 | 状态 | 优先级 | 后续动作 | 证据 |
|---|---|---|---|---|---|---|---|
| `F01` | Multiline classifier | 使用实际 `shouldCompleteMultiline` 代码语义；有 selected completion 时返回 multiline allowed。 | source-mapped classifier 与测试对齐。 | `MATCH` | — | 保留。 | `U17`,`K4`,`K12` |
| `F02` | Stop/suffix/repetition filters | 在 stream pipeline 按 stop、suffix echo、行重复、markdown 等顺序过滤。 | 将可转移规则映射到完整响应，含 stop/suffix/repetition 防御；不能复制 fullStop。 | `ADAPTER` | — | 按用户约束保留 full-response adapter。 | `U18`,`K4`,`K12` |
| `F03` | Batch postprocess | 丢弃空白、上一行重写、极端重复；Qwen3 特定 thinking strip；清 markdown fence/空格。 | Qwen 路径语义基本 source-mapped；当前 model id 不触发 Qwen3-only branch，与 Continue 一致。 | `MATCH` | — | 保留 Qwen-target tests。 | `U14`,`K12` |
| `F04` | Range/render | single-line 做 suffix-aware replacement；multiline 覆盖 cursor 到当前行尾；设置 `completeBracketPairs=true`。 | 相同有效语义。 | `MATCH` | — | 保留。 | `U2`,`U14`,`K12` |
| `F05` | Display/accept/reject | `markDisplayed` 后维护 displayed outcome；inline item command 记录 accept/reject。 | item 无 command/completion id；只有 render/return diagnostics，没有 displayed/accepted lifecycle。 | `GAP` | `P2` | 补最小本地 accept/display contract；默认不要持久化 prompt/completion。 | `U1`,`U2`,`U15`,`K4`,`K12` |
| `F06` | Code-bearing data logging | Continue display lifecycle 可把 prefix/suffix/prompt/completion 写本地 all-level log，远端由 data config 控制。 | Qwen diagnostics 以 count/phase/path hash 为主，secret 留在 CLI；无 Continue code-bearing outcome store。 | `EXTRA` | — | 保留隐私边界；F05 只补事件，不复制源码持久化。 | `U15`,`U16`,`K4`,`K5` |
| `F07` | Prefix LRU matching | 最长 prefix 命中、typed-delta 校验、返回剩余 completion，容量 1000。 | in-memory qwen-owned adapter 语义对齐。 | `MATCH` | — | 保留。 | `U10`,`K11` |
| `F08` | Cache persistence | SQLite singleton，30 秒 flush，跨进程重启保留。 | memory-only，provider dispose 后丢弃，不写 source-derived text 到磁盘。 | `ADAPTER` | — | 按隐私边界保留 memory-only。 | `U10`,`K11` |
| `F09` | Cache key 与 multifile prefix | lookup 用 `helper.prunedPrefix`，put 用 rendered `outcome.prefix`；key 不含 file/model/provider/suffix/context。 | 同样 lookup raw helper prefix；有注入时 put rendered prefix；key 同样不 namespaced。 | `SHARED-RISK` | — | 不是 Kilo parity gap。若后续加 namespaced semantic key，明确记录为安全 hardening，而非 Continue port。 | `U1`,`U10`,`K4`,`K11` |
| `F10` | Cache hit postprocess | cache 存储已 postprocessed completion；hit 直接进入 render，不再次 postprocess。 | 相同。 | `MATCH` | — | 保留。 | `U1`,`K4` |
| `F11` | Diagnostics | Continue outcome/logging 以 completion lifecycle 为中心。 | Kilo 有 request phase、cache/context count、server phase、hashed path 和 stale diagnostics。默认 `logLevel=off`；debug 下 completion first-line preview 默认允许但会 redact，prompt preview 恒为空。 | `EXTRA` | — | 保留脱敏 diagnostics；不要扩大 code-bearing preview。 | `K4` |

### 5.5 Security、ignore 和配置卫生

| ID | 能力 | Continue `d0a3` 有效行为 | Kilo 当前有效行为 | 状态 | 优先级 | 后续动作 | 证据 |
|---|---|---|---|---|---|---|---|
| `S01` | Security concern patterns | 在主请求前调用 `isSecurityConcern`。 | 复用相同 security list，并用于 current file/context read。 | `EXTRA` | — | 保留 context-read 同等级 guard。 | `U11`,`K10` |
| `S02` | Ignore policy | 支持 `disableInFiles`、global/workspace `.continueignore` 和 Continue config exclusion。 | `.kilocodeignore` 优先；否则 `.gitignore`+`.env*`；workspace 外拒绝；错误 fail closed。 | `ADAPTER` | — | 保留 Kilo policy；文档说明不读取 `.continueignore`。 | `U11`,`K10` |
| `S03` | `onlyMyCode` | 默认 true，但 d0 中它主要约束已被关闭的 IDE snippets；不能解释为所有 source 都 workspace-only。 | 所有 context read 都要求 workspace 内且通过 Kilo ignore。 | `EXTRA` | — | 保留更强边界。 | `U5`,`K10` |
| `S04` | Legacy settings | Continue options 都进入 active config merge。 | `kilo.autocomplete.enabled/provider/qwen.model`、`prefixChars`、`suffixChars` 不驱动当前 Qwen lifecycle。 | `DORMANT` | `P2` | 标 deprecated/compat 或删除 manifest 暴露；迁移代码确认后再动。 | `K2` |
| `S05` | `multifileContext.enabled` | Continue 没有同名总开关；实际 source options 直接控制 context。 | key 被读取并写 diagnostics，但 prompt injection 不检查它。 | `DORMANT` | `P2` | 明确语义并接线，或移除该误导性总开关。 | `K2`,`K7` |

## 6. 后续差异补齐队列

### ✅ 首轮已完成（下一轮不要重复实施）

| 状态 | Gap | 验收结果 |
|---|---|---|
| ✅ 已完成 | `T04` generation-side stop | extension request、generated SDK、CLI schema 和上游 body 已贯通；`stream:false` 与本地 post-filter 保留。 |
| ✅ 已完成 | `T02` empty suffix normalization | single、multifile、injection-blocked 三条 EOF 路径均包含 `fim_suffix + "\n"`。 |
| ✅ 已完成 | `A02` provider registration/automatic gate | automatic-off 不发请求；provider 和 context tracker 保持注册。 |
| ✅ 已完成 | `A03` manual Invoke | automatic-off 时显式 Invoke 仍可请求并跳过 debounce。 |
| ✅ 已完成 | `A04` multi-cursor gate | 同一活动文档有两个以上 selection 时不发 CLI 请求。 |
| ✅ 已完成 | `T07` temperature | manifest、extension 和 CLI 未配置默认值均为 `0.01`。 |

### ⬜ 剩余可直接实施

| 状态 | 顺序 | Gap | 最小改动面 | 最低验收 |
|---|---|---|---|---|
| ⬜ 未完成 | 1 | `A09` multi-root scope | registration 和四个 collector 的 resource-aware config read | 第二 workspace folder 的 provider/context flags 不受第一 folder 污染。 |
| ⬜ 未完成 | 2 | `T09`/`T11` request/error contract | Qwen schema/handler/client + generated SDK/tests | 支持的采样字段按需透传；错误含结构化 upstream status 且不泄露 body/secret。 |
| ⬜ 未完成 | 3 | `F05` accept/display | inline item command、内存 outcome registry、privacy tests | 记录 displayed/accepted/rejected 事件，不持久化 prompt/completion。 |

### 🟨 先决策再实施

| 状态 | 决策 | 当前选择 | 需要确认 |
|---|---|---|---|
| 🟨 待决策 | Default context profile (`C03-C05`,`C13`) | 纯 single-file，四 source 全 off，context length 未知。 | 是否默认启用 opened/import/root；context length 从 provider model metadata 还是显式设置获得；延迟和隐私预算。 |
| ✅ 已决策 | Language/document scope (`A06`) | 支持 file-scheme C/C++、Python、`.sh` 和 Gitea Workflow；空 saved file 仍拒绝。 | 普通 YAML 继续排除，避免扩大配置文件发送范围。 |
| 🟨 待决策 | Output budget (`T08`) | 128 tokens。 | 目标 Qwen endpoint 的质量/延迟/成本基准，以及允许的最大值。 |
| 🟨 待决策 | Clipboard/static (`C08`,`C09`) | 不采集。 | 是否允许读取/发送这些 source；默认必须保持关闭。 |

### 🚫 明确不补

- 🚫 不实施：`T12` 中的 `stream:true`、GeneratorReuse、fullStop 和 partial result。
- 🚫 不实施：Continue SQLite code-bearing cache persistence；保留 Kilo memory-only adapter。
- 🚫 不实施：Continue code-bearing local/remote autocomplete outcome logging。
- 🚫 不实施：Continue 当前已经硬禁用或未接通的 diff、IDE snippets、recently visited 和 recently edited collector，不以“声明默认 true”作为 port 依据。

## 7. 验证边界和下一轮 Gate

当前矩阵是 source-backed audit，并由现有单元/路由测试辅助验证。它不等于真实模型、真实 Extension Host 或安装后 VSIX 验收。

本轮实际运行结果：

| 检查 | 结果 |
|---|---|
| `packages/kilo-vscode`: `bun test tests/unit/qwen-autocomplete*.test.ts tests/unit/autocomplete-manager-lifecycle.test.ts tests/unit/autocomplete-runtime-isolation.test.ts tests/unit/autocomplete-selection.test.ts` | 234 pass，0 fail，859 assertions，20 files。 |
| `packages/opencode`: `bun test ./test/kilocode/server/qwen-fim-custom-provider.test.ts ./test/kilocode/server/kilo-gateway-statuses.test.ts` | 20 pass，0 fail，58 assertions，2 files。 |
| `packages/kilo-vscode`: `bun run typecheck` | 通过。 |
| `packages/opencode`: `bun run typecheck` | 通过。 |
| 根目录：`./script/generate.ts` | 通过；Qwen `stop` 已进入 OpenAPI 和 generated SDK。 |
| `bun run script/check-md-table-padding.ts packages/kilo-vscode/docs/CONTINUE_QWEN_AUTOCOMPLETE_DIFFERENCE_MATRIX_20260714.md` | 通过，无 padded tables。 |
| `git diff --check -- packages/kilo-vscode/docs/CONTINUE_QWEN_AUTOCOMPLETE_DIFFERENCE_MATRIX_20260714.md` | 通过。 |
| Continue `eaa23c5a...` → `d0a3c0b...` audited paths diff | 为空；`core/autocomplete` tree hash 相同。 |

下一轮每个 gap 至少应满足：

1. 只处理本表一个可审查 slice，不顺手开启其他 context 或 UI。
2. 保持 Qwen `stream:false`。
3. 跑相应 `packages/kilo-vscode` 定向单测；涉及 CLI route 时再跑 `packages/opencode/test/kilocode/server/qwen-fim-custom-provider.test.ts`。
4. 涉及 API schema 时重新生成 SDK，不手改 `packages/sdk/js/src/gen/**`。
5. 涉及 shared `packages/opencode/src` 时遵循 annotation guard；当前 Qwen route 位于 Kilo-owned path。
6. 对 manual、multi-cursor、multi-root、display/accept 等 VS Code 行为，补真实 Extension Host 或明确的手动证据。
7. 对 temperature、max tokens、default context profile，必须用真实 Qwen endpoint 做 A/B；mock benchmark 不能作为质量结论。

当前仍缺少以下 runtime evidence：

- 安装态/Extension Host 中 Qwen provider 的真实注册与显式手动触发。
- 第二 workspace folder 的 resource-scoped config/collector 行为。
- multi-cursor 不发请求。
- generation-side stop 在真实上游 body 中生效。
- Provider 切换与 cache 的实际隔离/共享结果。
- 真实 endpoint 的 latency、空结果率、多行率、acceptance 和错误分类；当前 real benchmark path 不可用。

因此，本文件支持“首轮五项差异已完成 source/unit/route 对齐”，但仍不支持宣称完整 Continue parity、真实模型质量验收或安装态生产验收完成。
