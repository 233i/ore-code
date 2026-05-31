Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

pnpm install --frozen-lockfile
pnpm --filter @seekforge/desktop typecheck
pnpm --filter @seekforge/desktop test
pnpm --filter @seekforge/desktop lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @seekforge/desktop tauri:build:win

Write-Host ""
Write-Host "Windows installer artifacts:"
Get-ChildItem "apps/desktop/src-tauri/target/release/bundle" -Recurse -Include "*.exe","*.msi" |
  ForEach-Object { Write-Host $_.FullName }
