# ChipMate 1.0.7

相较 1.0.6：

- 新增 Ultra Agent，在每轮任务前执行强制并行探索，并保留主代理复核与权限约束。
- 新增 PlantUML 生成、服务端渲染、语法诊断与 PNG 回传能力；明确区分 Mermaid 与 PlantUML 的工具路由。
- 加强 Mermaid 图表的语义一致性保护，阻止修复、拆图或 Word 适配过程中丢失节点、关系与关键事实。
- 完善 ChipMate Server 的 PlantUML endpoint 状态、健康检查与设置页布局，敏感 URL 信息不会直接暴露。
- 更新检查现在可展示服务端发布说明，并使用短期候选标识防止过期或伪造的安装请求。
- VSIX 现在强制携带与版本匹配的 `RELEASE_NOTES.md`，缺失或版本不一致时打包直接失败。
- 强化 ChipMate 身份与默认简体中文交互策略，同时保留命令、路径和兼容性标识原文。
