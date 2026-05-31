# SeekForge 设计文档索引

本文档集是 SeekForge 的公开文档入口，覆盖架构、开发、配置、安全边界和已知限制。

阅读顺序：

1. [Architecture Overview](./ARCHITECTURE_OVERVIEW.md)
2. [Development Guide](./DEVELOPMENT.md)
3. [Troubleshooting](./TROUBLESHOOTING.md)
4. [FAQ](./FAQ.md)
5. [Local Data and Configuration](./LOCAL_DATA_AND_CONFIG.md)
6. [Package Boundaries and Compatibility](./API_AND_COMPATIBILITY.md)
7. [Roadmap](./ROADMAP.md)
8. [Known Limitations](./KNOWN_LIMITATIONS.md)
9. [Skill 系统](./06-skill-system.md)
10. [DeepSeek V4 Context Strategy](./DEEPSEEK_V4_CONTEXT.md)

当前默认决策：

- 使用 Tauri 2 + React + TypeScript。
- Agent runtime 主要用 TypeScript 实现。
- Rust 侧只承载文件、shell、git、keychain、SQLite 等 OS boundary。
- 兼容性敏感的改动应先确认协议、工具 schema、持久化数据和跨平台行为边界。
