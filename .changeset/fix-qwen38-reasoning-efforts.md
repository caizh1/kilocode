---
"@chipmate/cli": patch
"chipmate": patch
---

修复自定义 OpenAI-compatible Provider 自动发现模型后缺少推理等级的问题：GLM 5.2、DeepSeek V4 Flash、DeepSeek V4 Pro 与 Doubao Seed 2.0 Pro 现在会按各自能力显示精确档位，已有配置无需重建；批量添加的模型会逐项显示完整的推理与图片能力设置；同时为 Qwen3.8 27B 与 Qwen3.8 27B FP8 提供 `xhigh`、`medium`、`low` 和“关闭”四档按请求思考控制。
