---
"@chipmate/chipmate-indexing": patch
---

修复文档 RAG 对重复 XLSX、PDF 或图表分块生成相同向量 ID 后导致 LanceDB 写入失败的问题，并在升级后自动重新建立受影响文档索引。
