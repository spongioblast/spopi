#!/usr/bin/env node
// ABOUTME: Downloads and verifies the locked FiraCode Nerd Font Mono release.
// ABOUTME: Extracts only SPOPI's terminal font assets and license into public/fonts.

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const LOCK_FILE = path.join(__dirname, "terminal-font-version.json");
const CACHE_DIR = path.join(ROOT, ".cache", "terminal-fonts");
const OUT_DIR = path.join(ROOT, "public", "fonts", "terminal");
const VERSION_MARKER = path.join(OUT_DIR, ".version");
const LICENSE_FILE = "LICENSE";

function info(message) {
  console.log(`[fetch-terminal-font] ${message}`);
}

function fail(message) {
  console.error(`[fetch-terminal-font] FAIL: ${message}`);
  process.exit(1);
}

function loadLock() {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch (error) {
    fail(`could not read ${LOCK_FILE}: ${error.message}`);
  }

  if (!/^\d+\.\d+\.\d+$/.test(lock.version || "")) {
    fail(`invalid version in ${LOCK_FILE}`);
  }
  if (lock.archiveName !== "FiraCode.zip") {
    fail(`unexpected archiveName in ${LOCK_FILE}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(lock.sha256 || "")) {
    fail(`missing sha256 pin in ${LOCK_FILE}`);
  }
  if (!Array.isArray(lock.fontFiles) || lock.fontFiles.length === 0) {
    fail(`missing fontFiles in ${LOCK_FILE}`);
  }
  if (
    !Array.isArray(lock.outputFiles) ||
    lock.outputFiles.length !== lock.fontFiles.length ||
    lock.outputFiles.some((name) => !name.endsWith(".woff2"))
  ) {
    fail(`missing or invalid outputFiles in ${LOCK_FILE}`);
  }
  return lock;
}

function sha256Of(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function isUpToDate(lock) {
  try {
    if (fs.readFileSync(VERSION_MARKER, "utf8").trim() !== lock.version) return false;
  } catch {
    return false;
  }
  return lock.outputFiles
    .concat(LICENSE_FILE)
    .every((name) => fs.existsSync(path.join(OUT_DIR, name)));
}

function downloadTo(url, destination) {
  return new Promise((resolve, reject) => {
    let file = null;
    const cleanup = (error) => {
      file?.close();
      fs.unlink(destination, () => {});
      reject(error);
    };
    const request = https.get(
      url,
      { headers: { "User-Agent": "spopi-terminal-font-fetch" } },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          downloadTo(response.headers.location, destination).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          cleanup(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", cleanup);
      },
    );
    request.on("error", cleanup);
  });
}

function extractArchive(archivePath, destination) {
  const command = process.platform === "win32" ? "tar" : "unzip";
  const args =
    process.platform === "win32"
      ? ["-xf", archivePath, "-C", destination]
      : ["-q", "-o", archivePath, "-d", destination];
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status === 0) return;
  fail(`zip extraction failed with ${command} (exit ${result.status ?? "unknown"})`);
}

function findFile(root, filename) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === filename) return candidate;
    if (entry.isDirectory()) {
      const found = findFile(candidate, filename);
      if (found) return found;
    }
  }
  return null;
}

function replaceDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

async function convertToWoff2(sourcePath, destinationPath) {
  const { default: convert } = await import("ttf2woff2");
  const converted = convert(fs.readFileSync(sourcePath));
  fs.writeFileSync(destinationPath, converted);
}

async function main() {
  const lock = loadLock();
  if (isUpToDate(lock)) {
    info(`already installed v${lock.version}; skipping.`);
    return;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const archivePath = path.join(CACHE_DIR, `${lock.version}-${lock.archiveName}`);
  if (fs.existsSync(archivePath) && sha256Of(archivePath) !== lock.sha256.toLowerCase()) {
    fs.unlinkSync(archivePath);
  }
  if (!fs.existsSync(archivePath)) {
    const url = `https://github.com/ryanoasis/nerd-fonts/releases/download/v${lock.version}/${lock.archiveName}`;
    info(`downloading ${url}`);
    await downloadTo(url, archivePath);
  }

  const actualSha = sha256Of(archivePath);
  if (actualSha !== lock.sha256.toLowerCase()) {
    fs.unlinkSync(archivePath);
    fail(`sha256 mismatch: expected ${lock.sha256}, got ${actualSha}; cached archive removed`);
  }

  const extractDir = fs.mkdtempSync(path.join(CACHE_DIR, "extract-"));
  try {
    extractArchive(archivePath, extractDir);
    replaceDirectory(OUT_DIR);
    for (let index = 0; index < lock.fontFiles.length; index += 1) {
      const fontFile = lock.fontFiles[index];
      const outputFile = lock.outputFiles[index];
      const source = findFile(extractDir, fontFile);
      if (!source) fail(`release archive is missing ${fontFile}`);
      await convertToWoff2(source, path.join(OUT_DIR, outputFile));
    }
    const license = findFile(extractDir, LICENSE_FILE);
    if (!license) fail(`release archive is missing ${LICENSE_FILE}`);
    fs.copyFileSync(license, path.join(OUT_DIR, LICENSE_FILE));
    fs.writeFileSync(VERSION_MARKER, `${lock.version}\n`, "utf8");
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  info(`installed FiraCode Nerd Font Mono v${lock.version} -> ${OUT_DIR}`);
}

main().catch((error) => fail(error.stack || error.message || String(error)));
