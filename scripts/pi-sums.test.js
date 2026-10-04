// ABOUTME: Tests the SHA256SUMS reader, the version check, and the package.json pin
// ABOUTME: that bump-pi.mjs uses to move SPOPI to a new Pi release.
import { describe, expect, it } from "vitest";
import { normalizePiVersion, PI_ARCHIVES, parsePiSums, pinPiDevDependency } from "./pi-sums.mjs";

const hex = (n) => n.toString(16).padStart(64, "0");

describe("parsePiSums", () => {
  it("keeps the six archives and ignores other release files", () => {
    const lines = PI_ARCHIVES.map((name, index) => `${hex(index + 1)}  ${name}`);
    lines.splice(2, 0, `${hex(99)}  pi-source.tar.gz`, "", "not a line");
    lines.push(`${"A".repeat(64)} *extra.zip`);
    const sums = parsePiSums(`${lines.join("\r\n")}\n`);
    expect(Object.keys(sums)).toEqual(PI_ARCHIVES);
    expect(sums["pi-darwin-arm64.tar.gz"]).toBe(hex(1));
    expect(sums["pi-windows-x64.zip"]).toBe(hex(6));
  });

  it("accepts the binary-mode marker and upper-case digests", () => {
    const text = PI_ARCHIVES.map((name) => `${"AB".repeat(32)} *${name}`).join("\n");
    expect(parsePiSums(text)["pi-linux-x64.tar.gz"]).toBe("ab".repeat(32));
  });

  it("names the archives a release is missing", () => {
    const text = PI_ARCHIVES.slice(0, 4)
      .map((name, index) => `${hex(index)}  ${name}`)
      .join("\n");
    expect(() => parsePiSums(text)).toThrow("pi-windows-arm64.zip, pi-windows-x64.zip");
  });
});

describe("normalizePiVersion", () => {
  it("drops a leading v and refuses anything that is not a release", () => {
    expect(normalizePiVersion("v1.0.2")).toBe("1.0.2");
    expect(normalizePiVersion(" 1.1.0-rc.1 ")).toBe("1.1.0-rc.1");
    expect(() => normalizePiVersion("latest")).toThrow("Not a Pi release version");
    expect(() => normalizePiVersion(undefined)).toThrow();
  });
});

describe("pinPiDevDependency", () => {
  it("changes only the Pi version", () => {
    const before =
      '{\n  "devDependencies": {\n    "@earendil-works/pi-coding-agent": "1.0.0",\n    "x": "1.0.0"\n  }\n}\n';
    expect(pinPiDevDependency(before, "1.0.2")).toBe(
      before.replace('agent": "1.0.0"', 'agent": "1.0.2"'),
    );
    expect(() => pinPiDevDependency("{}", "1.0.2")).toThrow("no @earendil-works/pi-coding-agent");
  });
});
