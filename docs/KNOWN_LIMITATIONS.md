# Known Limitations

Ore Code is pre-release software. This document lists current limitations that should be visible before a public GitHub launch.

## Platform Support

- macOS and Windows are the primary desktop targets.
- Linux is useful for CI and may run parts of the stack, but desktop packaging and system integration are not a release target yet.
- Windows packaging still needs manual validation on a real Windows machine before each public release.
- Do not advertise a Windows installer as ready until artifact, checksum, and smoke-test evidence are recorded in the release launch documents.

## DeepSeek and Provider Support

- The product is optimized for DeepSeek-compatible models and OpenAI-compatible APIs.
- Provider configuration is still developer-oriented. API keys should be stored through the app's secure storage flow rather than committed into config files.
- Model behavior and token accounting can vary across compatible providers.

## Tool Execution

- `exec_shell` remains a powerful free-form shell tool. It is intentionally approval-gated unless the user chooses a higher-trust permission mode.
- Structured tools are preferred for cross-platform behavior, but some workflows still depend on local executables such as Git, Node, pnpm, Python, Cargo, `npx`, or MCP server CLIs.
- Long-running commands, nested child processes, and third-party tools that spawn their own windows may behave differently across operating systems.

## MCP

- MCP server setup is local-machine dependent. Servers launched through `npx` or custom commands require those tools to exist on the user's PATH.
- Slow or failing MCP servers can delay tool availability until their connection attempt finishes.
- The advanced MCP editor is intended to reduce JSON hand-editing, but invalid server-specific schemas and environment requirements can still require manual debugging.

## Skills

- Skills are loaded from the configured global skills directory.
- Skill installation and editing flows are still evolving. Avoid storing secrets or project-specific private data in skill files.

## Sandbox and Safety

- A full OS-level sandbox is not enabled by default.
- The current safety model relies on tool classification, approval policy, process boundaries, environment filtering, and user-controlled permission modes.
- The optional sandbox executor is tracked separately and should be completed before advertising strong isolation guarantees.

## Git and Code Changes

- Git diff, lightweight review, and commit-message generation are convenience features, not a replacement for human review.
- Large diffs may still require external review tools for detailed inspection.
- Generated commit messages should be reviewed before use.

## Performance

- Very long conversations, large tool outputs, huge diffs, and large project indexes can still stress UI rendering and memory.
- The app is moving toward more incremental transcript rendering and persistent indexing, but public pre-release users should expect occasional rough edges on large repositories.

## Documentation

- Internal planning documents under `docs/` may describe future work as well as completed work.
- Public-facing docs should be treated as the stable entry point; deeper planning docs may lag implementation details.
