# SeekForge Desktop

This package contains the SeekForge Tauri desktop application.

## Stack

- Tauri 2 for the desktop shell and OS boundary.
- React 19 and TypeScript for the UI.
- Vite for frontend development and builds.
- Rust for file, process, Git, keychain, MCP, and platform commands.

## Development

From the repository root:

```bash
pnpm --filter @seekforge/desktop tauri dev
```

Frontend-only development:

```bash
pnpm --filter @seekforge/desktop dev
```

## Checks

```bash
pnpm --filter @seekforge/desktop typecheck
pnpm --filter @seekforge/desktop test
pnpm --filter @seekforge/desktop lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Build

```bash
pnpm --filter @seekforge/desktop tauri:build
```

Windows NSIS bundle:

```bash
pnpm --filter @seekforge/desktop tauri:build:win
```

## Runtime Data

The app stores user-level data outside the repository, including SeekForge skills and MCP configuration under `~/.seekforge/`.

Project-local `.seekforge/` data is ignored by Git.
