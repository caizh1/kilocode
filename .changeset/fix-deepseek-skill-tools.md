---
"@kilocode/cli": patch
"chipmate": patch
---

修复 DeepSeek V4 在调用 Skill 创建、安装、发布和事务工具前因事务参数 Schema 缺少对象根类型而拒绝整个请求的问题。
