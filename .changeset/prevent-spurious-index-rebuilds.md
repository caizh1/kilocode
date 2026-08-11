---
"@chipmate/chipmate-indexing": patch
"@chipmate/cli": patch
"chipmate": patch
---

避免页面切换、相同配置、搜索参数和仅文档配置变化重复重建 CodeGraph，防止已完成索引被旧初始化响应回退为持续进行中状态，恢复关联工作树回退到主线内容后的图谱证据，优先返回包含精确查询的文档，并阻止索引跟随越界符号链接读取工作区外源码。
