Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

pnpm install --frozen-lockfile
pnpm --filter @ore-code/desktop typecheck
pnpm --filter @ore-code/desktop test
pnpm --filter @ore-code/desktop lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @ore-code/desktop tauri:build:win

Write-Host ""
Write-Host "Windows installer artifacts:"
Get-ChildItem "apps/desktop/src-tauri/target/release/bundle" -Recurse -Include "*.exe","*.msi" |
  ForEach-Object { Write-Host $_.FullName }
