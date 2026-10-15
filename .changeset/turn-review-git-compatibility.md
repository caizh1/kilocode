---
"@chipmate/cli": patch
"chipmate": patch
---

兼容旧版 Git 的快照暂存参数，修复 Git 2.25.1 等版本无法记录本轮修改及撤销的问题。避免未跟踪的嵌套 Git 仓库拖累父工程快照，并继续保护未被完整收录的文件。
