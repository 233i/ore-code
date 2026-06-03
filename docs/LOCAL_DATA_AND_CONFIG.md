# Local Data and Configuration

Ore Code stores runtime data outside the repository. Keep these paths out of Git, release artifacts, issue screenshots, and logs unless a maintainer explicitly asks for a redacted excerpt.

## User-Level Data

User-level data lives in the user's home directory:

| Path | Purpose | Commit to Git? |
| --- | --- | --- |
| `~/.ore-code/skills` | Global skill definitions loaded by the Skills page. | No |
| `~/.ore-code/mcp.json` | Local MCP server configuration. | No |
| `~/.ore-code/config.toml` | DeepSeek-compatible provider configuration. | No |

These files may contain local paths, MCP command details, or provider-specific settings. Treat them as user-private configuration.

## App Data

The desktop app also uses the operating system app-data directory for settings, sessions, artifacts, notes, and runtime indexes. The exact path is OS-specific and should be treated as private user data.

Do not copy app-data files into the repository. If a bug needs session or artifact evidence, share the smallest redacted excerpt that reproduces the issue.

## Project-Local Data

Project-local runtime data under `.ore-code/` is ignored by Git by default. It may include generated indexes, cached metadata, and temporary agent state.

If a project intentionally wants to version an example config, use a clearly named sample file such as `ore-code.example.json` instead of committing real runtime data.

## Secrets and Provider Credentials

- Store API keys through the app's secure storage flow where supported.
- Do not commit provider API keys, MCP tokens, shell history, `.env` files, or private project logs.
- Before opening a public issue, remove local absolute paths that reveal private directory names unless the path itself is necessary to reproduce the bug.

## Reset and Backup

For troubleshooting, back up or remove only the specific path related to the issue:

- Skills issue: inspect `~/.ore-code/skills`.
- MCP issue: inspect `~/.ore-code/mcp.json`.
- Provider config issue: inspect `~/.ore-code/config.toml` and secure storage state.
- Session or artifact issue: inspect the OS app-data directory.

Avoid deleting all local data unless you have exported any skills, MCP settings, or session evidence you need to keep.

## Public Reporting Checklist

Before attaching logs or screenshots to GitHub:

- Remove API keys, tokens, and provider secrets.
- Remove private project source code unless the issue requires a minimal reproduction.
- Remove private local paths when they are not relevant.
- Summarize large tool output instead of pasting full logs.
- Mention the OS and Ore Code version or commit.
