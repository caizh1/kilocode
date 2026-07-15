# 07 Diagram Planning and Splitting Rules

## 1. 先计划后画图

必须先生成 `04-diagrams/diagram-plan.md`。表格列：Diagram、Type、Evidence inputs、Functions covered、Branches covered、State transitions covered、Split reason、Output。

业务流程图必须额外生成 `04-diagrams/business-flow-plan.md`。表格列：Diagram、Business level、Evidence inputs、Business capabilities covered、Business steps covered、Business edges covered、Submodules covered、Split reason、Output。

## 2. 图层级

业务流程图层级必须先于代码级详细图规划。业务图和代码图不得混用同一张图表达。

业务图层级：

- B0 business-parent-module-master-flow：总模块 high-level 业务流程图；
- B1 business-submodule-flow：子模块 high-level 业务流程图；
- B2 business-scenario-flow：复杂场景、异常场景、异步等待场景；
- B3 business-data-state-flow：业务对象和业务状态流转图。

代码图层级：

- C0 parent-module-code-flow；
- C1 entry-to-main-code-flow；
- C2 submodule-code-detail-flow；
- C3 function-detail-flow；
- C4 fsm-state-overview；
- C5 fsm-transition-conditions；
- C6 error-retry-timeout-code-flow；
- C7 dependency-data-code-flow。

兼容旧命名时，可将以下层级视为代码图层级：L0 parent-module-master-flow，L1 entry-to-main-flow，L2 submodule-business-flow，L3 function-detail-flow，L4 fsm-state-overview，L5 fsm-transition-conditions，L6 error-retry-timeout-flow，L7 dependency-data-flow。

## 3. 拆图判定

不使用节点数、边数或 subgraph 数量作为机械质量指标。出现以下任一情况时拆图：在 Word 正文宽度下标签不可读；主路径和异常/重试/异步分支互相遮挡；架构边界与函数内部控制流混在一张图；状态转换 guard/action 无法完整标注；数据生命周期与业务动作难以同时追踪。

拆图后保留一张 source-backed overview，并按语义补充 business-parent-main-flow、business-parent-error-retry-flow、business-parent-async-wait-flow、business-parent-data-state-flow 或对应的子模块详图。不得通过删掉异常路径或无限缩小图片维持单图。

## 4. 模块与子模块五视图

父级/目标模块和每个重要子模块都必须规划 architecture、business flow、code flow、state machine、data/lifecycle 五类视图。只有源码中不存在 state、phase、event、dispatch、handler、lifecycle 或 transition 证据时，状态机才可标记为 `N/A`，并在计划中写出证据和理由。

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
