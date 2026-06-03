# Architecture Overview

Ore Code is a desktop coding agent workbench built around a TypeScript agent runtime, a React/Tauri desktop shell, and a small Rust OS boundary. This overview is the public architecture map for contributors who need to understand where changes belong before editing code.

For compatibility rules, use [Package Boundaries and Compatibility](./API_AND_COMPATIBILITY.md). For local setup and commands, use [Development Guide](./DEVELOPMENT.md).

## Purpose

The architecture keeps model interaction, tool execution, desktop UI, and operating-system access separated:

- The UI renders state and collects user intent.
- The TypeScript app services coordinate desktop workflows.
- The agent runtime builds model requests, handles tool loops, emits runtime events, and updates persisted state.
- Tool packages define structured capabilities and conservative approval metadata.
- Rust handles local OS boundary work such as process execution, file access, Git integration, key storage, and Tauri commands.

## Layered Model

```text
React desktop UI
  -> Desktop app services and hooks
  -> Agent runtime and tool orchestration
  -> Shared protocol, tools, and state packages
  -> Tauri commands
  -> Filesystem, process, Git, key storage, app data, and MCP subprocesses
```

The UI should not call model APIs directly. It also should not run shell or process commands directly. Desktop-facing code should go through typed services and hosts so Windows and macOS behavior stays explicit.

## Workspace Packages

| Package | Responsibility |
| --- | --- |
| `@ore-code/protocol` | Runtime event schemas and shared protocol types. |
| `@ore-code/tools` | Tool specs, approval policy, command risk classification, and structured tool helpers. |
| `@ore-code/agent-core` | Agent engine, prompt assembly, model adapters, runtime context, subagents, model message ledger, and task flow. |
| `@ore-code/state` | JSONL session storage, artifact storage, event storage, and in-memory test stores. |
| `@ore-code/harness` | Scenario replay, mock model flows, and harness tests. |
| `@ore-code/desktop` | Tauri desktop app, React UI, settings, local services, and OS boundary wiring. |

Packages are private pre-release workspace packages, but their boundaries are still important because session files, artifacts, settings, and replay fixtures can outlive a single code change.

## Runtime Event Flow

The agent runtime writes observable work as runtime events. Desktop state, transcript rendering, tool cards, usage summaries, diff views, and replay all derive from those events.

Runtime events should be append-readable:

- New event types start in `@ore-code/protocol`.
- Existing event payloads should remain readable by newer code.
- Optional fields are preferred over renamed or removed fields.
- Persisted sessions should fail clearly only when a migration or reset path is documented.

## Tool Execution and Approval

Tools are registered as structured capabilities rather than ad hoc prompt text. The model sees the tool schema; the desktop app decides how to execute, approve, summarize, and display the result.

Important boundaries:

- Tool names and input/output schemas are compatibility-sensitive.
- Approval policy should stay conservative when a tool can write files, run processes, access the network, or expose private data.
- Large tool output should become concise summaries or artifacts instead of being copied back into model history by default.
- Use structured tools such as file, Git, search, `run_tests`, code execution, LSP diagnostics, web fetch, MCP, and artifact tools before falling back to free-form shell.

## Model Context and DeepSeek

Ore Code is DeepSeek-first. The agent runtime manages model-aware context budgets, prompt section ordering, immutable prefix expectations, project context injection, tool result routing, and history compression.

Design rules:

- Keep stable system prompt and tool schema ordering when possible.
- Treat project context as internal context, not user-visible chat text.
- Keep dynamic user intent near the end of the request.
- Preserve reasoning, tool-call, and project-delta context only where it is useful for replay or long-session continuity.

## Desktop OS Boundary

Rust and Tauri own the operating-system boundary. This keeps risky or platform-specific behavior out of React components and model prompts.

Desktop OS boundary responsibilities include:

- Structured process execution.
- Free-form shell execution.
- File reads and writes.
- Git commands and restore behavior.
- Secure key storage.
- Web fetch and local HTTP boundaries.
- MCP stdio server launch and lifecycle.
- App data and user-level configuration directories.

Windows and macOS behavior must stay explicit. Preserve Windows `.cmd` executable resolution, hidden child-console behavior, CRLF handling, and drive-letter path display. On macOS, preserve Keychain behavior, user-level data paths, and packaging/signing expectations.

## Persistence and Local Data

Ore Code stores user runtime data outside the repository by default:

- User-level skills: `~/.ore-code/skills`
- User-level MCP config: `~/.ore-code/mcp.json`
- DeepSeek-compatible provider config: `~/.ore-code/config.toml`
- Project-local runtime state: `.ore-code/`

Session, transcript, artifact, index, task, note, MCP, and settings data should use one canonical pre-release shape. If a cleanup intentionally breaks old data, document the reset path instead of adding hidden fallback readers by default.

## MCP and Skills

MCP and skills extend the runtime without changing core agent behavior:

- MCP server configuration lives in user-level config and may depend on local executables such as `node`, `npx`, or a server-specific command.
- Skills are local instruction bundles centered on `SKILL.md`.
- UI management flows should avoid exposing large raw JSON or private paths unless the user explicitly opens details.
- Failing MCP servers or invalid skills should not block unrelated desktop workflows.

## Testing and Replay

The project relies on repeatable tests rather than live-model intuition:

- Protocol tests protect event schema behavior.
- Tool tests protect command risk, approval, summaries, and structured output.
- Agent-core tests protect prompt assembly, context construction, tool loops, and replay-sensitive behavior.
- Desktop tests protect UI derivation, services, settings, tool display, and path/process integration.
- Harness scenarios keep model/tool flows reproducible with mock model clients.

Broad local validation uses `pnpm ci:local`; focused changes should run the relevant package checks.

## Cross-Platform Expectations

Ore Code targets macOS and Windows first. Contributors should assume path, process, shell, packaging, and line-ending behavior can differ across those platforms.

Prefer:

- Structured process calls over shell snippets.
- Cross-platform path helpers over string concatenation.
- Explicit executable resolution for Windows command shims.
- Focused OS-specific tests when a change touches process, filesystem, Git, MCP, packaging, or key storage behavior.

Linux may be useful for CI and development checks, but Linux desktop packaging is not a primary release target yet.

## Stability Rules

Before changing compatibility-sensitive areas, identify the reset, migration, or rollback plan:

- Runtime event names and payloads.
- Tool names, schemas, risk levels, and output shape.
- Prompt section ordering and model message ledger behavior.
- Persisted JSONL, artifact, settings, MCP, skills, notes, or index data.
- Desktop OS boundary commands and local data paths.
- Public package exports from `src/index.ts`.

Small, additive changes are preferred. Broad rewrites should be split behind stable boundaries with targeted tests.

## Related Documents

- [Package Boundaries and Compatibility](./API_AND_COMPATIBILITY.md)
- [Development Guide](./DEVELOPMENT.md)
- [Local Data and Configuration](./LOCAL_DATA_AND_CONFIG.md)
- [Roadmap](./ROADMAP.md)
