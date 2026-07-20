# 03 Source Exploration Rules

## 1. 探索边界

源码探索必须以 `module-scope.md` 为边界。禁止一开始无约束全仓 grep。边界外扩展必须记录扩展原因、关键词、目录、新发现是否纳入主模块。

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

子模块不是简单目录名。先在 `module-scope.md` 中冻结 `ScopeRegion`：目标源码根、公开头文件/接口、构建注册、初始化清理、上游调用者、下游依赖和平台/配置变体。每个 region 记录路径、边界角色、纳入/排除证据、探索完整性和限制。每发现新的源码所有权边界，就加入下一轮 discovery frontier；持续迭代，直到一轮没有新增 region、hit、signal 或 candidate。

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

至少两个相互独立的源码信号可以确认子模块；显式构建目标/模块注册、稳定公开接口边界、独立状态机、独立数据或资源所有权任一项可作为单项强证据。具有强信号的候选默认必须确认；只有逐项反证证明它是别名、重复归属或不拥有职责/状态/资源的 helper/adapter 时才可排除，单写 `helper` 或 `adapter` 标签不是反证。每个 confirmed candidate 必须且只能映射一个 target-owned confirmed-submodule DesignUnit，反向亦然。冻结分解表前必须满足发现面、hit、signal 闭环、`candidateCount = confirmedCount + excludedCount`、`unmappedCandidateCount = 0`、`confirmedCandidateCount = submoduleDesignUnitCount`。DesignUnit 集合只包含一个 target DesignUnit 和 target 内部的 confirmed-submodule DesignUnits，因此 `D = 1 + confirmedCandidateCount`；context parents 不计入 `D`。未闭环时不得冻结 `D`、不得开始 `5D` 图形计划，也不得声明完整交付通过。

## 7. 输出文件

必须生成：`source-file-index.md`、`source-evidence-index.md`、`call-chain-evidence.md`、`data-structure-evidence.md`、`state-and-error-evidence.md`、`submodule-discovery-surfaces.md`、`submodule-discovery-hits.md`、`submodule-discovery-signals.md`、`key-functions-and-submodules.md`、`function-deep-analysis.md`、`submodule-flow-analysis.md`。
