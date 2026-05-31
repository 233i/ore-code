# Contributing to SeekForge

SeekForge is in active pre-release development. Contributions should keep behavior stable unless the change intentionally updates product behavior and documents the reason.

## Development Setup

```bash
pnpm install
pnpm dev
```

For desktop development:

```bash
pnpm --filter @seekforge/desktop tauri dev
```

## Before You Start

- Search existing issues and pull requests before opening a duplicate report once the repository is public.
- Keep security-sensitive reports private and follow [SECURITY.md](./SECURITY.md).
- Prefer small pull requests with one clear behavior or documentation change.
- Open a discussion issue first for broad architecture, runtime, tool, storage, or security changes.

## Code Standards

- Keep changes focused. Avoid unrelated cleanup in the same patch.
- Preserve public package exports, runtime event schemas, tool schemas, and persisted data formats unless the change explicitly requires a migration.
- Follow [Package Boundaries and Compatibility](./docs/API_AND_COMPATIBILITY.md) when changing package exports, runtime events, tool schemas, persisted data, settings, MCP, skills, or desktop OS-boundary code.
- Review dependency and lockfile changes carefully; avoid dependency churn without a clear reason.
- Match verification to the changed surface, and use `pnpm ci:local` for broad cross-package changes.
- Prefer structured APIs over shell string composition, especially for desktop tools that must run on Windows and macOS.
- Keep UI fixes scoped to the affected component or page. Avoid broad fallback CSS unless the issue is intentionally design-system-wide.
- Add or update tests for extracted helpers, registries, parsers, and cross-platform path/process behavior.
- Do not commit local runtime data, secrets, build outputs, or generated test artifacts.

## Verification

For desktop UI/runtime changes, run the focused checks:

```bash
pnpm --filter @seekforge/desktop typecheck
pnpm --filter @seekforge/desktop test
pnpm --filter @seekforge/desktop lint
git diff --check
```

For shared package changes, run the relevant package checks:

```bash
pnpm --filter @seekforge/protocol test typecheck lint
pnpm --filter @seekforge/tools test typecheck lint
pnpm --filter @seekforge/agent-core test typecheck lint
pnpm --filter @seekforge/state test typecheck lint
pnpm --filter @seekforge/harness test typecheck lint
```

Run Rust tests when changing `apps/desktop/src-tauri`:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Before opening a broad pull request, run the local CI equivalent:

```bash
pnpm ci:local
```

## Pull Request Checklist

- [ ] The change has a narrow scope and a clear summary.
- [ ] A related issue is linked, or the PR explains why no issue exists.
- [ ] User-facing behavior changes are documented.
- [ ] Windows/macOS compatibility was considered for desktop, path, process, and shell behavior.
- [ ] Runtime event, tool schema, persisted data, and settings compatibility were considered when relevant.
- [ ] Dependency, lockfile, advisory, and license-review impact were considered when relevant.
- [ ] Security, permissions, sandboxing, process execution, and secret-handling impact were considered when relevant.
- [ ] Tests or verification commands were run and listed in the PR.
- [ ] No secrets, local runtime data, or generated artifacts are included.

## Sensitive Changes

Treat these areas as higher-risk and keep changes especially small:

- Tool approval, session approval cache, sandbox policy, shell/process execution, and command risk scoring.
- Provider API key storage, MCP server env handling, and any path that can expose secrets.
- Session, transcript, artifact, project index, or settings persistence.
- Runtime event schemas, tool schemas, prompt construction, and model-message ledger behavior.
- Git restore, file write, and workspace boundary behavior.

For these changes, explain compatibility and rollback risk in the PR.

## Commit Messages

Use concise conventional-style messages when practical:

```text
feat: add structured test runner tool
fix: preserve CRLF when editing files
docs: clarify local setup
refactor: split tool presentation registry
```
