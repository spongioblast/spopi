// ABOUTME: Guards the bridge dispatcher against duplicate ops and missing WebView calls.
// ABOUTME: It does not execute the operations.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bridgeHandlers } from "../spopi-config";

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

describe("bridge handlers", () => {
  it("has no duplicate operation names", () => {
    const names = Object.keys(bridgeHandlers);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers every config operation the WebView calls", () => {
    const root = join(import.meta.dirname, "..", "..", "public", "app");
    const ops = new Set<string>();
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\.call\(\s*"([a-z_]+)"/g)) ops.add(match[1]);
    }
    const missing = [...ops].filter((op) => !(op in bridgeHandlers));
    expect(missing).toEqual([]);
  });
});
