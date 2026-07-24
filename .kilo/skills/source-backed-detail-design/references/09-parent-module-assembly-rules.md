# 09 Target Module Assembly and Owning-Module Rules

文件名为兼容现有 reference 集合而保留；这里的 mandatory assembly owner 是解析后的 target module，不是其所属上级模块。完整交付中，target module 必须具备五类视图：

1. target-module-architecture：架构边界、组件、上下游和共享资源；
2. business-target-module-master-flow：high-level 业务总流程图；
3. target-module-code-flow：入口、调用层、分支、回调和清理；
4. target-module-state-machine：状态、事件、guard/action 和恢复；若目标模块不存在持久控制状态转换关系则证据化 `N/A`；
5. target-module-data-lifecycle：数据创建、所有权、传递、并发访问和释放。

business-target-module-master-flow 必须先于 target-module-code-flow 完成。业务总图聚合全部 source-confirmed 流程族和 target 内部子模块业务图；它不能用一个代表性子流程、状态机或组件拓扑替代端到端闭环。target 代码图聚合代码级子模块图、状态机图和异常路径图。

Target 五类 source 必须在子模块语义、证据、复杂度实例以及全部 base/focused 要求已冻结后生成。前置条件：存在源码支持的 entry-to-main-flow；每个已确认子模块的五类槽位已有证据或状态机证据化 `N/A`；error/retry/wait/timeout 路径已规划或说明源码无相关路径；edge coverage 已映射关键边。图形阶段按冻结顺序逐槽执行独立 `render_mermaid_diagram` 事务；任一 source 或 PNG 失败立即保存续作点并停止后续 target/child 图与全部 Word 工作。

业务总图前置条件：

- target business-capability-map 非空；
- business-flow-steps 非空；
- business-flow-edges 非空；
- 14-business-flow-family-census 非空，且 `unmappedFlowFamilyCount = 0`、`missingBusinessEdgeCount = 0`、`missingBusinessTerminalCount = 0`；
- 每个已确认子模块 high-level 业务流程的语义、证据、边和 Mermaid source 已完成；
- 子模块业务图 edge coverage 无 unverified；
- 总图覆盖或导航到全部流程族、关键决策、异步 handoff、失败恢复和终态，不展开函数内部。

五类父图合计必须覆盖外部入口、对外 API、子模块边界、核心数据结构、关键状态机、主要状态转换、下游依赖、error/wait/retry/complete 出口、数据所有权和指向子图的节点说明。单张图只承担自己的语义，不要求把全部信息塞入一张总图。

Target 汇总图不能展开所有函数内部细节。函数内部细节必须在子图中表达。Target 图的每个子模块节点应在 `diagram-index.md` 对应到具体子图文件。

代码/架构视角 target 图不得替代 business-target-module-master-flow。最终正文必须同时引用 high-level 业务总图和代码/架构视角 target 图。

## 系统架构定位、所属上级模块与目标角色

系统架构位置、源码归属、所属上级模块、调用关系、数据/状态/控制权 handoff、依赖、协作、管理和资源所有权必须分别取证，并在全文所有出现位置保持一致。源码归属不能证明系统层级；所属上级模块不能自动视为业务上游或调用入口；调用关系不能证明所有权；目标属于某系统层内部时不得把同一系统层写成目标下游。“管理”或“位于……之间”必须有直接证据，证据不足时标记“待确认”。

所属上级模块只用于说明目标在系统中的位置、源码归属、进入/退出接口、关键 handoff 和边界。必要时可以生成一张 source-backed positioning architecture 或 interaction figure，但该图不属于 DesignUnit、不占 `5D`、不建立 FsmAudit，也不能替代 target 的任何五类图。该关系规则适用于所有章节、表格、图、图注、review notes 和结论，不限于固定章节。生成内容统一使用“所属上级模块”，不得显示内部字段名或其直译。

## 内部架构与子模块分解

Target module 正文的第 4 至第 8 章共同组成唯一 root target DesignUnit：第 4 章放架构基础图，第 6 章放唯一业务流程基础图，第 7 章只分解 target 内部候选并放闭环后的子模块分解表且不占五视图槽位，第 8 章放数据/生命周期、代码流程、状态机或 `N/A` 以及其他实现细节。第 8 章只引用第 6 章业务主图，不重复插入或计数。第 9 章开始逐个放 target-owned confirmed submodule 的连续本地章节。分解表至少包含 Discovery Signal IDs、Candidate ID、源码位置、业务定位、职责、输入输出、上游/下游及其关系类型、关键状态或生命周期对象、确认结论与依据、排除原因或合并归属、重要性/深挖依据、详细章节、证据和置信度。表旁必须同时报告 discovery signal 和 candidate 的 mapped/unmapped 数量，且两者 `unmapped=0`。每个 `confirmed_submodule` 行都必须进入本地章节和五视图覆盖账本；所属上级模块不得出现在此表中伪装为 target 子模块。

Target 汇总节点必须链接到对应的已确认子模块连续章节。Target 代码图、状态图、对象索引或性能汇总只能表达跨单元关系，不能替代子模块本地架构、业务、数据、代码、状态和异常恢复说明。所属上级模块定位图同样不能替代 target 或子模块本地内容。
