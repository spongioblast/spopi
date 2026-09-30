#!/usr/bin/env bash
#
# Signs the Mach-O binaries embedded under src-tauri/resources/pi/ (the pi
# runtime binary + its native .node addons) and src-tauri/resources/agent-browser/
# with a Developer ID identity.
#
# Tauri's macOS bundler code-signs the .app bundle itself but does not
# deep-sign arbitrary files copied in via tauri.conf.json's `bundle.resources`
# map. Apple's notary service rejects any Mach-O inside the bundle that
# lacks its own Developer ID signature + hardened runtime + secure
# timestamp, so these need to be signed individually before the outer .app
# gets bundled and signed. Signing the outer .app afterwards does not
# disturb signatures already present on nested files.
#
# Runs as part of tauri.conf.json's beforeBuildCommand, which fires before
# Rust even compiles. Locally, with APPLE_SIGNING_IDENTITY exported, the
# identity is already in the developer's login keychain, so codesign just
# finds it. In CI (.github/workflows/release.yml), Tauri's own
# bundler only imports APPLE_CERTIFICATE into a keychain right before it
# signs the .app at the very end of the build — long after this hook runs —
# so the identity isn't in any keychain yet. When that's the case and
# APPLE_CERTIFICATE is set, import it into a temporary keychain ourselves.
#
# No-op when APPLE_SIGNING_IDENTITY is unset or ad-hoc ("-"), since ad-hoc
# builds are never notarized and there's nothing to fix.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "$IDENTITY" ] || [ "$IDENTITY" = "-" ]; then
    exit 0
fi

PI_DIR="$PROJECT_ROOT/src-tauri/resources/pi"
AB_DIR="$PROJECT_ROOT/src-tauri/resources/agent-browser"
if [ ! -d "$PI_DIR" ] && [ ! -d "$AB_DIR" ]; then
    exit 0
fi

# APPLE_SIGNING_IDENTITY is set for the whole non-Linux CI matrix (both
# macOS and Windows), but codesign/security are macOS-only tools. On other
# platforms there's nothing to sign here, so fall through to the no-op scan
# below instead of trying to run "security".
if [ "$(uname)" = "Darwin" ] && ! security find-identity -v -p codesigning | grep -qF "$IDENTITY"; then
    if [ -z "${APPLE_CERTIFICATE:-}" ]; then
        echo "[sign-pi-resources] ERROR: identity '$IDENTITY' not found in any keychain, and APPLE_CERTIFICATE is not set to import it" >&2
        exit 1
    fi

    echo "[sign-pi-resources] Identity not in any keychain yet; importing APPLE_CERTIFICATE into a temporary keychain"

    TMP_DIR="${RUNNER_TEMP:-$(mktemp -d)}"
    KEYCHAIN_PATH="$TMP_DIR/sign-pi-resources.keychain-db"
    KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
    CERT_PATH="$TMP_DIR/sign-pi-resources-cert.p12"

    echo "$APPLE_CERTIFICATE" | base64 --decode >"$CERT_PATH"
    security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security import "$CERT_PATH" -k "$KEYCHAIN_PATH" -P "${APPLE_CERTIFICATE_PASSWORD:-}" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security list-keychains -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | sed 's/"//g')
    rm -f "$CERT_PATH"
fi

echo "[sign-pi-resources] Signing embedded native binaries with: $IDENTITY"

signed_any=0
for dir in "$PI_DIR" "$AB_DIR"; do
    if [ ! -d "$dir" ]; then
        continue
    fi
    while IFS= read -r -d '' f; do
        if file "$f" | grep -q "Mach-O"; then
            codesign --force --options runtime --timestamp --sign "$IDENTITY" "$f"
            signed_any=1
        fi
    done < <(find "$dir" -type f -print0)
done

if [ "$signed_any" = "0" ]; then
    echo "[sign-pi-resources] WARN: no Mach-O binaries found under $PI_DIR or $AB_DIR"
fi
