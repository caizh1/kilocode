# ChipMate 非 QA 能力迁移开发计划

## 执行说明

- [x] 本计划用于后续进入目标模式逐项实现。
- [x] 每个任务项完成后，将对应 `[ ]` 改为 `[x]`。
- [ ] 每个里程碑完成后必须执行本阶段 `Review` checklist。
- [ ] 最终交付前必须执行 `M11: 最终迁移 Review`。
- [ ] Review 重点是确认迁移能力没有破坏 ChipMate 原有 QA、代码理解、Document RAG、autocomplete、terminal、tool registry、VS Code extension 激活和打包能力。
- [x] 本计划默认目标仓库为 `/Users/archer/Work/chipmate`。
- [x] 本计划默认源能力仓库为 `/Users/archer/Work/opencode`。

## Summary

- [x] 将 ChipMate 的非 QA 特色能力迁移到 `/Users/archer/Work/chipmate`。
- [x] 保留 ChipMate 原生 QA、代码理解、Document RAG、skill discovery、autocomplete 能力。
- [x] 迁移 Word 通用生成、增删改、渲染、合并、diff。
- [x] 更新迁移边界：Word 仅保留通用 `.docx` 能力，不迁移 ChipMate Word/document runtime contract、required-artifact validator、recipe repair loop 或 skill contract gate。
- [x] 迁移文档型 artifact 管理。
- [x] 迁移 Mermaid PNG 生成。
- [x] 迁移源码驱动详细设计 skill。
- [x] 所有迁移能力必须作为旁路 tools、skills、artifacts 接入。
- [x] 不替换 ChipMate 原生 agent、QA、terminal、autocomplete、Document RAG 流水线。
- [x] 所有生成文件进入统一 artifact 目录，并返回 manifest。
- [ ] 每个里程碑完成后必须 review 是否影响 ChipMate 原有能力。

## Migration Checklist

- [x] M0: 建立迁移文档和 no-QA-regression 边界。
- [x] M1: 实现文档型 artifact manager。
- [x] M2: 迁移 Word create/inspect 最小闭环。
- [x] M3: 迁移 Word 增删改能力。
- [x] M4: 迁移 Word 模板、字段、表格、合并、diff。
- [x] M5: 迁移 Word render 和质量门禁。
- [x] M6: 迁移 Mermaid PNG 生成。
- [x] M7: 迁移源码驱动详细设计 skill。
- [x] M8: 实现 VS Code artifact UI。
- [ ] M10: 做真实项目验收、QA 回归 review、VSIX 打包。
- [ ] M11: 做最终迁移 review，确认没有明显破坏 ChipMate 原有能力的问题。

## Key Decisions

- [x] QA 不迁移，继续使用 ChipMate 原生 `codebase_analysis`、`semantic_search`、`document_search`。
- [x] ChipMate planner/question routing 不迁移。
- [x] ChipMate CodeGraph/RAG 管理 UI 不迁移。
- [x] ChipMate 已有 Document RAG，不迁移 ChipMate Document RAG。
- [x] ChipMate 已有 Qwen Coder autocomplete `qwen-direct` 路径，不迁移 ChipMate completion。
- [x] Skill discovery 使用 ChipMate 原生能力，不迁移 ChipMate skill discovery。
- [x] Word 通用生成、增删改、渲染、合并、diff 完整迁移。
- [x] Word contract 边界已收紧：仅保留通用工具 schema、参数校验和安全规则；不把 ChipMate 文档 contract 或 repair/gating 流程迁入 ChipMate QA。
- [x] Mermaid PNG 迁移，draw.io 本轮不迁移。
- [x] 源码驱动详细设计只迁 skill 指南和产物工具使用方式，不迁 ChipMate runtime flow、Word contract 或 skill contract gate。
- [x] Renderer 继续外置，不把 LibreOffice、Chromium、Poppler 打进 VSIX。
- [x] Artifact 默认目录使用 `.chipmate/artifacts`。
- [x] 删除类 Word edit 默认 dry-run。
- [ ] 每个阶段完成后都必须 review 是否影响 ChipMate 原有 QA、terminal、tool registry、VS Code extension 激活、settings、packaging。

## Target Architecture

- [x] 在 `/Users/archer/Work/chipmate/packages/opencode/src/chipmate/documents/` 新增文档能力内核。
- [x] 在 `/Users/archer/Work/chipmate/packages/opencode/src/chipmate/tool/` 新增 artifact、Word、Mermaid 工具。
- [x] 在 ChipMate tool registry 中以旁路工具方式注册新增工具。
- [x] 在 ChipMate 原生 skill 目录迁入 `documents` skill；该 skill 只提供通用 Word/Mermaid/artifact 指南。
- [x] 在 ChipMate 原生 skill 目录迁入 `source-backed-detail-design` skill；该 skill 是可选指南，不是 ChipMate contract/gating runtime。
- [x] 保持 ChipMate 原生 agent/QA 主链路不变。
- [x] 保持 ChipMate 原生 `document_search` 只负责读已有文档，新 Word tools 负责生成/编辑产物。
- [x] 所有生成文件必须通过 artifact manager 登记。
- [x] 所有 tool result 返回路径、摘要、warnings，不返回大体积文件内容。

## Public APIs and Tool Contracts

### Artifact Tools

- [x] 新增 `declare_artifact`，用于创建或更新 artifact manifest。
- [x] 新增 `list_artifacts`，用于列出当前 workspace artifacts。
- [x] 新增 `open_artifact`，用于打开 artifact 文件或目录。
- [x] 新增 `export_artifact_diagnostics`，用于导出 artifact 诊断信息。
- [x] Artifact 默认目录为 `.chipmate/artifacts/<timestamp>-<task-slug>/`。
- [x] Artifact manifest 必须至少包含 `kind`、`title`、`createdAt`、`primaryFile`、`derivedFiles`、`sourceFiles`、`warnings`、`quality`。
- [x] Artifact manifest 中的路径必须是 workspace-relative 或 artifact-relative 路径。
- [x] Artifact 写入必须拒绝 workspace 外路径。

示例 manifest:

```json
{
  "kind": "word-document",
  "title": "模块详细设计文档",
  "createdAt": "2026-07-07T15:30:12+08:00",
  "primaryFile": "design.docx",
  "derivedFiles": ["design.pdf", "rendered/page-001.png"],
  "sourceFiles": [],
  "warnings": [],
  "quality": {
    "status": "ok"
  }
}
```

### Word Tools

- [x] 新增 `create_word_document`，从结构化 spec 创建 `.docx`。
- [x] 新增 `inspect_word_document`，读取 `.docx` outline、段落、表格、图片、样式。
- [x] 新增 `apply_word_document_edits`，对已有 `.docx` 执行增删改。
- [x] 新增 `render_word_document`，渲染 PDF/page PNG 并返回质量诊断。
- [x] 新增 `apply_word_template_styles`，应用模板样式、主题、字体、编号。
- [x] 新增 `merge_word_documents`，合并多个 `.docx`。
- [x] 新增 `diff_word_documents`，比较两个 `.docx`。
- [x] 新增 `materialize_word_fields`，处理 caption、SEQ、TOC、页码类字段。
- [x] 新增 `normalize_word_table_spec`，规范化和诊断 Word 表格 spec。

`apply_word_document_edits` 第一批 edit ops:

- [x] 支持 `insert_after_heading`。
- [x] 支持 `insert_before_heading`。
- [x] 支持 `append_blocks`。
- [x] 支持 `replace_paragraph`。
- [x] 支持 `replace_paragraph_with_blocks`。
- [x] 支持 `replace_section`。
- [x] 支持 `delete_paragraph`。
- [x] 支持 `delete_section`。
- [x] 支持 `delete_table`。
- [x] 支持 `update_table`。
- [x] 支持 `replace_image`。
- [x] 支持 `fill_content_control`。
- [x] 支持 `patch_ooxml_part`。

Word edit 默认行为:

- [x] 删除类操作默认 `dryRun: true`。
- [x] 默认 `overwrite: false`。
- [x] 默认 `backup: true`。
- [x] 默认 `renderAfterEdit: false`，只有用户明确要求时启用。
- [x] 默认输出到当前 artifact 目录下的新版本文件。

### Mermaid Tools

- [x] 新增 `validate_mermaid_diagram`，静态检查 Mermaid 输入。
- [x] 新增 `render_mermaid_diagram`，Mermaid 文本生成 PNG。
- [x] 新增 `save_mermaid_artifact`，保存 `.mmd` 和 `.png`。
- [x] 新增 `insert_mermaid_into_word`，将 Mermaid PNG 插入 Word。
- [x] Mermaid 渲染诊断至少支持 `chrome-not-found`、`chrome-startup-failed`、`mermaid-render-failed`、`mermaid-render-timeout`、`png-invalid`、`artifact-write-failed`。
- [x] Mermaid 工具只负责渲染，不负责判断业务主流程、异常流、状态角色、图型语义。

### VS Code Commands and Settings

- [x] 新增 `chipmate.documents.openArtifact` command。
- [x] 新增 `chipmate.documents.openArtifactFolder` command。
- [x] 新增 `chipmate.documents.exportDiagnostics` command。
- [x] 新增 `chipmate.documents.artifacts.root` setting，默认 `.chipmate/artifacts`。
- [x] 新增 `chipmate.documents.wordRender.remoteEndpoint` setting，默认空。
- [x] 新增 `chipmate.documents.wordRender.autoVerify` setting，默认 `false`。
- [x] 明确 Word render runtime 仍通过显式 tool 参数、`CHIPMATE_WORD_RENDER_ENDPOINT`，或本机已存在的 `soffice`/`pdftoppm` 环境驱动，不改 ChipMate 原生 session 配置链，也不把 renderer 二进制打包进 VSIX。
- [x] 新增 `chipmate.documents.tools.enabled` setting，默认 `true`。
- [x] `chipmate.documents.tools.enabled` 至少保护 VS Code artifact 命令入口；普通 QA、Document RAG、autocomplete、原生 terminal 不受该开关影响。

## M0: 迁移文档和边界

- [x] 新增 `/Users/archer/Work/chipmate/docs/no-qa-regression-boundary.md`，明确 QA 不迁移。
- [x] 新增 `/Users/archer/Work/chipmate/docs/document-tools-contract.md`，定义 artifact、Word、Mermaid 通用 tool API 边界；该文件不代表迁移 ChipMate runtime contract。
- [x] 新增 `/Users/archer/Work/chipmate/docs/source-backed-detail-design-skill-contract.md`，定义详细设计 skill 使用 ChipMate 原生证据工具的边界；该文件已收紧为 skill boundary，不迁移 ChipMate skill contract。
- [x] 明确普通代码问答、调用链分析、宏/寄存器/MMIO 分析继续优先走 ChipMate 原生代码理解工具。
- [x] Review M0: 检查文档中没有写成“替换 ChipMate QA”或“迁移 ChipMate planner”。
- [x] Review M0: 检查计划没有要求修改 ChipMate 原有 QA prompt 的核心行为。
- [x] Review M0: 检查所有非目标能力都明确列为 non-goals。
- [x] Review M0 更新: 检查 Word/document contract 只作为通用工具 API 边界保留，不作为 QA planner、missing-deliverable repair gate 或 skill contract gate。

## M1: Artifact Manager

- [x] 新增 artifact manager 模块，支持创建 artifact 目录、写 manifest、追加 warnings、记录 derived files。
- [x] 新增 `declare_artifact` tool。
- [x] 新增 `list_artifacts` tool。
- [x] 新增 `open_artifact` tool。
- [x] 新增 `export_artifact_diagnostics` tool。
- [x] 将 artifact tools 注册到 ChipMate tool registry。
- [x] artifact 根目录默认 `.chipmate/artifacts`。
- [x] artifact 写入必须限制在 workspace 内。
- [x] tool result 只返回 manifest 摘要、路径、warnings。
- [x] VS Code 侧新增打开 artifact 文件和目录的命令。
- [x] 增加 artifact manager 单元测试覆盖 dummy artifact 创建、list、open、diagnostics 和路径安全。
- [x] 增加 tool registry 回归测试覆盖 artifact tools 追加且不替换原有 ChipMate QA tools。
- [x] 测试 dummy artifact 创建。
- [x] 测试 artifact list。
- [x] 测试 artifact open。
- [x] 测试普通 QA 不创建 artifact。
- [x] Review M1: 检查 artifact tools 不会在普通 QA 中被误触发。
- [x] Review M1: 检查路径安全，不允许写出 workspace。
- [x] Review M1: 检查 tool result 不把大文件内容塞进上下文。
- [x] Review M1: 检查 ChipMate 原有 tool registry 工具仍可正常注册。

## M2: Word Create + Inspect

- [x] 新增 Word documents 模块目录。
- [x] 迁移 Word spec、block、table、image、style 类型。
- [x] 迁移 DOCX 文件读写能力。
- [x] 迁移 Word builder，支持标题、段落、列表、表格、图片、代码块。
- [x] 迁移 Word spec validator。
- [x] 迁移 Word inspector，输出 bounded JSON。
- [x] 新增 `create_word_document` tool。
- [x] 新增 `inspect_word_document` tool。
- [x] `create_word_document` 默认写入 artifact 目录。
- [x] `inspect_word_document` 默认输出 outline、paragraph summaries、tables、images、styles。
- [x] 增加 Word create/inspect 单元测试覆盖创建 docx artifact、bounded inspect、图片关系和路径安全。
- [x] 扩展 tool registry 回归测试覆盖 Word tools 追加且不替换原有 ChipMate QA tools。
- [x] 测试创建简单 Word。
- [x] 测试创建含表格 Word。
- [x] 测试创建含图片 Word。
- [x] 测试 inspect 返回 bounded JSON。
- [x] 测试 create 后自动登记 artifact。
- [x] Review M2: 检查 Word tools 只在明确 Word/docx 请求时触发。
- [x] Review M2: 检查没有覆盖 ChipMate `document_search` 的读取职责。
- [x] Review M2: 检查新增依赖不会破坏 ChipMate build/package。
- [x] Review M2: 检查普通嵌入式 C QA 不触发 Word tools。

## M3: Word 增删改

- [x] 迁移 Word edit plan DSL。
- [x] 迁移 Word document editor。
- [x] 迁移 OOXML patch 能力。
- [x] 迁移 content control 相关能力。
- [x] 迁移 source block placement 相关能力。
- [x] 新增 `apply_word_document_edits` tool。
- [x] 支持 `insert_after_heading`。
- [x] 支持 `insert_before_heading`。
- [x] 支持 `append_blocks`。
- [x] 支持 `replace_paragraph`。
- [x] 支持 `replace_paragraph_with_blocks`。
- [x] 支持 `replace_section`。
- [x] 支持 `delete_paragraph`。
- [x] 支持 `delete_section`。
- [x] 支持 `delete_table`。
- [x] 支持 `update_table`。
- [x] 支持 `replace_image`。
- [x] 支持 `fill_content_control`。
- [x] 支持 `patch_ooxml_part`。
- [x] 删除类操作默认 dry-run。
- [x] 非 dry-run 默认写出新 docx，不覆盖原文件。
- [x] 图片替换必须维护 `document.xml.rels`、`[Content_Types].xml`、`word/media/*`。
- [x] 修改后记录 edit plan、dry-run 结果和新版本文件。
- [x] 增加 Word edit 单元测试覆盖 dry-run、默认删除 dry-run、insert、replace、delete、table update、replace image、OOXML patch、content control 和路径安全。
- [x] 测试插入章节。
- [x] 测试删除章节 dry-run。
- [x] 测试删除章节 apply。
- [x] 测试替换段落为复杂 blocks。
- [x] 测试替换图片。
- [x] 测试 anchor 不唯一时拒绝高风险 edit。
- [x] Review M3: 检查删除/覆盖操作不会绕过权限或 dry-run。
- [x] Review M3: 检查 edit tool 不会误改用户原始 docx。
- [x] 静态 Review M3: Word edit/tool 操作失败会返回普通 tool result，不替换或中断 ChipMate 原生 QA 路由；真实 session 行为仍留到 M10 smoke。
- [x] Review M3: 检查普通文件 edit 工具仍按 ChipMate 原行为工作。

## M4: Word 模板、字段、表格、合并、diff

- [x] 迁移模板样式应用能力。
- [x] 迁移 Word style tools。
- [x] 迁移表格工具。
- [x] 迁移 table spec utils。
- [x] 迁移 Word fields 能力。
- [x] 迁移 Word merger。
- [x] 迁移 Word diff。
- [x] 新增 `apply_word_template_styles` tool。
- [x] 新增 `materialize_word_fields` tool。
- [x] 新增 `merge_word_documents` tool。
- [x] 新增 `diff_word_documents` tool。
- [x] 支持模板样式、主题、字体、编号继承。
- [x] 不承诺完整 mail-merge 占位符填充。
- [x] 支持 Figure/Table caption。
- [x] 支持 SEQ 字段。
- [x] 支持 TOC 字段保留或物化。
- [x] 合并文档时迁移图片、rels、content types。
- [x] 合并文档时处理 bookmark id 冲突。
- [x] diff 输出 Markdown 摘要和 JSON 诊断。
- [x] 测试应用模板样式。
- [x] 测试字段处理。
- [x] 测试合并含图片文档。
- [x] 测试 Word diff。
- [x] 测试样式冲突 warning。
- [x] Review M4: 检查模板能力没有被描述成完整 mail-merge。
- [x] 静态 Review M4: merge 实现会重映射图片 rel、复制 media、更新 `document.xml.rels` 和 `[Content_Types].xml`；真实复杂 `.docx` 仍留到 M10 验证。
- [x] Review M4: 检查 diff 不把整篇文档塞进模型上下文。
- [x] Review M4: 检查新增 Word 能力仍然不影响 ChipMate document_search。

## M5: Word Render 和质量门禁

- [x] 迁移 DOCX render quality gate。
- [x] 迁移 Word render quality gate。
- [x] 迁移 report quality gate 中通用可复用部分。
- [x] 新增 `render_word_document` tool。
- [x] 支持调用 remote renderer endpoint。
- [x] 输出 PDF 到 artifact 目录。
- [x] 输出 page PNG 到 artifact `rendered/` 目录。
- [x] 返回 page count、PDF path、page PNG paths、warnings。
- [x] 检查空白页。
- [x] 检查 PNG 非法。
- [x] 检查页数异常。
- [x] 检查图片明显丢失。
- [x] Renderer endpoint 未配置时返回明确 warning。
- [x] 不把 LibreOffice、Chromium、Poppler 打包进 VSIX。
- [x] VS Code UI 能打开 PDF 和 page PNG。
- [x] 测试 render docx。
- [x] 测试 endpoint 未配置 warning。
- [x] 测试空白页 warning。
- [x] 测试 artifact manifest 更新。
- [x] Review M5: 检查 render 失败不会把成功生成的 docx 标记为失败。
- [x] 静态 Review M5: render 每次调用都创建局部 `diagnostics/warnings` 并按当前 response 计算 quality；真实 endpoint 连续调用仍留到 M10 验证。
- [x] Review M5: 检查 renderer 外置，不显著增大 VSIX。
- [x] Review M5: 检查普通 QA 不自动触发 render。

## M6: Mermaid PNG

- [x] 迁移 Mermaid PNG renderer。
- [x] 迁移可复用 diagram 类型。
- [x] 新增 Mermaid document module。
- [x] 新增 `validate_mermaid_diagram` tool。
- [x] 新增 `render_mermaid_diagram` tool。
- [x] 新增 `save_mermaid_artifact` tool。
- [x] 新增 `insert_mermaid_into_word` tool。
- [x] Mermaid 源码保存为 `.mmd`。
- [x] PNG 保存为 `.png`。
- [x] Mermaid artifacts 使用统一 manifest。
- [x] 渲染错误返回结构化 diagnostic code。
- [x] 本轮不迁移 draw.io 完整链路。
- [x] 测试 Mermaid 生成 PNG。
- [x] 测试错误 Mermaid 返回 `mermaid-render-failed`。
- [x] 测试超时返回 `mermaid-render-timeout`。
- [x] 测试 PNG 插入 Word。
- [x] Review M6: 检查 Mermaid 工具不会替模型做业务语义判断。
- [x] Review M6: 检查 Mermaid 失败不会影响 Word 文档主体生成。
- [x] Review M6: 检查普通代码 QA 不触发 Mermaid tools。
- [x] Review M6: 检查 draw.io 未迁移边界被清楚保留。

## M7: Source-backed Detail Design Skill

- [x] 迁移 `source-backed-detail-design` skill 到 ChipMate 原生 skill 目录。
- [x] 迁移或合并 `chip-design-doc` skill 中的关键文档结构。
- [x] 将 skill 内 ChipMate 工具名替换为 ChipMate 新工具名。
- [x] 更新 `source-backed-detail-design` skill：详细设计流程改为 ChipMate 原生 agent 可选指南，不强制 ChipMate work-package contract、Word contract 或 quality-gate blocking 机制。
- [x] Skill 明确先用 ChipMate 原生 `codebase_analysis`、`semantic_search`、`document_search` 搜证据。
- [x] Skill 明确关键结论必须附源码或文档证据。
- [x] Skill 明确输出当前设计。
- [x] Skill 明确输出功能覆盖。
- [x] Skill 明确输出接口。
- [x] Skill 明确输出数据结构。
- [x] Skill 明确输出主流程。
- [x] Skill 明确输出异常流。
- [x] Skill 明确输出状态机。
- [x] Skill 明确输出配置项。
- [x] Skill 明确输出约束。
- [x] Skill 明确输出测试建议。
- [x] Skill 明确可生成业务流程图、代码流程图、状态机图、架构图。
- [x] Skill 明确最终产物包括 Markdown 草稿、Mermaid PNG、Word docx、rendered PDF/page PNG。
- [x] Skill 明确普通 QA 不应触发该流程。
- [x] 测试生成模块详细设计文档。
- [x] 测试只生成状态机章节。
- [x] 测试更新已有详细设计文档。
- [x] 测试证据覆盖。
- [x] Review M7: 检查没有迁移 ChipMate `DesignDocAgentFlow` runtime。
- [x] Review M7: 检查 skill 不绕过 ChipMate 原生代码理解工具。
- [x] Review M7: 检查普通问答不会被强制套详细设计流程。
- [x] Review M7: 检查详细设计生成失败不会影响 ChipMate QA 会话。

## M8: VS Code Artifact UI

- [x] 在聊天结果中展示 artifact 主文件链接。
- [x] 在聊天结果中展示 PDF 链接。
- [x] 在聊天结果中展示 page PNG 链接。
- [x] 在聊天结果中展示 diagnostics 链接。
- [x] 新增打开 artifact folder 的按钮或命令。
- [x] 新增 document artifact diagnostics 导出命令。
- [x] 对 page PNG 使用安全 webview URI。
- [x] UI 只展示 artifact manifest，不承担文档生成逻辑。
- [x] UI 文案区分 `warning` 和 `failed`。
- [x] 测试 Word artifact 展示。
- [x] 测试 Mermaid artifact 展示。
- [x] 测试 diagnostics 导出。
- [x] 测试 warning 不显示成失败。
- [x] Review M8: 检查 UI 不引入新的全局状态污染。
- [x] Review M8: 检查 UI 不影响 ChipMate 原有 chat rendering。
- [x] Review M8: 检查 artifact 卡片不会出现在普通 QA 中。
- [x] Review M8: 检查按钮和命令不会覆盖 ChipMate 原有 command id。


- [x] 新增 VS Code terminal profile。
- [x] 迁移 VS Code terminal profile 适配。
- [x] 迁移项目上下文摘要能力。
- [x] 复用 ChipMate 原生命令/agent 能力。
- [x] 不替换 ChipMate shell tool。
- [x] 支持自然语言命令规划。
- [x] 支持危险命令确认。
- [x] 支持命令失败后的修复建议。
- [x] 支持项目上下文摘要。
- [x] 支持长输出摘要。
- [x] 可选将长日志登记为 artifact。
- [x] 不改 ChipMate 原生 terminal/session manager 行为，除非为新增 profile 做最小适配。
- [x] 测试自然语言安全命令。
- [x] 测试危险命令确认。
- [x] 测试命令失败修复建议。
- [x] Review M9: 检查没有替换 ChipMate 原有 terminal/session manager。
- [x] Review M9: 检查危险命令确认可靠。
- [x] Review M9: 检查原生 bash/tool loop 不退化。

## M10: 全量测试、真实项目验收、打包

- [x] 增加 artifact manager 单元测试。
- [x] 增加 Word create 单元测试。
- [x] 增加 Word inspect 单元测试。
- [x] 增加 Word edit 单元测试。
- [x] 增加 Word render 集成测试。
- [x] 增加 Word merge/diff 测试。
- [x] 增加 Mermaid validate/render 测试。
- [x] 增加 artifact UI smoke test。
- [x] 增加 source-backed detail-design skill 端到端 fixture。
- [x] 增加普通 QA 不触发 document tools 的回归测试。
- [x] 增加 ChipMate 原生 `codebase_analysis` 仍可用的回归测试。
- [x] 增加 ChipMate 原生 `semantic_search` 仍可用的回归测试。
- [x] 增加 ChipMate 原生 `document_search` 仍可用的回归测试。
- [x] 增加 ChipMate autocomplete/Qwen direct 不受影响的 smoke 检查。
- [ ] 在内网嵌入式 C 项目上测试详细设计文档生成。
- [x] 在真实 `.docx` 模板上测试样式继承；当前证据使用现有 QEMU `.docx` 作为 style source，真实公司品牌模板兼容性仍记录为风险。
- [x] 打包 VSIX。
- [x] 安装 VSIX 做真实 extension-host/command smoke：当前 Linux-target 与 Windows-target VSIX 均通过 isolated installed host/command smoke，证据 `docs/chipmate-feature-migration-validation-runs/20260708-050231-installed-vsix-host-command-smoke-refresh/summary.md`。
- [ ] 安装 VSIX 做真实 chat/runtime S1-S16 smoke；这仍依赖可用 chat/autocomplete provider、目标工作区和人工/目标机执行，不能由 extension-host/command smoke 替代。
- [x] 新增 S16 autocomplete source guard helper：`docs/chipmate-feature-migration-s16-source-guard.sh` 只读快照 qwen autocomplete/package protected paths，并扫描旧 S16 证据里的源码修改风险；当前证据 `docs/chipmate-feature-migration-validation-runs/20260709-004500-s16-source-guard/summary.md` 返回 `NEEDS_REVIEW`，所以它是防误收口 guard，不是 S16 通过证据。
- [x] 建立 validation evidence 台账，包含命令、VSIX、installed smoke、known issues 的填报结构；未运行项保持 TODO。
- [x] 新增 validation capture helper，用于后续显式运行 M10 命令时采集 logs/status/smoke checklist；默认不执行任何验证。
- [x] 新增 VSIX inspection helper，用于后续检查版本、大小、manifest 和 renderer payload 边界；不打包、不安装。
- [x] 新增 validation summary helper，用于汇总 capture run 的 status、VSIX inspection 和 smoke checklist；只读，不改变验收状态。
- [x] 加固 validation helper 输出格式：summary Markdown 表格转义特殊字符，VSIX inspection 状态通过显式 status 文件回填。
- [x] 加固 VSIX inspection 结果语义：发现高风险 renderer payload 时同时记录 `FAIL` 状态和非零 exit code，`REVIEW` 保留为人工确认状态。
- [x] 新增 completion audit helper，用于最终签收前列出未勾选计划项，以及 plan/evidence/final review 表格 `Status`/`Result` 列中剩余 TODO、FAIL、REVIEW、OPEN、PENDING、PARTIAL、BLOCKED_AUTH、TIMEOUT、NEEDS_REVIEW 等风险状态；只读，不替代 M11 review。
- [x] 新增 post-validation update guide，明确命令证据、VSIX inspection、installed smoke 与计划勾选项的对应关系，避免把弱证据误勾为完成。
- [x] 新增 ChipMate no-regression runtime review 模板，用于 M11 逐项记录原生 QA、Document RAG、autocomplete、terminal、tool registry、VS Code 激活和打包能力是否被破坏。
- [x] 记录版本、artifact、验证命令、已知限制。
- [x] Review M10: 检查所有新增能力能按需触发。
- [x] Review M10: 检查所有非目标能力没有被误迁移。
- [x] Review M10: 检查 ChipMate 原有 QA、terminal、autocomplete、Document RAG 没有明显退化；当前结论为 `PASS_WITH_LIMITS`，focused no-regression refresh `docs/chipmate-feature-migration-validation-runs/20260708-045849-m10-chipmate-no-regression-review/summary.md` 通过，但 installed S1-S3/S14-S16 和 M11 final no-regression 仍未完成。
- [x] Review M10: 检查 VSIX 体积和启动耗时没有明显异常；当前证据为 VSIX size/inspection、isolated CLI install、VS Code extension-host activation smoke 2/2 pass，目标 Windows/Linux installed runtime smoke 仍保留到 S1-S16。

M10 evidence update 2026-07-08:

- [x] `docs/chipmate-feature-migration-validation-runs/20260708-080354/status.tsv` recorded C2/C4/C5/C6 PASS and C1/C3 FAIL.
- [x] Targeted migrated tool tests passed: `document-artifacts`, `mermaid-documents`, `word-documents` 12/12.
- [x] Internal offline Linux x64 VSIX generated: `packages/chipmate-vscode/out/chipmate-vscode-linux-x64-baseline.vsix`, version `0.0.38`, `143.95 MiB`.
- [x] Internal offline Windows x64 VSIX generated: `packages/chipmate-vscode/out/chipmate-vscode-win32-x64-baseline.vsix`, version `0.0.38`, `159.93 MiB`.
- [x] Linux VSIX inspection PASS: `docs/chipmate-feature-migration-validation-runs/20260708-082006/vsix-inspection.md`.
- [x] Windows VSIX inspection REVIEW: `docs/chipmate-feature-migration-validation-runs/20260708-081959/vsix-inspection.md`; high-risk renderer payload scan is `none`, review-required payload is existing internal-offline Poppler/pdftotext.
- [x] Reconciled M1-M6 automated test checklist items against T1/T2 and source test assertions; unchecked items remain where evidence is implementation-only or requires installed/runtime smoke.
- [x] Added and ran targeted Word test coverage for complex block replacement, ambiguous locator rejection, and render artifact manifest updates: `cd packages/opencode && bun test test/chipmate/word-documents.test.ts --timeout 60000`, 7/7 pass.
- [x] Refreshed Word focused test after local renderer fallback: `docs/chipmate-feature-migration-validation-runs/20260708-225900-word-render-local-fallback-focused-test/summary.md`; `bun test test/chipmate/word-documents.test.ts --timeout 60000` passes 7/7 and now covers endpoint warning, remote renderer, and fake local `soffice`/`pdftoppm` fallback wiring.
- [x] Added and reran source-backed detail-design skill boundary coverage after removing ChipMate Word/document contract scope and old contract-helper resources: `cd packages/opencode && bun test test/chipmate/source-backed-detail-design-skill.test.ts --timeout 60000`, 5/5 pass.
- [x] Added and ran VS Code extension-host smoke for activation, command registry, and settings visibility: `cd packages/chipmate-vscode && bun run compile-tests && bunx vscode-test --fail-zero --timeout 30000`, 2/2 pass; summary in `docs/chipmate-feature-migration-validation-runs/20260708-084152-extension-host-smoke/summary.md`.
- [x] Re-ran VS Code extension lint after extension-host smoke changes: `cd packages/chipmate-vscode && bun run lint`, PASS.
- [x] Hardened Poppler Windows packaging with `POPPLER_WINDOWS_ARCHIVE`, `CHIPMATE_POPPLER_CACHE_DIR`, retry, and fetch timeout support; `cd packages/chipmate-vscode && bun test tests/unit/poppler-helper.test.ts --timeout 60000`, 2/2 pass.
- [x] Rebuilt current internal-offline Linux and Windows VSIX after test-tooling and Poppler helper changes: `cd packages/chipmate-vscode && bun run package:internal-offline`, PASS; current Linux size `150944476` bytes / `143.95 MiB`, current Windows size `167696538` bytes / `159.93 MiB`.
- [x] Current Linux VSIX inspection PASS: `docs/chipmate-feature-migration-validation-runs/20260708-085117/vsix-inspection.md`.
- [x] Current Windows VSIX inspection REVIEW: `docs/chipmate-feature-migration-validation-runs/20260708-085123/vsix-inspection.md`; high-risk renderer payload scan is `none`, review-required payload is existing internal-offline Poppler/pdftotext.
- [x] Current rebuilt VSIX isolated CLI install PASS for both Linux and Windows targets: `docs/chipmate-feature-migration-validation-runs/20260708-085149-isolated-vscode-install-current/summary.md`.
- [x] Real embedded C project tool-layer smoke PASS on QEMU UFS: `docs/chipmate-feature-migration-validation-runs/20260708-085842-qemu-ufs-real-project-tool-smoke/summary.md`; generated a real `.docx`, Mermaid `.mmd`, artifact manifests, and expected Word render endpoint warning under `/Users/archer/Work/qemu/.chipmate/artifacts`.
- [x] Real `.docx` style inheritance smoke PASS_WITH_LIMITS: `docs/chipmate-feature-migration-validation-runs/20260708-090328-qemu-real-docx-style-smoke/summary.md`; used existing `/Users/archer/Work/qemu/.chipmate/docs/qemu-ufs-detail-design-20260705-003408.docx` as a style source and applied `word/styles.xml` plus `word/numbering.xml`.
- [x] Installed Linux-target VSIX extension-host offline smoke PASS: `docs/chipmate-feature-migration-validation-runs/20260708-091040-installed-vsix-extension-host-offline-smoke-shortpath/summary.md`; installed current Linux VSIX into an isolated short-path VS Code profile, activated `chipmate.chipmate`, and verified native plus sidecar commands/settings/profile/sidebar contributions.
- [x] Installed Windows-target VSIX extension-host offline smoke PASS: `docs/chipmate-feature-migration-validation-runs/20260708-091112-installed-win32-vsix-extension-host-offline-smoke-shortpath/summary.md`; installed current Windows VSIX into an isolated short-path VS Code profile, activated `chipmate.chipmate`, and verified the same contribution set.
- [x] Added reusable installed VSIX extension-host smoke helper: `docs/chipmate-feature-migration-installed-vsix-host-smoke.sh`; scripted Linux/Windows pair PASS in `docs/chipmate-feature-migration-validation-runs/20260708-091354-scripted-installed-vsix-host-smoke/summary.md`.
- [x] Fixed installed artifact diagnostics repeat-run bug: artifact root diagnostics JSON files are no longer treated as artifact directories.
- [x] Added focused regression coverage for the artifact diagnostics repeat-run bug: `docs/chipmate-feature-migration-validation-runs/20260708-092532-artifact-diagnostics-repeat-regression/summary.md`; `document-artifact-card-service.test.ts` now covers root-level diagnostics JSON files, 3/3 pass.
- [x] Rebuilt Linux/Windows VSIX after artifact diagnostics fix: `docs/chipmate-feature-migration-validation-runs/20260708-091733-post-artifact-diagnostics-fix-package/summary.md`; Linux size `150944484` bytes / `143.95 MiB`, Windows size `167696546` bytes / `159.93 MiB`.
- [x] Post-fix VSIX inspection complete: `docs/chipmate-feature-migration-validation-runs/20260708-092125-post-fix-vsix-inspection/summary.md`; Linux PASS, Windows REVIEW only for existing Poppler/pdftotext offline dependency, high-risk renderer payload scan remains `none`.
- [x] Attempted CLI native C QA smoke on QEMU UFS: `docs/chipmate-feature-migration-validation-runs/20260708-092652-cli-native-c-qa-smoke/summary.md`; ChipMate started indexing and reused codegraph/postings, but the run is not accepted as S1 pass because the configured DeepSeek credential returned `401 invalid api key`.
- [x] Attempted CLI macro/register QA and document QA/RAG smoke: `docs/chipmate-feature-migration-validation-runs/20260708-092837-cli-qa-rag-auth-smoke/summary.md`; both runs are not accepted as S2/S3 pass because the configured DeepSeek credential returned `401 invalid api key`.
- [x] Attempted one-shot provider recovery without changing global/project config: `docs/chipmate-feature-migration-validation-runs/20260708-093245-temp-provider-connectivity-smoke/summary.md` timed out while using redacted `CHIPMATE_CONFIG_CONTENT`; direct API probe `docs/chipmate-feature-migration-validation-runs/20260708-093522-temp-provider-direct-api-probe/summary.md` returned `HTTP 503`, so the saved indexing openai-compatible endpoint cannot currently be treated as a working chat provider for S1-S3.
- [x] Added conservative runtime smoke rerun helper: `docs/chipmate-feature-migration-runtime-smoke.sh`; it supports `--preflight`, `--run-qa`, `--run-all`, and `--ids`, uses one-shot redacted provider config when supplied, and records `NEEDS_REVIEW`/`BLOCKED_AUTH` instead of auto-marking acceptance items PASS.
- [x] Added runtime unblock runbook for finishing M10/M11 after provider/template/internal workspace are available: `docs/chipmate-feature-migration-runtime-unblock-runbook.md`; enhanced `docs/chipmate-feature-migration-runtime-smoke.sh` to inject `CHIPMATE_SMOKE_TEMPLATE_DOCX` into S9; verification `docs/chipmate-feature-migration-validation-runs/20260708-095817-runtime-unblock-runbook-verify/summary.md` confirms script syntax and help output.
- [x] Ran runtime smoke preflight against the current ChipMate auth state: `docs/chipmate-feature-migration-validation-runs/20260708-093856-runtime-smoke-preflight-current-auth/summary.md`; current status remains `BLOCKED_AUTH`, so installed/chat acceptance prompts still cannot be accepted.
- [x] Refreshed runtime smoke preflight against the current local provider/auth state: `docs/chipmate-feature-migration-validation-runs/20260708-173500-runtime-smoke-preflight-refresh/summary.md`; command `VALIDATION_RUN_DIR=docs/chipmate-feature-migration-validation-runs/20260708-173500-runtime-smoke-preflight-refresh bash docs/chipmate-feature-migration-runtime-smoke.sh --preflight` exited `0` but still reports `BLOCKED_AUTH`, so installed chat/runtime S1-S16 and QA preservation cannot be accepted from this environment yet.
- [x] Completion audit refreshed after current runtime preflight recheck: `docs/chipmate-feature-migration-validation-runs/20260708-174500-completion-audit-after-runtime-preflight-doc-update/completion-audit.md`; reports `72` blockers, `60` review items, and `Completion allowed: no`, preserving the boundary that `BLOCKED_AUTH` preflight evidence does not complete installed S1-S16, QA preservation, target OS execution, or M11 review.
- [x] Ran runtime smoke S1-S3 batch entry against the current ChipMate auth state: `docs/chipmate-feature-migration-validation-runs/20260708-093944-runtime-smoke-run-qa-current-auth/summary.md`; S1/S2/S3 all record `BLOCKED_AUTH`, proving the rerun harness works while confirming runtime QA remains blocked by chat provider auth.
- [x] Ran status-column completion audit guardrail after narrowing the scanner to unchecked plan items plus Markdown table `Status`/`Result` columns: `docs/chipmate-feature-migration-validation-runs/20260708-112311-completion-audit-after-windows-cmd-runner/completion-audit.md`; it reports `76` blockers, `23` review items, and `Completion allowed: no`, intentionally preventing final sign-off while S1-S16/runtime/internal validation remain `OPEN`/`PENDING`/`PARTIAL`/`BLOCKED_AUTH` and while full-suite failures remain recorded.
- [x] Added full-suite failure triage: `docs/chipmate-feature-migration-full-suite-triage.md`; C1 migrated sidecar tests passed while non-sidecar config/session/provider/skill-discovery/webfetch areas failed, and C3 failures are classified around autocomplete/backend/mock/legacy/font-size surfaces. This narrows M11 interpretation but does not convert C1/C3 to PASS.
- [x] Captured current offline Windows/Linux x86-64 VSIX delivery manifest with size and SHA256: `docs/chipmate-feature-migration-validation-runs/20260708-094144-offline-vsix-delivery-manifest/summary.md`; Linux SHA256 `7bd8e137a18e1aae7b0266c680929e7226a08c999cd986067b1ded22d91928ec`, Windows SHA256 `5c44c3b7e0f3643fa2fb4b6dc654931c73b72faee2f534be7542a66a5f98e0ec`, version `0.0.38`.
- [x] Added and ran VSIX target package verifier: `docs/chipmate-feature-migration-vsix-target-verify.sh`; PASS summary `docs/chipmate-feature-migration-validation-runs/20260708-102514-vsix-target-verify/summary.md` confirms both VSIX files keep `chipmate.chipmate@0.0.38`, VS Code engine `^1.93.0`, expected target CLI/LanceDB assets, no opposite-platform native modules, and no macOS `._*`/`.DS_Store`/`__MACOSX` noise.
- [x] Added offline handoff companion files beside the target VSIX artifacts: `packages/chipmate-vscode/out/SHA256SUMS-chipmate-0.0.38-offline.txt` and `packages/chipmate-vscode/out/OFFLINE_RELEASE_NOTES-chipmate-0.0.38.md`; validation summary `docs/chipmate-feature-migration-validation-runs/20260708-094445-offline-handoff-files/summary.md`; these record target filenames, version, size, SHA256, install command, and remaining runtime sign-off caveats.
- [x] Verified offline VSIX checksum handoff file against current target artifacts: `docs/chipmate-feature-migration-validation-runs/20260708-094551-offline-checksum-verify/summary.md`; `shasum -a 256 -c` returned `OK` for both Linux and Windows VSIX files.
- [x] Added offline release index companion files: `packages/chipmate-vscode/out/OFFLINE_RELEASE_INDEX-chipmate-0.0.38.json` and `packages/chipmate-vscode/out/OFFLINE_RELEASE_INDEX-chipmate-0.0.38.md`; validation summary `docs/chipmate-feature-migration-validation-runs/20260708-094727-offline-release-index/summary.md`; these list target artifacts, checksums, verification references, and remaining sign-off caveats.
- [x] Verified offline release index JSON syntax: `docs/chipmate-feature-migration-validation-runs/20260708-094809-offline-release-index-verify/summary.md`; `python3 -m json.tool` exited `0`.
- [x] Added reusable offline handoff verifier: `docs/chipmate-feature-migration-offline-handoff-verify.sh`; current verification PASS in `docs/chipmate-feature-migration-validation-runs/20260708-094956-offline-handoff-verify/summary.md`, covering required handoff files, checksum file, release index JSON, target file sizes, and target SHA256 values.
- [x] Created clean non-self-referential offline handoff bundle: `packages/chipmate-vscode/out/chipmate-0.0.38-offline-handoff.tar.gz` plus `packages/chipmate-vscode/out/chipmate-0.0.38-offline-handoff.tar.gz.sha256`; AppleDouble cleanup summary `docs/chipmate-feature-migration-validation-runs/20260708-101239-offline-handoff-bundle-clean-rebuild/summary.md`; final bundle-internal docs rebuild summary `docs/chipmate-feature-migration-validation-runs/20260708-102040-offline-handoff-bundle-final-docs-rebuild/summary.md`; external bundle index files `packages/chipmate-vscode/out/OFFLINE_BUNDLE_INDEX-chipmate-0.0.38.json` and `packages/chipmate-vscode/out/OFFLINE_BUNDLE_INDEX-chipmate-0.0.38.md`; bundle SHA256 `159de0e74c619e430d02a19e614fc0ebbaa58710fb831b2bed01e070bf10f752`; size `316392364` bytes / `301.74 MiB`.
- [x] Enhanced and re-ran offline handoff verifier: `docs/chipmate-feature-migration-validation-runs/20260708-102053-offline-handoff-verify/summary.md` validates VSIX files, handoff files, content release index, external bundle index, bundle size/SHA256, bundle checksum sidecar, and exact tarball contents; earlier `._*` AppleDouble tarball noise was removed.
- [x] Added offline Windows/Linux release sign-off: `docs/chipmate-feature-migration-offline-release-signoff.md`; records preferred transfer pair, exact tar contents, target VSIX checksums, install commands, and runtime caveats.
- [x] Added offline target-machine validation runbook: `docs/chipmate-feature-migration-offline-target-validation-runbook.md`; covers transfer checksum, extraction, target VSIX checksum, install commands, package identity checks, S1-S16 runtime smoke capture, and `BLOCKED_AUTH`/`BLOCKED_ENV` status rules. This prepares target validation but does not replace actually running S1-S16 on offline Windows/Linux machines.
- [x] Added offline target-machine verifier and runner scripts: `docs/chipmate-feature-migration-offline-target-verify-linux.sh`, `docs/chipmate-feature-migration-offline-target-verify-windows.ps1`, `docs/chipmate-feature-migration-offline-target-verify.py`, `docs/chipmate-feature-migration-offline-delivery-set-verify.py`, `docs/chipmate-feature-migration-offline-target-run-linux.sh`, `docs/chipmate-feature-migration-offline-target-run-windows.ps1`, and `docs/chipmate-feature-migration-offline-target-run-windows.cmd`; local Linux/bash verification passed in `docs/chipmate-feature-migration-validation-runs/20260708-103214-offline-target-linux-script-local-verify/summary.md`; local Python bundle verification passed in `docs/chipmate-feature-migration-validation-runs/20260708-105328-offline-target-python-verifier-local-smoke.run-summary.md`; extracted outer-package Linux target runner smoke passed in `docs/chipmate-feature-migration-validation-runs/20260708-111934-offline-target-runner-cmd-kit-tar-smoke/summary.md`; extracted zip delivery-set smoke passed in `docs/chipmate-feature-migration-validation-runs/20260708-111936-offline-target-runner-cmd-kit-zip-smoke/summary.md`. Windows PowerShell/cmd execution still needs an offline Windows target because `pwsh` is not available on this host.
- [x] Built a sidecar offline target verify kit so target machines do not need the whole repo to run package-integrity checks: `packages/chipmate-vscode/out/chipmate-0.0.38-offline-target-verify-kit.tar.gz` with SHA256 `3f5d64adf6422220ba8ca808018136512d883021a3dc7cfd5e69db16bceb0d2b` and size `13955` bytes. Latest rebuild evidence: `docs/chipmate-feature-migration-validation-runs/20260708-111924-offline-target-verify-kit-rebuild-with-windows-cmd-runner/summary.md`; latest extracted runner smoke evidence: `docs/chipmate-feature-migration-validation-runs/20260708-111934-offline-target-runner-cmd-kit-tar-smoke/summary.md`. This kit now includes delivery-set, bash, PowerShell, cmd wrapper, cross-platform Python verifier paths, and Linux/Windows target package evidence runners; it is intentionally separate from the main handoff bundle to avoid checksum self-reference and does not replace installed runtime S1-S16 validation.
- [x] Added offline delivery manifests and transfer checksum list in `packages/chipmate-vscode/out`: `CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.md`, `CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.json`, and `SHA256SUMS-chipmate-0.0.38-offline-delivery.txt`; latest refresh evidence `docs/chipmate-feature-migration-validation-runs/20260708-111925-offline-delivery-manifest-refresh-windows-cmd-runner/summary.md`; latest verification evidence `docs/chipmate-feature-migration-validation-runs/20260708-111934-offline-target-runner-cmd-kit-tar-smoke/summary.md`. These files summarize the transfer set and validation order without changing the main handoff bundle or replacing runtime S1-S16.
- [x] Added a non-self-referential delivery manifest checksum sidecar: `packages/chipmate-vscode/out/SHA256SUMS-chipmate-0.0.38-offline-delivery-manifest.txt`; latest refresh evidence `docs/chipmate-feature-migration-validation-runs/20260708-111925-offline-delivery-manifest-refresh-windows-cmd-runner/summary.md`; latest verification evidence `docs/chipmate-feature-migration-validation-runs/20260708-111934-offline-target-runner-cmd-kit-tar-smoke/summary.md`. It validates the JSON and Markdown delivery manifests without embedding their checksum back into the manifests.
- [x] Added optional outer offline delivery-set package for one-file transfer: `packages/chipmate-vscode/out/chipmate-0.0.38-offline-delivery-set.tar.gz` with SHA256 `0d9cf4e2526b526feadafb39d05d82807cd74bd497c1fc053c08a69638cf7b47` and size `316503764` bytes; build evidence `docs/chipmate-feature-migration-validation-runs/20260708-111925-offline-delivery-set-package-rebuild-with-windows-cmd-runner/summary.md`; extracted target-runner smoke evidence `docs/chipmate-feature-migration-validation-runs/20260708-111934-offline-target-runner-cmd-kit-tar-smoke/summary.md`. This outer package is a transport container only and does not alter the main handoff bundle or replace runtime S1-S16.
- [x] Added optional Windows-friendly outer offline delivery-set zip for one-file transfer: `packages/chipmate-vscode/out/chipmate-0.0.38-offline-delivery-set.zip` with SHA256 `ab37b32abf8ecd66df605dbc729ca1999a7b0b64ad74760202ffddbfd30bf14c` and size `316455554` bytes; build evidence `docs/chipmate-feature-migration-validation-runs/20260708-111929-offline-delivery-set-zip-rebuild-with-windows-cmd-runner/summary.md`; extracted self-verify evidence `docs/chipmate-feature-migration-validation-runs/20260708-111936-offline-target-runner-cmd-kit-zip-smoke/summary.md`. This zip is a transport container only and does not alter the main handoff bundle or replace runtime S1-S16.
- [x] Added standard target evidence return template: `docs/chipmate-feature-migration-target-evidence-return-template.md`; it is included in the rebuilt sidecar verify kit and captures package-integrity checks, VSIX install checks, S1-S16 runtime statuses, blocking classification, native ChipMate no-regression observations, returned file inventory, and target owner sign-off.
- [x] Added returned target-machine evidence intake verifier: `docs/chipmate-feature-migration-target-evidence-intake-verify.py`; package-only smoke evidence `docs/chipmate-feature-migration-validation-runs/20260708-112017-target-evidence-intake-windows-cmd-runner-package-only/intake-summary.md` reports package evidence `PASS` but final status `PARTIAL_PACKAGE_ONLY`, preserving the boundary that package-integrity evidence does not prove installed runtime S1-S16 behavior.
- [x] Added a synthetic runtime PASS self-check for the target evidence intake verifier: `docs/chipmate-feature-migration-validation-runs/20260708-112017-target-evidence-intake-windows-cmd-runner-synthetic-pass/intake-summary.md` returns final status `PASS` when package evidence is `PASS` and synthetic S1-S16 runtime evidence is all `PASS`. This validates the verifier's acceptance path only; it is not real target-machine runtime evidence.
- [ ] Installed VS Code smoke S1-S16 not run in this session.
- [ ] Internal embedded C detailed-design end-to-end project validation not run in this session; QEMU UFS smoke above validates migrated artifact helpers on real source evidence, not the installed chat/skill pipeline.
- [ ] Real company `.docx` template validation not run in this session.


M10 latest repackage update 2026-07-08 11:49:

- [x] Rebuilt Linux/Windows baseline CLI binaries and internal-offline VSIX packages after removing old ChipMate document-contract repair helper resources from the migrated source-backed detail-design skill; evidence `docs/chipmate-feature-migration-validation-runs/20260708-114840-vsix-repackage-contract-boundary/summary.md`.
- [x] Confirmed rebuilt Linux/Windows VSIX CLI binaries contain required built-in skill markers and do not contain old ChipMate contract markers including `validate_artifacts`, `nextToolContract`, `missingDeliverable`, `先渲染缺失图表`, or `缺失文档合同规划`.
- [x] Reran focused built-in skill and source-backed boundary tests: `bun test test/chipmate/builtin-skills.test.ts test/chipmate/source-backed-detail-design-skill.test.ts --timeout 60000`, 9/9 pass.
- [x] Refreshed offline Windows/Linux x86-64 VSIX artifacts: Linux SHA256 `95218162b0d0a09c6425c80a10e9745569c1b021edd9d666a5f43278d31458ad`, size `151641659` bytes; Windows SHA256 `3c6b9943ecf8259379c6f75b1ff321bb83677c092aac3974584524fcd90e489d`, size `168397172` bytes.
- [x] Refreshed clean offline handoff bundle: `packages/chipmate-vscode/out/chipmate-0.0.38-offline-handoff.tar.gz`, SHA256 `97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5`, size `317784738` bytes; package-integrity evidence `docs/chipmate-feature-migration-validation-runs/20260708-114900-offline-handoff-verify-after-repackage/summary.md`.
- [x] VSIX target identity/content verification passed for the rebuilt packages: `docs/chipmate-feature-migration-validation-runs/20260708-115000-vsix-target-verify-after-repackage/summary.md`.
- [x] VSIX target verifier now formally checks migrated skill markers and absence of old ChipMate document-contract repair markers; evidence `docs/chipmate-feature-migration-validation-runs/20260708-122200-vsix-target-contract-marker-verify/summary.md`.
- [x] Installed extension-host smoke passed for current rebuilt packages: Linux `docs/chipmate-feature-migration-validation-runs/20260708-115010-installed-linux-vsix-host-smoke-after-repackage/summary.md`, Windows `docs/chipmate-feature-migration-validation-runs/20260708-115040-installed-win32-vsix-host-smoke-after-repackage-rerun/summary.md`; supersedes the earlier parallel Windows temp-dir collision run `docs/chipmate-feature-migration-validation-runs/20260708-115020-installed-win32-vsix-host-smoke-after-repackage/summary.md`.
- [x] Installed VSIX host smoke helper now uses unique default run/temp roots to avoid same-second parallel `ENOTEMPTY` collisions; parallel Linux/Windows smoke regression `docs/chipmate-feature-migration-validation-runs/20260708-121540-installed-vsix-host-smoke-parallel-unique-root/summary.md` PASS.
- [x] Refreshed sidecar target verify kit and delivery-set packages: kit SHA256 `f3934200040f6520e9d66b7f14a57d2c599a7ebaca2ea85cf8be4c2ecd1ba024`, tar SHA256 `372eec17d74c64a16df31f9def35e98af17a347b0d8d8a82c6bd014bbfc30485`, zip SHA256 `ae4c43352f0dfe727a175d0ca467e8a367b3981a94e35cefb68696e2a1383c13`; local verifier evidence `docs/chipmate-feature-migration-validation-runs/20260708-114910-offline-target-linux-local-after-repackage/summary.md`, `docs/chipmate-feature-migration-validation-runs/20260708-114920-offline-target-python-local-after-repackage/summary.md`, `docs/chipmate-feature-migration-validation-runs/20260708-114930-offline-delivery-set-local-after-repackage/summary.md`.
- [x] Target-side offline verifiers now check VSIX CLI marker boundary; rebuilt target verify kit and delivery-set evidence `docs/chipmate-feature-migration-validation-runs/20260708-123130-target-verifier-cli-marker-boundary-delivery-refresh/summary.md`.
- [x] Target validation runbook and evidence return template now require VSIX CLI marker-boundary evidence and avoid target verify kit checksum self-reference; evidence `docs/chipmate-feature-migration-validation-runs/20260708-124500-target-runbook-template-marker-boundary-refresh/summary.md`.
- [x] Target evidence intake verifier now requires VSIX CLI marker-boundary evidence and rejects package-only evidence that only has hashes; evidence `docs/chipmate-feature-migration-validation-runs/20260708-125130-target-intake-marker-boundary-guard/summary.md`.
- [x] Target evidence intake verifier synthetic full-pass path covers marker-boundary plus S1-S16 PASS evidence; evidence `docs/chipmate-feature-migration-validation-runs/20260708-130010-target-intake-marker-synthetic-full-pass/summary.md`.
- [x] Target verify kit now includes target evidence intake verifier and delivery-set verifier requires it; evidence `docs/chipmate-feature-migration-validation-runs/20260708-131020-target-kit-includes-intake-verifier/summary.md`.
- [x] Target validation runbook now documents package-only and full runtime evidence intake self-check commands; evidence `docs/chipmate-feature-migration-validation-runs/20260708-132120-target-runbook-intake-command-delivery-refresh/summary.md`.
- [x] Target package runners now auto-run package-only intake verifier and emit `intake-summary.md` when Python is available; evidence `docs/chipmate-feature-migration-validation-runs/20260708-133010-target-runner-auto-intake/summary.md`.
- [x] Windows target package runner now downgrades its summary to `PASS_WITH_LIMITS` and writes `BLOCKED_ENV` intake evidence when Python or the intake verifier is unavailable; refreshed kit/delivery evidence `docs/chipmate-feature-migration-validation-runs/20260708-045533-windows-runner-intake-boundary-refresh/summary.md`. This preserves the package-only boundary and does not claim Windows runtime S1-S16 or ChipMate native QA no-regression completion.
- [x] M10 ChipMate no-obvious-regression focused review refreshed: `docs/chipmate-feature-migration-validation-runs/20260708-045849-m10-chipmate-no-regression-review/summary.md`; native tool boundary 32/32 pass, VS Code contribution boundary 10/10 pass. This checks the review action only and does not close installed runtime S1-S16 or M11.
- [x] Refreshed installed VSIX host/command smoke for both current target packages: `docs/chipmate-feature-migration-validation-runs/20260708-050231-installed-vsix-host-command-smoke-refresh/summary.md`; Linux-target child run `docs/chipmate-feature-migration-validation-runs/20260708-130125-48658-1082-installed-vsix-host-smoke/summary.md`, Windows-target child run `docs/chipmate-feature-migration-validation-runs/20260708-130129-48912-19989-installed-vsix-host-smoke/summary.md`, both exit 0. This is not S1-S16 chat/runtime acceptance.
- [x] Word render endpoint-unconfigured acceptance smoke PASS_WITH_LIMITS: `docs/chipmate-feature-migration-validation-runs/20260708-050428-word-render-endpoint-warning-acceptance/summary.md`; a real QEMU `.docx` returned `word-render-endpoint-not-configured` diagnostics artifact with no PDF/page PNG, preserving the external-renderer boundary without failing docx generation or triggering QA/repair flow.
- [x] Word render local soffice/pdftoppm smoke PASS_WITH_LIMITS: `docs/chipmate-feature-migration-validation-runs/20260708-230000-word-render-local-soffice-smoke/summary.md`; externally available local `soffice` and `pdftoppm` rendered a generated `.docx` into PDF and page PNG artifacts without bundling renderer binaries into the VSIX or triggering QA/repair flow.
- [x] Updated offline target validation docs for Word render local renderer configuration: `docs/chipmate-feature-migration-offline-target-validation-runbook.md` and `docs/chipmate-feature-migration-target-evidence-return-template.md`; S10 now distinguishes remote renderer, external local `soffice`/`pdftoppm`, and warning-only diagnostics on target Windows/Linux machines.
- [x] Target package runners now capture optional Word renderer availability in `environment.md`: Linux local smoke `docs/chipmate-feature-migration-validation-runs/20260708-231500-target-runner-word-render-env-linux-local/summary.md` records `CHIPMATE_WORD_RENDER_SOFFICE` and `CHIPMATE_WORD_RENDER_PDFTOPPM`; Windows static runner check `docs/chipmate-feature-migration-validation-runs/20260708-231500-target-runner-word-render-env-windows-static/summary.md` confirms equivalent endpoint/soffice/pdftoppm capture lines.
- [x] Refreshed offline target verify kit and delivery-set packages after adding optional Word renderer environment capture to target runners/runbook/template: kit SHA256 `d3abd2ff1da281dfda635d71fe7b4171099854942123a0abbaf77eea751aa133`, size `27962` bytes; delivery tar SHA256 `273259890eafe0a1f4bbdfa1393094659843622ecae3873c51315d0cfa7b09b8`, size `317912153` bytes; delivery zip SHA256 `64506c52873ba2b12814e4b6555c4ac8860b4d23d543fa9e6c267bbe1c1549ed`, size `317916325` bytes. Evidence `docs/chipmate-feature-migration-validation-runs/20260708-232000-target-kit-word-render-env-refresh/summary.md` verifies in-place delivery-set verifier PASS, extracted tar verifier PASS, extracted zip verifier PASS, target runner/runbook/template Word-render hooks present, and the packaged verifier now requires `targetPackageRunnersCaptureOptionalWordRenderer=true` plus `runbookDocumentsOptionalWordRenderer=true`. This refresh does not rebuild VSIX, does not migrate QA, and does not replace installed runtime S1-S16 or M11 no-regression review.
- [x] Mermaid remote-render PNG tool-layer smoke PASS_WITH_LIMITS: `docs/chipmate-feature-migration-validation-runs/20260708-050701-mermaid-remote-render-png-smoke/summary.md`; a state-machine Mermaid source was rendered through an explicit local endpoint into `.mmd` and `.png` artifacts. This is explicit tool-layer rendering only, not installed chat S11/S12 and not old missing-diagram repair/contract behavior.
- [x] Word image-bearing merge/diff tool-layer smoke PASS_WITH_LIMITS: `docs/chipmate-feature-migration-validation-runs/20260708-051100-word-image-merge-diff-smoke/summary.md`; three generated QEMU `.docx` artifacts with embedded PNG images were merged, merged inspection saw 3 images, copied image rels count was 2, and bounded Markdown/JSON diff artifacts captured added/removed lines.
- [x] Qwen inline autocomplete focused smoke PASS_WITH_LIMITS: `docs/chipmate-feature-migration-validation-runs/20260708-052259-qwen-inline-autocomplete-focused-smoke/summary.md`; 98/98 focused qwen tests pass, exercising provider registration, `provideInlineCompletionItems`, mock qwen request paths, cache, diagnostics, prompt rendering, and legacy runtime isolation. Installed ghost-text S16 remains pending.
- [x] Runtime source forbidden contract-marker scan PASS: `docs/chipmate-feature-migration-validation-runs/20260708-155013-runtime-contract-marker-source-scan/summary.md`; scanned runtime source/manifests for `validate_artifacts`, `nextToolContract`, `missingDeliverable`, `先渲染缺失图表`, `缺失文档合同规划`, and related contract/repair/gating phrases. No hits were found outside docs/tests, preserving the boundary that old ChipMate document-contract repair flow was not migrated.
- [x] Current source/skill contract-marker audit PASS: `docs/chipmate-feature-migration-contract-marker-audit.sh`, evidence `docs/chipmate-feature-migration-validation-runs/20260708-225000-contract-marker-current-source-audit/summary.md`; product source, VS Code source/webview, package contribution manifest, and local skill paths contain none of `nextToolContract`, `missingDeliverable`, `validate_artifacts`, `missing-required-artifact`, `missing-mermaid-pngs`, `建议先渲染缺失图表`, or `缺失文档合同规划`.
- [x] Runtime S1-S16 intake verifier added and self-checked: `docs/chipmate-feature-migration-runtime-smoke-intake-verify.py`; evidence `docs/chipmate-feature-migration-validation-runs/20260708-155420-runtime-smoke-intake-verifier/summary.md`. The verifier accepts only explicit reviewed `PASS` for every requested S-id, rejects `NEEDS_REVIEW`/`BLOCKED_AUTH`/missing IDs, and is documented in the runtime unblock runbook so target/provider-unblocked smoke results cannot be accidentally treated as final acceptance.
- [x] Offline target verify kit refreshed to include the runtime S1-S16 intake verifier: initial evidence `docs/chipmate-feature-migration-validation-runs/20260708-160200-target-kit-runtime-intake-refresh/summary.md`, current package refresh `docs/chipmate-feature-migration-validation-runs/20260708-161100-target-intake-requires-runtime-intake/summary.md`; delivery-set verifier PASS confirms 12 expected helper files, extracted kit contains `chipmate-feature-migration-runtime-smoke-intake-verify.py`, and the extracted verifier accepts the synthetic S1-S16 PASS fixture. That refresh produced kit SHA256 `2b79422c760eeda03d0dc103733e4afbfa07b211921de932a078590ed87c3d1a`, delivery tar SHA256 `c9892e71fb52f9dd36329f9d94ffac9c1d2591992913844e4347e5680092d15c`, delivery zip SHA256 `87c22f331d1f88c828b57f0ae394616390684a94c019babddf63b8eb87ca001b`. The refresh updates package guardrails only and does not replace target runtime S1-S16.
- [x] Target evidence return template now requires runtime intake evidence: `docs/chipmate-feature-migration-target-evidence-return-template.md`; validation `docs/chipmate-feature-migration-validation-runs/20260708-160520-target-evidence-template-runtime-intake/summary.md`. The template now records runtime verifier availability, requires `runtime-intake-summary.md` after S1-S16 runtime smoke, and keeps any non-`PASS` runtime intake status as incomplete for M11.
- [x] Target evidence intake verifier now requires runtime intake PASS and reads `runtime-smoke.tsv`: `docs/chipmate-feature-migration-validation-runs/20260708-161100-target-intake-requires-runtime-intake/summary.md`; local and extracted-kit verifier self-checks accept complete package+runtime `PASS`, reject missing `runtime-intake-summary.md`, and reject non-`PASS` runtime intake. This prevents a filled S1-S16 table or TSV alone from being accepted as final runtime evidence.
- [x] Final outer delivery tar/zip extraction verification PASS: `docs/chipmate-feature-migration-validation-runs/20260708-161420-final-delivery-outer-package-extract-verify/summary.md`; both `chipmate-0.0.38-offline-delivery-set.tar.gz` and `.zip` extract into delivery directories whose manifest/checksum/target-kit guardrails pass the delivery-set verifier. This verifies one-file transfer container integrity only and does not replace offline target runtime S1-S16.
- [x] Target evidence intake verifier now requires a filled target evidence return template with `Overall target status` = `PASS` before full returned runtime evidence can pass; evidence `docs/chipmate-feature-migration-validation-runs/20260708-162000-target-intake-requires-return-template/summary.md`; local and extracted-kit self-checks accept full package+runtime+template `PASS` and reject missing/unfilled templates. That refresh produced target verify kit SHA256 `5095dcc7092343289bc969181b047929d1bfcb8753cfefdf5ef1e75588f77f45`, delivery-set tar SHA256 `218474dad5a5d609107e0ba5b10037fc056ea8063b0d15b8549294ed8acabf9f`, and delivery-set zip SHA256 `6dbd3ae4a19e6f3d2f37c6a85905668614e8ac1b89de88d9a705d6449285611d`. This only strengthens returned-evidence guardrails and does not migrate ChipMate document-contract repair/gating behavior.
- [x] Completion audit refreshed after the target evidence return-template PASS guard: `docs/chipmate-feature-migration-validation-runs/20260708-163500-completion-audit-after-target-intake-return-template-doc-update/completion-audit.md`; reports `72` blockers, `58` review items, and `Completion allowed: no`, keeping installed S1-S16, target Windows/Linux execution, internal embedded C full run, and M11 no-regression review open.
- [x] Added target runtime evidence bootstrap helper for offline target operators: `docs/chipmate-feature-migration-target-runtime-evidence-bootstrap.py`; self-check `docs/chipmate-feature-migration-validation-runs/20260708-164500-target-runtime-evidence-bootstrap/summary.md` confirms default NOT_RUN/PARTIAL skeletons are rejected and fixture-only PASS skeletons pass runtime/target intake; rebuilt sidecar kit/delivery evidence `docs/chipmate-feature-migration-validation-runs/20260708-165200-target-runtime-bootstrap-kit-refresh/summary.md` confirms extracted kit includes the helper and manifest records `containsTargetRuntimeEvidenceBootstrap=true`. That refresh produced kit SHA256 `ae2d616fb998feba8035d190cf99de89e83f062030dd20bdf82d37cb83eb3a10`, delivery-set tar SHA256 `037394ac1a72836c0b0e236e7b82b27a96f221e5be692b2d084852366368622a`, delivery-set zip SHA256 `d057c7f2cc369c917009019958a72e0f9428613a2500d847a2402f2087f75a67`. This helper only creates evidence skeletons and does not execute or replace real S1-S16 runtime smoke.
- [x] Target package runners now auto-generate conservative runtime evidence skeletons when Python and the bootstrap helper are available; local runner smoke `docs/chipmate-feature-migration-validation-runs/20260708-171000-target-runner-runtime-bootstrap-local/summary.md` and rebuilt extracted-kit evidence `docs/chipmate-feature-migration-validation-runs/20260708-172000-target-runner-runtime-bootstrap-manifest-guard/summary.md` confirm `runtime-evidence-skeleton/runtime-smoke.tsv` is generated, the default skeleton remains `PARTIAL` under runtime intake, and the delivery-set verifier now requires `targetPackageRunnersGenerateRuntimeEvidenceSkeleton=true`. That refresh produced kit SHA256 `e8422adda974bce11bdf726bd1fed978843019d31cf0969fb4e2b7034d6c5f93`, delivery-set tar SHA256 `8e62259fc842bd2f088fd204ae165819e7b59755b4742787ca89c8359901af85`, delivery-set zip SHA256 `13e53c99c2804d80cf62128d608c4b341f55623d7f6fb02f800076386e7888a4`.
- [x] Added returned target evidence packaging helper: `docs/chipmate-feature-migration-target-evidence-return-pack.py`; self-check `docs/chipmate-feature-migration-validation-runs/20260708-175000-target-evidence-return-pack-self-check/summary.md` confirms it emits manifest/tar/zip/checksums while preserving `PARTIAL` runtime status signals; rebuilt kit/delivery evidence `docs/chipmate-feature-migration-validation-runs/20260708-175500-target-evidence-return-pack-kit-refresh/summary.md` confirms extracted kit includes the helper and delivery-set verifier requires `containsTargetEvidenceReturnPackHelper=true`. Current kit SHA256 `a8ddc8f6fbf4e0699e96b7811b9a9a3ff2487577771bb78e30071893dbfce6f5`, delivery-set tar SHA256 `6ec0beec97f1ec61b374f2827d947b0a38160ca311f6c3a4526d1725c4c260b3`, delivery-set zip SHA256 `c2ba642d7714849c48116eb09092f4aecfee34eba682bf63eeba6106df53a48f`. This packages returned evidence for transfer only and does not execute or accept S1-S16.
- [x] Completion audit refreshed after adding the target evidence return-pack helper: `docs/chipmate-feature-migration-validation-runs/20260708-180500-completion-audit-after-target-evidence-return-pack-doc-update/completion-audit.md`; reports `72` blockers, `61` review items, and `Completion allowed: no`, preserving the boundary that returned evidence packaging does not complete installed S1-S16, target Windows/Linux execution, internal embedded C full run, or M11 no-regression review.
- [x] Generated current blocked handoff audit: `docs/chipmate-feature-migration-blocked-handoff-20260708.md` and `docs/chipmate-feature-migration-validation-runs/20260708-181000-blocked-handoff-audit/summary.md`; remaining unchecked items are external/runtime gates requiring provider auth, real target Windows/Linux execution, internal embedded C installed skill run, real company template validation, or M11 manual review.
- [x] Ran first resume runtime preflight after blocked handoff: `docs/chipmate-feature-migration-validation-runs/20260708-182500-runtime-preflight-resume-check/summary.md`; status remains `BLOCKED_AUTH`, so S1-S16, native QA no-regression, Document RAG runtime smoke, and M11 review still cannot be accepted from this local environment.
- [x] Ran second resume runtime preflight after blocked handoff: `docs/chipmate-feature-migration-validation-runs/20260708-184000-runtime-preflight-resume-check-2/summary.md`; status remains `BLOCKED_AUTH`, making this the second consecutive resumed-turn provider/auth blocker. S1-S16, native QA no-regression, Document RAG runtime smoke, and M11 review still cannot be accepted from this local environment.
- [x] Ran third resume runtime preflight after blocked handoff: `docs/chipmate-feature-migration-validation-runs/20260708-185500-runtime-preflight-resume-check-3/summary.md`; status remains `BLOCKED_AUTH`, making this the third consecutive resumed-turn provider/auth blocker. This satisfies the resumed blocked-audit threshold; S1-S16, native QA no-regression, Document RAG runtime smoke, and M11 review still cannot be accepted from this local environment.
- [x] After local macOS VS Code install support work, restored `packages/opencode/dist` baseline CLI generated directories from verified Linux/Windows VSIX files and reran offline handoff verification: `docs/chipmate-feature-migration-validation-runs/20260708-212316-offline-handoff-after-mac-install/summary.md`; package integrity remains PASS, while provider-backed S1-S16/internal embedded C/M11 remain pending.
- [x] Ran completion audit after post-mac-install offline handoff recheck: `docs/chipmate-feature-migration-validation-runs/20260708-212419-completion-audit-after-mac-install-handoff-recheck/completion-audit.md`; result remains `72` blockers / `61` review items / `Completion allowed: no`, so package-integrity progress is not treated as M10/M11 completion.
- [x] Ran current-auth runtime preflight and S1-S3 QA batch after local VS Code/provider work: preflight `docs/chipmate-feature-migration-validation-runs/20260708-212531-runtime-preflight-after-mac-install-current-auth/summary.md`, S1-S3 `docs/chipmate-feature-migration-validation-runs/20260708-212602-runtime-s1-s3-after-mac-install-current-auth/summary.md`, manual review `docs/chipmate-feature-migration-validation-runs/20260708-212602-runtime-s1-s3-after-mac-install-current-auth/manual-review.md`; S1/S2 accepted as CLI/runtime PASS_WITH_REVIEW, S3 remains partial because `document_search` was not observed.
- [x] Ran current-auth runtime S4-S12 document/artifact batch: `docs/chipmate-feature-migration-validation-runs/20260708-213010-runtime-s4-s12-doc-artifact-after-current-auth/summary.md`, manual review `docs/chipmate-feature-migration-validation-runs/20260708-213010-runtime-s4-s12-doc-artifact-after-current-auth/manual-review.md`; accepted S5/S6/S7/S9-diff/S11/S12 as PASS_WITH_REVIEW, kept S4/S8/template/three-doc-merge/render limitations open.
- [x] Ran current-auth runtime S13-S16 batch: `docs/chipmate-feature-migration-validation-runs/20260708-213907-runtime-s13-s16-after-current-auth/summary.md`, manual review `docs/chipmate-feature-migration-validation-runs/20260708-213907-runtime-s13-s16-after-current-auth/manual-review.md`; accepted only S15 as PASS_WITH_REVIEW, kept S13/S14 partial, and blocked S16 review because the runtime agent modified autocomplete source files instead of performing read-only smoke.
- [x] Ran completion audit after current-auth S13-S16 review: `docs/chipmate-feature-migration-validation-runs/20260708-214817-completion-audit-after-current-auth-s13-s16-review/completion-audit.md`; result remains `51` blockers / `73` review items / `Completion allowed: no`, with S16 source-modification risk intentionally blocking final completion.
- [x] Hardened runtime smoke prompts for S4/S8/S10/S16 and reran S4/S8/S10: `docs/chipmate-feature-migration-validation-runs/20260708-215039-runtime-s4-s8-s10-hardened-prompts/summary.md`, manual review `docs/chipmate-feature-migration-validation-runs/20260708-215039-runtime-s4-s8-s10-hardened-prompts/manual-review.md`; accepted S8 TODO replacement and S10 three-document merge/diff as PASS_WITH_REVIEW, kept S4 partial because manifest was still missing.
- [x] Ran completion audit after hardened S4/S8/S10 review: `docs/chipmate-feature-migration-validation-runs/20260708-215328-completion-audit-after-hardened-s4-s8-s10/completion-audit.md`; result remains `49` blockers / `74` review items / `Completion allowed: no`, with S4 partial and S16 blocked still visible.
- [x] Reran hardened S3/S4 runtime prompts: S3 `docs/chipmate-feature-migration-validation-runs/20260708-215517-runtime-s3-document-search-hardened/summary.md`, S4 `docs/chipmate-feature-migration-validation-runs/20260708-215433-runtime-s4-declare-artifact-hardened/summary.md`; manual reviews keep both partial because S3 did not show `document_search` and S4 did not produce `artifact.json`.
- [x] Added runtime smoke guardrails for required tools and guarded source files, then ran S3/S4 guardrail check: `docs/chipmate-feature-migration-validation-runs/20260708-215826-runtime-s3-s4-guardrail-check/summary.md`; S3/S4 correctly downgrade to `ERROR_NEEDS_REVIEW` when `document_search` / `declare_artifact` are missing.
- [x] Added deterministic document_search contract smoke: `docs/chipmate-feature-migration-document-search-smoke.sh`; clean run `docs/chipmate-feature-migration-validation-runs/20260708-223000-document-search-deterministic-smoke/summary.md` proves native `document_search` tool id, permission request, path normalization, max result forwarding, and evidence-pack formatting. This is tool-contract evidence only and does not replace chat/runtime S3 tool-selection or live document-index recall evidence.
- [x] Added deterministic artifact lifecycle smoke: `docs/chipmate-feature-migration-artifact-smoke.sh`; clean run `docs/chipmate-feature-migration-validation-runs/20260708-222000-artifact-manifest-deterministic-smoke/summary.md` proves the migrated artifact manager can create a report artifact, write `.chipmate/artifacts/.../artifact.json`, list it, open its manifest path, and export diagnostics in the real workspace. This does not replace chat/runtime S4 evidence that the agent selects `declare_artifact`.
- [x] Completion audit refreshed after third resume preflight check: `docs/chipmate-feature-migration-validation-runs/20260708-190500-completion-audit-after-resume-preflight-check-3-doc-update/completion-audit.md`; reports `72` blockers, `61` review items, and `Completion allowed: no`, confirming the third resumed `BLOCKED_AUTH` check still does not close runtime/target/internal/M11 gates and the resumed blocked-audit threshold is satisfied.
- [x] Completion audit refreshed after second resume preflight check: `docs/chipmate-feature-migration-validation-runs/20260708-185000-completion-audit-after-resume-preflight-check-2-doc-update/completion-audit.md`; reports `72` blockers, `61` review items, and `Completion allowed: no`, confirming the second resumed `BLOCKED_AUTH` check still does not close runtime/target/internal/M11 gates.
- [x] Completion audit refreshed after first resume preflight check: `docs/chipmate-feature-migration-validation-runs/20260708-183500-completion-audit-after-resume-preflight-doc-update/completion-audit.md`; reports `72` blockers, `61` review items, and `Completion allowed: no`, confirming the resumed `BLOCKED_AUTH` check does not close runtime/target/internal/M11 gates.
- [x] Completion audit refreshed after current blocked handoff audit: `docs/chipmate-feature-migration-validation-runs/20260708-182000-completion-audit-after-blocked-handoff-doc-update/completion-audit.md`; reports `72` blockers, `61` review items, and `Completion allowed: no`, confirming the handoff does not reduce scope or close runtime/target/internal/M11 gates.
- [x] Completion audit refreshed after target package runners were wired to generate conservative runtime evidence skeletons: `docs/chipmate-feature-migration-validation-runs/20260708-173000-completion-audit-after-target-runner-runtime-bootstrap-doc-update/completion-audit.md`; reports `72` blockers, `60` review items, and `Completion allowed: no`, preserving the boundary that runner-generated skeletons do not complete installed S1-S16, target Windows/Linux execution, internal embedded C full run, or M11 no-regression review.
- [x] Completion audit refreshed after adding the target runtime evidence bootstrap helper: `docs/chipmate-feature-migration-validation-runs/20260708-170500-completion-audit-after-target-runtime-bootstrap-doc-update/completion-audit.md`; reports `72` blockers, `59` review items, and `Completion allowed: no`, preserving the boundary that bootstrap skeletons do not complete installed S1-S16, target Windows/Linux execution, internal embedded C full run, or M11 no-regression review.
- [x] Linux target runner now returns BLOCKED_ENV evidence when python3 is unavailable instead of failing mid-run; evidence `docs/chipmate-feature-migration-validation-runs/20260708-134020-linux-runner-python-boundary/summary.md`.
- [x] Added current blocker resume map: `docs/chipmate-feature-migration-current-blockers-20260708.md`; it records the latest completion state, accepted current-auth runtime progress, S3/S4/S16 local blockers, external-input blockers, and the do-not-complete checklist so the goal can continue without treating partial evidence as completion.
- [x] Completion audit refreshed after blocker resume map registration: `docs/chipmate-feature-migration-validation-runs/20260708-220300-completion-audit-after-blocker-map/completion-audit.md`; reports `49` blockers, `74` review items, and `Completion allowed: no`, preserving the boundary that the blocker map is continuity evidence rather than completion evidence.
- [x] Completion audit refreshed after deterministic artifact smoke: `docs/chipmate-feature-migration-validation-runs/20260708-222100-completion-audit-after-artifact-smoke/completion-audit.md`; reports `49` blockers, `74` review items, and `Completion allowed: no`, confirming the S4 artifact-manager lifecycle evidence does not close chat/runtime S4, target Windows/Linux execution, internal embedded C full run, or M11 no-regression gates.
- [x] Completion audit refreshed after deterministic document_search smoke: `docs/chipmate-feature-migration-validation-runs/20260708-223100-completion-audit-after-document-search-smoke/completion-audit.md`; reports `49` blockers, `74` review items, and `Completion allowed: no`, confirming native `document_search` tool-contract evidence does not close chat/runtime S3, live document-index recall, target Windows/Linux execution, internal embedded C full run, or M11 no-regression gates.
- [x] Hardened S3/S4 runtime smoke prompts to require direct tool calls rather than task/write fallbacks, then reran focused runtime smoke: `docs/chipmate-feature-migration-validation-runs/20260708-233500-runtime-s3-s4-direct-tool-smoke/summary.md`. S4 now returns `NEEDS_REVIEW` with guardrails passed, calls `declare_artifact`, and creates `.chipmate/artifacts/runtime-smoke-s4/artifact.json`; S3 remains `ERROR_NEEDS_REVIEW` because the runtime tool list does not expose `document_search` in the current workspace, so Document RAG/indexing readiness remains a separate blocker. This does not migrate QA and does not close M11.
- [x] Added an S3 Document RAG provider-readiness guard and reran S3 in an isolated workspace with `indexing.documents.enabled=true` and `paths=["docs/source-backed-detail-design-skill-contract.md"]`: `docs/chipmate-feature-migration-validation-runs/20260708-235500-runtime-s3-document-rag-provider-readiness-guard/summary.md`. The run remains `ERROR_NEEDS_REVIEW`; `docs/chipmate-feature-migration-validation-runs/20260708-235500-runtime-s3-document-rag-provider-readiness-guard/s3-guard.txt` now records both `missing required tool: document_search` and `document_search unavailable because Document RAG indexing provider/readiness failed`, while `docs/chipmate-feature-migration-validation-runs/20260708-235500-runtime-s3-document-rag-provider-readiness-guard/s3.log` records embedder validation failure. This keeps S3 as an environment/indexing blocker instead of treating it as a ChipMate QA migration issue.
- [x] Added repeatable S3 Document RAG readiness helper: `docs/chipmate-feature-migration-document-rag-readiness-smoke.sh`; current run `docs/chipmate-feature-migration-validation-runs/20260709-000500-document-rag-readiness-helper-smoke/document-rag-readiness-summary.md` creates an isolated workspace with `indexing.documents.enabled=true`, runs S3, and reports `document_search used: no` plus `provider/readiness failure detected: yes`. Updated `docs/chipmate-feature-migration-runtime-unblock-runbook.md` so S3 unblock requires this helper to show `document_search used: yes`, no provider/readiness failure, and `s3-guard.txt` guardrails passed before accepting Document RAG runtime evidence.
- [x] Enhanced S3 Document RAG readiness helper with provider diagnostics and reran it: `docs/chipmate-feature-migration-validation-runs/20260709-031000-document-rag-readiness-diagnostics/document-rag-readiness-summary.md` still reports `ERROR_NEEDS_REVIEW`, `document_search used: no`, and provider/readiness failure; `docs/chipmate-feature-migration-validation-runs/20260709-031000-document-rag-readiness-diagnostics/document-rag-provider-diagnostics.md` classifies the current embedder failure as `server_or_upstream_unavailable`, HTTP `503`, provider `openai-compatible`, service `embedder-openai-compatible`. This keeps S3 as an embedding upstream/readiness blocker, not a ChipMate QA migration issue.
- [x] Completion audit refreshed after Document RAG provider diagnostics: `docs/chipmate-feature-migration-validation-runs/20260709-032000-completion-audit-after-document-rag-diagnostics-doc-update/completion-audit.md`; reports `47` blockers, `79` review items, and `Completion allowed: no`, confirming S3 remains blocked on openai-compatible embedder HTTP `503` and does not close target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Refreshed blocked handoff audit to current state: `docs/chipmate-feature-migration-blocked-handoff-20260708.md` now records latest package hashes, latest completion audit, S3 openai-compatible embedder HTTP `503` diagnostics, S16 decision boundary, target Windows/Linux execution blockers, and current resume commands.
- [x] Completion audit refreshed after blocked handoff refresh: `docs/chipmate-feature-migration-validation-runs/20260709-033000-completion-audit-after-blocked-handoff-refresh-doc-update/completion-audit.md`; reports `47` blockers, `79` review items, and `Completion allowed: no`, confirming the refreshed handoff is continuity evidence and does not close S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Restored the standalone target-kit boundary for the S3 Document RAG readiness helper and refreshed sidecar delivery artifacts: `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/summary.md`. The rebuilt target kit SHA256 is `59e221cddcb6c4287d281d1ddcf76f542358a5daa57d5e178631113108aa2a35` size `30020` bytes, delivery tar SHA256 `5b1502559d24805def63c4c70baeef03c6046721230ea89279297263eac6faee` size `317913548` bytes, and delivery zip SHA256 `721e7b1b3d34229cb1e41cf51cf5857a66c908f41e6c75a00990cfeb662ef5a1` size `317823530` bytes. Verification confirms the source-checkout helper `chipmate-feature-migration-document-rag-readiness-smoke.sh`, `chipmate-feature-migration-runtime-smoke.sh`, and the temporary Windows wrapper are not packaged in the standalone target kit; the helper remains a source-workstation validation tool only.
- [x] Added package-level forbidden contract-marker audit: `docs/chipmate-feature-migration-package-marker-audit.sh`; clean run `docs/chipmate-feature-migration-validation-runs/20260709-002500-package-marker-audit/summary.md` reports `PASS` across VSIX runtime surfaces, offline delivery manifests, and target-kit source-helper exclusion boundary. It found no `nextToolContract`, `missingDeliverable`, `validate_artifacts`, `missing-required-artifact`, `missing-mermaid-pngs`, `建议先渲染缺失图表`, or `缺失文档合同规划` in packaged runtime surfaces, while intentionally excluding historical docs/tests and target guardrail documentation from fail scope.
- [x] Completion audit refreshed after current source/skill contract-marker audit: `docs/chipmate-feature-migration-validation-runs/20260708-225100-completion-audit-after-current-source-marker-audit/completion-audit.md`; reports `48` blockers, `75` review items, and `Completion allowed: no`, confirming old ChipMate contract/repair/gating marker absence in current source/skill paths does not replace target Windows/Linux execution, installed runtime S1-S16, S16 resolution, internal embedded C full run, or M11 no-regression gates.
- [x] Completion audit refreshed after local Word render implementation and smoke: `docs/chipmate-feature-migration-validation-runs/20260708-230100-completion-audit-after-local-word-render/completion-audit.md`; reports `46` blockers, `76` review items, and `Completion allowed: no`, confirming S10 tool-layer PDF/page PNG evidence is accepted while target Windows/Linux execution, installed runtime S1-S16, S16 resolution, internal embedded C full run, and M11 no-regression gates remain open.
- [x] Completion audit refreshed after target Word render docs update: `docs/chipmate-feature-migration-validation-runs/20260708-231000-completion-audit-after-target-word-render-docs/completion-audit.md`; reports `46` blockers, `76` review items, and `Completion allowed: no`, confirming target renderer configuration documentation does not replace target Windows/Linux execution, installed runtime S1-S16, S16 resolution, internal embedded C full run, or M11 no-regression gates.
- [x] Completion audit refreshed after target runner Word renderer environment capture: `docs/chipmate-feature-migration-validation-runs/20260708-231600-completion-audit-after-target-runner-word-render-env/completion-audit.md`; reports `46` blockers, `76` review items, and `Completion allowed: no`, confirming package-runner environment capture does not replace target Windows/Linux execution, installed runtime S1-S16, S16 resolution, internal embedded C full run, or M11 no-regression gates.
- [x] Completion audit refreshed after target kit/delivery-set Word renderer environment refresh: `docs/chipmate-feature-migration-validation-runs/20260708-232500-completion-audit-after-target-kit-word-render-refresh/completion-audit.md`; reports `46` blockers, `76` review items, and `Completion allowed: no`, confirming refreshed transfer artifacts and packaged verifier guardrails do not replace target Windows/Linux execution, installed runtime S1-S16, S16 resolution, internal embedded C full run, or M11 no-regression gates.
- [x] Completion audit refreshed after S3/S4 direct-tool runtime smoke: `docs/chipmate-feature-migration-validation-runs/20260708-234000-completion-audit-after-s3-s4-direct-tool-smoke/completion-audit.md`; reports `46` blockers, `76` review items, and `Completion allowed: no`, confirming S4 `declare_artifact` runtime evidence is review-limited while S3 Document RAG runtime exposure, target Windows/Linux execution, S16 resolution, internal embedded C full run, and M11 no-regression remain open.
- [x] Completion audit refreshed after S3 Document RAG provider-readiness guard: `docs/chipmate-feature-migration-validation-runs/20260709-000000-completion-audit-after-s3-document-rag-provider-readiness/completion-audit.md`; reports `46` blockers, `76` review items, and `Completion allowed: no`, confirming the S3 embedder/indexing provider gap remains blocking and does not close target Windows/Linux execution, S16 resolution, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after adding the repeatable Document RAG readiness helper: `docs/chipmate-feature-migration-validation-runs/20260709-001000-completion-audit-after-document-rag-readiness-helper/completion-audit.md`; reports `46` blockers, `76` review items, and `Completion allowed: no`, confirming the helper keeps S3 provider/readiness failure visible and does not close target Windows/Linux execution, S16 resolution, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after restoring the target-kit source-helper boundary: `docs/chipmate-feature-migration-validation-runs/20260709-002000-completion-audit-after-target-kit-source-helper-boundary/completion-audit.md`; reports `46` blockers, `76` review items, and `Completion allowed: no`, confirming the target kit no longer packages source-checkout-only S3 helpers while S3 provider/readiness, target Windows/Linux execution, S16 resolution, internal embedded C full run, and M11 no-regression remain open.
- [x] Completion audit refreshed after package-level forbidden marker audit: `docs/chipmate-feature-migration-validation-runs/20260709-003000-completion-audit-after-package-marker-audit/completion-audit.md`; reports `46` blockers, `77` review items, and `Completion allowed: no`, confirming package marker evidence is review-limited and does not close S3 provider/readiness, target Windows/Linux execution, S16 resolution, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after S16 source guard: `docs/chipmate-feature-migration-validation-runs/20260709-005500-completion-audit-after-s16-source-guard-doc-update/completion-audit.md`; reports `47` blockers, `77` review items, and `Completion allowed: no`, confirming the guard makes S16 source-mutation risk explicit while S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, and M11 no-regression remain open.
- [x] Runtime smoke intake verifier now supports S16 source-checkout guard gating: `docs/chipmate-feature-migration-validation-runs/20260709-010000-s16-source-guard-intake/summary.md` proves synthetic S16 `PASS` plus guard `PASS_WITH_LIMITS` returns `PASS`, while guard `NEEDS_REVIEW` keeps S16 non-PASS.
- [x] Refreshed offline target verify kit and delivery-set packages after adding S16 source-checkout guard support to runtime intake/template/runbook: `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/summary.md`. The rebuilt target kit SHA256 is `59e221cddcb6c4287d281d1ddcf76f542358a5daa57d5e178631113108aa2a35` size `30020` bytes, delivery tar SHA256 `5b1502559d24805def63c4c70baeef03c6046721230ea89279297263eac6faee` size `317913548` bytes, and delivery zip SHA256 `721e7b1b3d34229cb1e41cf51cf5857a66c908f41e6c75a00990cfeb662ef5a1` size `317823530` bytes; delivery-set verifier and extracted tar/zip verifiers pass, and package marker audit `docs/chipmate-feature-migration-validation-runs/20260709-022000-package-marker-audit-after-manifest-return-verifier-kit/summary.md` remains `PASS`.
- [x] Package marker audit now explicitly rejects packaging the source-checkout-only S16 source guard helper: `docs/chipmate-feature-migration-validation-runs/20260709-022000-package-marker-audit-after-manifest-return-verifier-kit/summary.md` reports `PASS`, and `docs/chipmate-feature-migration-validation-runs/20260709-013000-package-marker-audit-with-s16-source-helper-exclusion/package-marker-scanned-surfaces.json` records `forbiddenSourceHelpersPresent: []` for the target kit boundary.
- [x] Target evidence intake now checks returned delivery manifest S16 source-guard support when the manifest is present: `docs/chipmate-feature-migration-validation-runs/20260709-015000-target-intake-s16-guard-manifest-self-check/summary.md` proves no-manifest package-only evidence remains backward-compatible, manifest `runtimeSmokeIntakeSupportsS16SourceGuard=true` passes, and `false` fails.
- [x] Refreshed offline target verify kit and delivery-set packages after adding target runner delivery-manifest return and target intake manifest flag checks: `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/summary.md`. The rebuilt target kit SHA256 is `59e221cddcb6c4287d281d1ddcf76f542358a5daa57d5e178631113108aa2a35` size `30020` bytes, delivery tar SHA256 `5b1502559d24805def63c4c70baeef03c6046721230ea89279297263eac6faee` size `317913548` bytes, and delivery zip SHA256 `721e7b1b3d34229cb1e41cf51cf5857a66c908f41e6c75a00990cfeb662ef5a1` size `317823530` bytes; extracted Linux runner smoke `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/extracted-linux-runner-manifest-smoke.md` confirms the returned manifest is copied and intake sees `runtimeSmokeIntakeSupportsS16SourceGuard true`.
- [x] Completion audit refreshed after target intake delivery-manifest return support: `docs/chipmate-feature-migration-validation-runs/20260709-021000-completion-audit-after-target-intake-manifest-return-doc-update/completion-audit.md`; reports `47` blockers, `77` review items, and `Completion allowed: no`, confirming the stronger target evidence intake does not close S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Delivery-set verifier now enforces `targetPackageRunnersReturnDeliveryManifest=true` and refreshed target kit/delivery-set packages: `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/summary.md`. The rebuilt target kit SHA256 is `59e221cddcb6c4287d281d1ddcf76f542358a5daa57d5e178631113108aa2a35` size `30020` bytes, delivery tar SHA256 `5b1502559d24805def63c4c70baeef03c6046721230ea89279297263eac6faee` size `317913548` bytes, and delivery zip SHA256 `721e7b1b3d34229cb1e41cf51cf5857a66c908f41e6c75a00990cfeb662ef5a1` size `317823530` bytes; in-place, extracted tar, and extracted zip delivery-set verifiers pass, extracted Linux runner smoke `docs/chipmate-feature-migration-validation-runs/20260709-021500-target-kit-manifest-return-verifier-refresh/extracted-linux-runner-manifest-smoke.md` still confirms manifest return, and package marker audit `docs/chipmate-feature-migration-validation-runs/20260709-022000-package-marker-audit-after-manifest-return-verifier-kit/summary.md` remains `PASS`.
- [x] Windows target runner manifest-return static package check PASS: `docs/chipmate-feature-migration-validation-runs/20260709-023500-windows-runner-manifest-return-static-check/summary.md` confirms the current target kit contains the Windows PowerShell/cmd runners, the PowerShell runner copies `CHIPMATE_OFFLINE_DELIVERY_MANIFEST-$Version.json`, its summary mentions delivery manifest copy, and the delivery manifest flags `runtimeSmokeIntakeSupportsS16SourceGuard=true` plus `targetPackageRunnersReturnDeliveryManifest=true`. This is package-content evidence only; real offline Windows x86-64 execution remains pending.
- [x] Windows cmd wrapper manifest-return static package check PASS: `docs/chipmate-feature-migration-validation-runs/20260709-025500-windows-cmd-wrapper-manifest-return-static-check/summary.md` supersedes the initial too-strict static check and confirms the packaged `.cmd` wrapper invokes the PowerShell runner, forwards delivery/evidence arguments via `%~1` / `%~2`, and therefore uses the same manifest-return logic. This is package-content evidence only; real offline Windows x86-64 execution remains pending.
- [x] Completion audit refreshed after Windows cmd wrapper manifest-return static check: `docs/chipmate-feature-migration-validation-runs/20260709-030500-completion-audit-after-windows-cmd-wrapper-manifest-static-check-doc-update/completion-audit.md`; reports `47` blockers, `79` review items, and `Completion allowed: no`, confirming cmd wrapper package-content evidence remains review-limited and does not close real Windows target execution, S3 provider/readiness, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after Windows runner manifest-return static package check: `docs/chipmate-feature-migration-validation-runs/20260709-024500-completion-audit-after-windows-runner-manifest-static-check-doc-update/completion-audit.md`; reports `47` blockers, `78` review items, and `Completion allowed: no`, confirming Windows package-content evidence remains review-limited and does not close target Windows execution, S3 provider/readiness, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after manifest-return verifier refresh: `docs/chipmate-feature-migration-validation-runs/20260709-023000-completion-audit-after-manifest-return-verifier-refresh-doc-update/completion-audit.md`; reports `47` blockers, `77` review items, and `Completion allowed: no`, confirming verifier-enforced target delivery-manifest return does not close S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after adding S16 source-helper target-kit exclusion guard: `docs/chipmate-feature-migration-validation-runs/20260709-014000-completion-audit-after-s16-source-helper-exclusion-doc-update/completion-audit.md`; reports `47` blockers, `77` review items, and `Completion allowed: no`, confirming the stronger package boundary does not close S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after S16 source-guard intake and target-kit refresh: `docs/chipmate-feature-migration-validation-runs/20260709-012500-completion-audit-after-s16-source-guard-intake-kit-doc-update/completion-audit.md`; reports `47` blockers, `77` review items, and `Completion allowed: no`, confirming S16 source-guard support is packaged while S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, and M11 no-regression remain open.
- [ ] Target offline Windows x86-64 execution remains pending.
- [ ] Target offline Linux x86-64 execution remains pending.
- [ ] Installed chat/runtime S1-S16, internal embedded C full source-backed skill run, and M11 no-regression review remain pending.

## M11: 最终迁移 Review

- [x] Review 架构边界，确认新增能力是旁路 tools/skills/artifacts。
- [x] Review QA 边界，确认没有引入 ChipMate planner/question routing。
- [x] Review tool descriptions，确认普通 QA 不容易误触发 Word/Mermaid tools。
- [x] Review settings，确认高风险能力默认关闭或低风险默认。
- [x] Review permissions，确认写文件、删除、覆盖、命令执行走 ChipMate 权限体系。
- [x] Review artifact path，确认不能写出 workspace。
- [x] Review Word edit，确认删除默认 dry-run。
- [x] Review Word render，确认 renderer 外置。
- [x] Review Mermaid，确认不承担业务语义判断。
- [x] Review source-backed detail-design skill，确认使用 ChipMate 原生证据工具。
- [x] Review VS Code commands，确认没有 command id 冲突。
- [x] Review packaging，确认 VSIX 可安装；当前证据是隔离 VS Code CLI 安装通过，目标 Windows/Linux 运行态 smoke 仍保留到 installed smoke。
- [ ] Review 真实项目结果，确认至少一个内网嵌入式 C 项目完整跑通。
- [x] Review partial real-project tool-layer evidence: QEMU UFS smoke generated Word/Mermaid/artifact outputs from real embedded C source and recorded the boundary that installed chat/skill runtime is still pending.
- [x] 建立最终 review 模板，要求最终结论明确列出已迁移能力、未迁移能力、验证过的 ChipMate 原有能力和已知风险。
- [x] Review known issues，确认未完成项写入文档，不伪装成已完成。
- [ ] 最终结论必须明确写出已迁移能力、未迁移能力、验证过的 ChipMate 原有能力、已知风险。

## Regression Review Matrix

- [x] 检查普通代码 QA 是否仍优先使用 ChipMate 原生 `codebase_analysis`。
- [x] 检查开放式代码搜索是否仍可使用 ChipMate 原生 `semantic_search`。
- [x] 检查已有文档问答是否仍可使用 ChipMate 原生 `document_search`。
- [x] 检查 ChipMate autocomplete/Qwen direct 设置和 provider 注册未受影响。
- [x] 静态检查 ChipMate VS Code extension 激活路径没有被替换；新增模块以追加注册方式接入。
- [x] 检查新增 document tools 不会默认抢占普通 QA。
- [x] 检查新增 settings 不改变 ChipMate 既有默认 provider/model 行为。
- [x] 检查新增 artifact 文件不会污染 repo tracked source：`.gitignore` 已忽略 `.chipmate/artifacts/` 和 `.chipmate/artifacts/`。
- [x] 静态检查打包流程不会把 renderer 大依赖塞入 VSIX：Word/Mermaid 渲染依赖外部 endpoint 或外部命令，未新增 LibreOffice/Chromium/Mermaid CLI/Poppler renderer runtime 依赖。
- [x] 检查 remote renderer 未配置时只降级产物渲染，不影响 QA。
- [x] 静态检查 Word/Mermaid 失败时错误可理解：失败会返回 warning/diagnostics 或 sidecar tool load fallback；是否导致真实 agent 循环仍保留到 M10 smoke 验证。
- [x] 检查 source-backed detail-design skill 不在普通问答中自动触发。
- [x] 检查工具权限和路径校验没有绕开 ChipMate 原有安全机制。

## Acceptance Test Matrix

- [x] QA 回归: “分析这个 C 函数的调用链”，预期只使用 ChipMate 原生代码理解工具。
- [x] QA 回归: “这个宏在哪里定义，哪些函数会用到？”，预期不触发 Word/Mermaid/artifact tools。
- [x] Artifact: “生成一个报告产物并列出文件”，预期 `.chipmate/artifacts/.../artifact.json` 正常。Evidence: `docs/chipmate-feature-migration-validation-runs/20260709-074000-artifact-acceptance-rollup/summary.md` reports `PASS_WITH_REVIEW` for deterministic manifest/list/open plus runtime S4 direct-tool guard; installed VSIX S1-S16 remains separately pending.
- [x] Word 新建: “生成一份模块接口设计 Word，包含参数表和注意事项”，预期输出 `.docx` artifact。
- [x] Word 增: “在接口设计后新增错误码表”，预期输出新版本 `.docx`。
- [x] Word 删: “删除旧方案章节，先 dry-run”，预期返回影响范围，不写文件。
- [x] Word 改: “把 TODO 段落替换成表格和说明”，预期结构化替换成功。
- [ ] Word 模板: “用这个公司模板样式生成文档”，预期继承样式，不承诺任意占位符填充。
- [x] Word 合并: “把三个模块文档合并为总文档”，预期图片、rels、content types 正确。
- [x] Word diff: “比较 v1 和 v2 Word 文档差异”，预期输出差异摘要和 JSON。
- [x] Word render: “渲染成 PDF 和每页 PNG”，预期输出 PDF、page PNG、quality diagnostics；tool-layer local `soffice`/`pdftoppm` smoke passes, while installed chat prompt remains covered by final 打包验收。
- [x] Mermaid: “生成状态机 Mermaid PNG”，预期输出 `.mmd` 和 `.png`。
- [x] Mermaid + Word: “把状态机图插入刚才的 Word”，预期 PNG 插入 Word 并登记 artifact。
- [ ] 详细设计: “为该嵌入式 C 模块生成源码驱动详细设计文档”，预期 ChipMate 搜证据，生成 Markdown、图、Word。

## Explicit Non-goals

- [x] 不迁移 ChipMate QA planner。
- [x] 不迁移 ChipMate question routing。
- [x] 不迁移 ChipMate CodeGraph/RAG 管理 UI。
- [x] 不迁移 ChipMate 已有 Document RAG。
- [x] 不迁移 ChipMate 已有 Qwen Coder autocomplete。
- [x] 不迁移完整 draw.io 链路。
- [x] 不实现完整 mail-merge 占位符引擎。
- [x] 不迁移 AI 注释生成 runtime。
- [x] 不迁移 C 编码规范专项报告。
- [x] 不把 renderer 大依赖打进 VSIX。

## Assumptions

- [x] 计划文件默认保存到 `/Users/archer/Work/chipmate/docs/chipmate-feature-migration-plan.md`。
- [x] Artifact 根目录默认 `.chipmate/artifacts`。
- [x] Word renderer 使用外部 remote renderer 或本机已存在的 `soffice`/`pdftoppm`，不把 renderer 二进制打进 VSIX。
- [x] Mermaid renderer 可以复用外部 renderer 或本地轻量渲染路径，但不能显著增大 VSIX。
- [x] 删除类 Word edit 默认 dry-run。
- [x] Skill discovery 使用 ChipMate 原生。
- [x] 详细设计证据工具使用 ChipMate 原生 `codebase_analysis`、`semantic_search`、`document_search`。
- [ ] 每个里程碑完成后必须执行对应 review checklist。
- [ ] 最终交付前必须执行 M11 最终迁移 review。

## M11 Current Status Dashboard Follow-up

- [x] 生成 M11 当前状态看板，汇总计划完成计数、最终签核状态和仍需外部返回的真实环境证据；该看板只读汇总，不迁移 QA、不触发旧 ChipMate contract/repair/gating 流水线。
- [x] 将 M11 当前状态看板和 self-check 纳入 current-state consistency 检查范围，避免后续交接时使用过期看板或旧最终签核证据。
- [x] Refreshed current source and package runtime-surface contract-marker audits after M11 dashboard consistency integration: `docs/chipmate-feature-migration-validation-runs/20260709-153000-contract-marker-current-source-audit-after-dashboard-consistency/summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-153500-package-marker-audit-after-dashboard-consistency/summary.md` both report `PASS`, confirming current source/skill surfaces and packaged runtime surfaces still exclude old ChipMate contract/repair/gating markers.
- [x] Extended the M11 current status dashboard to surface the latest current source/skill marker audit and package runtime-surface marker audit, so final review can see the no-old-contract boundary status without opening separate evidence files.
- [x] Extended source/package contract-marker audits with English variants for missing-diagram auto-repair, missing-document contract planning, and render-missing-diagrams-first behavior, closing the gap where old ChipMate repair/gating behavior could return under English wording instead of the original Chinese phrases or internal marker names.
- [x] Added the English-variant source/package marker audit summaries to current-state consistency requirements, requiring `PASS` plus representative English old-flow markers so stale or missing enhanced audits fail the source-side handoff check.
- [x] Added the source/package contract-marker audit scripts themselves to current-state consistency requirements, so removing the English old-flow marker coverage from the audit definitions fails the source-side handoff check even if older PASS summaries still exist.
- [x] Reran S3 Document RAG readiness after marker-guard hardening: `docs/chipmate-feature-migration-validation-runs/20260709-160500-document-rag-readiness-rerun-after-marker-guards/document-rag-readiness-summary.md` remains `ERROR_NEEDS_REVIEW` because `document_search` was not exposed/used and provider diagnostics still classify the embedder failure as `server_or_upstream_unavailable` with HTTP `503`.
- [x] Refreshed M11 readiness intake against the latest S3 `160500` rerun by updating the default S3 readiness input and current readiness anchors to `docs/chipmate-feature-migration-validation-runs/20260709-161000-m11-readiness-after-latest-s3-rerun/summary.md`; readiness remains expected to be `NOT_READY_FOR_M11_REVIEW` until S3 and the other external gates return acceptable evidence.
- [x] Fixed M11 current status dashboard parsing for bullet-form readiness/S3 status fields and strengthened dashboard self-check/current-state checks to require the latest `161000` readiness anchor, latest S3 `160500` anchor, `NOT_READY_FOR_M11_REVIEW`, `ERROR_NEEDS_REVIEW`, HTTP `503`, and self-check `PASS` with zero missing tokens.
- [x] Added the current M11 final signoff summary itself to current-state consistency requirements, requiring `NOT_READY_FOR_FINAL_SIGNOFF`, `1/4` gates, the latest `161000` readiness evidence, current completion audit, current-state consistency summary, and final-review-not-ready decision so stale or accidentally permissive final signoff summaries fail handoff consistency.
- [x] Added a target execution boundary check for the current source workstation: `docs/chipmate-feature-migration-target-execution-boundary-check.py`; evidence `docs/chipmate-feature-migration-validation-runs/20260709-163000-target-execution-boundary-check/summary.md` records that this macOS/arm64 host cannot directly satisfy offline Windows x86-64 or offline Linux x86-64 target execution gates, and package-only checks cannot replace installed VSIX S1-S16 runtime smoke.
- [x] Added the target execution boundary check to the M11 current status dashboard and dashboard self-check, so final review can see that the current source workstation cannot directly close offline Windows/Linux x86-64 target gates and that package-only runners cannot replace installed runtime smoke.
- [x] Added a package refresh boundary check: `docs/chipmate-feature-migration-package-refresh-boundary-check.py`; evidence `docs/chipmate-feature-migration-validation-runs/20260709-164000-package-refresh-boundary-check/summary.md` records that current offline package artifacts do not contain the latest source-side M11/readiness/target-boundary evidence, so final offline delivery must either regenerate packages or explicitly keep those source-side evidence updates outside the packaged target kit.
- [x] Added the package refresh boundary check to the M11 current status dashboard and dashboard self-check, so final review can see `REFRESH_REQUIRED_FOR_FINAL_DELIVERY` and avoid assuming the current offline packages already include the latest source-side M11 evidence chain.
- [x] Added package refresh decision intake: `docs/chipmate-feature-migration-package-refresh-decision-intake.py`; current evidence `docs/chipmate-feature-migration-validation-runs/20260709-164500-package-refresh-decision-intake/summary.md` reports `NEEDS_PACKAGE_REFRESH_DECISION` until final delivery explicitly chooses `REGENERATE_OFFLINE_PACKAGES` or `EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT` with an accepted owner.
- [x] Added the package refresh decision intake to the M11 current status dashboard and dashboard self-check, so final review can see `NEEDS_PACKAGE_REFRESH_DECISION`, the missing decision, and the two accepted final-delivery choices directly from the dashboard.
- [x] Added package refresh decision as an explicit M11 final signoff gate: `docs/chipmate-feature-migration-m11-final-signoff-intake.py` now requires `READY_FOR_PACKAGE_REFRESH_SCOPE` before final signoff can pass, and its defaults point at the current readiness/audit/consistency evidence chain instead of older pre-dashboard summaries.
- [x] Added package refresh decision template: `docs/chipmate-feature-migration-package-refresh-decision-template.md`; current-state consistency now requires the template to preserve the two accepted decisions, owner/date placeholders, and boundary text so the package refresh gate has a concrete owner-facing decision artifact.
- [x] Added package refresh decision intake self-check: `docs/chipmate-feature-migration-package-refresh-decision-intake-self-check.py`; evidence `docs/chipmate-feature-migration-validation-runs/20260709-170500-package-refresh-decision-intake-self-check/summary.md` proves missing decisions remain blocked while both accepted final-delivery decisions can pass when an owner is supplied.
- [x] Added package refresh decision quickstart: `docs/chipmate-feature-migration-package-refresh-decision-quickstart.md`; current-state consistency now requires it to preserve both accepted decisions, the expected `READY_FOR_PACKAGE_REFRESH_SCOPE` status, and the commands to rerun package refresh decision intake and M11 final signoff.
- [x] Added M11 final signoff package gate self-check: `docs/chipmate-feature-migration-m11-final-signoff-package-gate-self-check.py`; evidence `docs/chipmate-feature-migration-validation-runs/20260709-171500-m11-final-signoff-package-gate-self-check/summary.md` proves missing package decision and `NEEDS_PACKAGE_REFRESH_DECISION` block final signoff, while `READY_FOR_PACKAGE_REFRESH_SCOPE` can pass when all other synthetic gates pass.
- [x] Hardened package refresh decision intake to require `Accepted date` in addition to an accepted owner, and extended the decision intake self-check so missing accepted date keeps the gate at `NEEDS_PACKAGE_REFRESH_DECISION`.
- [x] Surfaced package refresh accepted owner/date in the M11 current status dashboard and dashboard self-check, so final review can see that the current package refresh decision is still missing both accepted owner and accepted date.
- [x] Added package refresh owner action packet: `docs/chipmate-feature-migration-package-refresh-owner-action-packet.md`; current-state consistency now requires it to preserve the current gate state, accepted decisions, owner/date requirements, decision-intake/final-signoff commands, and no-QA/no-runtime boundary.
- [x] Added the package refresh owner action packet to the M11 current status dashboard and dashboard self-check, so final review has a direct owner-facing action entrypoint for resolving `NEEDS_PACKAGE_REFRESH_DECISION`.

Current M11 evidence anchors after dashboard consistency integration:

- Completion audit: `docs/chipmate-feature-migration-validation-runs/20260709-151000-completion-audit-after-dashboard-consistency/completion-audit.md`
- M11 final signoff intake: `docs/chipmate-feature-migration-validation-runs/20260709-152000-m11-final-signoff-after-dashboard-consistency/current-signoff-summary.md`
- Latest M11 readiness intake: `docs/chipmate-feature-migration-validation-runs/20260709-161000-m11-readiness-after-latest-s3-rerun/summary.md`
- Latest S3 Document RAG readiness rerun: `docs/chipmate-feature-migration-validation-runs/20260709-160500-document-rag-readiness-rerun-after-marker-guards/document-rag-readiness-summary.md`
- Latest S3 provider diagnostics: `docs/chipmate-feature-migration-validation-runs/20260709-160500-document-rag-readiness-rerun-after-marker-guards/document-rag-provider-diagnostics.md`
- [x] Added a read-only current-state consistency guard to catch stale handoff/package hashes, stale top-level review docs, target-kit content boundary drift, and delivery-manifest flag drift before final handoff: `docs/chipmate-feature-migration-current-state-consistency-check.py`. Initial run `docs/chipmate-feature-migration-validation-runs/20260709-033500-current-state-consistency-check-initial/summary.md` correctly failed on stale final-review package sizes and missing latest audit reference in blocked handoff; after correcting those current-facing docs, rerun `docs/chipmate-feature-migration-validation-runs/20260709-034000-current-state-consistency-check/summary.md` reports `PASS`, `24` passed checks, and `0` failed checks. This guard is documentation/package-state evidence only and does not close S3 provider readiness, S16 decision, target Windows/Linux execution, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after current-state consistency guard registration: `docs/chipmate-feature-migration-validation-runs/20260709-034500-completion-audit-after-current-state-consistency-check/completion-audit.md`; reports `47` blockers, `79` review items, and `Completion allowed: no`, confirming the new consistency guard reduces handoff drift but does not close S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Hardened returned target evidence intake against false PASS templates: `docs/chipmate-feature-migration-target-evidence-intake-verify.py` now rejects `Overall target status=PASS` when the return template still contains `TODO`/platform placeholders or contradicts package/runtime intake results. Source self-check `docs/chipmate-feature-migration-validation-runs/20260709-035000-target-intake-template-contradiction-guard/summary.md` and packaged extracted-kit self-check `docs/chipmate-feature-migration-validation-runs/20260709-040000-target-intake-template-contradiction-kit-refresh/extracted-kit-target-intake-self-check.md` both accept a full PASS fixture and reject runtime-contradiction/TODO-template fixtures. Refreshed target kit/delivery-set evidence `docs/chipmate-feature-migration-validation-runs/20260709-040000-target-intake-template-contradiction-kit-refresh/summary.md`; rebuilt target kit SHA256 `10f398918113a5144cfbe785432668f110f61bc5cafc25bb194e3a30285cd1e0` size `30500` bytes, delivery tar SHA256 `553f808beda69ae974bf867da736e2d838d0ba84be1dcd0098493771959d320f` size `317914117` bytes, delivery zip SHA256 `1a61cdf7a33f70088535b802643c5f785c75f96395495287ceec1c8d67082a9e` size `317915787` bytes. This remains target-evidence guardrail hardening only and does not close real offline Windows/Linux runtime execution, S3 provider readiness, S16 source decision, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after target-intake template-contradiction guard kit refresh: `docs/chipmate-feature-migration-validation-runs/20260709-041500-completion-audit-after-template-contradiction-guard-kit-refresh/completion-audit.md`; reports `47` blockers, `80` review items, and `Completion allowed: no`, confirming the stronger returned-evidence guardrail does not close S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Added returned target evidence pack verification support to `docs/chipmate-feature-migration-target-evidence-return-pack.py`: pack mode remains unchanged, and new `--verify-pack` mode validates SHA256SUMS, manifest JSON, archive member safety, exact evidence file list, and evidence file size/SHA256 without executing S1-S16 or deciding M11 acceptance. Source self-check `docs/chipmate-feature-migration-validation-runs/20260709-042000-target-evidence-return-pack-verify/summary.md` verifies tar/zip positive paths and a bad-checksum negative path. Refreshed packaged target kit/delivery evidence `docs/chipmate-feature-migration-validation-runs/20260709-043000-target-evidence-return-pack-verify-kit-refresh/summary.md` confirms in-place/extracted tar/extracted zip delivery-set verifiers pass, package marker audit remains PASS, and the extracted kit helper can verify returned-evidence tar/zip packs. Rebuilt target kit SHA256 `13b921f256f1b5b2f259c7d300ba811f12b042bf690f1e717b9f0cd722dd2e6e` size `32097` bytes, delivery tar SHA256 `c28fdd6befa92691df7ef25f2c39d98ea4e1e6aaf60178c9adaaa0c764a46661` size `317915950` bytes, delivery zip SHA256 `25622fbefb74c9b7c1ebf69abcec0b20aa4abb51cb054be2a28864c6fe406aae` size `317917426` bytes. This is returned-evidence transfer integrity only and does not close target Windows/Linux runtime execution, S3 provider readiness, S16 source decision, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after returned-evidence pack verification kit refresh: `docs/chipmate-feature-migration-validation-runs/20260709-044500-completion-audit-after-return-pack-verify-kit-refresh/completion-audit.md`; reports `47` blockers, `81` review items, and `Completion allowed: no`, confirming returned-evidence archive verification does not close S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Documented the returned-evidence archive verification step in the packaged offline target validation runbook: `docs/chipmate-feature-migration-offline-target-validation-runbook.md` now instructs migration-workstation operators to run `chipmate-feature-migration-target-evidence-return-pack.py --verify-pack` on returned target evidence tar/zip archives before workstation-side intake or M11 review. Refreshed package evidence `docs/chipmate-feature-migration-validation-runs/20260709-045000-return-pack-verify-runbook-kit-refresh/summary.md` verifies in-place, extracted tar, and extracted zip delivery-set verifiers pass; package marker audit remains PASS; and extracted target-kit runbook contains the verify-pack receiving step. Rebuilt target kit SHA256 `803c6a22129cc7fcbe9b9912a43a9ebab741a5b8502e26d6d3d0c9cb741f5471` size `32344` bytes, delivery tar SHA256 `83c8c27dbe058bd0d2bd5fe63f7bb17259c5dea1943ba18a81e83c142c736954` size `317916299` bytes, delivery zip SHA256 `d4014986abf84d5d3b4207996427f0bc655e473f9a36a9846790cbbc7b08cbb4` size `317917776` bytes. This is target evidence receiving workflow hardening only and does not close real target Windows/Linux runtime execution, S3 provider readiness, S16 source decision, internal embedded C full run, or M11 no-regression.
- [x] Completion audit refreshed after documenting returned-evidence verify-pack receiving workflow in the packaged runbook: `docs/chipmate-feature-migration-validation-runs/20260709-050500-completion-audit-after-return-pack-runbook-refresh/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming receiving workflow hardening does not close S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Reran S3 Document RAG readiness after the latest target evidence receiving workflow refresh: `docs/chipmate-feature-migration-validation-runs/20260709-051000-document-rag-readiness-refresh/document-rag-readiness-summary.md` still reports `ERROR_NEEDS_REVIEW`, `document_search used: no`, and provider/readiness failure; `docs/chipmate-feature-migration-validation-runs/20260709-051000-document-rag-readiness-refresh/document-rag-provider-diagnostics.md` still classifies the openai-compatible embedder failure as `server_or_upstream_unavailable`, HTTP `503`, service `embedder-openai-compatible`, first error `503 status code (no body)`. This keeps S3 as an external embedder/readiness blocker and does not migrate or replace native ChipMate QA.
- [x] Completion audit refreshed after the latest S3 Document RAG readiness rerun: `docs/chipmate-feature-migration-validation-runs/20260709-051500-completion-audit-after-s3-readiness-refresh/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming the new S3 evidence is still a provider/readiness blocker and does not close target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Added a source-workstation real `.docx` template validation helper for future company-template S8 evidence: `docs/chipmate-feature-migration-company-docx-template-validate.py`. Self-check `docs/chipmate-feature-migration-validation-runs/20260709-053000-company-docx-template-validator-self-check/summary.md` returns `PASS_WITH_LIMITS` against the existing QEMU `.docx` style source, reporting 13 style ids, numbering XML present, 12 media files, no placeholders, and a scoped theme warning. This helper validates OOXML template/style-source structure and optional generated-docx style overlap only; it does not generate Word output, fill placeholders, require missing artifacts, run recipe repair, trigger document contracts, or close the real company template blocker until a representative company `.docx` is supplied and S8 is rerun.
- [x] Completion audit refreshed after adding the company `.docx` template validation helper: `docs/chipmate-feature-migration-validation-runs/20260709-053500-completion-audit-after-company-docx-template-validator/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming the helper is readiness evidence only and does not close real company template validation, S3 provider/readiness, target Windows/Linux execution, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Added an explicit S16 qwen autocomplete source-modification decision brief without touching protected source files: `docs/chipmate-feature-migration-s16-autocomplete-decision-brief-20260709.md`. It records current protected file sizes/SHA256 values for `packages/chipmate-vscode/src/services/qwen-autocomplete/smoke.ts`, `packages/chipmate-vscode/src/services/qwen-autocomplete/index.ts`, and `packages/chipmate-vscode/package.json`, explains why the old S16 run remains blocked by `docs/chipmate-feature-migration-validation-runs/20260709-004500-s16-source-guard/summary.md` and `docs/chipmate-feature-migration-validation-runs/20260708-213907-runtime-s13-s16-after-current-auth/manual-review.md`, and lays out keep/revert/split-review options. This reduces the S16 decision cost but does not close S16 until the user decides and a read-only autocomplete smoke is rerun.
- [x] Completion audit refreshed after adding the S16 autocomplete decision brief: `docs/chipmate-feature-migration-validation-runs/20260709-054500-completion-audit-after-s16-decision-brief/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming the decision brief does not close S16, S3 provider/readiness, target Windows/Linux execution, internal embedded C full run, or M11 no-regression.
- [x] Added a source-workstation target execution request generator for the offline Windows/Linux blockers: `docs/chipmate-feature-migration-target-execution-request.py`. Self-check `docs/chipmate-feature-migration-validation-runs/20260709-060000-target-execution-request-generator/summary.md` generates `linux-x64-target-execution-request.md` and `win32-x64-target-execution-request.md` from the current delivery manifest, includes current target-kit/delivery hashes and `--verify-pack` receiving instructions, and records `REQUEST_PENDING_TARGET_EXECUTION`. This makes the target-owner handoff explicit but does not close offline Windows/Linux execution until returned evidence is accepted.
- [x] Completion audit refreshed after adding the offline target execution request generator: `docs/chipmate-feature-migration-validation-runs/20260709-060500-completion-audit-after-target-execution-request-generator/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming request generation does not close target Windows/Linux execution, S3 provider/readiness, S16 user decision, internal embedded C full run, or M11 no-regression.
- [x] Added an internal embedded-C source-backed detail-design validation request generator: `docs/chipmate-feature-migration-internal-embedded-c-validation-request.py`. Self-check `docs/chipmate-feature-migration-validation-runs/20260709-061500-internal-embedded-c-validation-request/summary.md` generates `internal-embedded-c-validation-request.md` with S13 installed-VSIX execution requirements, expected evidence, source-backed-detail-design skill selection criteria, and explicit non-goals excluding ChipMate runtime flow, Word/document contract, required-artifact validator, recipe repair, missing-diagram auto-rendering, and old contract/gating markers. This is internal-project handoff readiness only and does not close the internal embedded C validation blocker until returned project evidence is accepted.
- [x] Completion audit refreshed after adding the internal embedded-C validation request generator: `docs/chipmate-feature-migration-validation-runs/20260709-062000-completion-audit-after-internal-embedded-c-request/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming request generation does not close the internal embedded-C full run, target Windows/Linux execution, S3 provider/readiness, S16 user decision, or M11 no-regression.
- [x] Added an installed VSIX runtime S1-S16 execution request generator: `docs/chipmate-feature-migration-installed-runtime-smoke-request.py`. Self-check `docs/chipmate-feature-migration-validation-runs/20260709-063000-installed-runtime-smoke-request/summary.md` generates `installed-runtime-smoke-s1-s16-request.md` covering all S1-S16 cases, expected tool/runtime boundaries, runtime intake requirements, evidence return requirements, and old ChipMate contract/repair marker exclusions. This prepares the installed-runtime operator handoff but does not close installed chat/runtime S1-S16 until real evidence is returned and accepted.
- [x] Completion audit refreshed after adding the installed runtime S1-S16 execution request generator: `docs/chipmate-feature-migration-validation-runs/20260709-063500-completion-audit-after-installed-runtime-request/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming request generation does not close installed chat/runtime S1-S16, target Windows/Linux execution, S3 provider/readiness, S16 user decision, internal embedded C full run, or M11 no-regression.

- [x] Added a conservative M11 readiness intake helper: `docs/chipmate-feature-migration-m11-readiness-intake.py`. Current run `docs/chipmate-feature-migration-validation-runs/20260709-064500-m11-readiness-intake/summary.md` reports `NOT_READY_FOR_M11_REVIEW` and keeps final review gated on S3 Document RAG readiness, S16 autocomplete decision, installed runtime S1-S16 evidence, offline Windows/Linux target execution, internal embedded-C source-backed detail-design evidence, and real company `.docx` template validation. This helper is readiness intake only; it does not execute tests, install VSIX files, mark M11 complete, or reintroduce ChipMate document contract/repair/gating behavior.

- [x] Completion audit refreshed after adding the M11 readiness intake helper: `docs/chipmate-feature-migration-validation-runs/20260709-065000-completion-audit-after-m11-readiness-intake/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming readiness intake does not close S3 provider/readiness, S16 user decision, installed runtime S1-S16, target Windows/Linux execution, internal embedded-C full run, real company template validation, or final M11 no-regression.

- [x] Current-state consistency guard prepared for the M11 readiness intake refresh: `docs/chipmate-feature-migration-validation-runs/20260709-065500-current-state-consistency-after-m11-readiness-intake/summary.md` verifies current package hashes, current-facing docs, target-kit helper inclusion/exclusion, delivery-manifest flags, latest completion audit reference, S3 diagnostics, and M11 readiness-intake evidence. This guard remains documentation/package-state evidence only and does not close provider/runtime/target/internal/project blockers.

- [x] Hardened the M11 readiness intake against premature acceptance of review-limited gates: `docs/chipmate-feature-migration-m11-readiness-intake.py` now requires `--accept-s16-decision` before S16 `PASS_WITH_LIMITS` plus a decision brief can count as ready, and requires `--accept-company-template-pass-with-limits` before company template `PASS_WITH_LIMITS` can count as ready. Self-check `docs/chipmate-feature-migration-validation-runs/20260709-070000-m11-readiness-acceptance-guard/summary.md` reports `PASS`: no explicit acceptance returns `NOT_READY_FOR_M11_REVIEW`, explicit synthetic acceptance returns `READY_FOR_M11_REVIEW`, and current evidence remains `NOT_READY_FOR_M11_REVIEW`. This remains a final-review guardrail only and does not migrate ChipMate contract/repair/gating runtime behavior.

- [x] Completion audit refreshed after adding the M11 explicit-acceptance readiness guard: `docs/chipmate-feature-migration-validation-runs/20260709-070500-completion-audit-after-m11-acceptance-guard/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming the stricter readiness guard does not close S3 provider/readiness, S16 user decision, installed runtime S1-S16, target Windows/Linux execution, internal embedded-C full run, real company template validation, or final M11 no-regression.

- [x] Current-state consistency guard refreshed after the M11 explicit-acceptance readiness guard: `docs/chipmate-feature-migration-validation-runs/20260709-071000-current-state-consistency-after-m11-acceptance-guard/summary.md` verifies current package hashes, current-facing docs, target-kit helper inclusion/exclusion, delivery-manifest flags, latest completion audit reference, S3 diagnostics, M11 readiness-intake evidence, and M11 explicit-acceptance self-check evidence. This remains documentation/package-state evidence only and does not close provider/runtime/target/internal/project blockers.

- [x] Added a conservative M11 final signoff intake helper: `docs/chipmate-feature-migration-m11-final-signoff-intake.py`. Self-check `docs/chipmate-feature-migration-validation-runs/20260709-072000-m11-final-signoff-intake/summary.md` reports `PASS`: current real evidence returns `NOT_READY_FOR_FINAL_SIGNOFF`, synthetic `PASS_WITH_KNOWN_LIMITS` remains blocked without `--accept-pass-with-known-limits`, explicitly accepted known-limits evidence returns `READY_FOR_FINAL_SIGNOFF`, and final `PASS` evidence returns `READY_FOR_FINAL_SIGNOFF`. Current signoff summary `docs/chipmate-feature-migration-validation-runs/20260709-072000-m11-final-signoff-intake/current-signoff-summary.md` remains not ready. This helper is read-only/signoff-only and does not execute tests, install/package VSIX files, or migrate ChipMate contract/repair/gating behavior.

- [x] Completion audit refreshed after adding the M11 final signoff intake helper: `docs/chipmate-feature-migration-validation-runs/20260709-072500-completion-audit-after-m11-final-signoff-intake/completion-audit.md`; reports `47` blockers, `82` review items, and `Completion allowed: no`, confirming the final signoff intake does not close S3 provider/readiness, S16 user decision, installed runtime S1-S16, target Windows/Linux execution, internal embedded-C full run, real company template validation, or final M11 no-regression.

- [x] Current-state consistency guard refreshed after the M11 final signoff intake helper: `docs/chipmate-feature-migration-validation-runs/20260709-073000-current-state-consistency-after-m11-final-signoff-intake/summary.md` verifies current package hashes, current-facing docs, target-kit helper inclusion/exclusion, delivery-manifest flags, latest completion audit reference, S3 diagnostics, M11 readiness/explicit-acceptance evidence, and M11 final signoff intake/self-check evidence. This remains documentation/package-state evidence only and does not close provider/runtime/target/internal/project blockers.

- [x] Added a local Artifact acceptance rollup checker: `docs/chipmate-feature-migration-artifact-acceptance-rollup.py`. Current run `docs/chipmate-feature-migration-validation-runs/20260709-074000-artifact-acceptance-rollup/summary.md` reports `PASS_WITH_REVIEW`, verifying deterministic artifact manifest/list/open evidence, manifest/report/diagnostics file existence, runtime S4 direct-tool row, S4 guardrail pass, and `declare_artifact` in the runtime log. This closes the local Artifact Acceptance Matrix item only; installed VSIX S1-S16, target Windows/Linux execution, and M11 remain open.

- [x] Completion audit refreshed after closing the local Artifact acceptance item with review limits: `docs/chipmate-feature-migration-validation-runs/20260709-074500-completion-audit-after-artifact-acceptance-rollup/completion-audit.md`; reports `45` blockers, `84` review items, and `Completion allowed: no`, confirming the artifact rollup does not close S3 provider/readiness, S16 user decision, installed runtime S1-S16, target Windows/Linux execution, internal embedded-C full run, real company template validation, or final M11 no-regression.

- [x] Current-state consistency guard refreshed after the Artifact acceptance rollup: `docs/chipmate-feature-migration-validation-runs/20260709-075000-current-state-consistency-after-artifact-acceptance-rollup/summary.md` verifies current package hashes, current-facing docs, target-kit helper inclusion/exclusion, delivery-manifest flags, latest completion audit reference, M11 guard evidence, and Artifact acceptance rollup evidence. This remains documentation/package-state evidence only and does not close provider/runtime/target/internal/project blockers.




- [x] Reran S3 Document RAG readiness after the latest local acceptance rollups: `docs/chipmate-feature-migration-validation-runs/20260709-120000-document-rag-readiness-rerun/document-rag-readiness-summary.md` still reports `ERROR_NEEDS_REVIEW`, `document_search used: no`, and provider/readiness failure; diagnostics `docs/chipmate-feature-migration-validation-runs/20260709-120000-document-rag-readiness-rerun/document-rag-provider-diagnostics.md` still classify the openai-compatible embedder failure as `server_or_upstream_unavailable`, HTTP `503`, service `embedder-openai-compatible`, first error `503 status code (no body)`. This keeps S3 as an external embedder/readiness blocker and does not migrate or replace native ChipMate QA.

- [x] M11 readiness intake refreshed after the latest S3 rerun: `docs/chipmate-feature-migration-validation-runs/20260709-082500-m11-readiness-after-s3-rerun/summary.md` reports `NOT_READY_FOR_M11_REVIEW`, with S3 still `ERROR_NEEDS_REVIEW`, S16 still `NEEDS_REVIEW`, and installed runtime/target/internal/company evidence still missing. This readiness refresh does not close M11 or reintroduce any ChipMate document contract/repair/gating behavior.

- [x] Prepared the final signoff intake for the latest S3/rerun evidence by keeping the current signoff summary path `docs/chipmate-feature-migration-validation-runs/20260709-072000-m11-final-signoff-intake/current-signoff-summary.md` as the authoritative final-signoff current-state artifact. It will be regenerated after the latest completion audit and consistency refresh, and remains `NOT_READY_FOR_FINAL_SIGNOFF` while S3, S16, installed runtime, target execution, internal embedded-C, company-template, and M11 review gates remain open.

- [x] Completion audit refreshed after the latest S3 Document RAG readiness rerun: `docs/chipmate-feature-migration-validation-runs/20260709-083000-completion-audit-after-s3-rerun/completion-audit.md`; reports `45` blockers, `85` review items, and `Completion allowed: no`, confirming the S3 rerun still does not close S3 provider/readiness, S16 user decision, installed runtime S1-S16, target Windows/Linux execution, internal embedded-C full run, real company template validation, visible installed terminal-pane UX, or final M11 no-regression.




- [x] Added a conservative S16 autocomplete decision intake helper: `docs/chipmate-feature-migration-s16-decision-intake.py`. Self-check `docs/chipmate-feature-migration-validation-runs/20260709-085000-s16-decision-intake/summary.md` reports `PASS`: current real evidence remains `NEEDS_USER_DECISION`, a valid decision plus `PASS_WITH_LIMITS` source guard reaches `READY_FOR_READONLY_S16_SMOKE`, a valid decision plus `NEEDS_REVIEW` guard remains `DECISION_RECORDED_NEEDS_READONLY_RERUN`, and invalid decisions are rejected. Current intake `docs/chipmate-feature-migration-validation-runs/20260709-085000-s16-decision-intake/current-summary.md` does not modify protected autocomplete/package files and does not run autocomplete smoke.

- [x] Completion audit refreshed after adding the S16 decision intake helper: `docs/chipmate-feature-migration-validation-runs/20260709-085500-completion-audit-after-s16-decision-intake/completion-audit.md`; reports `45` blockers, `86` review items, and `Completion allowed: no`, confirming the S16 decision intake does not close S16 user decision, S3 provider/readiness, installed runtime S1-S16, target Windows/Linux execution, internal embedded-C full run, real company template validation, visible installed terminal-pane UX, or final M11 no-regression.



- [x] Completion audit refreshed after adding the remaining blocker owner matrix: `docs/chipmate-feature-migration-validation-runs/20260709-091500-completion-audit-after-blocker-owner-matrix/completion-audit.md`; reports `45` blockers, `86` review items, and `Completion allowed: no`, confirming the owner matrix improves handoff clarity but does not close S3 provider/readiness, S16 user decision, installed runtime S1-S16, target Windows/Linux execution, internal embedded-C full run, real company template validation, visible installed terminal-pane UX, or final M11 no-regression.


## Remaining blocker unblock packet

- Note: 解锁包内列出的外部/provider/runtime/target/internal/template/UX/M11 证据全部返回并通过 intake 后，才能关闭 M10/M11。
- [x] Review unblock packet: 确认该包只是 handoff 辅助物，没有引入 ChipMate QA、planner、question routing、Word/document runtime contract、required-artifact validator、recipe repair loop、skill contract gate、缺失图表自动补渲染、缺失文档合同规划、`nextToolContract`、`missingDeliverable` 或 `validate_artifacts`。

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-093500-completion-audit-after-blocker-unblock-packet/completion-audit.md`。
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-094000-current-state-consistency-after-blocker-unblock-packet/summary.md`。


- Note: 这只准备证据回收路径；真实 installed VS Code 可见 UX 证据仍需返回并通过 intake 后，才能关闭 S14/S15 可见 UX 和 M11。



- [x] 刷新 M11 final signoff intake 默认链路到最新 readiness/audit/consistency：`docs/chipmate-feature-migration-validation-runs/20260709-102500-m11-final-signoff-after-visible-ux-gate/current-signoff-summary.md` 和 `docs/chipmate-feature-migration-validation-runs/20260709-102500-m11-final-signoff-after-visible-ux-gate/summary.md`，当前仍为 `NOT_READY_FOR_FINAL_SIGNOFF`。

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-103500-completion-audit-after-m11-visible-ux-gate/completion-audit.md`。
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-104000-current-state-consistency-after-m11-visible-ux-gate/summary.md`。


- Note: 该自检只验证 readiness gate wiring，不替代 installed VS Code 可见 UX 真实证据。

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-110000-completion-audit-after-m11-visible-ux-self-check/completion-audit.md`。
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-110500-current-state-consistency-after-m11-visible-ux-self-check/summary.md`。

## M11 final signoff gate self-check

- [x] 新增 M11 final signoff gate 自检：`docs/chipmate-feature-migration-validation-runs/20260709-111000-m11-final-signoff-self-check/summary.md`，验证 readiness、completion audit、current-state consistency 和 final review 全部满足时才进入 `READY_FOR_FINAL_SIGNOFF`。
- [x] Review M11 final signoff self-check: 验证 completion audit 仍有 blocker 时会保持 `NOT_READY_FOR_FINAL_SIGNOFF`；当前真实 signoff `docs/chipmate-feature-migration-validation-runs/20260709-102500-m11-final-signoff-after-visible-ux-gate/current-signoff-summary.md` 仍为 `NOT_READY_FOR_FINAL_SIGNOFF`。
- Note: 该自检只验证 final signoff gate wiring，不替代真实 M11 no-regression review 或 release acceptance。

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-112000-completion-audit-after-m11-final-signoff-self-check/completion-audit.md`。
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-112500-current-state-consistency-after-m11-final-signoff-self-check/summary.md`。

## Company template validator CLI compatibility

- [x] Fixed company `.docx` template validator CLI compatibility: `docs/chipmate-feature-migration-company-docx-template-validate.py` now supports both recommended `--output-dir <run-dir>` and older handoff-compatible `--output <run-dir>/summary.md` forms.
- [x] Review company template validator CLI compatibility: refreshed `docs/chipmate-feature-migration-validation-runs/20260709-093000-remaining-blocker-unblock-packet/remaining-blocker-unblock-packet.md` to recommend `--output-dir`, and self-check `docs/chipmate-feature-migration-validation-runs/20260709-113000-company-template-output-compat-self-check/summary.md` confirms both CLI forms work without closing real company template validation.
- Note: This fixes evidence collection ergonomics only; real company `.docx` template validation remains open until a representative company template is supplied and S8/runtime evidence is accepted.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-114000-completion-audit-after-company-template-output-compat/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-114500-current-state-consistency-after-company-template-output-compat/summary.md`.

## Current-state consistency CLI compatibility

- [x] Fixed current-state consistency CLI compatibility: `docs/chipmate-feature-migration-current-state-consistency-check.py` now supports both recommended `--output-dir <run-dir>` and older handoff-compatible `--output <run-dir>/summary.md` forms.
- [x] Review current-state consistency CLI compatibility: refreshed `docs/chipmate-feature-migration-validation-runs/20260709-093000-remaining-blocker-unblock-packet/remaining-blocker-unblock-packet.md` to recommend `--output-dir`, and self-check `docs/chipmate-feature-migration-validation-runs/20260709-115000-current-state-output-compat-self-check/summary.md` confirms both CLI forms work.
- Note: This fixes evidence collection ergonomics only; it does not close provider/runtime/target/internal/template/UX/M11 blockers.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-122000-completion-audit-after-current-s3-rerun-and-visible-ux-shape-guard/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-122500-current-state-consistency-after-current-s3-rerun-and-visible-ux-shape-guard/summary.md`.

## Current S3 rerun and visible UX evidence-shape guard

- [x] Reran S3 Document RAG readiness with current provider state: `docs/chipmate-feature-migration-validation-runs/20260709-120000-document-rag-readiness-rerun/document-rag-readiness-summary.md`; result remains `ERROR_NEEDS_REVIEW`, `document_search used: no`, provider/readiness failure `yes`, HTTP `503`, classification `server_or_upstream_unavailable`.
- [x] Refreshed M11 readiness against the current S3 rerun: `docs/chipmate-feature-migration-validation-runs/20260709-120500-m11-readiness-after-current-s3-rerun/summary.md`; result remains `NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-122000-completion-audit-after-current-s3-rerun-and-visible-ux-shape-guard/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-122500-current-state-consistency-after-current-s3-rerun-and-visible-ux-shape-guard/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-123000-m11-final-signoff-after-current-s3-rerun-and-visible-ux-shape-guard/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-123000-m11-final-signoff-after-current-s3-rerun-and-visible-ux-shape-guard/summary.md`.

## M11 external evidence-shape guard

- [x] Hardened M11 readiness external evidence gates: installed runtime must use runtime intake shape, Windows/Linux target execution must use target evidence intake shape, real company `.docx` validation must use company template validator shape, and internal embedded-C detailed-design evidence must include installed profile, source workspace, module, Markdown, Word, diagram, quality report, and old-contract absence fields.
- [x] Review M11 external evidence-shape guard: self-check `docs/chipmate-feature-migration-validation-runs/20260709-124000-m11-external-evidence-shape-self-check/summary.md` verifies true-shaped fixtures can pass while missing visible UX, visible UX self-check summaries, and generic runtime `PASS` summaries are rejected.
- [x] Refreshed M11 readiness after external evidence-shape guard: `docs/chipmate-feature-migration-validation-runs/20260709-124500-m11-readiness-after-external-evidence-shape-guard/summary.md` remains `NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-125000-completion-audit-after-external-evidence-shape-guard/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-125500-current-state-consistency-after-external-evidence-shape-guard/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-126000-m11-final-signoff-after-external-evidence-shape-guard/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-126000-m11-final-signoff-after-external-evidence-shape-guard/summary.md`.

## Internal embedded-C detail-design evidence intake

- [x] Added internal embedded-C source-backed detail-design evidence intake helper: `docs/chipmate-feature-migration-internal-embedded-c-intake.py` validates returned evidence shape without running ChipMate QA, VS Code, source-backed skill execution, Word generation, diagram rendering, recipe repair, missing-diagram auto-repair, or document-contract planning.
- [x] Review internal embedded-C intake helper: self-check `docs/chipmate-feature-migration-validation-runs/20260709-126500-internal-embedded-c-intake-self-check/summary.md` accepts a complete evidence fixture and rejects placeholder/incomplete evidence.
- [x] Refreshed M11 external evidence-shape guard and readiness after wiring the internal embedded-C intake summary shape: `docs/chipmate-feature-migration-validation-runs/20260709-127000-m11-external-evidence-shape-after-internal-intake/summary.md` passes and `docs/chipmate-feature-migration-validation-runs/20260709-127500-m11-readiness-after-internal-embedded-c-intake/summary.md` remains `NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-128000-completion-audit-after-internal-embedded-c-intake/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-128500-current-state-consistency-after-internal-embedded-c-intake/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-129000-m11-final-signoff-after-internal-embedded-c-intake/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-129000-m11-final-signoff-after-internal-embedded-c-intake/summary.md`.

## S16 decision intake evidence-shape guard

- [x] Hardened M11 S16 autocomplete decision gate: S16 now requires source guard `PASS_WITH_LIMITS`, typed decision intake `READY_FOR_READONLY_S16_SMOKE`, and explicit `--accept-s16-decision`; generic `Decision: keep` files are not accepted.
- [x] Review S16 decision evidence-shape guard: self-check `docs/chipmate-feature-migration-validation-runs/20260709-129500-m11-external-evidence-shape-after-s16-decision-shape/summary.md` verifies typed S16 decision intake can satisfy the synthetic all-gates fixture while a generic decision file is rejected.
- [x] Refreshed M11 readiness after S16 decision shape guard: `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` remains `NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready because current S16 decision intake `docs/chipmate-feature-migration-validation-runs/20260709-085000-s16-decision-intake/current-summary.md` is still `NEEDS_USER_DECISION`.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-130500-completion-audit-after-s16-decision-shape-guard/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-131000-current-state-consistency-after-s16-decision-shape-guard/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-131500-m11-final-signoff-after-s16-decision-shape-guard/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-131500-m11-final-signoff-after-s16-decision-shape-guard/summary.md`.

## M11 returned evidence bundle intake

- [x] Registered returned-evidence bundle intake as the preferred external-evidence receiving path; current readiness remains `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` (`NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready) until real evidence is returned.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-133000-completion-audit-after-returned-evidence-bundle-intake/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-133500-current-state-consistency-after-returned-evidence-bundle-intake/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-134000-m11-final-signoff-after-returned-evidence-bundle-intake/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-134000-m11-final-signoff-after-returned-evidence-bundle-intake/summary.md`.

## M11 returned evidence bundle template

- [x] Review M11 returned-evidence bundle template: self-check `docs/chipmate-feature-migration-validation-runs/20260709-134500-m11-returned-evidence-bundle-template-self-check/summary.md` confirms all required placeholder summaries are present as `PENDING` and the generated skeleton is rejected by returned-evidence bundle intake until placeholders are replaced by typed verifier outputs.
- [x] Registered the returned-evidence bundle template alongside bundle intake `docs/chipmate-feature-migration-validation-runs/20260709-132000-m11-returned-evidence-bundle-intake-self-check/summary.md` as the external evidence receiving workflow; current readiness remains `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` (`NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready) until real evidence is returned.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-135000-completion-audit-after-returned-evidence-bundle-template/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-135500-current-state-consistency-after-returned-evidence-bundle-template/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-136000-m11-final-signoff-after-returned-evidence-bundle-template/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-136000-m11-final-signoff-after-returned-evidence-bundle-template/summary.md`.

## M11 returned evidence bundle archive verify

- [x] Added M11 returned-evidence bundle archive/structure verifier: `docs/chipmate-feature-migration-m11-returned-evidence-bundle-archive-verify.py` accepts a directory, `.zip`, `.tar`, `.tar.gz`, or `.tgz`, checks the required returned-evidence summary files, rejects template placeholders, rejects missing files, and detects macOS metadata before bundle intake.
- [x] Registered archive verifier as the pre-intake receiving guard alongside template `docs/chipmate-feature-migration-validation-runs/20260709-134500-m11-returned-evidence-bundle-template-self-check/summary.md` and bundle intake `docs/chipmate-feature-migration-validation-runs/20260709-132000-m11-returned-evidence-bundle-intake-self-check/summary.md`; current readiness remains `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` (`NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready) until real evidence is returned.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-137000-completion-audit-after-returned-evidence-bundle-archive-verify/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-137500-current-state-consistency-after-returned-evidence-bundle-archive-verify/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-138000-m11-final-signoff-after-returned-evidence-bundle-archive-verify/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-138000-m11-final-signoff-after-returned-evidence-bundle-archive-verify/summary.md`.

## M11 returned evidence receive wrapper

- [x] Added M11 returned-evidence receive wrapper: `docs/chipmate-feature-migration-m11-returned-evidence-receive.py` runs archive/structure verification first, extracts archives into the run directory when needed, and only then delegates to returned-evidence bundle intake.
- [x] Review M11 returned-evidence receive wrapper: self-check `docs/chipmate-feature-migration-validation-runs/20260709-138500-m11-returned-evidence-receive-self-check/summary.md` confirms a complete synthetic bundle reaches `READY_FOR_M11_REVIEW` while a placeholder bundle is rejected before intake.
- [x] Registered receive wrapper as the preferred external evidence receiving command above archive verifier `docs/chipmate-feature-migration-validation-runs/20260709-136500-m11-returned-evidence-bundle-archive-verify-self-check/summary.md` and bundle intake `docs/chipmate-feature-migration-validation-runs/20260709-132000-m11-returned-evidence-bundle-intake-self-check/summary.md`; current readiness remains `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` (`NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready) until real evidence is returned.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-139000-completion-audit-after-returned-evidence-receive/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-139500-current-state-consistency-after-returned-evidence-receive/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-140000-m11-final-signoff-after-returned-evidence-receive/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-140000-m11-final-signoff-after-returned-evidence-receive/summary.md`.

## M11 returned evidence receive quickstart

- [x] Added M11 returned-evidence receive quickstart generator: `docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.py` produces operator-facing instructions for generating the bundle skeleton, replacing placeholders with typed verifier outputs, packaging the returned bundle, and running the fail-closed receive wrapper.
- [x] Review M11 returned-evidence receive quickstart: generated quickstart `docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md` and self-check `docs/chipmate-feature-migration-validation-runs/20260709-140500-m11-returned-evidence-receive-quickstart-self-check/summary.md` confirm the required commands and boundaries are present, including no QA migration, no missing-diagram repair, no document-contract planning, and no `nextToolContract` / `missingDeliverable` / `validate_artifacts` acceptance.
- [x] Registered quickstart as the external evidence operating guide above receive wrapper `docs/chipmate-feature-migration-validation-runs/20260709-138500-m11-returned-evidence-receive-self-check/summary.md`; current readiness remains `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` (`NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready) until real evidence is returned.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-141000-completion-audit-after-returned-evidence-receive-quickstart/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-141500-current-state-consistency-after-returned-evidence-receive-quickstart/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-142000-m11-final-signoff-after-returned-evidence-receive-quickstart/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-142000-m11-final-signoff-after-returned-evidence-receive-quickstart/summary.md`.

## M11 returned evidence target-kit boundary

- [x] Hardened target verify kit boundary for returned-evidence receiving workflow: `chipmate-feature-migration-m11-returned-evidence-bundle-intake.py`, `chipmate-feature-migration-m11-returned-evidence-bundle-template.py`, `chipmate-feature-migration-m11-returned-evidence-bundle-archive-verify.py`, `chipmate-feature-migration-m11-returned-evidence-receive.py`, and `chipmate-feature-migration-m11-returned-evidence-receive-quickstart.py` are now explicitly forbidden from the offline target verify kit because they are source-side receiving helpers, not target-machine runners.
- [x] Review returned-evidence target-kit boundary: current-state consistency target `docs/chipmate-feature-migration-validation-runs/20260709-143500-current-state-consistency-after-returned-evidence-target-kit-boundary/summary.md` checks the packaged target verify kit excludes those source-side receive/template/intake/archive helpers while retaining the required target-side runners and verifiers.
- [x] Registered the source-side/target-side boundary alongside receive quickstart `docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md` and self-check `docs/chipmate-feature-migration-validation-runs/20260709-140500-m11-returned-evidence-receive-quickstart-self-check/summary.md`; current readiness remains `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` (`NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready) until real evidence is returned.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-143000-completion-audit-after-returned-evidence-target-kit-boundary/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-143500-current-state-consistency-after-returned-evidence-target-kit-boundary/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-144000-m11-final-signoff-after-returned-evidence-target-kit-boundary/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-144000-m11-final-signoff-after-returned-evidence-target-kit-boundary/summary.md`.

## M11 external evidence action packet

- [x] Review M11 external evidence action packet: generated packet `docs/chipmate-feature-migration-m11-external-evidence-action-packet.md` and self-check `docs/chipmate-feature-migration-validation-runs/20260709-144500-m11-external-evidence-action-packet-self-check/summary.md` confirm all eight external evidence gates, returned-evidence receive workflow, and migration boundaries are documented.
- [x] Registered action packet alongside receive quickstart `docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md` as the current external evidence execution handoff; current readiness remains `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` (`NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready) until real evidence is returned.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-145000-completion-audit-after-external-evidence-action-packet/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-145500-current-state-consistency-after-external-evidence-action-packet/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-146000-m11-final-signoff-after-external-evidence-action-packet/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-146000-m11-final-signoff-after-external-evidence-action-packet/summary.md`.

## Remaining blocker unblock packet receive workflow

- [x] Updated remaining blocker unblock packet generator `docs/chipmate-feature-migration-remaining-blocker-unblock-packet.py` so the handoff now points to action packet `docs/chipmate-feature-migration-m11-external-evidence-action-packet.md`, receive quickstart `docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md`, and fail-closed receive wrapper before per-gate typed verifier details.
- [x] Regenerated remaining blocker unblock packet `docs/chipmate-feature-migration-validation-runs/20260709-093000-remaining-blocker-unblock-packet/remaining-blocker-unblock-packet.md` and verified with self-check `docs/chipmate-feature-migration-validation-runs/20260709-146500-remaining-blocker-unblock-packet-receive-workflow-self-check/summary.md` that it contains the receive workflow, placeholder warning, final-signoff boundary, and old ChipMate contract/repair/gating exclusions.
- [x] Registered unblock packet receive workflow as the current owner-facing handoff; current readiness remains `docs/chipmate-feature-migration-validation-runs/20260709-130000-m11-readiness-after-s16-decision-shape-guard/summary.md` (`NOT_READY_FOR_M11_REVIEW`, `0/8` gates ready) until real evidence is returned.

Current follow-up audit target: `docs/chipmate-feature-migration-validation-runs/20260709-147000-completion-audit-after-unblock-packet-receive-workflow/completion-audit.md`.
Current consistency target: `docs/chipmate-feature-migration-validation-runs/20260709-147500-current-state-consistency-after-unblock-packet-receive-workflow/summary.md`.
Current final signoff target: `docs/chipmate-feature-migration-validation-runs/20260709-148000-m11-final-signoff-after-unblock-packet-receive-workflow/current-signoff-summary.md` and `docs/chipmate-feature-migration-validation-runs/20260709-148000-m11-final-signoff-after-unblock-packet-receive-workflow/summary.md`.
