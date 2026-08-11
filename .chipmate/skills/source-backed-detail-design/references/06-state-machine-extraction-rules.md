# 06 State Machine Extraction Rules

## 1. 搜索关键词

必须搜索 fsm/state/phase/step/status/event/next/handler/dispatch/switch/case/enum/define/idle/init/ready/running/wait/retry/error/abort/complete/done/finish/timeout。

## 2. 状态变量

从当前源码识别实际的持久状态存储，不预设任何变量名、字段名或命名模式。必须记录定义位置、可能取值、读取位置、写入位置、handler、状态改变条件，并证明确实存在 `current state -> event/trigger -> guard/action -> next state` 的持久控制关系。

## 3. dispatch 分析

必须记录 dispatch 函数、switch expression 或 table index、state value/case、handler function、default behavior、invalid state behavior。先区分状态分派与普通命令分派：opcode、command、request type、handler-table key 或普通 switch selector 即使选择不同 handler，也不能在没有持久状态和下一状态关系时当作 FSM。

## 4. handler 深挖

每个状态 handler 必须提取参数校验、分支、状态读写、下游调用、等待/重试/错误/完成路径、返回值。

## 5. 必需状态机图

每个重要 FSM 必须覆盖 dispatch、state-overview、transition-conditions、error-retry-timeout 和关键 `handler-<state>` 细节。可在标签保持可读、语义边界清楚时合并视图，也可按分支或 handler 拆分；不使用固定图片数量作为质量指标。状态边必须包含 trigger/event、guard condition、action、next state、evidence ID。

状态机图必须放在所属 target module 或已确认子模块的状态机小节中。全局状态机索引或 target 总览只能用于说明跨单元转换，不能替代本地 dispatch、handler、失败和恢复分析。Target module 和已确认子模块使用相同三态判定。每个 DesignUnit 建立 FsmAudit，逐项记录 state storage/enums、state reads、state/next-state writes、events/triggers、dispatch/handler、initialization、terminal/error/recovery paths、positive/negative evidence IDs 和 audit completeness。所属上级模块不是 DesignUnit，不建立强制 FsmAudit：

- `PRESENT`：源码存在持久控制状态参与 `current state -> event/trigger -> guard/action -> next state` 关系，必须生成状态机图；
- `N/A`：所有 audit 维度均已完整搜索且负证据证明不存在上述状态语义；
- `MISSING`：范围未读完、检索截断、存在 unresolved state candidate/unknown transition 或证据不足。

`MISSING` 不得降级为 `N/A`。普通命令/opcode/type 分派、handler table、结果/status 字段或资源创建、读写、释放等数据生命周期本身不构成状态机证据，但应进入代码流程或生命周期复杂度清单。冻结图形计划前必须满足 `D = presentStateMachineCount + evidencedStateMachineNaCount + missingStateMachineDecisionCount`；完整交付要求 `missingStateMachineDecisionCount = 0`。

存在多个独立 FSM 域时，每个域必须拥有可读的 state overview 和 transition detail；存在独立 error/retry/timeout/recovery handler 族时，必须逐实例增加聚焦详图并在复杂度清单中关联对应 Signal ID，不能用单张 target 状态总览替代。普通非状态 dispatch 域进入代码流程复杂度清单，不冒充 FSM 域。
