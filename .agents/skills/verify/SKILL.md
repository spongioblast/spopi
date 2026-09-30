---
name: verify
description: How to build, check, test, run, and look at SPOPI. Read before checking your work in this repo.
---

# Verify SPOPI

## Setup
- `bun install --frozen-lockfile` when `node_modules/` is missing. Never `npm install`.
- `bun run fetch:pi` when `src-tauri/resources/pi/` is missing.

## Fast check (after every change)
- `bun run check` (about 5 s): Biome, types, design tokens, locales, ABOUTME lines, and the other product checks.
- `bun run check:fix` applies the safe Biome and token fixes.
- After an edit under `src-tauri/`: `bun run check:rust` (cargo check, clippy, tests). It takes minutes.

## Tests
- One file: `bun run vitest run public/app/packages/packages-page.test.js`
- All: `bun run test` (about 10 s)

## Run (to look at the UI)
The user's own SPOPI may be running on 57620 with real data. Never touch that port, `%APPDATA%\spopi`, or `~/.pi/agent`.

```bash
bun run build:extensions
cargo build --manifest-path src-tauri/Cargo.toml
mkdir -p .pi/tmp/host && (SPOPI_APP_DATA_DIR="$PWD/.pi/tmp/host/appdata" PI_CODING_AGENT_DIR="$PWD/.pi/tmp/host/pi-agent" SPOPI_HOST_PORT=57690 src-tauri/target/debug/spopi.exe > .pi/tmp/host/run.log 2>&1 & echo $! > .pi/tmp/host/run.pid)
```

- Ready when `curl -sf http://127.0.0.1:57690/health` answers with `"appDataScratch":true`. A SPOPI window opens as well.
- Stop the whole tree (host, WebView2, Pi): `taskkill //PID "$(cat /proc/$(cat .pi/tmp/host/run.pid)/winpid)" //T //F`

## Look
- Open `http://127.0.0.1:57690/` with the browser-check skill. The empty scratch profile shows the Projects sidebar, "Welcome to SPOPI", and a disabled composer.
- The scratch profile has no models, so a chat turn will not run. Layout, settings, and panels can be checked.

## Known problems
- "Could not find <name>.mjs extension": `src-tauri/target/debug/spopi.exe` is older than the source. Rebuild it. If `CARGO_TARGET_DIR` is set, cargo writes elsewhere and the old binary stays; unset it for this build.
