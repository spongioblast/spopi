// ABOUTME: Maps Tauri's release file names to `SPOPI_<version>_<os>_<arch>` names.
// ABOUTME: One arch spelling everywhere: x64 and arm64.

const ARCH = { x64: "x64", amd64: "x64", x86_64: "x64", arm64: "arm64", aarch64: "arm64" };

const RULES = [
  // SPOPI_0.7.0_x64-setup.exe -> SPOPI_0.7.0_win_x64-setup.exe
  { os: "win", pattern: /^(.+?)_(\d[^_]*)_(x64|arm64)-setup\.exe$/, suffix: "-setup.exe" },
  // SPOPI_0.7.0_aarch64.dmg -> SPOPI_0.7.0_mac_arm64.dmg
  { os: "mac", pattern: /^(.+?)_(\d[^_]*)_(x64|aarch64)\.dmg$/, suffix: ".dmg" },
  // SPOPI_aarch64.app.tar.gz -> SPOPI_0.7.0_mac_arm64.app.tar.gz (updater archive)
  {
    os: "mac",
    pattern: /^(.+?)_(x64|aarch64)\.app\.tar\.gz$/,
    suffix: ".app.tar.gz",
    noVersion: true,
  },
  // SPOPI_0.7.0_amd64.AppImage -> SPOPI_0.7.0_linux_x64.AppImage
  { os: "linux", pattern: /^(.+?)_(\d[^_]*)_(amd64|aarch64)\.AppImage$/, suffix: ".AppImage" },
];

/** New name for a release file, or null when it keeps its name. */
export function releaseAssetName(name, version) {
  for (const rule of RULES) {
    const match = rule.pattern.exec(name);
    if (!match) continue;
    const product = match[1];
    const fileVersion = rule.noVersion ? version : match[2];
    const arch = ARCH[rule.noVersion ? match[2] : match[3]];
    const next = `${product}_${fileVersion}_${rule.os}_${arch}${rule.suffix}`;
    return next === name ? null : next;
  }
  return null;
}

/** Updater signatures live inside latest.json, so the separate files are clutter. */
export function isSignatureAsset(name) {
  return name.endsWith(".sig");
}

/** Point every latest.json platform URL at the renamed file. */
export function relabelManifest(manifest, renames) {
  const next = structuredClone(manifest);
  for (const platform of Object.values(next.platforms ?? {})) {
    if (typeof platform?.url !== "string") continue;
    const slash = platform.url.lastIndexOf("/");
    const file = decodeURIComponent(platform.url.slice(slash + 1));
    const renamed = renames.get(file);
    if (renamed) platform.url = `${platform.url.slice(0, slash + 1)}${encodeURIComponent(renamed)}`;
  }
  return next;
}
