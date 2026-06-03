<p align="center">
  <img src="./apps/desktop/src-tauri/icons/128x128.png" alt="Ore Code icon" width="96" height="96">
</p>

<h1 align="center">Ore Code</h1>

<p align="center">
  <strong>面向 DeepSeek 的桌面端 AI 编码工作台。</strong>
</p>

<p align="center">
  面向长上下文编码、结构化工具调用、本地项目上下文、MCP 集成、技能、自动化，以及 macOS 和 Windows 桌面体验。
</p>

<p align="center">
  <a href="https://github.com/233i/ore-code/releases"><img alt="Release" src="https://img.shields.io/github/v/release/233i/ore-code?include_prereleases&style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/233i/ore-code?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-24292f?style=flat-square">
  <img alt="Built with Tauri" src="https://img.shields.io/badge/Tauri-2.x-24c8db?style=flat-square">
</p>

<p align="center">
  <a href="https://github.com/233i/ore-code/releases/tag/v0.1.0"><strong>下载预览版</strong></a>
  ·
  <a href="./docs/README.md">文档</a>
  ·
  <a href="./README.md">English</a>
</p>

![Ore Code home screen](./docs/assets/ore-code-home.png)

> 状态：预发布。当前仓库源码基于 MIT License 发布。

## 为什么是 Ore Code

Ore Code 面向需要真实项目上下文、稳定工具执行和长对话连续性的编码工作流。它由 TypeScript agent runtime、React/Tauri 桌面应用和 Rust OS 边界组成，覆盖本地文件、进程、Git 和 MCP 操作。

| 长上下文 Agent | 本地桌面工具 | DeepSeek-first 工作流 |
| --- | --- | --- |
| 面向大型编码任务的模型容量估算、历史压缩和请求组织。 | 文件操作、shell/process 执行、测试、Git review、代码执行、web fetch 和 MCP server。 | Provider 配置、thinking level 控制、prompt/cache 稳定性，以及 DeepSeek-compatible 默认配置。 |

## 亮点

- 面向 DeepSeek 的 Agent runtime，支持计划、Agent 和完全访问等工作模式。
- 桌面 UI 覆盖对话、工具审批、技能、自动化、项目索引、用量/上下文可视化和代码变更。
- 提供结构化工具：文件操作、shell/process 执行、测试、Git diff review、代码执行、web fetch、LSP diagnostics 和 MCP server。
- 提供 harness 和 replay 相关包，用于在不依赖真实模型的情况下测试 Agent 行为。
- 持续完善 macOS 和 Windows 跨平台桌面能力。

## 下载

当前公开构建是 macOS Apple Silicon 预发布版：

- [下载 `Ore.Code_0.1.0_aarch64.dmg`](https://github.com/233i/ore-code/releases/download/v0.1.0/Ore.Code_0.1.0_aarch64.dmg)
- SHA-256：`805dc211c21d0d8995115260bd91c0b856d44d09775f3ba65a2a629b47773eaa`

### macOS 预发布版安装

首个 macOS 预发布包未签名、未公证。macOS 拦截应用时，可以用下面任一方式首次打开：

- 按住 Control 点击或右键点击 `Ore Code.app`，选择**打开**，然后在确认弹窗里再次选择**打开**。
- 如果仍然被拦截，打开**系统设置 > 隐私与安全性**，找到 Ore Code 的拦截提示，选择**仍要打开**。

只安装本仓库 GitHub Releases 中发布的构建产物。

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

## 开发

环境要求：

- Node.js 20+；`.node-version` 中固定的开发和 CI 版本是 Node 22。
- pnpm 11.x。仓库在 `packageManager` 中声明了 `pnpm@11.0.8`。
- Rust stable 和 Cargo。
- 当前操作系统对应的 Tauri 2 系统依赖。
- Git。

启动桌面应用：

```bash
pnpm install
pnpm dev
```

运行包级检查：

```bash
pnpm --filter @ore-code/desktop typecheck
pnpm --filter @ore-code/desktop test
pnpm --filter @ore-code/desktop lint
```

构建安装包：

```bash
pnpm --filter @ore-code/desktop tauri:build
pnpm build:desktop:windows
```

## 配置和本地数据

Ore Code 会在仓库外创建和读取用户级运行时数据：

- `~/.ore-code/skills`
- `~/.ore-code/mcp.json`
- `~/.ore-code/config.toml`，用于 DeepSeek-compatible provider 配置

项目内的 `.ore-code/` 运行时数据已被 Git 忽略。

## 文档

- [架构概览](./docs/ARCHITECTURE_OVERVIEW.md)
- [开发指南](./docs/DEVELOPMENT.md)
- [故障排查](./docs/TROUBLESHOOTING.md)
- [FAQ](./docs/FAQ.md)
- [本地数据和配置](./docs/LOCAL_DATA_AND_CONFIG.md)
- [包边界和兼容性](./docs/API_AND_COMPATIBILITY.md)
- [路线图](./docs/ROADMAP.md)
- [技能系统](./docs/06-skill-system.md)
- [已知限制](./docs/KNOWN_LIMITATIONS.md)

## 项目

- [贡献指南](./CONTRIBUTING.md)
- [支持](./SUPPORT.md)
- [行为准则](./CODE_OF_CONDUCT.md)
- [隐私](./PRIVACY.md)
- [安全](./SECURITY.md)
- [更新日志](./CHANGELOG.md)

## 许可证

Ore Code 基于 [MIT License](./LICENSE) 发布。
