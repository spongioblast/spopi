#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$ROOT_DIR/target/release/bundle/dmg"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS."
  exit 1
fi

cd "$ROOT_DIR"

echo "Fetching embedded pi binary (idempotent if version matches)..."
bun run "$ROOT_DIR/scripts/fetch-pi-binary.js"
echo "Fetching bundled terminal font..."
bun run "$ROOT_DIR/scripts/fetch-terminal-font.js"
echo "Fetching bundled CJK font..."
bun run "$ROOT_DIR/scripts/fetch-cjk-font.js"
echo "Building extensions bundle..."
bun run "$ROOT_DIR/scripts/build-extensions.js"

echo "Building macOS DMG via Tauri (standard bundler path)..."
PATH="$HOME/.cargo/bin:$PATH" tauri build --bundles dmg

DMG_PATH="$(ls -t "$BUNDLE_DIR"/*.dmg | head -n 1)"
if [[ -z "${DMG_PATH:-}" ]]; then
  echo "No DMG produced under $BUNDLE_DIR"
  exit 1
fi

echo "Done! DMG is at: $DMG_PATH"
