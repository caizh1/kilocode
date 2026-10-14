---
"@chipmate/chipmate-indexing": patch
"@chipmate/cli": patch
"chipmate": patch
---

修复本地 RAG 索引重建中断后残留元数据表导致的初始化失败，按当前模型和维度恢复索引；候选索引重建时同步清除旧校验样本，避免已删除文件阻止新索引完成。
