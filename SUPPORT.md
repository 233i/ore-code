# Support

SeekForge is pre-release software. Please use GitHub issues for reproducible bugs, focused feature requests, documentation problems, performance reports, and setup questions.

## Before Opening an Issue

- Search existing issues first.
- Check [FAQ](./docs/FAQ.md) for common setup, platform, local data, MCP, skills, and public launch questions.
- Check [Known Limitations](./docs/KNOWN_LIMITATIONS.md).
- Check [Troubleshooting](./docs/TROUBLESHOOTING.md) for setup, provider, workspace, tools, MCP, skills, performance, and packaging checks.
- Check [Local Data and Configuration](./docs/LOCAL_DATA_AND_CONFIG.md) before sharing logs or screenshots that may include private paths or runtime data.
- Confirm whether the problem is platform-specific.
- Remove API keys, tokens, local paths that should remain private, and private project data from logs or screenshots.

## Where to Ask

- Bugs: open a bug report with reproduction steps.
- Feature requests: open a feature request that describes the workflow pain and expected behavior.
- Performance issues: open a performance report with the affected scenario, project/session scale, OS, version, and measurements.
- Usage or setup questions: open a question/support issue with the closest area selected.
- Security issues: follow [SECURITY.md](./SECURITY.md) and do not open a public issue.

## Useful Debug Information

Include what is relevant:

- OS and version.
- SeekForge version or commit.
- Install or launch method, such as DMG, Windows installer, `pnpm dev`, source build, or GitHub Actions artifact.
- Minimal reproduction link, redacted fixture, or smallest project shape that reproduces the issue.
- Model/provider being used.
- Workspace type, such as Node, Rust, Python, or mixed.
- Whether the issue involves shell/process tools, MCP, skills, Git changes, packaging, or long conversations.
- Screenshots for UI problems, with private data removed.

## Current Support Scope

Primary support targets:

- macOS desktop development and packaging.
- Windows desktop development and packaging.
- DeepSeek-compatible provider workflows.
- Local MCP and skill workflows.

Linux desktop packaging is not a primary support target yet.
