# Ore Code

[简体中文](./README.zh-CN.md)

Ore Code is a DeepSeek-first desktop coding agent workbench built with Tauri, React, TypeScript, and Rust. It focuses on long-context coding workflows, structured tool execution, local project context, MCP integrations, skills, automation, and cross-platform desktop behavior for macOS and Windows.

> Status: pre-release. This repository is source-available under the MIT License.

## Highlights

- DeepSeek-oriented agent runtime with plan, agent, and full-access workflows.
- Large-context support with model-aware capacity estimates, history compression, and project context routing.
- Structured tools for file operations, shell/process execution, tests, Git diff review, code execution, web fetch, LSP diagnostics, and MCP servers.
- Desktop UI for chat, tool approvals, skills, automations, project indexing, usage/context visibility, and code changes.
- Cross-platform work in progress for macOS and Windows, including structured process execution and Windows executable resolution.
- Harness and replay-oriented packages for testing agent behavior without relying on live models.

## Screenshot

![Ore Code home screen](./docs/assets/ore-code-home.png)

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

## Prerequisites

- Node.js 20+ is required; Node 22 is the pinned development and CI version in `.node-version`.
- pnpm 11.x. This repo declares `pnpm@11.0.8` in `packageManager`; use Corepack or an equivalent pinned pnpm install.
- Rust stable with Cargo.
- Tauri 2 system prerequisites for your OS.
- Git.

Optional capabilities depend on the workflow you use:

- Python for `code_execution` and Python project diagnostics.
- Cargo/Rust for Rust project diagnostics and desktop builds.
- MCP server CLIs such as `npx`-launched servers.

## Getting Started

```bash
pnpm install
pnpm dev
```

Run the desktop package directly:

```bash
pnpm --filter @ore-code/desktop tauri dev
```

Build all TypeScript packages:

```bash
pnpm build
```

Build desktop installers:

```bash
pnpm --filter @ore-code/desktop tauri:build
pnpm build:desktop:windows
```

## macOS Pre-Release Install

The first macOS pre-release builds are unsigned and not notarized. When macOS blocks the app, open it once with either of these flows:

- Control-click or right-click `Ore Code.app`, choose **Open**, then choose **Open** again in the confirmation dialog.
- If macOS still blocks it, open **System Settings > Privacy & Security**, find the Ore Code warning, and choose **Open Anyway**.

Only install builds downloaded from this repository's GitHub releases.

## Verification

Use the focused package checks while developing:

```bash
pnpm --filter @ore-code/desktop typecheck
pnpm --filter @ore-code/desktop test
pnpm --filter @ore-code/desktop lint
```

Run broader local checks before opening a larger pull request:

```bash
pnpm ci:local
```

## Configuration and Local Data

Ore Code creates and reads local runtime data outside the repository, including:

- `~/.seekforge/skills`
- `~/.seekforge/mcp.json`
- `~/.deepseek/config.toml` for DeepSeek-compatible provider configuration

Project-local runtime data under `.seekforge/` is ignored by Git.

## Documentation

Start with [docs/README.md](./docs/README.md). Useful entry points:

- [Architecture overview](./docs/ARCHITECTURE_OVERVIEW.md)
- [Development guide](./docs/DEVELOPMENT.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [FAQ](./docs/FAQ.md)
- [Local data and configuration](./docs/LOCAL_DATA_AND_CONFIG.md)
- [Package boundaries and compatibility](./docs/API_AND_COMPATIBILITY.md)
- [Roadmap](./docs/ROADMAP.md)
- [Skill system](./docs/06-skill-system.md)
- [Known limitations](./docs/KNOWN_LIMITATIONS.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Keep changes scoped, preserve runtime event/tool compatibility unless intentionally changing it, and consider Windows/macOS behavior for any desktop or process-related work.

## Community and Support

See [SUPPORT.md](./SUPPORT.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Privacy

See [PRIVACY.md](./PRIVACY.md) for local data, provider request, and tool execution boundaries.

## Security

See [SECURITY.md](./SECURITY.md) for reporting guidance.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

Ore Code is released under the [MIT License](./LICENSE).
