# OpenSSD 结构化响应诊断

## 结论

2026 年 8 月 1 日使用 VS Code 扩展当前代码注释编排链路，在本机 Cosmos+ OpenSSD 快照上实跑 3 个 C 函数。所有会话均固定为 `agent=code` 和 `chipmate/deepseek-v4-flash`，共发起 7 个临时只读会话，全部正常返回，无超时、认证失败或模型回退。

修复前的首轮结果中，2/3 函数生成可用候选，1/3 未生成注释。失败样本 `CheckDataBufHit` 的首轮返回了 6880 字符、以 Markdown JSON 代码围栏开头的 JSON 候选；当时的解析器在尝试解析内部内容前，就明确拒绝任何以 Markdown fence 开头或结尾的文本，随后统一显示“模型没有返回符合协议的结构化 JSON”。因此该错误不等于模型没有返回 JSON，也可能只是 JSON 外层存在代码块。由于当时的诊断只保留响应类型、长度和脱敏预览，不能反向证明该轮内部 JSON 已完全满足 Schema。

## 修复前样本与结果

| 函数 | 文件 | 最终状态 | 轮次 | 总耗时 | 关键结果 |
|---|---|---:|---:|---:|---|
| `check_nvme_cc_en` | `nvme/host_lld.c` | 可用 | 2 | 73.1 秒 | 首轮为严格 JSON，仅因一条证据说明缺少中文未通过；独立复核后通过 |
| `CheckDataBufHit` | `data_buffer.c` | 未解决 | 3 | 284.7 秒 | 首轮为 Markdown fence 包裹的 JSON；复核和仲裁又因锚点、缩进及 `verification.conflicts` 语义未通过 |
| `IssueNandReq` | `request_schedule.c` | 可用 | 2 | 190.8 秒 | 首轮为严格 JSON但错误保留冲突；独立复核后通过 |

总体可用完成率为 66.7%，平均每个函数耗时 182.9 秒。7 次响应中 6 次是严格 JSON，1 次是 Markdown fence 包裹的 JSON；该 1 次直接触发了 Windows 用户看到的同类通用错误。

## 确定原因

1. 修复前的 `parseCommentModelResponse` 在解析 JSON 前先检查字符串是否以 Markdown 代码围栏开头或结尾，命中后立即返回 `undefined`。即使内部 JSON 合法且满足 Schema，也不会获得解析和校验机会。
2. 会话请求只在系统提示中要求 JSON，没有向 SDK 发送 `format` 或 JSON Schema 约束；`session-runner` 优先读取 `assistant.info.structured`，不存在时退回普通文本。因此格式遵循主要依赖模型，不足以保证每次都是裸 JSON。
3. 解析失败、JSON 语法错误、字段缺失和类型错误最终都被折叠成同一条“模型没有返回符合协议的结构化 JSON”，实际 Windows 日志无法区分具体原因。
4. 即使模型返回严格 JSON，锚点文本、缩进、中文证据以及 `verification.conflicts` 仍可能导致确定性校验失败。本轮未解决样本在恢复轮次中同时命中了锚点和冲突语义问题。

## 修复边界

- 允许且只允许单个完整 Markdown JSON 代码围栏包装：去除外层 fence 后仍必须执行严格 `JSON.parse`、Schema、锚点、注释语法和代码注入校验；fence 外存在任何其他文本仍拒绝。
- 按“Markdown fence”“JSON 语法错误”“Schema 字段错误”“锚点错误”等返回具体失败码和可诊断日志，避免继续使用单一通用错误。
- 当前 `chipmate/deepseek-v4-flash` 实际链路不能直接启用 SDK `json_schema`：使用正确 ChipMate 配置执行最小结构化预检时，Provider 明确返回 HTTP 400 `Thinking mode does not support this tool_choice`。因此生产修复继续使用严格文本解析回退；结构化输出能力必须等 Provider 支持思考模式与强制工具选择的组合后再启用。
- 将 `verification.conflicts` 限定为尚未解决的事实冲突，不允许模型把“已核对、已修复”的说明写入冲突数组。

## 修复后回归

修复采用“唯一完整围栏解包后继续严格校验”，不从任意说明文本中截取 JSON。单元测试同时覆盖裸围栏、`json` 围栏、CRLF、额外前后文本、异常围栏以及围栏内代码注入。

修复后再次运行同一组 3 个 OpenSSD 函数：`CheckDataBufHit` 经三轮恢复后成为可用结果；`check_nvme_cc_en` 因模型仍把已解决说明写入 `verification.conflicts` 而未解决；`IssueNandReq` 因首轮 120 秒和仲裁剩余 78 秒超时而未解决。该结果证明已消除原来的围栏直接拒绝缺陷，但整体完成率仍只有 1/3，不能据此宣布功能通过发布门槛。

OpenSSD 仓库仅被读取，没有写入注释或修改源码。
