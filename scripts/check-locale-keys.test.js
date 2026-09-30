// ABOUTME: Tests the locale key flattener and the missing-key diff.
// ABOUTME: It uses temporary JSON files and does not read the real locale directory.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkLocaleKeys, diffLocaleKeys, flattenKeys } from "./check-locale-keys.mjs";

describe("flattenKeys", () => {
  it("emits dotted leaf paths", () => {
    expect(
      flattenKeys({
        app: { welcome: "hi" },
        nav: { chat: "Chat", nested: { deep: "x" } },
      }),
    ).toEqual(["app.welcome", "nav.chat", "nav.nested.deep"]);
  });

  it("treats arrays as leaves", () => {
    expect(flattenKeys({ tags: ["a", "b"] })).toEqual(["tags"]);
  });
});

describe("diffLocaleKeys", () => {
  it("reports keys missing from a subset of files", () => {
    const { reports } = diffLocaleKeys([
      { file: "en.json", keys: new Set(["a", "b"]) },
      { file: "zh.json", keys: new Set(["a"]) },
    ]);
    expect(reports).toEqual([{ file: "zh.json", missing: ["b"] }]);
  });

  it("treats a key present in only one file as missing from the others", () => {
    const { reports } = diffLocaleKeys([
      { file: "en.json", keys: new Set(["shared"]) },
      { file: "zh.json", keys: new Set(["shared", "onlyZh"]) },
    ]);
    expect(reports).toEqual([{ file: "en.json", missing: ["onlyZh"] }]);
  });

  it("passes when every file has the same keys", () => {
    const { unionSize, reports } = diffLocaleKeys([
      { file: "en.json", keys: new Set(["a.b", "c"]) },
      { file: "zh.json", keys: new Set(["c", "a.b"]) },
    ]);
    expect(unionSize).toBe(2);
    expect(reports).toEqual([]);
  });
});

describe("checkLocaleKeys", () => {
  it("loads JSON files from a directory and finds missing keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "locale-keys-"));
    writeFileSync(join(dir, "en.json"), JSON.stringify({ hello: "Hello", nested: { a: "A" } }));
    writeFileSync(join(dir, "zh.json"), JSON.stringify({ hello: "你好" }));

    const result = checkLocaleKeys(dir);
    expect(result.files).toEqual(["en.json", "zh.json"]);
    expect(result.reports).toEqual([{ file: "zh.json", missing: ["nested.a"] }]);
  });

  it("rejects invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "locale-keys-"));
    writeFileSync(join(dir, "en.json"), "{");
    expect(() => checkLocaleKeys(dir)).toThrow(/invalid JSON/);
  });
});
