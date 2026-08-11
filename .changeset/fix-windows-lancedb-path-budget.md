---
"@chipmate/chipmate-indexing": patch
"@chipmate/cli": patch
---

统一缩短代码与文档 RAG 的 LanceDB 工作区和安全代际路径，在写入前校验 Windows 路径预算，并在新索引成功后清理过长的旧索引，避免事务临时文件超过传统 260 字符限制后以 `os error 3` 失败。
