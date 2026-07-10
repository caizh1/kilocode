# 13 Review Checklist

本文件只提供源码驱动详细设计的人工 review 建议。它不是 ChipMate 文档合同，不是自动修复流水线，不是缺失图表渲染计划，也不是 Kilo QA 的触发条件。

不要迁移或调用旧的 artifact validator helper。Kilo 中的详细设计 skill 应依靠模型、Kilo 原生证据工具、通用 Word/Mermaid/artifact tools，以及人工可读的 review notes。

## 建议检查项

- 源码范围是否清楚：目标模块、父模块、核心实现、边界和不负责内容是否写清。
- 证据是否足够：关键结论是否引用源码、控制流、状态、结构体、宏、寄存器、文档或 owner-review 说明。
- 业务流程是否有解释：如果生成了业务图，图前简介、图后解读、关键步骤和异常路径是否可读。
- 代码流程是否有依据：如果生成了代码图，关键边是否能追溯到函数、分支、状态读写或调用关系。
- 状态机是否合适：只有在源码存在状态、事件、phase、dispatch、handler 等证据时才生成状态机图。
- Word 输出是否符合用户请求：如果用户要求 `.docx`，是否使用通用 `create_word_document`，并报告主文件路径。
- Render QA 是否如实披露：只有用户要求、配置启用或任务明确需要时才调用 `render_word_document`；未配置 renderer 时说明跳过即可。
- Artifact 是否清晰：生成的 `.docx`、`.mmd`、`.png`、`.pdf`、诊断 JSON 等是否有路径、摘要和 warnings。

## Review 状态写法

需要记录状态时，用人工可读的 `PASS / PARTIAL / MISSING / N/A` 即可。`MISSING` 只表示该交付范围内缺少某项证据或产物，不应触发自动补图、自动合同规划或普通 QA 改道。

## 明确禁止

- 不要因为图没有 PNG 就自动启动补图流程。
- 不要因为 `.docx` 未生成就插入旧合同规划提示。
- 不要在 skill disabled、skill permission denied、或普通代码 QA 场景中触发本 skill 的 review 文案。
- 不要把 Markdown 草稿、Mermaid 源码、Word 输出、render QA 绑定成不可拆分的合同。
- 不要把 review checklist 的 `MISSING` 当成 runtime error。
