# Pi bump

SPOPI bundles one Pi release, pinned in `scripts/pi-version.json`. A bump is done by hand, after reading what changed. The daily `update-pi-version.yml` workflow only opens an issue, "Pi vX available", with the release notes.

1. **Read the notes** of every release since the pinned one (`https://github.com/earendil-works/pi/releases`). Look for changes to RPC mode, the session format, `pi list`, `pi mcp list --json`, `models.json` keys, and the extension events the bundled extensions use (below). Note anything SPOPI should show, and anything that makes SPOPI code unnecessary.
2. **Run `bun run bump:pi <version>`.** It reads the release's `SHA256SUMS` and writes `version` and the six archive hashes into `pi-version.json`, sets the `@earendil-works/pi-coding-agent` devDependency (types only) to the same version, then runs `bun install`, `fetch:pi`, `build:extensions`, `smoke:pi-rpc --update` (which rewrites `tests/fixtures/pi-rpc/contract.json`), and `scripts/testing/make-session-fixtures.mjs`. It commits nothing.
3. **Review `git diff tests/fixtures`.** With no RPC change, `contract.json` differs only in `version`. Any other difference is a contract change to handle in the host or the UI.
4. **Recheck the hand-captured fixtures** against the new Pi. They are real command output with local paths replaced by `C:\Users\me\...`:
   - `tests/fixtures/pi-cli/list.txt`: `pi list` (there is no JSON form).
   - `tests/fixtures/pi-cli/mcp-list-mixed.json` and `mcp-list-empty.json`: `pi mcp list --json` from a scratch `PI_CODING_AGENT_DIR`. The mixed list has a connected, a failed, a needs-auth, and a disabled server, one config error, and one project override (a project entry in a trusted project; `pi mcp list` reads trust from the agent folder's `trust.json`).
   - `tests/fixtures/pi-sessions/codemode-nested.jsonl`: a session where a codemode script calls tools.
5. **Bundled extensions.** `spopi-bridge`, `pi-permission-system`, `spopi-verify`, and `spopi-tool-output` run inside Pi. `spopi-verify` depends on the `agent_before_settle` boundary and `createLocalBashOperations`. `spopi-tool-output` depends on `tool_result` details, `turn_end` `toolResultEntryIds`, the `context_edit` replacement shape (`{ content }`), and the shell tools' `details.fullOutputPath`. Run the package_health op against the new Pi: a package is loaded, failed, or registered-nothing from sourceInfo, and the Update Pi hint is only for failed.
6. **Smokes**, not in CI: `bun run smoke:mcp` (the echo fixture through `pi mcp add`, `list`, and `remove`) and `bun run smoke:stream` (including the `TOOL:long` step).
7. **Checks:** `bun run check`, `bun run test`, `bun run check:rust`, and `cargo +stable clippy --all-targets -- -D warnings` in `src-tauri/`.
8. **RPC gaps.** Recheck whether `setFooter`, `setHeader`, `setWorkingMessage`, and `custom()` work over RPC. Until they do, SPOPI badges `setFooter` and `setHeader` through `host-ui-capabilities.ts` and does not render those TUI factories.
9. Update the Pi version in `ARCHITECTURE.md`, `docs/FEATURES.md` (Updates, app data, and environment), and the release's `CHANGELOG.md` section. Close the "Pi vX available" issue with the release.

## Updater key

Installed copies trust only the public key in `src-tauri/tauri.conf.json` `plugins.updater.pubkey` (minisign key id `FD56145172E0CA4E`). The private key never enters the repo. It lives with the maintainer as `~/.tauri/spopi.key`, with its password, and in two GitHub Actions secrets that `release.yml` reads:

- `TAURI_SIGNING_PRIVATE_KEY`: the content of `spopi.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password

A build without both fails at the updater artifacts step, because `bundle.createUpdaterArtifacts` is on. For a local `bun run build`, set the same two variables in the shell.

Losing the private key means installed copies can no longer update. Replacing it (`bunx tauri signer generate -w ~/.tauri/spopi.key`, then the new public key in `tauri.conf.json`) only reaches users who install the next release by hand.
