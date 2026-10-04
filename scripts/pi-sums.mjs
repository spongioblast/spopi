// ABOUTME: Reads a Pi release's SHA256SUMS into the per-archive pins of pi-version.json.
// ABOUTME: Fails unless all six platform archives SPOPI bundles are listed with a sha256.

export const PI_ARCHIVES = [
  "pi-darwin-arm64.tar.gz",
  "pi-darwin-x64.tar.gz",
  "pi-linux-arm64.tar.gz",
  "pi-linux-x64.tar.gz",
  "pi-windows-arm64.zip",
  "pi-windows-x64.zip",
];

/**
 * @param {string} text `sha256sum` output: `<hex>  <file>` per line, `*` before binary files.
 * @returns {Record<string, string>} archive name to lowercase sha256, in PI_ARCHIVES order.
 */
export function parsePiSums(text) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line);
    if (match) found.set(match[2], match[1].toLowerCase());
  }
  const missing = PI_ARCHIVES.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`SHA256SUMS does not list ${missing.join(", ")}`);
  }
  return Object.fromEntries(
    PI_ARCHIVES.map((name) => [name, /** @type {string} */ (found.get(name))]),
  );
}

/**
 * @param {string} raw `1.0.2` or `v1.0.2`
 * @returns {string}
 */
export function normalizePiVersion(raw) {
  const version = String(raw ?? "")
    .trim()
    .replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Not a Pi release version: ${raw}`);
  }
  return version;
}

/**
 * Sets the exact version of the Pi types package without reformatting package.json.
 * @param {string} packageJson
 * @param {string} version
 */
export function pinPiDevDependency(packageJson, version) {
  const pattern = /("@earendil-works\/pi-coding-agent":\s*")[^"]*(")/;
  if (!pattern.test(packageJson)) {
    throw new Error("package.json has no @earendil-works/pi-coding-agent dependency");
  }
  return packageJson.replace(pattern, `$1${version}$2`);
}
