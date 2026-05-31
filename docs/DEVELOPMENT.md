# Development Guide

This guide is the day-to-day contributor entry point for SeekForge development.

## Local Setup

Use Node.js 22 for local development when possible; `.node-version` matches CI. The package metadata allows Node.js 20+ and pnpm 11.x.

```bash
corepack enable
pnpm install
pnpm --filter @seekforge/desktop tauri dev
```

Frontend-only development:

```bash
pnpm --filter @seekforge/desktop dev
```

## Workspace Packages

- `apps/desktop`: Tauri desktop app.
- `packages/protocol`: runtime event schemas and shared protocol types.
- `packages/tools`: tool specs, approval policy, command risk, and tool helpers.
- `packages/agent-core`: agent engine, model adapters, prompts, runtime context, subagents, and tool loop logic.
- `packages/state`: event/session/artifact storage helpers.
- `packages/harness`: scenario replay and deterministic agent behavior tests.

## Common Commands

```bash
pnpm build
pnpm -r --sort typecheck
pnpm -r --sort test
pnpm -r --sort lint
```

Focused desktop checks:

```bash
pnpm --filter @seekforge/desktop typecheck
pnpm --filter @seekforge/desktop test
pnpm --filter @seekforge/desktop lint
```

Rust boundary checks:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Change Guidelines

- Keep public exports and runtime event schemas stable unless the change intentionally updates the contract.
- Prefer structured process/file APIs over shell snippets for built-in tools.
- Treat Windows and macOS compatibility as default requirements for desktop, path, process, and packaging changes.
- Keep UI fixes scoped to the affected component or page.
- Add tests for parsers, registries, extracted pure helpers, cross-platform path logic, and runtime behavior changes.
- Avoid committing local runtime data, screenshots from private projects, logs, secrets, or generated artifacts.

## Useful Test Targets

```bash
pnpm --filter @seekforge/protocol test typecheck lint
pnpm --filter @seekforge/tools test typecheck lint
pnpm --filter @seekforge/agent-core test typecheck lint
pnpm --filter @seekforge/state test typecheck lint
pnpm --filter @seekforge/harness test typecheck lint
```

## Manual Desktop Smoke Test

- Start the desktop app.
- Create or select a workspace.
- Send a short chat message.
- Run a read-only tool.
- Trigger an approval dialog.
- Open Skills and MCP pages.
- Open Code Changes and diff preview.
- Run Environment Check.
- Toggle dark/light mode on main entry screens.
