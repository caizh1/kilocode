---
"@chipmate/cli": patch
"@chipmate/sdk": patch
"chipmate": patch
---

从会话菜单或 `/export` 一次性导出本地 ChipMate QA 根会话及全部子 Agent 的未经脱敏原始 Markdown，完整保留已持久化的 reasoning、工具调用、错误、元数据、Todo 和原始 JSON，并在会话空闲后以可取消进度原子保存到本地文件。
