# 14 Continuation Checkpoint Protocol

本 skill 可以支持多 session，但只有在用户要求长任务、可恢复交付物或当前轮次无法完成时才需要写入文件系统。普通 QA 和短文档任务不要强制创建续跑文件。

长任务建议更新：

- `resume-state.md`
- `continue-prompt.md`
- `review-notes.md`

续跑时：如果这些文件存在，先读取它们，再从第一个未完成的人工 review 项继续。不要调用旧的 artifact validator，不要把缺失图表或缺失 Word 输出转成自动合同规划提示。

禁止因为 checkbox、已完成、✅ 等字样跳过仍有失败项的阶段。当“已完成”和“待补事项”冲突时，以待补事项为准。
