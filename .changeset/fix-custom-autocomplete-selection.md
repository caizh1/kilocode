---
"chipmate": patch
"@chipmate/cli": patch
---

允许从已连接的 OpenAI-compatible 提供商选择任意 Qwen FIM 部署模型，保留真实模型名称、ID 与不可用选择的回显。切换模型时取消旧补全请求并隔离缓存，同时让后端按模型配置解析真实上游 API ID。
