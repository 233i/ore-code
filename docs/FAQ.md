# FAQ

This page answers common questions for people evaluating or contributing to Ore Code.

## Is Ore Code Open Source Yet?

Yes. Ore Code is released under the MIT License. See the root [LICENSE](../LICENSE) file for the full license text.

## Which Platforms Are Supported?

The primary desktop targets are macOS and Windows.

- macOS development and local packaging are supported.
- Windows support is a target, but Windows installer builds should be verified on Windows before sharing binaries.
- Linux packaging is not a primary release target yet.

See [Known Limitations](./KNOWN_LIMITATIONS.md).

## What Does DeepSeek-First Mean?

Ore Code is designed around DeepSeek coding workflows: long context, model-aware capacity budgets, structured tools, prompt/cache stability, and DeepSeek-compatible provider configuration.

Other OpenAI-compatible providers may work where configuration supports them, but the primary optimization target is DeepSeek.

## Do I Need an API Key?

Yes, real model use requires a compatible provider configuration and API key. The desktop app should store provider keys through the secure storage flow where supported.

Local DeepSeek-style configuration can also live in `~/.ore-code/config.toml`. Do not commit API keys or provider secrets to the repository.

## Where Does Ore Code Store Local Data?

Ore Code uses user-level and project-level runtime data:

- `~/.ore-code/skills`
- `~/.ore-code/mcp.json`
- `~/.ore-code/config.toml`
- project-local `.ore-code/` data for runtime state

Project-local `.ore-code/` data is ignored by Git. See [Local Data and Configuration](./LOCAL_DATA_AND_CONFIG.md) for reset and privacy guidance.

## Does Ore Code Install Dependencies Automatically?

Ore Code may detect missing tools or project dependency signals, but it should not silently install system tools or project dependencies.

System-level installs, project dependency installs, and commands that may access the network should be shown to the user and confirmed before execution.

## Is Tool Execution Sandboxed?

Ore Code has tool approval and command-risk controls, but early releases should not claim full sandbox isolation. Optional sandbox execution is planned with quiet defaults and boundary prompts.

Use [Known Limitations](./KNOWN_LIMITATIONS.md) and [Security](../SECURITY.md) as the current source of truth for safety boundaries.

## How Do MCP Servers Work?

MCP server configuration is stored in `~/.ore-code/mcp.json`. The desktop UI provides MCP management flows, but server command availability still depends on local tools such as `node`, `npx`, or the configured executable.

If MCP setup fails, check [Troubleshooting](./TROUBLESHOOTING.md) and avoid sharing logs that contain API keys, tokens, private file paths, or workspace data.

## How Do Skills Work?

Skills are local instructions stored under `~/.ore-code/skills`. A skill appears in the Skills page when it contains a valid `SKILL.md`.

Install shared skills into the global skill directory unless a workflow explicitly requires project-local behavior. See [Skill System](./06-skill-system.md).

## What Should I Run Before Opening a Pull Request?

For broad changes, run:

```bash
pnpm ci:local
```

For focused desktop changes, run:

```bash
pnpm --filter @ore-code/desktop typecheck
pnpm --filter @ore-code/desktop test
pnpm --filter @ore-code/desktop lint
git diff --check
```

See [Contributing](../CONTRIBUTING.md) for package-specific checks and higher-risk areas.

## What Is Still Needed Before Publishing Binaries?

Before publishing downloadable installers:

- Build and smoke-test platform installers on the matching OS.
- Keep known limitations visible in the README and docs.

See [Roadmap](./ROADMAP.md).

## Where Should I Ask Questions?

After the repository is public, use GitHub issues for usage and setup questions. For private vulnerabilities, follow [Security](../SECURITY.md) instead of opening a public issue.

See [Support](../SUPPORT.md) for routing guidance.
