---
"@kilocode/kilo-indexing": patch
"@kilocode/cli": patch
"chipmate": patch
---

文件监控不可用时继续完成 CodeGraph、Code RAG 和 Document RAG 全量索引，并提示后续文件变更需要手动重建；精确符号查询复用代码图词法证据，优先返回对应定义，避免向量候选遗漏实现文件。
