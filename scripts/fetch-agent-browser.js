#!/usr/bin/env node
// ABOUTME: Downloads the pinned agent-browser binary into src-tauri/resources/agent-browser.
// ABOUTME: The packaged app puts that folder first on Pi's PATH and does not install it with npm.
/**
 * Fetch the platform-specific agent-browser native binary from the
 * vercel-labs/agent-browser GitHub release and place it in
 * `src-tauri/resources/agent-browser/` so the Tauri bundle ships it.
 *
 * Source of truth: `scripts/agent-browser-version.json`. Asset names match
 * the upstream postinstall script:
 *   agent-browser-{darwin|linux|win32}-{x64|arm64}[.exe]
 * Windows ARM uses the win32-x64 asset, as upstream does.
 *
 * `PI_TARGET_PLATFORM` (darwin-arm64, darwin-x64, linux-x64, linux-arm64,
 * windows-x64, windows-arm64) selects the asset, so CI can reuse the Pi
 * matrix field. Output binary is always `agent-browser` or `agent-browser.exe`.
 *
 * Idempotent: exits 0 when `.version` matches and the binary exists.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const VERSION_FILE = path.join(__dirname, "agent-browser-version.json");
const CACHE_DIR = path.join(ROOT, ".cache", "agent-browser-binaries");
const OUT_DIR = path.join(ROOT, "src-tauri", "resources", "agent-browser");
const VERSION_MARKER = path.join(OUT_DIR, ".version");
const GITHUB_REPO = "vercel-labs/agent-browser";

function info(msg) {
  console.log(`[fetch-agent-browser] ${msg}`);
}

function warn(msg) {
  console.warn(`[fetch-agent-browser] WARN: ${msg}`);
}

function fail(msg) {
  console.error(`[fetch-agent-browser] FAIL: ${msg}`);
  process.exit(1);
}

function platformAsset() {
  const platform = process.platform;
  const arch = process.arch;
  const override = process.env.PI_TARGET_PLATFORM;
  let key;
  if (override) {
    key = override;
  } else if (platform === "darwin" && arch === "arm64") {
    key = "darwin-arm64";
  } else if (platform === "darwin" && arch === "x64") {
    key = "darwin-x64";
  } else if (platform === "linux" && arch === "x64") {
    key = "linux-x64";
  } else if (platform === "linux" && arch === "arm64") {
    key = "linux-arm64";
  } else if (platform === "win32" && arch === "x64") {
    key = "windows-x64";
  } else if (platform === "win32" && arch === "arm64") {
    key = "windows-arm64";
  } else {
    fail(
      `Unsupported platform=${platform} arch=${arch}. ` +
        `Set PI_TARGET_PLATFORM to one of: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64.`,
    );
  }

  const assetByKey = {
    "darwin-arm64": { assetName: "agent-browser-darwin-arm64", binaryName: "agent-browser" },
    "darwin-x64": { assetName: "agent-browser-darwin-x64", binaryName: "agent-browser" },
    "linux-x64": { assetName: "agent-browser-linux-x64", binaryName: "agent-browser" },
    "linux-arm64": { assetName: "agent-browser-linux-arm64", binaryName: "agent-browser" },
    "windows-x64": { assetName: "agent-browser-win32-x64.exe", binaryName: "agent-browser.exe" },
    "windows-arm64": { assetName: "agent-browser-win32-x64.exe", binaryName: "agent-browser.exe" },
  };
  const mapped = assetByKey[key];
  if (!mapped) {
    fail(
      `Unsupported PI_TARGET_PLATFORM=${key}. ` +
        `Expected one of: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64.`,
    );
  }
  return { key, ...mapped };
}

function loadLockedVersion() {
  let raw;
  try {
    raw = fs.readFileSync(VERSION_FILE, "utf8");
  } catch (err) {
    fail(`Could not read ${VERSION_FILE}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON in ${VERSION_FILE}: ${err.message}`);
  }
  if (!parsed.version || typeof parsed.version !== "string") {
    fail(`Missing "version" string in ${VERSION_FILE}`);
  }
  return {
    version: parsed.version.trim(),
    sha256: parsed.sha256 && typeof parsed.sha256 === "object" ? parsed.sha256 : {},
  };
}

function isUpToDate(version, binaryName) {
  if (!fs.existsSync(VERSION_MARKER)) return false;
  let current;
  try {
    current = fs.readFileSync(VERSION_MARKER, "utf8").trim();
  } catch {
    return false;
  }
  if (current !== version) return false;
  return fs.existsSync(path.join(OUT_DIR, binaryName));
}

function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const cleanup = (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    };
    const handle = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadTo(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        cleanup(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", cleanup);
    };
    https.get(url, { headers: { "User-Agent": "spopi-fetch" } }, handle).on("error", cleanup);
  });
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function fetchCached(url, dest, label) {
  info(`downloading ${url}`);
  try {
    await downloadTo(url, dest);
  } catch (err) {
    fail(`download failed for ${label}: ${err.message}`);
  }
}

async function main() {
  const { version, sha256 } = loadLockedVersion();
  const asset = platformAsset();

  info(`locked agent-browser version: ${version}`);
  info(`target asset: ${asset.assetName} (${asset.key})`);

  if (isUpToDate(version, asset.binaryName)) {
    info(`already up to date at ${OUT_DIR}; skipping.`);
    return;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachedBinary = path.join(CACHE_DIR, `${version}-${asset.assetName}`);
  const expectedSha = sha256[asset.assetName];

  if (fs.existsSync(cachedBinary) && expectedSha) {
    const actual = sha256OfFile(cachedBinary);
    if (actual !== expectedSha) {
      warn(
        `cached binary checksum mismatch (expected ${expectedSha}, got ${actual}); re-downloading.`,
      );
      fs.unlinkSync(cachedBinary);
    } else {
      info(`using cached binary: ${cachedBinary}`);
    }
  } else if (fs.existsSync(cachedBinary)) {
    info(`using cached binary: ${cachedBinary}`);
  }

  if (!fs.existsSync(cachedBinary)) {
    const url = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${asset.assetName}`;
    await fetchCached(url, cachedBinary, asset.assetName);
  }

  if (expectedSha) {
    const actual = sha256OfFile(cachedBinary);
    if (actual !== expectedSha) {
      try {
        fs.unlinkSync(cachedBinary);
      } catch {}
      fail(
        `sha256 mismatch for ${asset.assetName}: expected ${expectedSha}, got ${actual}. Cached file removed.`,
      );
    }
    info(`sha256 verified.`);
  } else {
    warn(
      `no sha256 pin for ${asset.assetName} in scripts/agent-browser-version.json — skipping checksum verification.`,
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const binPath = path.join(OUT_DIR, asset.binaryName);
  fs.copyFileSync(cachedBinary, binPath);
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(binPath, 0o755);
    } catch {}
  }

  const licensePath = path.join(OUT_DIR, "LICENSE");
  const licenseUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/v${version}/LICENSE`;
  const licenseTmp = path.join(CACHE_DIR, `${version}-LICENSE`);
  if (!fs.existsSync(licenseTmp)) {
    await fetchCached(licenseUrl, licenseTmp, "LICENSE");
  }
  fs.copyFileSync(licenseTmp, licensePath);

  if (process.platform === "darwin") {
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync("codesign", ["--force", "--sign", "-", binPath]);
      info(`codesign: ad-hoc signed ${binPath}`);
    } catch (e) {
      warn(`codesign: could not re-sign ${binPath}: ${e.message}`);
    }
  }

  fs.writeFileSync(VERSION_MARKER, version, "utf8");
  info(`installed agent-browser ${version} -> ${binPath}`);
}

main().catch((err) => {
  fail(`unexpected error: ${err.stack || err.message || err}`);
});
