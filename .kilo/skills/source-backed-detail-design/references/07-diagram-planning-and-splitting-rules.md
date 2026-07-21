# 07 Diagram Planning and Splitting Rules

## 1. 先计划后画图

必须先完成 ScopeRegion 固定点探索、DiscoverySurface/Hit/Signal、候选子模块、DesignUnit 双射、FsmAudit、complexity source 闭环，以及目标模块和全部确认子模块的十四项内容草稿与证据表，再生成图形计划。图形必须从已写清的业务流程、代码路径、状态转换和对象生命周期中导出，不能用图形数量替代正文深度；绘图暴露的新缺口必须回写对应内容草稿。发现闭环至少满足 `discoverySignalCount = mappedToCandidateSignalCount + evidencedNonSubmoduleSignalCount`、`unmappedDiscoverySignalCount = 0`、候选 signal ID 双向严格相等和 confirmed Candidate/DesignUnit 双射。不得把一个数组式“图清单”同时当作基础槽位和实际 artifact 账本。

`04-diagrams/coverage-slots.md` 一行一个基础槽位，列固定为：DesignUnit ID、Candidate ID、DesignUnit、Unit kind、View type、Requirement、Evidence IDs、FSM decision、Base diagram ID、Status。唯一 target module 与每个 target-owned `confirmed_submodule` 形成严格 `5D` 行；所属上级模块不进入该表。

`04-diagrams/diagram-requirements.md` 一行一张实际必需图，列固定为：Diagram ID、Base/focused、Owning slot、Complexity instance IDs、Evidence inputs、Functions/branches/transitions/owners covered、MMD path、Source status、Syntax validation、Semantic coverage、PNG path、Visible figure ID、Target section、Render disposition、Visual QA status、Word insertion status。其他 reference 引用时不得删减或改写这套 canonical 字段。

设一个 target DesignUnit 与其已确认子模块的设计单元总数为 `D = 1 + confirmedSubmoduleCount`。在写 Mermaid 源码前，账本必须先出现 `5D` 个基础槽位；复杂视图拆出的 overview、branch、error/retry、async、lifecycle、transition 或 handler 图作为附加行关联到对应基础槽位。只有状态机槽位允许证据化 `N/A`。若聚焦详图数为 `F`，必需图数为 `requiredFigureCount = 5D - stateMachineNaCount + focusedFigureCount`；不得仍以 `5D - N/A` 作为含复杂度实例任务的最终图片数。所属上级模块定位图不计入 `D`、`5D` 或 requiredFigureCount。

基础槽位就绪公式固定为 `expectedBaseSlots = 5D - evidencedStateMachineNaCount`。每个非 `N/A` 槽位必须拥有唯一 Diagram ID 和唯一 PNG；caption-only、重复 ID、重复 PNG、共享总图或只有 Mermaid source 都不计覆盖。只有 `missingSlotCount = 0` 且 `duplicateDiagramIdCount = 0` 时图形阶段才可终结，否则 Word 状态必须保持 `not_started`。

业务流程图必须额外生成 `04-diagrams/business-flow-plan.md`。表格列：Diagram、Owning design unit、Business level、Evidence inputs、Business capabilities covered、Business steps covered、Business edges covered、Submodules covered、Split reason、Output。`business-target-module-master-flow` 是 target DesignUnit `business flow` 基础槽位的唯一主图，不得再作为 `5D` 之外的附加图重复计数；只有另行拆出的异常、异步、场景或数据状态详图才是附加图。Target 主图不能替代任何 confirmed submodule 的本地业务图，所属上级模块交互图也不能替代 target 主图。

## 2. 图层级

业务流程图层级必须先于代码级详细图规划。业务图和代码图不得混用同一张图表达。

业务图层级：

- B0 business-target-module-master-flow：目标模块 high-level 业务流程图；
- B1 business-submodule-flow：子模块 high-level 业务流程图；
- B2 business-scenario-flow：复杂场景、异常场景、异步等待场景；
- B3 business-data-state-flow：业务对象和业务状态流转图。

代码图层级：

- C0 target-module-code-flow；
- C1 entry-to-main-code-flow；
- C2 submodule-code-detail-flow；
- C3 function-detail-flow；
- C4 fsm-state-overview；
- C5 fsm-transition-conditions；
- C6 error-retry-timeout-code-flow；
- C7 dependency-data-code-flow。

兼容旧 artifact 名称时，可将 `parent-module-*` 视为历史文件名，但其语义所有者必须是当前 target module，不能因此把所属上级模块升格为 DesignUnit。其他兼容层级为：L1 entry-to-main-flow，L2 submodule-business-flow，L3 function-detail-flow，L4 fsm-state-overview，L5 fsm-transition-conditions，L6 error-retry-timeout-flow，L7 dependency-data-flow。

## 3. 拆图判定

不使用节点数、边数或 subgraph 数量作为机械质量指标。该规则只约束单图复杂度和拆图深度，不得用于减少 `5D` 基础槽位。出现以下任一版面情况时拆图：在 Word 正文宽度下标签不可读；主路径和异常/重试/异步分支互相遮挡；架构边界与函数内部控制流混在一张图；状态转换 guard/action 无法完整标注；数据生命周期与业务动作难以同时追踪。

以下语义复杂度不依赖版面拥挤。先从全部 entry、BF、CE、BR、ST、ownership/lifecycle 和 platform/feature/build/init evidence ledgers 反向导出 `04-diagrams/complexity-sources.md`，逐条记录 ComplexitySourceId、Source kind、DesignUnit ID、Origin evidence IDs、Disposition、Instance ID 和 Disposition evidence IDs。Disposition 只能是 `focused_instance`、`base_view_only` 或 `evidenced_non_instance`；后两者必须使用限定理由和证据。要求 `complexitySourceCount = mappedToInstanceCount + evidencedBaseViewOnlyCount + evidencedNonInstanceCount` 且 `unmappedComplexitySourceCount = 0`。

再生成 `04-diagrams/complexity-census.md`，逐实例记录 Signal ID、DesignUnit ID、Kind、ComplexitySourceIds、Evidence IDs、Required view/figure kind、Diagram IDs、MergeGroupId、Merge reason、edge/transition/owner/variant coverage、Status。不得只按类别写一个泛化 signal，也不得只有 merge reason 而没有 diagram ID：

- 多入口（multi-entry）或多个独立业务流程族：每个入口/流程族各有实例，保留本地 overview，并生成业务流程详图；
- 异步等待、回调、超时或取消链：生成 async detail；
- 独立错误、重试、恢复或回滚链：生成 exception/recovery detail；
- 多个独立 FSM 域：每个域生成 state overview 和 transition detail；普通非状态 dispatch 域逐实例生成 code-flow dispatch detail，不当作状态机；
- 多个独立数据/资源所有权或生命周期族：生成对应 lifecycle detail；
- 实质不同的平台、feature flag、构建注册或初始化变体：生成 architecture 或 code-flow variant detail。

多个实例共图时必须具有相同 DesignUnit、view 和 figure kind，共享 MergeGroupId，并逐实例证明语义覆盖和可读性；跨 DesignUnit/基础槽位共图禁止。`focusedFigureCount` 按唯一 focused diagram ID 计算，且 base/focused diagram ID 集合不得相交。

拆图后保留一张 source-backed target overview，并按语义补充 business-target-main-flow、business-target-error-retry-flow、business-target-async-wait-flow、business-target-data-state-flow 或对应的子模块详图。不得通过删掉异常路径或无限缩小图片维持单图。

## 4. 模块与子模块五视图

请求解析后的 target module 和每个已确认子模块都必须规划 architecture、business flow、code flow、state machine、data/lifecycle 五类视图。重要性不决定是否进入覆盖账本；复杂度实例决定必须增加哪些聚焦详图。Target 和子模块使用相同的 `PRESENT | N/A | MISSING` FSM audit：只有持久控制状态参与 `current state -> event/trigger -> guard/action -> next state` 关系时才要求状态机图；只有完整 absence audit 才能标记 `N/A`；证据不足必须是 `MISSING`。普通 opcode/command/type 分派、handler table、普通 switch selector、结果/status 字段或数据/资源生命周期本身不是状态机证据，应进入相应 code/lifecycle complexity source，而不是虚构状态。所属上级模块不在五视图矩阵中；需要时只能生成额外的定位或交互图。

每个非 `N/A` 基础槽位至少需要一张唯一主图。一张 PNG、一个 Mermaid source 或一个 diagram ID 只能归属一个设计单元的一种基础视图；跨模块总图、共享依赖图、所属上级模块定位图和聚合图是附加图，不能为多个基础槽位重复计数。每张 DiagramRequirement 的 source status 依次是 `planned -> authored -> syntax_validated -> semantic_validated`，或以 blocker evidence 结束为 `MISSING`。正常完整路径先完成所有已确认子模块 base+focused source 的语法和语义验证，再生成 target-module 汇总源。具体 child source blocker 允许继续 target 图和 `PARTIAL`，但不能 PASS；子模块 PNG 失败不能阻塞 target 图的生成或渲染。

每张必需图必须有 terminal disposition：`semantic_validated -> attempted_success | attempted_failed`；`MISSING -> not_attemptable + blockerEvidenceIds`。要求 `requiredFigureCount = attemptedSuccessCount + attemptedFailedCount + notAttemptableCount`。完整 PASS 要求 `attemptedSuccessCount = requiredFigureCount`、`attemptedFailedCount = 0`、`notAttemptableCount = 0`；不得伪造 Mermaid source 只为满足 render attempt。

## 5. 有效代码级流程图

代码级流程图必须覆盖源码中实际存在的 decision、branch label、switch/case、loop、condition 下调用、state/data read/write、return、error、wait/retry、complete 和 evidence mapping。不存在的结构记录为不适用，不通过虚构分支或节点满足数量要求。

本条适用于代码级详细业务/逻辑图。high-level 业务流程图的有效性以第 6 节为准。

## 6. high-level 业务流程图有效性

high-level 业务流程图必须覆盖真实存在且适用的以下语义：

- 外部业务触发；
- 业务输入对象；
- 子模块业务动作；
- 业务条件边；
- 业务状态或数据影响；
- 下游依赖或异步等待；
- 错误/重试/终止路径；
- 成功完成路径；
- BF edge coverage。

high-level 业务流程图不得以函数名作为主流程节点，不得只有组件拓扑，不得只画 happy path。
