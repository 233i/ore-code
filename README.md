<p align="center">
  <img src="./apps/desktop/src-tauri/icons/128x128.png" alt="Ore Code icon" width="96" height="96">
</p>

<h1 align="center">Ore Code</h1>

<p align="center">
  <strong>DeepSeek-first desktop coding agent workbench.</strong>
</p>

<p align="center">
  Long-context coding, structured tool execution, local project context, MCP integrations, skills, automation, and a native desktop shell for macOS and Windows.
</p>

<p align="center">
  <a href="https://github.com/233i/ore-code/releases"><img alt="Release" src="https://img.shields.io/github/v/release/233i/ore-code?include_prereleases&style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/233i/ore-code?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-24292f?style=flat-square">
  <img alt="Built with Tauri" src="https://img.shields.io/badge/Tauri-2.x-24c8db?style=flat-square">
</p>

<p align="center">
  <a href="https://github.com/233i/ore-code/releases/tag/v0.1.0"><strong>Download Preview</strong></a>
  ·
  <a href="./docs/README.md">Docs</a>
  ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

![Ore Code home screen](./docs/assets/ore-code-home.png)

> Status: pre-release. Ore Code is source-available under the MIT License.

## Why Ore Code

Ore Code is built for coding workflows where the agent needs to inspect real project context, run tools predictably, and keep long conversations coherent. It combines a TypeScript agent runtime, a React/Tauri desktop app, and a Rust OS boundary for local file, process, Git, and MCP operations.

| Long-context agent | Local desktop tools | DeepSeek-first workflow |
| --- | --- | --- |
| Model-aware context budgets, history compression, and request shaping for large coding turns. | File operations, shell/process execution, tests, Git review, code execution, web fetch, and MCP servers. | Provider configuration, thinking-level controls, prompt/cache stability, and DeepSeek-compatible defaults. |

## Highlights

- DeepSeek-oriented agent runtime with plan, agent, and full-access workflows.
- Desktop UI for chat, tool approvals, skills, automations, project indexing, usage/context visibility, and code changes.
- Structured tools for file operations, shell/process execution, tests, Git diff review, code execution, web fetch, LSP diagnostics, and MCP servers.
- Harness and replay packages for testing agent behavior without relying on live models.
- Cross-platform desktop work for macOS and Windows.

## Download

The current public build is a macOS Apple Silicon pre-release:

- [Download `Ore.Code_0.1.0_aarch64.dmg`](https://github.com/233i/ore-code/releases/download/v0.1.0/Ore.Code_0.1.0_aarch64.dmg)
- SHA-256: `805dc211c21d0d8995115260bd91c0b856d44d09775f3ba65a2a629b47773eaa`

### macOS Pre-Release Install

The first macOS pre-release builds are unsigned and not notarized. When macOS blocks the app, open it once with either of these flows:

- Control-click or right-click `Ore Code.app`, choose **Open**, then choose **Open** again in the confirmation dialog.
- If macOS still blocks it, open **System Settings > Privacy & Security**, find the Ore Code warning, and choose **Open Anyway**.

Only install builds downloaded from this repository's GitHub releases.

## Repository Layout

```text
apps/desktop/          Tauri desktop application
packages/protocol/     Runtime event schemas and shared protocol types
packages/tools/        Tool specifications, approval policy, and tool helpers
packages/agent-core/   Agent engine, prompts, runtime context, and model adapters
packages/state/        Session/event/artifact storage helpers
packages/harness/      Scenario replay and harness tests
docs/                  Product, architecture, workflow, and project planning docs
scripts/               Local helper scripts
```

## Development

Prerequisites:

- Node.js 20+; Node 22 is the pinned development and CI version in `.node-version`.
- pnpm 11.x. This repo declares `pnpm@11.0.8` in `packageManager`.
- Rust stable with Cargo.
- Tauri 2 system prerequisites for your OS.
- Git.

Start the desktop app:

```bash
pnpm install
pnpm dev
```

Run package checks:

```bash
pnpm --filter @ore-code/desktop typecheck
pnpm --filter @ore-code/desktop test
pnpm --filter @ore-code/desktop lint
```

Build installers:

```bash
pnpm --filter @ore-code/desktop tauri:build
pnpm build:desktop:windows
```

## Configuration and Local Data

Ore Code keeps user-level runtime data outside the repository:

- `~/.ore-code/skills`
- `~/.ore-code/mcp.json`
- `~/.ore-code/config.toml` for DeepSeek-compatible provider configuration

Project-local runtime data under `.ore-code/` is ignored by Git.

## Documentation

- [Architecture overview](./docs/ARCHITECTURE_OVERVIEW.md)
- [Development guide](./docs/DEVELOPMENT.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [FAQ](./docs/FAQ.md)
- [Local data and configuration](./docs/LOCAL_DATA_AND_CONFIG.md)
- [Package boundaries and compatibility](./docs/API_AND_COMPATIBILITY.md)
- [Roadmap](./docs/ROADMAP.md)
- [Skill system](./docs/06-skill-system.md)
- [Known limitations](./docs/KNOWN_LIMITATIONS.md)

## Project

- [Contributing](./CONTRIBUTING.md)
- [Support](./SUPPORT.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Privacy](./PRIVACY.md)
- [Security](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

## License

Ore Code is released under the [MIT License](./LICENSE).
