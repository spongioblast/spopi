// ABOUTME: Guards the bridge dispatcher against missing WebView calls and ops nothing calls.
// ABOUTME: It does not execute the operations; duplicate names already throw at import.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bridgeHandlers } from "../spopi-config";

const repo = join(import.meta.dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", "dist", "target", "bridge"]);

function walk(dir: string, extensions: string[], out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, extensions, out);
    } else if (extensions.some((ext) => name.endsWith(ext)) && !name.includes(".test.")) {
      out.push(path);
    }
  }
  return out;
}

describe("bridge handlers", () => {
  it("covers every config operation the WebView calls", () => {
    const ops = new Set<string>();
    for (const file of walk(join(repo, "public", "app"), [".js"])) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\.call\(\s*"([a-z_]+)"/g)) ops.add(match[1]);
    }
    const missing = [...ops].filter((op) => !(op in bridgeHandlers));
    expect(missing).toEqual([]);
  });

  it("registers no operation that the WebView, host, or scripts never name", () => {
    const callers = [
      ...walk(join(repo, "public", "app"), [".js"]),
      ...walk(join(repo, "src-tauri", "src"), [".rs"]),
      ...walk(join(repo, "extensions"), [".ts"]),
      ...walk(join(repo, "scripts"), [".js", ".mjs"]),
      ...walk(join(repo, "e2e"), [".js", ".mjs"]),
    ].map((file) => readFileSync(file, "utf8"));
    const unused = Object.keys(bridgeHandlers).filter(
      (op) => !callers.some((text) => text.includes(`"${op}"`) || text.includes(`'${op}'`)),
    );
    expect(unused).toEqual([]);
  });
});
