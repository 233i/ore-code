# Roadmap

Ore Code is in pre-release development. This roadmap describes intended direction, not a promise of dates or final scope.

## Current Status

The project is being prepared for source-level public GitHub hosting.

Completed foundation work includes:

- Tauri desktop shell for macOS and Windows-oriented workflows.
- DeepSeek-first agent runtime with plan, agent, and full-access modes.
- Structured tool execution, approval flows, skills, MCP integration, automations, project indexing, and Git diff review.
- Repository entry docs, contribution/security/support notes, known limitations, and a simple CI workflow.

The project is licensed under MIT. Binary release readiness is still separate from source availability.

## 0.1.0 Source Snapshot

The first public source snapshot should stay small and credible:

- Documented install, development, troubleshooting, support, privacy, and security paths.
- Simple CI for TypeScript/package checks.
- Clear known limitations for MCP, sandboxing, Windows packaging, performance, and public launch caveats.
- No binary release claims until installers are built and smoke-tested on their target OS.

No public announcement should imply production readiness.

## 0.1.x Stabilization

After the first public pre-release, prioritize fixes that make day-to-day use dependable:

- Startup and long-session rendering performance.
- Windows path, process, shell, line-ending, and packaging issues.
- MCP reconnect, configuration, and failure recovery.
- Skills discovery, editing, installation location, and cross-platform behavior.
- Approval, sandbox, and tool-output UX polish.
- Documentation updates driven by real user setup problems.

Breaking runtime event, tool schema, persisted data, and settings changes should remain rare in this phase.

## 0.2 Workflow Depth

The next larger feature wave should improve coding quality and context selection:

- Persistent project index and incremental indexing status.
- Symbol graph, call relationship, and impact analysis.
- Better codebase retrieval and working-set recall.
- Stronger subagent orchestration and role-specific task routing.
- Deeper GitHub, PR, and CI workflow integration.
- Optional sandbox executor with quiet defaults and clear boundary prompts.

These areas should land behind focused tests and compatibility notes rather than as broad UI rewrites.

## Future Ideas

Potential later work includes:

- More provider integrations after DeepSeek-first workflows are stable.
- Richer MCP marketplace/configuration flows.
- Team-oriented review and shared policy controls.
- Linux packaging after macOS and Windows are validated.
- More complete localization once the UI message boundaries are stable.

## Non-Goals for Early Releases

Early public releases should not try to solve every IDE or cloud-agent workflow:

- No silent system-level dependency installation.
- No unsupported promise of full sandbox isolation.
- No broad plugin marketplace commitments before MCP and skills are stable.
- No Linux desktop release target until packaging and smoke tests exist.
- No binary release claims until installers are built and smoke-tested on their target OS.

## How to Influence Priority

Use GitHub issues after the repository is public:

- Bug reports should include OS, version, reproduction steps, logs with secrets removed, and whether the issue affects macOS, Windows, or both.
- Feature requests should describe the workflow, current workaround, and expected benefit.
- Security-sensitive reports must follow [SECURITY.md](../SECURITY.md).

Use [Contributing](../CONTRIBUTING.md), [Support](../SUPPORT.md), and [Security](../SECURITY.md) when turning feedback into follow-up work.
