# 14 Continuation Checkpoint Protocol

本 skill 可以支持多 session。普通 QA、单章节和明确窄范围短文档不要强制创建续跑文件；完整多子模块 Word 任务无论预计是否能在当前轮次完成，都必须在正文阶段写入续跑文件，避免未填充的 Word skeleton 成为交付物。

完整多子模块 Word 必须更新：

- `resume-state.md`
- `continue-prompt.md`
- `review-notes.md`

完整多子模块任务必须在图形和 Word assembly 前，在输出根目录创建并维护这些续作文件，同时保存 `02-source-evidence/module-scope.md` 和每个 `05-enhanced-detail-design/units/<designUnitId>.md`。`resume-state.md` 至少记录用户原始模块表达、冻结后的所属上级模块、唯一目标模块、目标内部已确认子模块、层级证据与解析置信度、有序 DesignUnit census、unit 文件路径、每个设计单元十四项正文的实际状态、证据缺口、五类图/聚焦图状态、Word body-audit 状态、最后成功的原生工具输出路径和首个未完成项。所属上级模块不进入 DesignUnit census。全部 unit 文件达到 prose readiness 且必需图形输入就绪前，Word 状态保持 `not_started`。目标仍需澄清时不得开始正文或 Word；运行时没有安全 workspace file-writing tool 时，也不得开始正文落盘或 Word。

`resume-state.md`、`continue-prompt.md` 和 `review-notes.md` 首部必须写入 `SBDD_RULESET_REVISION=2026-07-long-task-gate-v1`，并明确提示：任何上下文压缩、摘要恢复或跨会话续作后，先通过原有 Skill 机制重新加载 `source-backed-detail-design`，再读取这些文件；不得只依赖被截断的旧工具输出继续 Word。

续跑时：如果这些文件存在，先读取它们，再从有序 DesignUnit census、十四项正文状态、发现信号清单、候选表、复杂度实例清单或完整覆盖账本中第一个未完成项继续。正文完成状态必须由实际内容和证据决定，不能只看 checkbox。不要调用旧的 artifact validator，不要把缺失图表或缺失 Word 输出转成自动合同规划提示。

禁止因为 checkbox、已完成、✅、已生成 Word、已有 target 五图或所属上级模块定位图等字样跳过仍有失败项的阶段。当“已完成”和“待补事项”冲突时，以实际 unit 内容和待补事项为准。原生工具可用且有界尝试尚未失败时，从正文、发现信号、候选、复杂度实例或覆盖账本第一个未完成项继续。达到执行边界时保存证据、unit 草稿、图片和最后成功状态；如果 prose readiness 尚未就绪，不调用 `create_word_document`，不生成或宣称完整 Word，也不把剩余设计单元压缩为清单。

若异常中断发生在 text-only `*-working.docx` 创建之后但 body audit 之前，记录该路径仅供续作，`artifactStatus` 不得升级为 `generated`，最终回答不得输出该 Word 路径。恢复时从第一个未消费 `[[SBDD-CONTENT:*]]` anchor 继续，全部 anchor 清零且每个 heading range 具备解释性正文后才进入插图。正文完成后的明确图片/渲染阻塞可保留文本完整的 `generated + PARTIAL` DOCX，并记录明确续作点。
