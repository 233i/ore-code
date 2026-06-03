# Troubleshooting

Use this guide before opening a GitHub issue. Ore Code is pre-release software, so many failures are caused by local toolchain, provider, MCP, or workspace configuration rather than a single app bug.

## Quick Checks

1. Confirm the current repository state:

   ```bash
   pnpm --filter @ore-code/desktop typecheck
   pnpm --filter @ore-code/desktop test
   pnpm --filter @ore-code/desktop lint
   ```

2. Confirm local runtime paths:

   - Skills: `~/.ore-code/skills`
   - MCP config: `~/.ore-code/mcp.json`
   - DeepSeek config: `~/.ore-code/config.toml`
   - Project-local runtime data: `.ore-code/`

3. Check [Known Limitations](./KNOWN_LIMITATIONS.md) and [Local Data and Configuration](./LOCAL_DATA_AND_CONFIG.md).

## Install or Startup Problems

- Use Node.js 20+; Node 22 is the pinned development and CI version.
- Use pnpm 11.x. If pnpm is missing, enable Corepack or install the pinned pnpm version.
- Run `pnpm install` from the repository root before starting the desktop app.
- For Tauri startup failures, confirm Rust stable and Tauri 2 system prerequisites for your OS.
- On Windows, run the app from a terminal once to capture logs if the window closes immediately.

## Provider and Model Problems

- Confirm provider settings are present and do not contain placeholder values.
- Store API keys through the app's secure storage flow where supported.
- For DeepSeek-compatible providers, verify the base URL, model name, and API key outside the app if possible.
- If a model response appears truncated, check the context usage panel and current model capacity.

## Workspace Problems

- Select a real project directory before asking the agent to inspect or modify files.
- If paths look wrong on Windows, include the drive-letter path in a bug report after redacting private directory names.
- If Git diff or code changes are empty, confirm the selected workspace is inside a Git repository.
- Project-local `.ore-code/` data is ignored by Git and can be regenerated if indexing state becomes stale.

## Tool Execution Problems

- Prefer structured tools such as file read/search, Git diff, and run tests over free-form shell commands.
- If `run_tests`, diagnostics, or code execution cannot find a program, confirm `git`, `node`, `pnpm`, `python` or `py`, `cargo`, and `npx` are on PATH.
- On Windows, built-in tools should resolve `.cmd` shims such as `pnpm.cmd` and `npx.cmd`; report the exact command and PATH details if resolution fails.
- Shell commands can still behave differently across macOS and Windows. Include the OS and shell when reporting shell-specific issues.

## MCP Problems

- Confirm `~/.ore-code/mcp.json` exists and contains the expected server entry.
- Confirm the server command works outside Ore Code, especially `npx`-launched servers.
- Slow MCP startup can delay tool availability. Reconnect one server at a time when debugging.
- If a tool schema or argument error appears, include the server name, tool name, redacted input JSON, and error text.
- Do not paste MCP tokens or private environment variables into public issues.

## Skills Problems

- Skills load from the global skills directory, `~/.ore-code/skills`.
- A skill directory should contain a `SKILL.md` file.
- If a skill disappears after refresh, confirm the file still exists under the global skills directory and is not disabled by its metadata.
- Avoid putting secrets or project-private data in skill files.

## Performance Problems

- Long conversations, large tool outputs, huge diffs, and large project indexes can increase UI rendering and memory use.
- Include project size, conversation length, OS, app version or commit, and the action that triggered the slowdown.
- For startup slowness, mention whether the left sidebar history, project index, MCP reconnect, or skills scan appears to be the slow part.
- Prefer screenshots of summary panels over full logs when reporting performance issues.

## Packaging Problems

- Build macOS artifacts on macOS and Windows artifacts on Windows.
- Current macOS pre-release artifacts are unsigned and not notarized. If macOS blocks the app, Control-click or right-click `Ore Code.app`, choose **Open**, and confirm **Open** again. If needed, use **System Settings > Privacy & Security > Open Anyway**.
- Do not treat a macOS-only build as proof that Windows packaging works.
- For Windows installer reports, include Windows version, build command, artifact name, and smoke-test result.

## When Opening an Issue

Include:

- OS and version.
- Ore Code version or commit.
- Workspace type and size.
- Provider and model name, without API keys.
- Relevant tool, MCP, or skill names.
- Minimal reproduction steps.
- Redacted logs or screenshots.

Do not include API keys, tokens, private source code, private local paths, or full tool output unless a maintainer explicitly requests a redacted excerpt.
