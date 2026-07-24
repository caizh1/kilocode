# 02 Input and Module Scope Rules

## 1. 目的

模块定位用于回答：哪个模块是文档主体、哪些源码实体构成其所属上级模块，以及主体内部有哪些待确认子模块。未生成 `02-source-evidence/module-scope.md` 前，禁止生成正文、禁止画图、禁止生成 Word。

## 2. 输入处理

用户可能提供：旧详设文档、源码仓库路径、一个或多个模块名、候选源码目录、输出目录、是否导出 Word、断点续跑目录。先原样保存用户名称和关系措辞，再从文档标题、章节、文件名、函数名、结构体名、状态名、业务词及源码所有权中验证模块层级。

内部角色必须分开；内部字段名只用于范围计算，生成的 Word、Markdown 工作包、表格、图和 review notes 统一使用中文用户侧名称：

- `context_parent`：目标上方有证据的拥有者或封装模块，用户侧名称为“所属上级模块”，只用于系统定位、源码归属、边界和协作说明；
- `target_module`：文档主体，拥有第 4 至第 8 章、十四项正文和五类图；
- `confirmed_submodule`：目标内部确认的独立子模块，拥有第 9 章中的本地正文和五类图；
- `peer_or_dependency`：同级或依赖模块，只进入接口与协作说明。

目标解析顺序：用户明确指定主体时直接采用；多个名称形成源码确认的祖先—后代链时选择最深、最具体的名称为 `target_module`，其有证据的上层拥有者记为 `context_parent`；同级、层级未知、存在多个最深候选或用户明确要求多个模块分别作为主体时，先请求用户确认主体或交付拆分。不得因为名称排在前面、目录更大或拥有更多文件就把所属上级模块升格为目标模块。

紧凑表达按“最后且最具体名称优先”解析，但只有源码层级证据成立时才应用；本 Skill 不提供任何具体模块名称示例。冻结后的 `module-scope.md` 是 scope lock，必须记录用户原始表达、`SBDD_RULESET_REVISION`、所属上级模块源码根、唯一目标模块及其主源码根、目标编译单元 census、目标内部确认子模块、排除对象、层级证据和置信度。每个 target-owned 编译单元必须映射到 target orchestration、唯一候选/确认单元、证据化 alias/duplicate owner 或 generated/test 等证据化 non-submodule，并满足 `unmappedTargetCompilationUnitCount = 0`；未完成前不得冻结范围。

对以下关系分别建立证据，不得从一种关系推导另一种关系：系统架构位置、源码归属、所属上级模块、实际调用方和被调用方、数据/状态/控制权 handoff、依赖、协作、管理和资源所有权。源码包含不能证明系统层级，所属上级模块不能自动视为业务上游或调用入口，调用边不能证明所有权。目标位于某系统层内部时，不得同时把该系统层写成目标下游。“管理”或“位于……之间”必须有直接证据；证据不足时标记“待确认”，不得使用行业常识补全。该一致性规则适用于所有章节、表格、图、图注、review notes 和结论。

## 3. 原文档线索抽取

必须生成 `00-input/extracted-document-clues.md`，至少包含：

| 线索类型 | 内容 | 用途 | 源码确认状态 |
|---|---|---|---|
| 模块名 | | 定位目录和符号前缀 | 是/否 |
| 文件名 | | 定位候选文件 | 是/否 |
| 函数名 | | 定位入口/关键函数 | 是/否 |
| 结构体 | | 定位核心上下文 | 是/否 |
| 宏/枚举 | | 定位状态/配置 | 是/否 |
| 业务流程节点 | | 辅助识别子模块 | 是/否 |

## 4. 候选范围评分

候选范围可为目录、文件集合、命名空间、构建目标。评分：模块名匹配 30，文件名匹配 20，符号匹配 20，调用链集中度 15，数据结构集中度 10，构建归属 5。>=60 可作为主探索范围。多个候选都 >=60 时必须比较，不得混合无关模块。

## 5. 范围分类

必须区分：

- 主探索范围：target module 的核心实现、接口及其内部候选子模块；
- 所属上级模块范围：只读取足以证明目标定位、源码归属、边界和 handoff 的源码；
- 辅助范围：peer/dependency、公共库、下游接口和共享结构体；
- 排除范围：test/mock/deprecated/generated/vendor/tooling。

## 6. module-scope.md 模板

```md
# module-scope

## 1. 用户输入与目标解析
| 项目 | 内容 |
|---|---|
| 用户原始模块表达 | |
| 用户明确主体 | 有则填写，否则 `未明确` |
| 所属上级模块 | 名称、源码位置、层级证据；没有证据时填“待确认” |
| 目标模块 | 名称、别名/缩写、源码位置 |
| 已确认子模块 | 初始为空，探索后冻结有序清单 |
| 同级或依赖模块 | 名称、关系和证据 |
| 解析结论 | explicit subject / deepest confirmed descendant / user clarification |
| 层级证据 | build/registration、公开接口、调用、所有权或目录边界 |
| 置信度 | 高 / 中 / 低 |
| 是否需要用户澄清 | 是/否及原因 |

## 2. 原文档定位线索
| 线索类型 | 线索内容 | 用途 | 是否在源码确认 |
|---|---|---|---|

## 3. 候选源码范围评分
| 候选范围 | 匹配依据 | 评分 | 结论 |
|---|---|---:|---|

## 4. 主探索范围：目标模块
## 5. 所属上级模块范围
## 6. 辅助范围：同级或依赖模块
## 7. 排除范围
## 8. 后续探索边界
```

冻结范围时必须证明只有一个 root target DesignUnit，所属上级模块不进入 DesignUnit/十四项/五视图分母。目标范围内参与构建、非 generated/test 的实现单元，只要具有配对接口/头文件及可跨文件调用的符号，就必须确认为子模块；无状态、纯函数、utility/storage/adapter、共享或只有一个调用者均不改变此结论。只有 target orchestration、无实现/API 的 header-only 定义、范围外 generated/test，或“全部导出符号仅透传且不增加校验、转换、状态、资源、错误或生命周期行为”的精确 alias/duplicate 才可排除；后一种必须逐符号给出证据并指向唯一 confirmed owner。“被某单元使用”只证明依赖，不证明别名或归属合并。若用户明确要求多个主体，必须先确定拆分方式。

冻结 `module-scope.md` 后立即写入并回读同目录 `design-unit-census.json`。该文件是图形完整性校验的独立输入，不复制正文。通用字段为 `version: 1`、唯一 `targetDesignUnitId`，以及 `designUnits[]` 的 `id/name/kind/parentId?`；根目标的 `kind` 为 `target`，每个确认子模块的 `kind` 为 `confirmed-submodule` 且 `parentId` 指向直接所属 DesignUnit。

C/C++ 目标还必须写入工作区内 `targetSourceRoot` 和 `implementationUnits[]`。语义校验器会递归枚举该根下的 `.c/.cc/.cpp/.cxx`，每个实际实现文件必须恰好出现一次：

```json
{
  "version": 1,
  "targetDesignUnitId": "<target-id>",
  "targetSourceRoot": "<workspace-relative-target-source-root>",
  "designUnits": [
    { "id": "<target-id>", "name": "<target-name>", "kind": "target" },
    { "id": "<child-id>", "name": "<child-name>", "kind": "confirmed-submodule", "parentId": "<target-id>" }
  ],
  "implementationUnits": [
    { "path": "<workspace-relative-main-implementation>", "disposition": "target", "designUnitId": "<target-id>" },
    { "path": "<workspace-relative-child-implementation>", "disposition": "confirmed-submodule", "designUnitId": "<child-id>" }
  ]
}
```

`disposition: "excluded"` 只允许 `exclusion.reason` 为 `generated`、`test-fixture`、`inactive-platform-variant`、`outside-target-build` 或 `exact-alias-duplicate`，且必须带非空行级 `evidence[]`；`outside-target-build` 必须引用构建/注册证据，精确别名还必须以 `ownerDesignUnitId` 指向唯一确认单元。`utility`、`helper`、无状态、纯函数、小文件、单调用者、无 FSM、无资源或“业务不够独立”都不是合法 reason。目标 orchestration 实现映射到 target，不写 excluded。要求实际实现路径集合与 `implementationUnits[].path` 严格相等、每个非排除项的 DesignUnit 映射有效、合法排除证据可读；否则范围未冻结，禁止绘图。其 ID/名称集合必须与 `module-scope.md` 冻结集合完全一致。图形阶段不得删改或重建该文件来规避缺图；范围确因新源码证据变化时，必须返回范围阶段并同步重做全部下游正文和图形账本。

范围冻结不是计数相等，而是集合恒等：`architecture decomposition names = confirmed census = DesignUnit IDs = detailed chapter IDs = diagram-ledger unit IDs`。任一目标外部单元混入、confirmed 单元被替换、同数异名、遗漏或多余项都使 Word 保持 `not_started`。
