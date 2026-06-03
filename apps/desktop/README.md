# Ore Code Desktop

This package contains the Ore Code Tauri desktop application.

## Stack

- Tauri 2 for the desktop shell and OS boundary.
- React 19 and TypeScript for the UI.
- Vite for frontend development and builds.
- Rust for file, process, Git, keychain, MCP, and platform commands.

## Development

From the repository root:

```bash
pnpm --filter @ore-code/desktop tauri dev
```

Frontend-only development:

```bash
pnpm --filter @ore-code/desktop dev
```

## Checks

```bash
pnpm --filter @ore-code/desktop typecheck
pnpm --filter @ore-code/desktop test
pnpm --filter @ore-code/desktop lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Build

```bash
pnpm --filter @ore-code/desktop tauri:build
```

Windows NSIS bundle:

```bash
pnpm --filter @ore-code/desktop tauri:build:win
```

## Runtime Data

The app stores user-level data outside the repository, including Ore Code skills and MCP configuration under `~/.ore-code/`.

Project-local `.ore-code/` data is ignored by Git.
