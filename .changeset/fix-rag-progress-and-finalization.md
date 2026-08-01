---
"@kilocode/kilo-indexing": patch
"@kilocode/cli": patch
"chipmate": patch
---

修复代码 RAG 重复计数导致进度提前显示 100%、终态与文档索引永久等待的问题；批量提交 LanceDB 文件代际并限制候选读回与远程 embedding 请求，确保失败时保留上一份可用索引。
