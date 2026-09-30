# Pi bump cadence

When a new Pi release should land in SPOPI:

1. Run the package_health op against the new Pi. A package is loaded, failed, or registered-nothing from sourceInfo. The Update Pi hint is only for failed. Those packages are recommended, not bundled. Bundled extensions are `spopi-bridge`, `pi-permission-system`, `spopi-verify`, and `spopi-tool-output`. `spopi-verify` depends on the `agent_before_settle` boundary and `createLocalBashOperations`. `spopi-tool-output` depends on `tool_result` details, `turn_end` `toolResultEntryIds`, the `context_edit` replacement shape (`{ content }`), and the shell tools' `details.fullOutputPath`. Rerun their tests and `bun run smoke:stream` (the `TOOL:long` step) after a bump.
2. Bump `scripts/pi-version.json` and the `@earendil-works/pi-coding-agent` devDependency.
3. `bun run fetch:pi`
4. `bun run build:extensions`
5. `bun run smoke:pi-rpc`
6. Read the Pi changelog for RPC and session-format changes.
7. Run `bun run check`, `bun run test`, and `bun run check:rust`.
8. Re-check `pi-server` / `pi-client` status and whether `setFooter`, `setHeader`, `setWorkingMessage`, and `custom()` over RPC were fixed upstream. Until they are, SPOPI badges `setFooter` and `setHeader` through `host-ui-capabilities.ts` and does not render those TUI factories.
9. `bun run smoke:pi-rpc -- --update` refreshes `tests/fixtures/pi-rpc/<version>/contract.json`. `scripts/testing/make-session-fixtures.mjs` refreshes the session fixtures.

## Updater key

Installed copies trust only the public key in `src-tauri/tauri.conf.json` `plugins.updater.pubkey` (minisign key id `FD56145172E0CA4E`). The private key never enters the repo. It lives with the maintainer as `~/.tauri/spopi.key`, with its password, and in two GitHub Actions secrets that `release.yml` reads:

- `TAURI_SIGNING_PRIVATE_KEY`: the content of `spopi.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password

A build without both fails at the updater artifacts step, because `bundle.createUpdaterArtifacts` is on. For a local `bun run build`, set the same two variables in the shell.

Losing the private key means installed copies can no longer update. Replacing it (`bunx tauri signer generate -w ~/.tauri/spopi.key`, then the new public key in `tauri.conf.json`) only reaches users who install the next release by hand.
