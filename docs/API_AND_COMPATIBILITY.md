# Package Boundaries and Compatibility

Ore Code is still pre-release. Contributors should keep package exports, runtime events, tool schemas, settings, and persisted data understandable, but should not accumulate compatibility aliases for old pre-release names or layouts. Prefer one canonical shape plus an explicit reset path when a breaking cleanup is intentional.

## Workspace Packages

| Package | Responsibility | Compatibility-sensitive surface |
| --- | --- | --- |
| `@ore-code/protocol` | Runtime event schemas and shared protocol types. | Event names, payload schemas, parsing behavior, backward-readable persisted events. |
| `@ore-code/tools` | Tool specs, approval policy, risk classification, and tool helpers. | Tool names, input/output schemas, risk levels, artifact behavior, approval semantics. |
| `@ore-code/agent-core` | Agent engine, prompt assembly, model adapters, runtime context, subagents, and task flow. | Public exports, model message ledger behavior, prompt section ordering, context construction, runtime event emission. |
| `@ore-code/state` | JSONL session store, artifact store, and event storage helpers. | File layout, JSONL event shape, session index behavior, migration expectations. |
| `@ore-code/harness` | Scenario replay and test harness helpers. | Scenario file format, replay assumptions, mock provider behavior. |
| `@ore-code/desktop` | Tauri desktop app and OS boundary wiring. | Tauri commands, local data paths, settings shape, UI expectations, process/file/Git/MCP host behavior. |

The packages are currently private workspace packages. Keep stability where it protects active workflows, but avoid long-lived fallback branches for names, paths, or schemas that have not shipped as a supported public contract.

## Stable-by-Default Contracts

Keep these stable unless the change explicitly documents reset or rollback risk:

- Public package exports from `src/index.ts`.
- Runtime event names and payload fields.
- Tool names, input schemas, output schemas, and risk classification.
- Persisted JSONL session data and artifact metadata.
- Settings, provider configuration, MCP configuration, skills metadata, and local index files.
- Prompt section ordering that affects prefix caching.
- Windows/macOS path, process, and shell behavior.

Adding optional fields is usually safer than renaming or deleting fields. Removing or changing the meaning of a field is a breaking change, but pre-release breaking cleanups should favor deleting obsolete branches over preserving every old shape indefinitely.

## Runtime Events

Runtime events should be append-only from a reader's perspective:

- New event types should be added in `@ore-code/protocol` first.
- Existing events should remain readable by current state and desktop code.
- Older sessions should not fail to load when a new optional event field is missing.
- Event payload changes should have targeted tests in protocol, state, agent-core, or desktop code depending on where the event is consumed.

When changing event semantics, update replay or harness coverage so old and new sessions remain understandable.

## Tool Schemas

Tool schema changes affect model behavior, approvals, context usage, and replay:

- Prefer adding a new optional input field over renaming an existing field.
- Keep tool names stable once they are part of a supported surface. For pre-release renames, update call sites and tests instead of keeping aliases by default.
- Keep risk classification conservative when behavior expands.
- Keep output summaries compact and avoid putting large raw payloads back into model history by default.
- Update tool presentation and approval UI when a new tool or high-risk behavior is added.

## Persisted Data

Persisted data includes sessions, artifacts, task state, notes, indexes, settings, skills, and MCP configuration.

Pre-release persisted-data cleanups should either:

- Keep the current canonical shape unchanged.
- Include a documented reset path when data is cache-like or safe to rebuild.
- Include a deliberate migration only when preserving that data is more valuable than keeping the runtime simple.

Do not add silent fallback readers for obsolete paths or keys unless maintaining a supported release requires it.

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
- Why the break is intentional.
- Which persisted data or user workflows are affected.
- How to migrate or reset safely.
- How to roll back.
- Which tests prove the new canonical shape works and obsolete data is ignored, reset, or rejected clearly.

Pull requests that touch compatibility-sensitive areas should fill out the compatibility and risk sections of the PR template.

## Verification Expectations

Match verification to the changed surface:

- Protocol changes: `pnpm --filter @ore-code/protocol test typecheck lint`.
- Tool schema or risk changes: `pnpm --filter @ore-code/tools test typecheck lint`.
- Agent runtime changes: `pnpm --filter @ore-code/agent-core test typecheck lint`.
- Desktop settings, storage, path, process, MCP, or UI wiring: `pnpm --filter @ore-code/desktop test typecheck lint`.

For cross-package or persisted-data changes, run the focused package checks plus `pnpm ci:local` before publishing.
