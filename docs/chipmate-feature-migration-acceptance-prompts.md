# ChipMate Feature Migration Acceptance Prompts

This prompt pack is for the installed VS Code smoke phase of `chipmate-feature-migration-plan.md`.

Status: not executed yet.

Use these prompts after a VSIX has been packaged and installed into the agreed VS Code profile. Replace placeholders such as `<module>`, `<function>`, `<macro>`, and `<docx>` with representative internal project values. Do not rewrite the prompts into project-specific production logic.

## Evidence Rules

- Record the installed VSIX filename and version before running prompts.
- Record the workspace path and VS Code profile used for each smoke.
- Record the prompt/action, observed tool sequence when visible, generated artifact paths, warnings, and final result.
- For QA preservation prompts, explicitly record whether Word, Mermaid, or artifact tools were not called.
- For generated artifacts, record the `artifact.json` path and primary output path.
- For skipped prompts, record the reason and risk.

## Native Kilo QA Preservation

### S1: Embedded C call-chain QA

Prompt:

```text
分析 <function> 这个 C 函数的调用链：谁调用它，它调用哪些关键函数，主流程和错误处理路径分别是什么？
```

Expected behavior:

- Uses Kilo native code understanding/search tools such as `codebase_analysis`, `semantic_search`, `Grep`, or `Read`.
- Does not call Word, Mermaid, or artifact-generation tools.
- Answer cites source files/functions and separates direct evidence from inference.

Evidence to record:

- Function name and project.
- Tool sequence or visible source references.
- Confirmation that no `.kilo/artifacts/...` deliverable was created for ordinary QA.

### S2: Macro/register/MMIO QA

Prompt:

```text
这个宏 <macro> 在哪里定义？哪些 C 文件或函数会用到它？如果它关联寄存器或 MMIO，请说明读写路径。
```

Expected behavior:

- Uses native code/search tools.
- Does not call Word, Mermaid, or artifact-generation tools.
- Provides definition, references, and evidence-backed usage summary.

Evidence to record:

- Macro name and project.
- Definition path and usage paths.
- Tool sequence or visible source references.

### S3: Existing document RAG

Prompt:

```text
基于已索引文档，说明 <document-topic> 的约束、关键流程和注意事项。只回答文档里的内容，不生成新的 Word。
```

Expected behavior:

- Uses Kilo native `document_search` for indexed document QA.
- Does not call Word generation/edit tools.
- Does not create document artifacts unless explicitly requested.

Evidence to record:

- Document topic and indexed document source.
- `document_search` usage or equivalent visible evidence.
- Confirmation that no Word artifact was generated.

## Artifact and Word Deliverables

### S4: Artifact manifest

Prompt:

```text
生成一个简短的迁移验证报告 artifact，包含标题、摘要、风险列表，并列出生成的文件。
```

Expected behavior:

- Creates a generated artifact under `.kilo/artifacts/...`.
- Produces or declares an `artifact.json`.
- Returns artifact directory and manifest path.

Evidence to record:

- Artifact directory.
- `artifact.json` path.
- Primary file path and warnings.

### S5: Word create

Prompt:

```text
生成一份 <module> 模块接口设计 Word 文档，包含接口列表、参数表、错误码表和注意事项。
```

Expected behavior:

- Calls explicit Word document generation tools.
- Produces a `.docx` artifact.
- Registers the artifact manifest.

Evidence to record:

- `.docx` path.
- `artifact.json` path.
- Whether tables are present after inspection.

### S6: Word append/edit

Prompt:

```text
在刚才的接口设计 Word 中，在接口设计章节后新增一个错误码表，输出新版本文档，不覆盖原文档。
```

Expected behavior:

- Writes a new `.docx` artifact.
- Preserves original source document.
- Creates a source backup when editing an existing `.docx`.

Evidence to record:

- Source `.docx` path.
- New `.docx` path.
- Backup path.
- Edit summary or impacts.

### S7: Word delete dry-run

Prompt:

```text
删除刚才 Word 文档里的旧方案章节。先 dry-run，告诉我会影响哪些段落，不要直接写文件。
```

Expected behavior:

- Performs dry-run only.
- Reports impacted section/paragraphs.
- Does not write a new `.docx` until explicit apply is requested.

Evidence to record:

- Dry-run result.
- Confirmation that no new file was written for the dry-run step.

### S8: Word replace complex blocks

Prompt:

```text
把 Word 文档中的 TODO 段落替换成一段说明、一张参数表和一个有序列表，输出新版本。
```

Expected behavior:

- Uses structured Word edit operation.
- Outputs a new `.docx`.
- Does not mutate the original document in place.

Evidence to record:

- New `.docx` path.
- Inspection summary showing paragraph/table/list presence.

### S9: Word template style

Prompt:

```text
使用 <template.docx> 的公司模板样式生成或改写这份设计文档。继承样式即可，不要承诺支持任意占位符填充。
```

Expected behavior:

- Applies template styles/theme/numbering where supported.
- Returns warnings for unsupported template behavior.
- Does not claim full mail-merge support.

Evidence to record:

- Template path.
- Output `.docx` path.
- Applied parts and warnings.

### S10: Word merge and diff

Prompt:

```text
把三个模块 Word 文档合并为一个总文档，然后比较 v1 和 v2 的差异，输出差异摘要和 JSON。
```

Expected behavior:

- Merge copies images and remaps rels/content types.
- Diff output is bounded and artifact-backed.
- Original files are not overwritten.

Evidence to record:

- Source docs.
- Merged `.docx` path.
- Diff Markdown and JSON paths.
- Any image/rels warnings.

### S11: Word render

Prompt:

```text
把这份 Word 渲染成 PDF 和每页 PNG，并给出质量诊断。如果没有配置 renderer，请返回可理解的 warning artifact。
```

Expected behavior:

- Uses external renderer endpoint or returns endpoint-not-configured warning artifact.
- Does not bundle or require a newly packaged renderer.
- Produces PDF/page PNG when renderer is available.

Evidence to record:

- Renderer endpoint status.
- PDF path or warning diagnostics path.
- Page PNG paths and quality diagnostics.

## Mermaid and Diagrams

### S12: Mermaid state-machine PNG

Prompt:

```text
为 <module> 的核心状态机生成 Mermaid 状态机图，并导出 .mmd 和 PNG artifact。
```

Expected behavior:

- Uses Mermaid sidecar tools for explicit diagram generation.
- Produces `.mmd`, `.png`, and diagnostics artifact.
- Does not infer business semantics in renderer code; semantics come from the agent/skill answer.

Evidence to record:

- `.mmd` path.
- `.png` path.
- Diagnostics path.
- Warnings.

### S13: Mermaid insert into Word

Prompt:

```text
把刚才的状态机图插入到 Word 详细设计文档的状态机章节下，输出新版本 Word。
```

Expected behavior:

- Inserts rendered PNG into a new Word artifact.
- Does not mutate original `.docx`.
- Registers artifact manifest.

Evidence to record:

- Source Word path.
- Mermaid PNG path.
- New Word path.
- Manifest path.

## Source-backed Detail Design

### S13: Full source-backed detail design

Prompt:

```text
为 <embedded-c-module> 生成源码驱动详细设计文档。要求先基于源码搜证据，再生成当前设计、功能覆盖、业务流程、代码流程、状态机、风险和 Word 输出。
```

Expected behavior:

- Uses Kilo native evidence tools such as `codebase_analysis`, `semantic_search`, and `document_search`.
- Uses the source-backed detail-design skill process.
- Produces Markdown, diagrams, Word document, and evidence/quality report artifacts.

Evidence to record:

- Internal project/module.
- Evidence tool sequence.
- Markdown path.
- Diagram paths.
- Word path.
- Evidence/quality report path.

### S13 optional sub-scope: State-machine-only detail design section

Prompt:

```text
只为 <embedded-c-module> 生成状态机章节：状态列表、事件、转移表、异常路径和 Mermaid 图。不要生成完整文档。
```

Expected behavior:

- Uses native source evidence.
- Restricts output to the requested section.
- Produces Mermaid artifact if diagram output is requested.

Evidence to record:

- Module.
- Evidence references.
- State table.
- Mermaid artifact paths.

## Agent Terminal and Autocomplete

### S14: Agent Terminal open and build-plan advice

Action:

```text
Run command: Kilo Agent Terminal: Open
Then ask: 帮我分析这个项目应该怎么构建，但先不要执行命令。
```

Expected behavior:

- `kilo.agentTerminal.enabled` is disabled by default.
- User is prompted before enabling/opening.
- The terminal helper provides safe command planning.
- Native Kilo terminal/session manager remains available.

Evidence to record:

- Setting state before open.
- Prompt/enable behavior.
- Suggested command plan.

### S15: Agent Terminal dangerous command confirmation

Prompt/action inside Agent Terminal:

```text
删除这些临时产物：<temp-paths>
```

Expected behavior:

- Dangerous command is classified as requiring confirmation.
- No destructive deletion runs without explicit confirmation.

Evidence to record:

- Planned command.
- Classification result.
- Confirmation prompt behavior.

### S16: Qwen direct autocomplete

Action:

```text
Enable or select qwen-direct autocomplete, open a C file, and trigger inline completion at a representative location.
```

Expected behavior:

- Qwen direct provider still registers.
- Completion can be requested without document artifact tools involved.
- New document/Agent Terminal settings do not alter autocomplete defaults.

Evidence to record:

- Autocomplete provider setting.
- File/language used.
- Whether inline completion appears or logs show provider activity.
