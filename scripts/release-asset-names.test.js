// ABOUTME: Tests the release file names and the latest.json rewrite.
// ABOUTME: Covers all six installers and the macOS updater archives.
import { describe, expect, it } from "vitest";
import { isSignatureAsset, relabelManifest, releaseAssetName } from "./release-asset-names.mjs";

describe("releaseAssetName", () => {
  it("labels every installer with its OS and one arch spelling", () => {
    const cases = {
      "SPOPI_0.7.0_x64-setup.exe": "SPOPI_0.7.0_win_x64-setup.exe",
      "SPOPI_0.7.0_arm64-setup.exe": "SPOPI_0.7.0_win_arm64-setup.exe",
      "SPOPI_0.7.0_aarch64.dmg": "SPOPI_0.7.0_mac_arm64.dmg",
      "SPOPI_0.7.0_x64.dmg": "SPOPI_0.7.0_mac_x64.dmg",
      "SPOPI_aarch64.app.tar.gz": "SPOPI_0.7.0_mac_arm64.app.tar.gz",
      "SPOPI_x64.app.tar.gz": "SPOPI_0.7.0_mac_x64.app.tar.gz",
      "SPOPI_0.7.0_amd64.AppImage": "SPOPI_0.7.0_linux_x64.AppImage",
      "SPOPI_0.7.0_aarch64.AppImage": "SPOPI_0.7.0_linux_arm64.AppImage",
    };
    for (const [from, to] of Object.entries(cases)) {
      expect(releaseAssetName(from, "0.7.0")).toBe(to);
    }
  });

  it("leaves labeled and unrelated files alone", () => {
    expect(releaseAssetName("SPOPI_0.7.0_win_x64-setup.exe", "0.7.0")).toBeNull();
    expect(releaseAssetName("SPOPI_0.7.0_mac_arm64.dmg", "0.7.0")).toBeNull();
    expect(releaseAssetName("SPOPI_0.7.0_linux_x64.AppImage", "0.7.0")).toBeNull();
    expect(releaseAssetName("latest.json", "0.7.0")).toBeNull();
  });
});

describe("isSignatureAsset", () => {
  it("matches only .sig files", () => {
    expect(isSignatureAsset("SPOPI_0.7.0_x64-setup.exe.sig")).toBe(true);
    expect(isSignatureAsset("SPOPI_0.7.0_x64-setup.exe")).toBe(false);
  });
});

describe("relabelManifest", () => {
  it("rewrites platform urls and keeps signatures", () => {
    const base = "https://github.com/o/r/releases/download/v0.7.0/";
    const manifest = {
      version: "0.7.0",
      platforms: {
        "windows-x86_64": { signature: "sig-win", url: `${base}SPOPI_0.7.0_x64-setup.exe` },
        "darwin-aarch64": { signature: "sig-mac", url: `${base}SPOPI_aarch64.app.tar.gz` },
        "linux-x86_64": { signature: "sig-lin", url: `${base}SPOPI_0.7.0_amd64.AppImage` },
      },
    };
    const renames = new Map([
      ["SPOPI_0.7.0_x64-setup.exe", "SPOPI_0.7.0_win_x64-setup.exe"],
      ["SPOPI_aarch64.app.tar.gz", "SPOPI_0.7.0_mac_arm64.app.tar.gz"],
      ["SPOPI_0.7.0_amd64.AppImage", "SPOPI_0.7.0_linux_x64.AppImage"],
    ]);
    const next = relabelManifest(manifest, renames);
    expect(next.platforms["windows-x86_64"].url).toBe(`${base}SPOPI_0.7.0_win_x64-setup.exe`);
    expect(next.platforms["darwin-aarch64"].url).toBe(`${base}SPOPI_0.7.0_mac_arm64.app.tar.gz`);
    expect(next.platforms["linux-x86_64"].url).toBe(`${base}SPOPI_0.7.0_linux_x64.AppImage`);
    expect(next.platforms["windows-x86_64"].signature).toBe("sig-win");
    expect(manifest.platforms["windows-x86_64"].url).toBe(`${base}SPOPI_0.7.0_x64-setup.exe`);
  });
});
