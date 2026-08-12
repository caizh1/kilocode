---
"@chipmate/cli": patch
"@chipmate/chipmate-indexing": patch
"chipmate": patch
---

在索引初始化前安全迁移旧版配置、认证、模型与会话状态，并在仅恢复 API Key 且向量空间一致时复用现有 Code RAG 和 Document RAG 索引，避免无谓的全量重新嵌入。
