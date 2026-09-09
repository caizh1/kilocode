---
"@chipmate/cli": minor
"@chipmate/sdk": minor
"@chipmate/chipmate-indexing": patch
"chipmate": minor
---

新增完全独立部署的内网 Patent Server 与本地 Patent Radar：扫描嵌入式 C/C++ 和设计文档，通过编译 Variant、确定性关系图、机制卡、跨文件 bridge 合成、本地 Embedding 观察通道及独立原文回查生成可定位候选；证据采用分片与检查点保存，超出模型上下文时自动细分，不依赖长会话。支持从专利中心或资源管理器选择文件和目录建立智能模块范围，通过完整强关系闭包纳入跨目录依赖，提供范围预览、40% 阻断确认、保存模块、独立历史与可选补跑；均衡范围存在未处理边界时禁止正面结论。Patent Server 固定使用 RRF 混合召回并关闭 Rerank，通过公开专利语料建立逐项证据矩阵。VS Code 专利中心集中配置服务、选择已连接 Provider 的分析模型、查看分阶段后台进度、覆盖缺口和跨文件证据链，并支持取消、断点续跑、评审、盲审与证据包导出；真实 gold set 达标前固定标记为实验性，任何语料、检索或引用门禁失败时关闭正面结论。
