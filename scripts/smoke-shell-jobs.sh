#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

pnpm --filter @ore-code/protocol build
pnpm --filter @ore-code/tools build
pnpm --filter @ore-code/agent-core build
pnpm --filter @ore-code/harness exec vitest run src/scenario.test.ts -t "background shell job"

cargo test shell_job --manifest-path "$ROOT_DIR/apps/desktop/src-tauri/Cargo.toml"
