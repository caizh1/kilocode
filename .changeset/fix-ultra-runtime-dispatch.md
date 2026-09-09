---
"@chipmate/cli": patch
"chipmate": patch
---

修复 Ultra 验证启动与真实工具注册链，改由运行时在联系父模型前直接执行已注册的三路验证，并仅在综合结果明确判定为实施请求后开放编辑。
