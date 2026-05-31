# Security Policy

SeekForge is pre-release software. Security issues should be handled privately until a fix is available.

## Reporting a Vulnerability

Do not open a public GitHub issue for vulnerabilities, leaked secrets, approval bypasses, or sandbox/process isolation problems.

Until a dedicated security contact is published, report issues privately to the repository owner with:

- A short summary of the issue.
- Affected OS and SeekForge version or commit.
- Reproduction steps.
- Expected and actual behavior.
- Any relevant logs with secrets removed.

## Response Expectations

SeekForge is maintained as pre-release software, so there is no guaranteed response SLA yet. Maintainers will review private reports as capacity allows, ask for clarifying reproduction details when needed, and avoid publishing sensitive details until a mitigation or disclosure decision is ready.

## Sensitive Areas

Please be especially careful around:

- Shell, process, and test execution.
- Tool approval and session approval cache behavior.
- MCP server configuration and stdio process launch.
- File read/write boundaries.
- Git operations and restore behavior.
- API key storage and provider configuration.
- Project indexing, artifact storage, and transcript/session persistence.

## Supported Versions

SeekForge has not published a stable release line yet. Security fixes target the current main development branch unless a release branch is created later.
