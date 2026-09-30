// ABOUTME: Tests spopi-ui-copy: a byte-exact copy into the overlay that refuses paths the overlay cannot serve.
// ABOUTME: Includes "keeps an overlay copy that already exists".

// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyShippedUiFile, registerSpopiUiCopy, UI_COPY_TOOL } from "./spopi-ui-copy";

let root = "";
let shipped = "";
let overlay = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spopi-ui-copy-"));
  shipped = join(root, "public");
  overlay = join(root, "ui");
  mkdirSync(join(shipped, "app", "theme"), { recursive: true });
  mkdirSync(join(shipped, "locales"), { recursive: true });
  writeFileSync(join(shipped, "app", "theme", "themes.js"), "export const a = 1; // ─ é\n");
  writeFileSync(join(shipped, "index.html"), "<html></html>");
  writeFileSync(join(shipped, "locales", "en.json"), "{}");
  writeFileSync(join(root, "secret.txt"), "no");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

type Tool = {
  name: string;
  execute: (id: string, params: { file: string }) => Promise<{ content: Array<{ text: string }> }>;
};

function register(env: Record<string, string | undefined>) {
  const tools: Tool[] = [];
  const pi = { registerTool: (tool: Tool) => tools.push(tool) } as unknown as ExtensionAPI;
  registerSpopiUiCopy(pi, env);
  return tools;
}

describe("spopi_ui_copy", () => {
  it("is not registered unless SPOPI names both folders", () => {
    expect(register({})).toEqual([]);
    expect(register({ SPOPI_PUBLIC_DIR: shipped })).toEqual([]);
  });

  it("copies byte for byte to the same relative path, from a map path or a public/ path", async () => {
    const [tool] = register({ SPOPI_PUBLIC_DIR: shipped, SPOPI_UI_OVERLAY: overlay });
    expect(tool.name).toBe(UI_COPY_TOOL);
    const result = await tool.execute("c1", { file: "public\\app\\theme\\themes.js" });
    expect(result.content[0].text).toContain("Copied app/theme/themes.js");
    expect(readFileSync(join(overlay, "app", "theme", "themes.js"))).toEqual(
      readFileSync(join(shipped, "app", "theme", "themes.js")),
    );
  });

  it("keeps an overlay copy that already exists", () => {
    mkdirSync(join(overlay, "app", "theme"), { recursive: true });
    writeFileSync(join(overlay, "app", "theme", "themes.js"), "mine");
    expect(copyShippedUiFile(shipped, overlay, "app/theme/themes.js").copied).toBe(false);
    expect(readFileSync(join(overlay, "app", "theme", "themes.js"), "utf8")).toBe("mine");
  });

  it("refuses index.html, locale files, traversal, and files SPOPI does not ship", () => {
    expect(() => copyShippedUiFile(shipped, overlay, "index.html")).toThrow("cannot be overridden");
    expect(() => copyShippedUiFile(shipped, overlay, "locales/en.json")).toThrow(
      "only the keys you change",
    );
    expect(() => copyShippedUiFile(shipped, overlay, "../secret.txt")).toThrow("not a path");
    expect(() => copyShippedUiFile(shipped, overlay, "C:/x.js")).toThrow("not a path");
    expect(() => copyShippedUiFile(shipped, overlay, "app/missing.js")).toThrow("ships no file");
  });
});
