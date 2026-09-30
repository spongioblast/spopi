#!/usr/bin/env node
// ABOUTME: Downloads and verifies the locked LXGW WenKai Lite release.
// ABOUTME: Subsets it to GB2312 + CJK punctuation and installs the WOFF2 into public/fonts.

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { collectGb2312SubsetChars } = require("./cjk-subset.js");

const ROOT = path.resolve(__dirname, "..");
const LOCK_FILE = path.join(__dirname, "cjk-font-version.json");
const CACHE_DIR = path.join(ROOT, ".cache", "cjk-fonts");
const OUT_DIR = path.join(ROOT, "public", "fonts", "cjk");
const VERSION_MARKER = path.join(OUT_DIR, ".version");
const LICENSE_FILE = "OFL.txt";
// A GB2312 subset is ~1.5 MB; anything below this floor is a silently empty
// or broken subset and must not be installed.
const MIN_WOFF2_BYTES = 100_000;

function info(message) {
  console.log(`[fetch-cjk-font] ${message}`);
}

function fail(message) {
  console.error(`[fetch-cjk-font] FAIL: ${message}`);
  process.exit(1);
}

function loadLock() {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch (error) {
    fail(`could not read ${LOCK_FILE}: ${error.message}`);
  }

  if (!/^\d+\.\d+(\.\d+)?$/.test(lock.version || "")) {
    fail(`invalid version in ${LOCK_FILE}`);
  }
  if (lock.sourceFile !== "LXGWWenKaiLite-Regular.ttf") {
    fail(`unexpected sourceFile in ${LOCK_FILE}`);
  }
  if (typeof lock.sourceUrl !== "string" || !/^https:\/\//.test(lock.sourceUrl)) {
    fail(`invalid sourceUrl in ${LOCK_FILE}`);
  }
  if (typeof lock.licenseUrl !== "string" || !/^https:\/\//.test(lock.licenseUrl)) {
    fail(`invalid licenseUrl in ${LOCK_FILE}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(lock.sha256 || "")) {
    fail(`missing sha256 pin in ${LOCK_FILE}`);
  }
  if (lock.subsetSet !== "gb2312") {
    fail(`unsupported subsetSet in ${LOCK_FILE} (only "gb2312" is supported)`);
  }
  if (!Number.isFinite(lock.approxBytes) || lock.approxBytes <= 0) {
    fail(`invalid approxBytes in ${LOCK_FILE}`);
  }
  if (!Number.isSafeInteger(lock.sizeCapBytes) || lock.sizeCapBytes <= 0) {
    fail(`invalid sizeCapBytes in ${LOCK_FILE}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(lock.licenseSha256 || "")) {
    fail(`missing or invalid licenseSha256 pin in ${LOCK_FILE}`);
  }
  if (
    !Array.isArray(lock.outputFiles) ||
    lock.outputFiles.length !== 1 ||
    lock.outputFiles[0] !== "LXGWWenKaiLite-Regular.gb2312.woff2"
  ) {
    fail(`invalid outputFiles in ${LOCK_FILE}`);
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
      { headers: { "User-Agent": "spopi-cjk-font-fetch" } },
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

function replaceDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

async function subsetToWoff2(sourcePath, destinationPath) {
  const { default: subsetFont } = await import("subset-font");
  const ttf = fs.readFileSync(sourcePath);
  const subsetBuffer = await subsetFont(ttf, collectGb2312SubsetChars(), {
    targetFormat: "woff2",
  });
  fs.writeFileSync(destinationPath, subsetBuffer);
}

async function main() {
  const lock = loadLock();
  if (isUpToDate(lock)) {
    info(`already installed v${lock.version}; skipping.`);
    return;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const ttfPath = path.join(CACHE_DIR, `${lock.version}-${lock.sourceFile}`);
  if (fs.existsSync(ttfPath) && sha256Of(ttfPath) !== lock.sha256.toLowerCase()) {
    fs.unlinkSync(ttfPath);
  }
  if (!fs.existsSync(ttfPath)) {
    info(`downloading ${lock.sourceUrl}`);
    await downloadTo(lock.sourceUrl, ttfPath);
  }

  const actualSha = sha256Of(ttfPath);
  if (actualSha !== lock.sha256.toLowerCase()) {
    fs.unlinkSync(ttfPath);
    fail(`sha256 mismatch: expected ${lock.sha256}, got ${actualSha}; cached source removed`);
  }

  const licensePath = path.join(CACHE_DIR, `${lock.version}-OFL.txt`);
  if (fs.existsSync(licensePath) && sha256Of(licensePath) !== lock.licenseSha256.toLowerCase()) {
    fs.unlinkSync(licensePath);
  }
  if (!fs.existsSync(licensePath)) {
    info(`downloading ${lock.licenseUrl}`);
    await downloadTo(lock.licenseUrl, licensePath);
  }
  const actualLicenseSha = sha256Of(licensePath);
  if (actualLicenseSha !== lock.licenseSha256.toLowerCase()) {
    fs.unlinkSync(licensePath);
    fail(
      `license sha256 mismatch: expected ${lock.licenseSha256}, got ${actualLicenseSha}; cached license removed`,
    );
  }
  const licenseText = fs.readFileSync(licensePath, "utf8");
  if (!/SIL OPEN FONT LICENSE/i.test(licenseText) && !/Open Font License/i.test(licenseText)) {
    fail(`license at ${lock.licenseUrl} does not look like the SIL Open Font License`);
  }

  replaceDirectory(OUT_DIR);
  const outputPath = path.join(OUT_DIR, lock.outputFiles[0]);
  await subsetToWoff2(ttfPath, outputPath);
  const sourceBytes = fs.statSync(ttfPath).size;
  const outputBytes = fs.statSync(outputPath).size;
  if (
    outputBytes >= sourceBytes ||
    outputBytes > lock.sizeCapBytes ||
    outputBytes < MIN_WOFF2_BYTES
  ) {
    replaceDirectory(OUT_DIR);
    fail(
      `generated WOFF2 size ${outputBytes} is invalid (source ${sourceBytes}, cap ${lock.sizeCapBytes}, floor ${MIN_WOFF2_BYTES})`,
    );
  }
  info(
    `generated ${lock.outputFiles[0]}: ${outputBytes} bytes (source ${sourceBytes}, cap ${lock.sizeCapBytes})`,
  );

  fs.copyFileSync(licensePath, path.join(OUT_DIR, LICENSE_FILE));
  fs.writeFileSync(VERSION_MARKER, `${lock.version}\n`, "utf8");

  info(`installed LXGW WenKai Lite v${lock.version} (gb2312 subset) -> ${OUT_DIR}`);
}

main().catch((error) => fail(error.stack || error.message || String(error)));
