# 15 Business Flow Abstraction Rules

## 1. 目的

业务流程图用于从源码证据中抽象出模块的业务处理逻辑，面向架构评审、详细设计阅读和业务流程理解。

业务流程图不是函数调用图，也不是状态机展开图。它必须回答：

- 模块被什么业务事件触发；
- 进入模块后先做什么业务判断；
- 分为哪些业务阶段或业务子模块；
- 每个子模块处理什么业务对象；
- 哪些条件导致继续、等待、重试、失败、终止或完成；
- 子模块之间如何交接数据、状态或结果；
- 总模块如何从入口走到完整业务结果。

业务流程图必须 high level，但不能脱离源码。每个业务节点和关键边都必须能映射到 SRC/CE/BR/ST/BF 证据。

## 2. 业务抽象原则

### 2.1 允许抽象

允许把具有同一业务目的、处理对象和结果的多个函数、分支或状态处理抽象成一个业务动作。每个抽象必须从当前源码证据动态命名，并保留其覆盖的函数、条件、状态、数据变化和证据 ID；不得套用本 Skill 预设的动作名称。

### 2.2 禁止抽象

禁止出现无源码依据的业务节点。禁止把旧文档中的流程直接搬进业务流程图。禁止把函数 A -> 函数 B -> 函数 C 改个中文名字就当业务流程图。

### 2.3 图中命名规则

业务流程图中的节点必须使用从当前源码和业务证据抽象出的业务语义。函数名、结构体名、字段名、宏名不得作为主节点名称，除非该符号本身就是经证据确认的业务概念。源码符号放到证据表，不放到业务图主标签。本 Skill 不预设节点名称、业务阶段或流程类型。

## 3. 业务证据输出

必须在 `03-control-flow-evidence/` 下新增业务抽象证据文件。

### 3.1 09-business-capability-map.csv

```csv
business_capability_id,capability_name,capability_description,business_value,scope_boundary,submodule,source_functions,source_states,source_data_objects,trigger,key_steps,output_or_side_effect,confidence,evidence_ids
```

要求：

- 每个已确认子模块必须覆盖源码确认的全部本地 capability；如果没有可确认的本地能力，应在冻结分解表前重新判断它是否只是 helper/adapter，而不是在画图阶段降级以逃避覆盖；
- capability_description 必须完整说明该能力处理的对象、触发、动作、结果和边界，不使用固定字数作为质量门槛；
- business_value 必须说明该能力对模块业务结果的价值；
- scope_boundary 必须说明该能力的负责范围和不负责范围；
- key_steps 必须用业务语言概括全部关键阶段，不遗漏源码确认的决策、等待、失败或终止阶段；
- source_functions 不能为空；
- evidence_ids 必须引用 SRC/CE/BR/ST；
- confidence 只能是 source_confirmed/high_confidence/medium_confidence；
- medium_confidence 只能进待确认或图注说明，不能作为确定业务主路径。

### 3.2 10-business-flow-steps.csv

```csv
business_step_id,step_name,step_type,submodule,input_business_object,business_action,decision_condition,output_business_object,state_effect,next_possible_steps,source_basis,evidence_ids
```

`step_type` 使用从当前流程语义归纳的简短角色名称；不得为了匹配本 Skill 的固定枚举而改写、合并或遗漏实际步骤。

要求：

- step_name 必须是业务语义，不得只是函数名；
- decision_condition 必须能追溯到源码条件；
- state_effect 需要说明业务状态影响；
- next_possible_steps 必须覆盖源码中适用的正常、异常、等待、重试、取消和终止后继；不存在的路径不得虚构，并在覆盖记录中说明依据。

### 3.3 11-business-flow-edges.csv

```csv
business_edge_id,from_step,to_step,edge_condition,business_meaning,submodule,cross_submodule,source_condition,evidence_ids
```

要求：

- edge_condition 不能为空，无条件写 always；
- 跨子模块边必须标记 cross_submodule=true；
- source_condition 记录源码条件或状态迁移条件；
- business_meaning 使用业务语言说明为什么流转。

### 3.4 12-business-flow-edge-coverage.csv

```csv
diagram_name,mermaid_edge,from_node,to_node,business_edge_id,evidence_ids,coverage_status,notes
```

coverage_status 包括 covered/partial/unverified。unverified 不能进入最终 PASS。

### 3.5 13-business-text-coverage.csv

```csv
item_type,item_name,section_file,has_description,description_chars,has_evidence,diagram_refs,quality_status,notes
```

item_type 包括 capability/submodule/target_flow。quality_status 包括 pass/weak/missing。每个业务能力、target module 和每个已确认子模块都必须有一行覆盖记录；所属上级模块只作为外部参与者或 handoff 证据，不占 target_flow 覆盖行。

## 4. 子模块业务流程图规则

每个已确认子模块必须先生成一张 high-level 子模块业务流程图。

输出位置：

```text
04-diagrams/mmd/business/submodules/
04-diagrams/png/business/submodules/
```

命名建议：

```text
business-submodule-<submodule-name>.mmd
business-submodule-<submodule-name>.png
```

每张子模块业务流程图必须包含：

1. 业务触发入口；
2. 输入业务对象；
3. 源码确认的全部关键业务处理阶段；
4. 源码确认的全部影响业务结果的条件边；源码确实没有条件分支时必须说明；
5. 数据或状态影响；
6. 正常完成路径；
7. 源码中适用的错误、等待、重试、取消、恢复和终止路径；不存在的语义不得虚构；
8. 与其他子模块的交接点；
9. BF edge coverage。

子模块业务图不展开函数内部细节。函数内部细节应放到 code-level 子模块图或 function-detail-flow 图。增加文字简介时不得把大段说明塞入 Mermaid 节点，避免影响当前图片质量。

## 5. 总模块业务流程图规则

总模块业务流程图必须在所有已确认子模块的业务语义、证据、边覆盖和 Mermaid source 完成后生成。子模块 PNG 渲染失败不能阻塞总模块业务图的生成或渲染，但会使对应子模块槽位保持 `MISSING`。

输出位置：

```text
04-diagrams/mmd/business/target/
04-diagrams/png/business/target/
```

命名建议：

```text
business-target-module-master-flow.mmd
business-target-module-master-flow.png
```

总模块业务图必须包含：

1. 外部业务触发；
2. 模块级输入；
3. 子模块边界；
4. 子模块之间的主流转；
5. 关键业务判断；
6. 核心业务状态变化；
7. 主要业务对象流转；
8. 下游依赖或外部系统；
9. 等待、重试、错误、终止、成功完成出口；
10. 每个子模块节点必须能回链到对应子模块业务图。

总模块业务图禁止展开所有函数细节。它只能聚合已完成语义与证据规划的子模块业务流程、核心状态机概览和关键异常路径，不得因某张子模块 PNG 渲染失败而省略整个父图。

## 6. Mermaid 表达规则

业务流程图默认使用：

```mmd
flowchart TD
```

源码证明确有子模块边界时，使用 subgraph 表达这些真实边界；不存在该层级时不得为了套模板创建 subgraph。本 Skill 不提供可被误用为实际流程的预制 Mermaid 节点或分支示例。

节点 ID 必须 ASCII。节点 label 使用中文业务语义。边 label 必须体现业务条件，不得只写 yes/no。

## 7. 图粒度控制

子模块业务图不设置节点或边的最低数量。它必须完整表达一个业务子模块的真实阶段、分支和结果；当正文宽度下标签、条件边或分支关系不可读时，拆成“子模块总览 + 场景/分支详图”，不得删掉异常路径或无限缩小图片。

总模块业务图同样不设置节点数量门槛。它应使用 subgraph 表达子模块，并展示影响端到端业务结果的关键条件；代码内部细枝末节放入子模块或代码流程图。总图在 Word 正文宽度下不可读时，可按语义拆为：
  - target overview；
  - 由当前源码识别出的独立场景或分支详图。

## 8. 无效业务图判定

以下业务图必须 REJECTED：

- 只有函数调用，没有业务动作；
- 只有目录或组件拓扑，没有业务流转；
- 只有 happy path，没有错误/等待/重试/终止；
- 关键节点无源码证据；
- 边没有业务条件；
- 子模块业务语义、证据、边覆盖或 Mermaid source 未完成就生成总图；
- 总图没有引用子模块图；
- 图中大量使用函数名、文件名、结构体名作为主流程节点。

## 9. 正文绑定

必须新增或补强以下正文：

```text
05-enhanced-detail-design/02-business-flow-overview.md
05-enhanced-detail-design/08-confirmed-submodules.md
```

`02-business-flow-overview.md` 必须引用总模块业务流程 PNG。

`08-confirmed-submodules.md` 必须在每个已确认子模块自己的连续详细设计单元中逐个引用业务流程 PNG，并包含：

- 子模块简介；
- 子模块业务职责；
- 业务触发条件；
- 输入/输出业务对象；
- 业务步骤表；
- 业务条件表；
- 图后流程解读；
- 状态/数据影响；
- 异常、等待、重试、终止路径；
- 源码证据表。

## 10. 业务能力说明要求

业务能力纵览表不能只列能力名称。每个能力必须配套一段完整说明，不设固定字数，内容包括：

- 能力处理的业务对象；
- 被什么入口、事件、状态或条件触发；
- 主要业务动作；
- 输出结果、状态变化、数据变化或下游副作用；
- 与所属子模块的关系。

禁止把函数名列表当成能力说明。源码细节应放在证据列，能力说明应使用业务语言。

## 11. 子模块简介要求

每个已确认子模块在正文中必须有图前简介，不设固定字数。简介必须覆盖：

- 子模块在整个模块中的业务定位；
- 上游触发和进入条件；
- 核心处理对象和关键状态；
- 正常完成后的业务结果；
- 典型异常、等待、重试或终止路径；
- 与其他子模块的交接关系。

图后必须有足以解释主路径、关键分支和异常路径的流程解读。不要逐个复述 Mermaid 节点，而要说明业务含义。

## 12. 与代码级图的关系

high-level 业务流程图先生成，用于说明“业务上发生了什么”。代码级子模块图、函数详情图和状态机图后生成，用于说明“源码如何实现这些业务流程”。

业务图中的每个关键节点和关键边都必须能映射到业务证据和源码/控制流证据。代码图不能替代业务图；业务图也不能替代代码图。

## 13. PASS 条件

业务流程层 PASS 必须同时满足：

- 09-business-capability-map.csv 非空；
- 10-business-flow-steps.csv 非空；
- 11-business-flow-edges.csv 非空；
- 12-business-flow-edge-coverage.csv 非空；
- 13-business-text-coverage.csv 非空；
- 每个已确认子模块存在 high-level 业务流程 mmd/png；
- 总模块业务流程 mmd/png 存在；
- mmd/png 一一对应；
- 业务图 edge coverage 无 unverified；
- 正文引用业务总图和子模块业务图；
- 业务能力纵览表包含 capability_description；
- 每个已确认子模块正文包含图前简介和图后流程解读；
- 业务图没有被判定为函数调用图或拓扑图。
