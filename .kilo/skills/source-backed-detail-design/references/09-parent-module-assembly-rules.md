# 09 Parent Module Assembly Rules

父模块必须具备五类视图：

1. parent-module-architecture：架构边界、组件、上下游和共享资源；
2. business-parent-module-master-flow：high-level 业务总流程图；
3. parent-module-code-flow：入口、调用层、分支、回调和清理；
4. parent-module-state-machine：状态、事件、guard/action 和恢复；
5. parent-module-data-lifecycle：数据创建、所有权、传递、并发访问和释放。

business-parent-module-master-flow 必须先于 parent-module-code-flow 完成。业务总图聚合子模块业务图；代码父图聚合代码级子模块图、状态机图和异常路径图。

父模块总图必须最后生成。前置条件：存在源码支持的 entry-to-main-flow；每个重要子模块的五类视图已完成或状态机已给出证据化 `N/A`；error/retry/wait/timeout 路径已绘制或说明源码无相关路径；edge coverage 覆盖子图关键边。

业务总图前置条件：

- business-capability-map 非空；
- business-flow-steps 非空；
- business-flow-edges 非空；
- 每个重要子模块 high-level 业务流程图已生成；
- 子模块业务图 edge coverage 无 unverified；
- 总图只聚合业务子模块，不展开函数内部。

五类父图合计必须覆盖外部入口、对外 API、子模块边界、核心数据结构、关键状态机、主要状态转换、下游依赖、error/wait/retry/complete 出口、数据所有权和指向子图的节点说明。单张图只承担自己的语义，不要求把全部信息塞入一张总图。

父图不能展开所有函数内部细节。函数内部细节必须在子图中表达。父图每个子模块节点应在 `diagram-index.md` 对应到具体子图文件。

代码/架构视角父图不得替代 business-parent-module-master-flow。最终正文必须同时引用 high-level 业务总图和代码/架构视角父图。

## 内部架构与子模块分解

目标模块正文必须在父/目标架构与详细主业务流程之后、重要子模块实现之前提供子模块分解表。表格至少包含源码位置、业务定位、职责、输入输出、上下游、关键状态或生命周期对象、重要性依据、详细章节、证据和置信度。

父级汇总节点必须链接到对应的重要子模块连续章节。父级代码图、状态图、对象索引或性能汇总只能表达跨单元关系，不能替代子模块本地架构、业务、数据、代码、状态和异常恢复说明。
