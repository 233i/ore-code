# Privacy and Data Handling

Ore Code is a local desktop coding agent workbench. This document explains the intended data boundaries for the pre-release version.

## Local Data

Ore Code stores local runtime data on the user's machine, including:

- App settings.
- Session and transcript data.
- Tool artifacts.
- Skills under `~/.ore-code/skills`.
- MCP configuration under `~/.ore-code/mcp.json`.
- Provider configuration metadata.

Project-local `.ore-code/` data is ignored by Git by default.

See [Local Data and Configuration](./docs/LOCAL_DATA_AND_CONFIG.md) for the current path map, reset guidance, and public reporting checklist.

## Provider Requests

When a model provider is configured, prompts and selected project context may be sent to that provider to complete the user's request. This can include:

- User messages.
- Relevant conversation history.
- Files or snippets selected by tools or project context retrieval.
- Tool results that the agent needs for the next model turn.

Users should avoid sending private code or data to a provider they do not trust.

## API Keys and Secrets

- API keys should be stored through the app's secure storage flow where supported.
- API keys and secrets should not be committed into repository files.
- Logs and screenshots shared in issues should be checked for keys, tokens, private paths, and private project data.

## Tools and External Processes

Ore Code can run local tools such as Git, shell/process commands, tests, diagnostics, code execution, and MCP servers when the user permits them. These tools may read local files or contact networks depending on their command and configuration.

The approval and permission system is intended to make higher-risk actions visible, but users should review commands before approving them.

## MCP Servers

MCP servers are external processes or remote integrations configured by the user. Their data handling depends on the specific server. Review each MCP server before enabling it.

## Crash Reports and Telemetry

Ore Code does not currently define a hosted telemetry pipeline in this repository. If telemetry or crash reporting is added later, this document should be updated before public release.

## Reporting Privacy Issues

For privacy-sensitive issues, follow [SECURITY.md](./SECURITY.md) rather than opening a public issue.
