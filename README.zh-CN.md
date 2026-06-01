# Ore Code

[English](./README.md)

Ore Code 是一个面向 DeepSeek 的桌面端 AI 编码工作台，基于 Tauri、React、TypeScript 和 Rust 构建。它专注于长上下文编码工作流、结构化工具调用、本地项目上下文、MCP 集成、技能、自动化，以及 macOS 和 Windows 的跨平台桌面体验。

> 状态：预发布。当前仓库源码基于 MIT License 发布。

## 亮点

- 面向 DeepSeek 的 Agent runtime，支持计划、Agent 和完全访问等工作模式。
- 支持大上下文场景，包含模型感知的容量估算、历史压缩和项目上下文路由。
- 提供结构化工具：文件操作、shell/process 执行、测试、Git diff review、代码执行、web fetch、LSP diagnostics 和 MCP server。
- 桌面 UI 覆盖对话、工具审批、技能、自动化、项目索引、用量/上下文可视化和代码变更。
- 持续完善 macOS 和 Windows 跨平台能力，包括结构化进程执行和 Windows 可执行文件解析。
- 提供 harness 和 replay 相关包，用于在不依赖真实模型的情况下测试 Agent 行为。

## 截图

![Ore Code home screen](./docs/assets/ore-code-home.png)

## 仓库结构

```text
apps/desktop/          Tauri 桌面应用
packages/protocol/     Runtime event schema 和共享协议类型
packages/tools/        工具定义、审批策略和工具辅助逻辑
packages/agent-core/   Agent engine、提示词、运行时上下文和模型适配
packages/state/        会话、事件和 artifact 存储辅助逻辑
packages/harness/      场景回放和 harness 测试
docs/                  产品、架构、工作流和项目规划文档
scripts/               本地辅助脚本
```

## 环境要求

- Node.js 20+；`.node-version` 中固定的开发和 CI 版本是 Node 22。
- pnpm 11.x。仓库在 `packageManager` 中声明了 `pnpm@11.0.8`，建议通过 Corepack 或等效方式固定版本。
- Rust stable 和 Cargo。
- 当前操作系统对应的 Tauri 2 系统依赖。
- Git。

可选能力取决于具体工作流：

- Python：用于 `code_execution` 和 Python 项目诊断。
- Cargo/Rust：用于 Rust 项目诊断和桌面构建。
- MCP server CLI，例如通过 `npx` 启动的 server。

## 快速开始

```bash
pnpm install
pnpm dev
```

直接运行桌面包：

```bash
pnpm --filter @ore-code/desktop tauri dev
```

构建所有 TypeScript 包：

```bash
pnpm build
```

构建桌面安装包：

```bash
pnpm --filter @ore-code/desktop tauri:build
pnpm build:desktop:windows
```

## macOS 预发布版安装

首个 macOS 预发布包未签名、未公证。macOS 拦截应用时，可以用下面任一方式首次打开：

- 按住 Control 点击或右键点击 `Ore Code.app`，选择**打开**，然后在确认弹窗里再次选择**打开**。
- 如果仍然被拦截，打开**系统设置 > 隐私与安全性**，找到 Ore Code 的拦截提示，选择**仍要打开**。

只安装本仓库 GitHub Releases 中发布的构建产物。

## 验证

开发时优先运行聚焦的包级检查：

```bash
pnpm --filter @ore-code/desktop typecheck
pnpm --filter @ore-code/desktop test
pnpm --filter @ore-code/desktop lint
```

在提交较大改动前运行更完整的本地检查：

```bash
pnpm ci:local
```

## 配置和本地数据

Ore Code 会在仓库外创建和读取本地运行时数据，包括：

- `~/.seekforge/skills`
- `~/.seekforge/mcp.json`
- `~/.deepseek/config.toml`，用于 DeepSeek-compatible provider 配置

项目内的 `.seekforge/` 运行时数据已被 Git 忽略。

## 文档

从 [docs/README.md](./docs/README.md) 开始阅读。常用入口：

- [架构概览](./docs/ARCHITECTURE_OVERVIEW.md)
- [开发指南](./docs/DEVELOPMENT.md)
- [故障排查](./docs/TROUBLESHOOTING.md)
- [FAQ](./docs/FAQ.md)
- [本地数据和配置](./docs/LOCAL_DATA_AND_CONFIG.md)
- [包边界和兼容性](./docs/API_AND_COMPATIBILITY.md)
- [路线图](./docs/ROADMAP.md)
- [技能系统](./docs/06-skill-system.md)
- [已知限制](./docs/KNOWN_LIMITATIONS.md)

## 贡献

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。请保持改动聚焦；除非有意改变行为，否则保持 runtime event、工具和持久化数据兼容；涉及桌面、路径或进程逻辑时，需要考虑 Windows 和 macOS。

## 社区和支持

参见 [SUPPORT.md](./SUPPORT.md) 和 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 隐私

参见 [PRIVACY.md](./PRIVACY.md)，了解本地数据、provider 请求和工具执行边界。

## 安全

参见 [SECURITY.md](./SECURITY.md) 获取安全问题报告方式。

## 更新日志

参见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

Ore Code 基于 [MIT License](./LICENSE) 发布。
