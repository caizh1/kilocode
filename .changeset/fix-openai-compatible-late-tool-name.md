---
"@chipmate/cli": patch
"chipmate": patch
---

修复 OpenAI 兼容模型将工具名延迟到后续流分片时中断推理的问题，并在工具名始终缺失时继续阻止工具执行。
