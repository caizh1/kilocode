---
"@chipmate/cli": patch
"chipmate": patch
---

修复专利中心使用 DeepSeek 官方模型时全项目和模块扫描会被空输出、局部坏数据或超大批次中断的问题，并拆分 Patent Server 多词检索以避免 OpenSearch 子句上限。
