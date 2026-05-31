# Package Boundaries and Compatibility

SeekForge is still pre-release, but contributors should treat package exports, runtime events, tool schemas, settings, and persisted data as compatibility-sensitive. This keeps local sessions, replay fixtures, desktop UI, and future releases understandable as the codebase evolves.

## Workspace Packages

| Package | Responsibility | Compatibility-sensitive surface |
| --- | --- | --- |
| `@seekforge/protocol` | Runtime event schemas and shared protocol types. | Event names, payload schemas, parsing behavior, backward-readable persisted events. |
| `@seekforge/tools` | Tool specs, approval policy, risk classification, and tool helpers. | Tool names, input/output schemas, risk levels, artifact behavior, approval semantics. |
| `@seekforge/agent-core` | Agent engine, prompt assembly, model adapters, runtime context, subagents, and task flow. | Public exports, model message ledger behavior, prompt section ordering, context construction, runtime event emission. |
| `@seekforge/state` | JSONL session store, artifact store, and event storage helpers. | File layout, JSONL event shape, session index behavior, migration expectations. |
| `@seekforge/harness` | Scenario replay and test harness helpers. | Scenario file format, replay assumptions, mock provider behavior. |
| `@seekforge/desktop` | Tauri desktop app and OS boundary wiring. | Tauri commands, local data paths, settings shape, UI expectations, process/file/Git/MCP host behavior. |

The packages are currently private workspace packages. The compatibility rules still matter because runtime data can outlive a single code change.

## Stable-by-Default Contracts

Keep these stable unless the change explicitly documents migration and rollback risk:

- Public package exports from `src/index.ts`.
- Runtime event names and payload fields.
- Tool names, input schemas, output schemas, and risk classification.
- Persisted JSONL session data and artifact metadata.
- Settings, provider configuration, MCP configuration, skills metadata, and local index files.
- Prompt section ordering that affects prefix caching.
- Windows/macOS path, process, and shell behavior.

Adding optional fields is usually safer than renaming or deleting fields. Removing or changing the meaning of a field is a breaking change even before a public package release.

## Runtime Events

Runtime events should be append-only from a reader's perspective:

- New event types should be added in `@seekforge/protocol` first.
- Existing events should remain readable by current state and desktop code.
- Older sessions should not fail to load when a new optional event field is missing.
- Event payload changes should have targeted tests in protocol, state, agent-core, or desktop code depending on where the event is consumed.

When changing event semantics, update replay or harness coverage so old and new sessions remain understandable.

## Tool Schemas

Tool schema changes affect model behavior, approvals, context usage, and replay:

- Prefer adding a new optional input field over renaming an existing field.
- Keep tool names stable. If a tool needs a new name, keep a compatibility alias only when the old behavior can be preserved safely.
- Keep risk classification conservative when behavior expands.
- Keep output summaries compact and avoid putting large raw payloads back into model history by default.
- Update tool presentation and approval UI when a new tool or high-risk behavior is added.

## Persisted Data

Persisted data includes sessions, artifacts, task state, notes, indexes, settings, skills, and MCP configuration.

Changes should either:

- Be backward-readable without migration.
- Include a clear migration path.
- Include a documented reset path when the data is cache-like and safe to rebuild.

Never silently delete user data as part of a compatibility fix.

## Desktop and OS Boundaries

Desktop-facing changes must keep macOS and Windows in mind:

- Avoid POSIX-only shell snippets in internal tools.
- Prefer structured process, file, Git, and MCP APIs.
- Preserve Windows `.cmd` executable resolution and hidden child-console behavior.
- Keep line-ending behavior consistent with `.gitattributes` and `.editorconfig`.
- Test path display with both POSIX paths and Windows drive-letter paths when changing path logic.

## Breaking Change Checklist

If a change intentionally breaks a contract, document:

- What changed.
- Why compatibility could not be preserved.
- Which persisted data or user workflows are affected.
- How to migrate or reset safely.
- How to roll back.
- Which tests prove old data is handled or intentionally rejected with a clear error.

Pull requests that touch compatibility-sensitive areas should fill out the compatibility and risk sections of the PR template.

## Verification Expectations

Match verification to the changed surface:

- Protocol changes: `pnpm --filter @seekforge/protocol test typecheck lint`.
- Tool schema or risk changes: `pnpm --filter @seekforge/tools test typecheck lint`.
- Agent runtime changes: `pnpm --filter @seekforge/agent-core test typecheck lint`.
- Desktop settings, storage, path, process, MCP, or UI wiring: `pnpm --filter @seekforge/desktop test typecheck lint`.

For cross-package or persisted-data changes, run the focused package checks plus `pnpm ci:local` before publishing.
