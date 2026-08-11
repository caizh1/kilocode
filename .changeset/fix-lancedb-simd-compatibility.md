---
"@chipmate/chipmate-indexing": patch
"@chipmate/cli": patch
---

升级 LanceDB 运行库并补齐打包依赖，避免缺少 AVX、AVX2、FMA 或 F16C 的 Windows x64 环境在余弦向量查询时以非法指令退出；同时进一步压缩代码与文档 RAG 的新索引路径，并将旧版未完成候选或已激活索引安全重建到短路径候选，避免 Windows 长路径导致落盘失败。索引进程关闭时完整等待原生 writer，并保留可恢复候选，避免升级交接期间旧进程删除新进程接管的 generation。Windows VSIX 使用本地文件系统专用 native 构建控制包体，并提高新版客户端下载上限，同时保留旧版客户端可下载的发布门禁。
