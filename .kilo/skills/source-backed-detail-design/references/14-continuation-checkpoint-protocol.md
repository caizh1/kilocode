# 14 Continuation Checkpoint Protocol

本 skill 可以支持多 session，但只有在用户要求长任务、可恢复交付物或当前轮次无法完成时才需要写入文件系统。普通 QA 和短文档任务不要强制创建续跑文件。

长任务建议更新：

- `resume-state.md`
- `continue-prompt.md`
- `review-notes.md`

完整多子模块任务必须在 Word assembly 前创建并维护这些文件。`resume-state.md` 至少记录用户原始模块表达、冻结后的 context parents、唯一 target module、target-owned confirmed submodules、层级证据与解析置信度，以及有序 DesignUnit census、每个设计单元十四项正文的完成状态、证据缺口、五类图/聚焦图状态、最后成功的原生工具输出路径和首个未完成项。Context parents 不进入 DesignUnit census。全部设计单元正文和必需图形就绪前，Word skeleton 状态保持 `not_started`；目标仍需澄清时不得开始正文或 Word。

续跑时：如果这些文件存在，先读取它们，再从有序 DesignUnit census、十四项正文状态、发现信号清单、候选表、复杂度实例清单或完整覆盖账本中第一个未完成项继续。正文完成状态必须由实际内容和证据决定，不能只看 checkbox。不要调用旧的 artifact validator，不要把缺失图表或缺失 Word 输出转成自动合同规划提示。

禁止因为 checkbox、已完成、✅、已生成 Word、已有 target 五图或 context-parent 定位图等字样跳过仍有失败项的阶段。当“已完成”和“待补事项”冲突时，以待补事项为准。原生工具可用且有界尝试尚未失败时，从正文、发现信号、候选、复杂度实例或覆盖账本第一个未完成项继续。达到执行边界时保存证据、内容草稿、图片和最后成功状态；如果完整正文尚未就绪，不生成或宣称完整 Word，也不把剩余设计单元压缩为清单。只有明确的证据阻塞、渲染不可用/失败、最小 Word mutation 失败、用户中断或执行边界耗尽导致必需内容或槽位 `MISSING` 时，本轮 `acceptanceStatus` 才记录为 `PARTIAL`；已有可用 DOCX 的 `artifactStatus` 仍可为 `generated`，并保留明确续作点。
