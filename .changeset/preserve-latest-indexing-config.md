---
"@chipmate/cli": patch
"chipmate": patch
---

升级时保留最后修改的索引配置，避免降级版本中选择的 embedding 模型被旧默认值覆盖并触发不必要的全量重建。
