# ChipMate 1.0.19

相较 1.0.18：

- 统一缩短 Code RAG 与 Document RAG 的 LanceDB 工作区和安全代际目录，在 Code Insiders 等深层 `globalStorage` 路径中为事务临时文件预留空间，避免写入时因 Windows 路径过长触发 `os error 3`。
- 安全复用仍在路径预算内的旧索引；旧目录过长时自动在紧凑路径完整重建，并只在新索引完成和校验后清理旧目录。显式配置的根目录仍过长时会在写入前给出实际长度和短目录建议。
