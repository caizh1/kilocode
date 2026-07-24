# 03 Source Exploration Rules

## 1. 探索边界

源码探索必须以 `module-scope.md` 为边界。窄范围基础架构图的 reference override 固定为且仅为 `03 → 07 → 08`；禁止读取 `01` 或任何其他 reference，每份独占一个消息。额外 reference 设置 `extraReferenceReadCount > 0` 并立即停止。用户给出明确目标路径时，首个源码调用必须是一次独立的 `read(filePath=<用户原样给出的精确目标路径>)`，第二个源码调用必须是 target-scoped symbol grep；第二个源码调用返回前禁止任何头文件或实现文件 read。任一顺序不符立即失败并停止，不采用其输出。不得把首调用替换为父目录、仓库根、推断出的更宽路径、glob/grep 或代理探索。禁止一开始无约束全仓 grep。边界外扩展必须记录扩展原因、关键词、目录、新发现是否纳入主模块。

所有源码探索必须由当前模型通过本 Skill 允许的直接证据工具完成并计入同一调用账本。禁止调用 `task`、agent manager、subagent、委派模型或在其 prompt 中要求扫描目录、逐文件阅读、总结调用关系；也禁止用 shell 脚本、后台任务或组合命令把多次源码探索伪装成一次调用。发生任何委派或预算逃逸时，当前阶段立即失败并停止，不得采用其输出、继续绘图或把它改记为一次源码调用。

每个 assistant message 最多只能包含一次源码 `glob`、`grep` 或 `read`。发出该工具调用后必须立即结束当前响应并等待其返回；不得在同一消息中预先排队第二个源码调用，也不得把多个头文件或实现文件并行读取。出现第二个源码调用时，无论工具是否成功，本轮都立即失败且不得采用这批输出。

窄范围基础架构从第一份 reference read 到 terminal review 全程要求 `ONE TOOL CALL TOTAL/message`：reference read、mkdir、ledger write/edit、source read/grep、artifact read/write、validate 和 render 各自独占 assistant message，调用后立即结束响应。bootstrap 固定为三个独立消息：创建目录 → 写入 ledger 表头和唯一 sentinel → source call #1；不得把 mkdir 与 ledger/source、ledger write 与 source 或任意两个工具合并。违反即 `multiToolMessageViolationCount > 0`、`STOP_NOW`，整批输出作废。Reference read 不增加 `sourceEvidenceCallCount`。

窄范围基础架构图不得把预算消耗在逐头文件阅读上：窄图只允许固定源码 slots：`#1 target-dir read → #2 target-symbol grep → #3 public header → #4 main impl → #5 one confirmed-submodule header → #6 highest-uncovered-relation implementation → #7 frozen-filename build-manifest parent grep → #8 exact egress parent grep(optional)`；#6 和 #7 必须执行，#6 选择能一次闭合最多尚无直接关系证据节点的实现文件，#7 用 call #1 冻结的编译单元文件名确认目标所有权。不得换序、插入其他调用或对空结果改宽重试。#2 是出现的第一次 target-scoped grep 工具调用，而不是模型事后挑选的“有效查询”；该调用返回后，无论有结果、零结果、错误或模式不理想，下一条工具调用只能用 `oldString=sentinel` 追加 ordinal #2，禁止第二次/替代/更宽 grep。`targetSymbolGrepCallCount = 1`、`replacementTargetGrepCount = 0`；不满足即 `STOP_NOW`，不能把两次查询合并成一个 ledger row。每次 `.h` read 前先分类并登记 `public_boundary`、`confirmed_submodule_boundary` 或 `support_definition_platform`；第三类在任何目的下都不得 read，即使为了确认出口回调、成员类型、结构体定义或函数签名。实现调用点的具名调用/回调成员已足以作为出口证据；缺名时使用 exact-symbol grep。允许最多两次窄化 parent-scoped grep：一次用冻结编译单元文件名确认 build manifest，一次用已登记的确切 caller/egress symbol 闭合边；禁止 parent read/glob。要求 `publicHeaderReadCount <= 1`、`focusedSubmoduleHeaderReadCount <= 1`、`supportDefinitionPlatformHeaderReadCount = parentDirectoryReadCount = parentGlobCount = 0`、`parentScopedGrepCount >= 1 && parentScopedGrepCount <= 2`。

加载三份 reference 后、源码 call 1 前创建 `02-source-evidence/source-call-ledger.md`，写入九列表头 `Ordinal | Tool | Exact Path/Scope | Pattern/File | Purpose | Result Evidence | Observed Anchor IDs | Scope Kind | Header Class` 及唯一哨兵 `<!-- SBDD-APPEND-SOURCE-ROW -->`。每次源码 `read/grep/glob` 返回后，无论成功、零匹配、错误、定位还是分页，下一条 tool call 只能在独立 message 中 edit 该哨兵：`oldString=sentinel`，`newString=<当前真实 ordinal 行>\n<sentinel>`；空/失败写 `EMPTY`/`ERROR` 并消耗 slot。该行必须同时冻结本次工具结果中实际可见的节点/接口锚点和关系锚点，格式为 `S<ordinal>A<n>=path:start[-end]@symbol-or-relation`；看到直接调用、字段依赖、所有权、控制或数据交接时，必须当场用 `@source -> relationship -> target` 记录，不能只记所在函数起点。若关系由同一精确对象的 producer/consumer 接口共同证明，则分别冻结两个接口锚点。没有可见行级证据时写 `NONE`。Anchor ID 到 path/line/meaning 的映射写入后永久不可变；后续 ledger 只能引用裸 ID（如 `S4A2`），禁止写 `S4A2=...` 重新定义、改行号或改语义。固定的 source call #1 是目录列表，其 `Observed Anchor IDs` 单元格必须字面等于 `NONE`；`@dir_listing`、`@file_exists`、无 `:line` 的路径或其他目录伪锚点均使 `directoryPseudoAnchorCount > 0`，必须停止且不得发出 call #2。目录列表只证明文件存在，grep 只证明命中的精确行/符号；二者都不能证明未显示的函数体、调用、所有权或依赖。不得记录工具输出中未出现的路径、行号、符号或关系。每次 edit 前后 sentinel count 必须为 1；禁止匹配表头/旧行、读取账本排错，或用 bash/shell/write fallback。edit 失败立即 `STOP_NOW`。成功前禁止续读、grep 或其他源码调用；违反即 `unledgeredSourceCallCount > 0`，后补不能恢复。ordinal 必须按工具时间顺序，禁止凭记忆重建、重排或省略调用。每个 target/parent 源码调用恰好一行。独立回读后从数据行重新计算 `sourceCallLedgerRowCount` 和 `observedSourceAnchorIdSet`，要求 `unledgeredSourceCallCount = offSequenceSourceCallCount = unobservedLedgerAnchorCount = directoryPseudoAnchorCount = anchorRedefinitionCount = 0` 且 `sourceEvidenceCallCount = sourceCallLedgerRowCount = finalSourceCallOrdinal <= 8`，并从 header class/scope kind 计算所有计数。最终回答、自写汇总或脑内重数不能覆盖 ledger；缺行、重复 ordinal、错误分类、虚构锚点或计数不等时禁止写 MMD。

## 2. 工具优先级

使用顺序：代码图/cgc → LSP/clangd → ast-grep/tree-sitter → rg/grep/glob/find → 读取源码原文确认。任何工具结果在写入正文或图前，都必须回到源码原文或精确位置证据确认。

## 3. 必须探索对象

必须探索：主目录、对外头文件、初始化入口、对外接口、核心控制结构体、全局变量和上下文、状态枚举和状态字段、错误码和异常分支、主调用链、上游调用者、下游依赖、构建脚本、模块注册、关键函数内部控制流、参数校验、数据读写、错误恢复、资源清理、子模块协作时序和数据传递。

## 4. 源码证据 ID

源码证据 ID 使用 `SRC-0001` 递增。`source-evidence-index.md` 模板：

```md
| 证据ID | 类型 | 路径 | 符号/行号 | 证据摘要 | 支撑结论 |
|---|---|---|---|---|---|
```

## 5. 关键函数深度分析

关键函数包括：对外 API、初始化/启动/停止/清理、状态迁移函数、错误处理入口、资源分配/释放、用户要求深度分析的函数。必须记录：函数签名、参数校验、局部变量、控制流分支、数据操作、下游调用、错误分支、状态变更、函数规模。

## 6. 发现面、命中、信号与候选闭环

子模块不是简单目录名。先在 `module-scope.md` 中建立 `ScopeRegion`：目标源码根、公开头文件/接口、构建注册、初始化清理、上游调用者、下游依赖和平台/配置变体。冻结前另建 target compilation-unit census：每个目标范围内参与构建的实现单元及匹配头文件逐行映射到 target orchestration、Candidate ID、证据化 alias/duplicate owner 或严格限定的 generated/test/inactive non-submodule；要求 `unmappedTargetCompilationUnitCount = 0`。C/C++ 不能只依赖这个自报计数：还要把 `targetSourceRoot` 下每个实际 `.c/.cc/.cpp/.cxx` 路径写入 `design-unit-census.json.implementationUnits[]`，由 Mermaid 语义校验器核对路径全集与 disposition。独立 `.c/.h` 只是信号而非机械结论，但它与 exported API、专属转换、生命周期、数据/资源所有权或稳定调用阶段结合时属于强信号，默认确认。每个 region 记录路径、边界角色、纳入/排除证据、探索完整性和限制。每发现新的源码所有权边界，就加入下一轮 discovery frontier；持续迭代，直到一轮没有新增 region、hit、signal 或 candidate。

`submodule-discovery-surfaces.md` 使用 `ScopeRegionId x DiscoveryClass` 必审矩阵。DiscoveryClass 固定为：business capability、stable interface、build/registration、initialization/cleanup、call-chain stage、state/event owner、data/resource/queue/cache owner、error/recovery owner。每行记录 DiscoverySurfaceId、ScopeRegionId、DiscoveryClass、查询范围/表达式/工具、Search evidence IDs、DiscoveryHitIds、Zero-result evidence IDs、是否截断、续查结果和 Status。截断未续查的 surface 不得关闭。冻结矩阵前必须满足：

```text
requiredDiscoverySurfaceCount
  = searchedDiscoverySurfaceCount
  + evidencedSurfaceNaCount
unsearchedDiscoverySurfaceCount = 0
truncatedWithoutContinuationCount = 0
```

每个 positive result 都生成唯一 `DiscoveryHitId`，逐条映射到一个 DiscoverySignalId，或以证据关闭为 duplicate/irrelevant：

```text
discoveryHitCount
  = signalizedHitCount
  + evidencedDuplicateHitCount
  + evidencedIrrelevantHitCount
unclassifiedDiscoveryHitCount = 0
```

`submodule-discovery-signals.md` 必须逐条记录 DiscoverySignalId、DiscoveryHitIds、Signal kind、Source path/line、Symbol、Evidence IDs、Candidate ID、Disposition 和 Disposition evidence。每条信号必须映射到一个 Candidate ID，或以源码证据关闭为 `evidenced_non_submodule`；不得在候选表完成后删除不方便解释的信号。冻结候选表前必须满足 `discoverySignalCount = mappedToCandidateSignalCount + evidencedNonSubmoduleSignalCount` 且 `unmappedDiscoverySignalCount = 0`。

`key-functions-and-submodules.md` 必须包含候选闭环表：Candidate ID、Candidate name、DiscoverySignalIds、StrongSignalIds、Responsibility key、Ownership key、Boundary evidence IDs、Decision、Decision evidence IDs、Exclusion counter-evidence IDs、Alias/duplicate owner、DesignUnitId、Destination section、Confidence。每个发现过的候选必须保留一行，最终只能是 `confirmed_submodule` 或 `excluded_non_submodule`。候选表中的 signal ID 集合必须与 signal 表中指向该 candidate 的 ID 集合严格双向相等。排除必须有逐项源码反证；合并或别名必须保留原 Candidate ID 并指向承载它的已确认行。禁止静默删除、改名、合并或因为预计图太多而降级候选。

对 target-owned build unit 使用 fail-closed 分类。除 target orchestration 和 generated/test 外，若独立实现单元具有配对接口/头文件以及 callable/cross-file symbols，直接确认为子模块；不得再以“业务职责不够独立”进行主观降级。无状态、纯函数、转换、utility、storage、adapter、共享或单调用者仍是独立设计边界；“只被另一单元使用”只是依赖边。排除只接受：(1) 无实现/API 的 header-only definitions；(2) 范围外 generated/test；(3) 逐符号证明全部行为仅透传、没有任何 validation/transformation/state/resource/error/lifecycle 语义的 exact alias/duplicate，并指向唯一 confirmed owner。每个 confirmed candidate 与 target-owned DesignUnit 双射。冻结前要求 compilation-unit/discovery/hit/signal 闭环、`candidateCount = confirmedCount + excludedCount`、`unmappedDiscoverySignalCount = 0`、`unmappedCandidateCount = 0`、`confirmedCandidateCount = submoduleDesignUnitCount`；`D = 1 + confirmedCandidateCount`。

## 7. 输出文件

必须生成：`source-file-index.md`、`source-evidence-index.md`、`call-chain-evidence.md`、`data-structure-evidence.md`、`state-and-error-evidence.md`、`submodule-discovery-surfaces.md`、`submodule-discovery-hits.md`、`submodule-discovery-signals.md`、`key-functions-and-submodules.md`、`function-deep-analysis.md`、`submodule-flow-analysis.md`。
