---
"@chipmate/chipmate-indexing": patch
"@chipmate/cli": patch
"chipmate": patch
---

在 RAG 嵌入配置校验失败时，保留脱敏后的 HTTP 状态、服务端错误详情以及 provider、模型和维度上下文，并将 embedder 日志写入 ChipMate Indexing 输出。内网 Qwen3 默认自动探测服务实际维度；用户填写维度时改为固定模式并发送、严格校验 `dimensions`。建库前新增向量结构、语义质量和空间漂移验证，候选 LanceDB 完整回查后才原子切换，失败时保留上一份兼容的有效索引；同时避免文件监控覆盖真实 RAG 错误，并让 Document RAG 在代码索引失败后独立继续建立。
