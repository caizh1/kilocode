---
"@kilocode/kilo-indexing": patch
"kilo-code": patch
---

修复旧版手动填写 bge-m3 向量维度后，升级会错误发送 `dimensions` 并导致 Code RAG 请求失败的问题。
