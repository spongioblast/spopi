// ABOUTME: Tests scanSecrets on real files in a temp folder, and the messages built from its findings.
// ABOUTME: Includes "skips .env but scans .env.example". Fake keys are assembled at runtime, never written whole.

// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanSecrets, secretMessage } from "./secret-scan";

const body = (length: number) => "A1b2C3d4".repeat(Math.ceil(length / 8)).slice(0, length);
const github = `ghp_${body(36)}`;
const aws = `AKIA${"Q7RT2WZ5".repeat(2)}`;
const anthropic = `sk-ant-api03-${body(90)}`;

let dir = "";
function project(files: Record<string, string>): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spopi-secrets-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("scanSecrets", () => {
  it("finds provider keys and private key blocks with line numbers and short previews", () => {
    const cwd = project({
      "src/config.js": `const a = 1;\nconst token = "${github}";\nconst key = "${aws}";\n`,
      "keys/id": `-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbg==\n`,
      "llm.py": `client = Anthropic(api_key="${anthropic}")\n`,
    });
    const found = scanSecrets(cwd, ["src/config.js", "keys/id", "llm.py"]);
    expect(found.map(({ file, line, kind, preview }) => ({ file, line, kind, preview }))).toEqual([
      { file: "src/config.js", line: 2, kind: "GitHub token", preview: "ghp_A1…" },
      { file: "src/config.js", line: 3, kind: "AWS access key", preview: "AKIAQ7…" },
      {
        file: "keys/id",
        line: 1,
        kind: "private key",
        preview: "-----BEGIN OPENSSH PRIVATE KEY-----",
      },
      { file: "llm.py", line: 1, kind: "Anthropic API key", preview: "sk-ant…" },
    ]);
    expect(JSON.stringify(found)).not.toContain(github);
  });

  it("skips .env but scans .env.example", () => {
    const cwd = project({ ".env": `GITHUB_TOKEN=${github}\n`, ".env.example": `T=${github}\n` });
    expect(scanSecrets(cwd, [".env", ".env.example"]).map((f) => f.file)).toEqual([".env.example"]);
  });

  it("ignores placeholders, missing files, and binary files", () => {
    const cwd = project({
      "a.js": `const k = "AKIAIOSFODNN7EXAMPLE"; const t = "ghp_${"x".repeat(36)}";\n`,
      "b.bin": `\0${github}`,
    });
    expect(scanSecrets(cwd, ["a.js", "b.bin", "gone.js"])).toEqual([]);
  });

  it("gives the same value in the same file the same fingerprint", () => {
    const cwd = project({ "a.js": `x("${github}")\n`, "b.js": `y("${github}")\n` });
    const [a] = scanSecrets(cwd, ["a.js"]);
    fs.writeFileSync(path.join(cwd, "a.js"), `\n\nx("${github}")\n`);
    const [moved] = scanSecrets(cwd, ["a.js"]);
    const [b] = scanSecrets(cwd, ["b.js"]);
    expect(moved.fingerprint).toBe(a.fingerprint);
    expect(moved.line).toBe(3);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });
});

describe("secretMessage", () => {
  it("names the place and offers the way out for a test value", () => {
    const text = secretMessage([
      { file: "a.js", line: 2, kind: "npm token", preview: "npm_ab…", fingerprint: "f" },
    ]);
    expect(text).toContain("- a.js:2 npm token (npm_ab…)");
    expect(text).toContain("If the value is a placeholder or a test value, say so and leave it.");
  });
});
