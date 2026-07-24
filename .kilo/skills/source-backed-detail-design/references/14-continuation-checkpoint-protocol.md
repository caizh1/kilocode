# 14 Continuation Checkpoint Protocol

本 Skill 支持多 session 续作。普通 QA、单章节和明确的窄范围图片任务不创建续作文件；完整多子模块 Word 任务维护：

- `resume-state.md`
- `continue-prompt.md`
- `review-notes.md`

三者首部写入 `SBDD_RULESET_REVISION=2026-07-source-semantic-v117`，并提示续作先按原机制重新加载 `source-backed-detail-design`。同时保存 `02-source-evidence/module-scope.md`、`02-source-evidence/design-unit-census.json` 和每个 `05-enhanced-detail-design/units/<designUnitId>.md`。

`resume-state.md` 记录用户原始表达、所属上级模块、唯一目标模块、目标内部确认子模块、有序 DesignUnit census、层级证据、unit 路径、十四项正文状态、流程族和业务边闭合状态、五类图槽位、最后成功的原生工具路径及首个未完成项。所属上级模块不进入 DesignUnit census。目标仍需澄清时不得开始正文或 Word；正文、业务流程或图形未就绪时 Word 状态保持 `not_started`。

`D > 1` 时根会话写入不可变 `orchestration-manifest.json`，整个流程保持在根会话内，不调用 `task` 或 `agent_manager`。第一轮可先写完多个 unit 草稿，但必须逐文件完成独立 `read → grep → repair/re-read/re-grep → review audit`，再一次性更新 canonical checkpoint。每个图形批次含冻结的 1–3 个 DesignUnit；根会话按顺序逐单元、逐槽位完成 source-backed validate/render，并写唯一 `figure-result.json`。不得用模型自述替代持久化结果。

完整多单元 Word 使用 3–5 轮自管理协议。第一轮完成 scope、census、全部正文与审计；随后按 `figureBatchCount = min(3, max(1, ceil(D / 3)))` 完成 1–3 个冻结图形批次；最后一轮合并、目录、渲染、验证并交付。`expectedTurnCount = 2 + figureBatchCount`。批次在第一轮结束前按 DesignUnit 冻结顺序均衡分配，之后不得换序、换单元、缩范围或重新规划。

Canonical checkpoint 只保存一组权威状态：`currentTurn`、`expectedTurnCount`、`phase`、`figureBatchCount`、`nextFigureBatchIndex`、`completedUnitIds`、`remainingUnitIds`、`firstIncompleteItem`、`nextAction`。`resume-state.md`、`review-notes.md` 和阶段回答中的数字必须由同一 ledger 重读生成，禁止手写三套计数。成功的非最终阶段只允许 `phase=prose_complete_waiting_continue` 或 `phase=figure_batch_complete_waiting_continue`，且 `nextAction` 必须唯一、可直接执行。

第一轮阶段回答前必须重新加载本 reference，并证实 `orchestration-manifest.json`、已回读且解析通过的 `14-business-flow-family-census.csv` 与三个 checkpoint 文件均存在。流程 census 行数必须至少为 `D`，owning DesignUnit 集合必须与冻结集合严格相等，每个单元至少拥有一个真实本地流程族；它还必须覆盖决策边、异步 handoff、失败/恢复/清理和全部终态，且四个 missing 计数均为零。manifest 和三个 checkpoint 必须逐字记录 `flowCensusStatus: PASS`、`flowCensusParseStatus: PASS`、`flowFamilyCount >= D`、`flowOwningDesignUnitCount = D`、同一 census path 与相同零计数；缺行、缺单元或空集合不能用零计数冒充闭环。任何 `not_started`、省略、占位或未回读状态都必须在当前回合修复，禁止请求“继续”。每个 unit 必须有原生 `read` 完成证据、独立 `grep` 结果和 `review-notes.md` 中替换掉全部 `tbd/not_started` 占位行的逐单元审计；shell/bash 审计或只存在草稿一律不计完成。重新读取所有 status 行和标题行，要求每单元恰好 14 个独立编号标题及 14 行相邻状态，范围/catch-all 标题一律失败，01–07/09–14 全部 `PASS`，只有 08 可证据化 `N/A`。随后必须先把相同完成集合、不可变批次、首个未完成项和唯一下一动作写入 `resume-state.md` 与 `continue-prompt.md`，并分别重新读取三个文件确认无 `not_started/tbd/N/A` 陈旧阶段值，才可输出阶段完成或请求“继续”。写回并回读后立即结束第一轮；本轮禁止加载 07/08、创建图形账本或写入任何 MMD/claim/PNG。助手回答中的表格、PASS 或计数不属于 checkpoint，不能补救任何缺失写回。

每个图形续作回合必须先重载主 Skill、07 和 08，再回读 canonical `resume-state.md`、`review-notes.md` 以及当前批次的每个 unit 文件；这些读取必须全部早于该回合的任何 `04-diagrams` ledger、MMD 或 claim 写入，事后补读不能修复顺序。若回读内容没有逐字确认 `flowCensusStatus: PASS` 与四个零计数，先完成并回读 flow census、重写并回读 checkpoint，期间仍不得写任何图形文件。第一张 MMD 前还必须写入并回读覆盖全部 DesignUnit 的完整 `5D` base-slot 表，不得只写当前批次。随后按主 Skill 的 Figure Evidence Core 续作。每个 DesignUnit 在首个 MMD 前先写入并回读 source-call ledger 与 visible-edge evidence。写完并回读当前冻结批次的全部最终 MMD 和相邻唯一 claim 后，写入并回读一个 1–20 item 的 v1 batch manifest；一次 `render_mermaid_diagram` 使用 `batchManifestPath` 与 `semanticMode: "source-backed"`，不得同时传 inline source 或 top-level claim path。工具逐项完成语法、语义校验与顺序渲染；回读其 `batchResultPath`，集合必须精确覆盖本批 required IDs。Invalid 或 split-required 只进入 repair-only batch，禁止普通 Mermaid fallback。每个非 `N/A` 槽位记录唯一 Diagram ID、节点/边 `path:line` 证据表、MMD、PNG、CSS/像素尺寸、Word-fit、人工检查状态和 SHA-256。调用箭头必须有调用方直接证据；数据或异步关系保持其真实关系类型。证据表方向自相矛盾、图片不可读、明显源码错误或第四次修正仍失败时停止，不能进入 Word。

Canonical checkpoint 保留五张基础图 semantic-set audit，并记录 `canonicalPhaseStatusMatchCount=1`、`stalePhaseStatusCount=0`、`staleRemainingCount=0`；没有平行的 Phase Progress 摘要。只有全部正文通过或一个冻结图形批次全部通过，才允许形成预定阶段边界。此时面向用户只报告 `第 n/N 阶段已完成，请回复“继续”` 以及简洁已完成计数，不要求选择、诊断、修复、重新描述目标或确认缩减范围。

用户回复普通的 `继续` 后，根会话只读取主 Skill、上述 checkpoint、当前批次或最终组装所需结果及必要源码切片；不要求用户重复原始提示或指出下一步。总数与完成状态只从 canonical ledgers/checkpoint 取得。若中断项属于已开始的 unit/slot，根会话从同一记录恢复，不新建平行结果。不得再次全库探索、展开旧 tool output、切换模型，或用 shell/第三方脚本替代原生文档工具。根会话必须自行处理可恢复错误；只有明确不可恢复的工具或证据阻塞才停止并直接说明原因，不向用户索要实施指导。

如果 `*-working.docx` 已存在，它仍不是交付物。恢复时从首个未消费正文锚点继续；正文检查、图片关系、目录、页面检查和 XML 验证全部通过后才产生最终权威 DOCX，并在最终回答中输出其绝对路径。
