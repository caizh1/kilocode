---
"@kilocode/kilo-indexing": patch
"@kilocode/cli": patch
---

串行执行本地 LanceDB 向量写入，在合并写入超时时自动拆分批次并延长写入时限；内存受限时通过可重复的 checkpoint rollover 继续未完成的安全代际，避免硬退出或反复从零索引；直接调试文档检索时等待文档索引完成初始化。
