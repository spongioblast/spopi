// ABOUTME: The spopi_ui_copy tool: copies one shipped UI file into the overlay so the model can edit the copy.
// ABOUTME: Registered only when SPOPI names both folders; it never overwrites an overlay file.

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const UI_COPY_TOOL = "spopi_ui_copy";

type Env = Record<string, string | undefined>;

export type CopyResult = { copied: boolean; file: string; target: string };

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** The same path in the overlay replaces the shipped file, so both use one relative path. */
export function normalizeUiPath(file: string): string {
  const rel = file
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/^public\//, "");
  if (!rel || rel.includes(":") || rel.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`"${file}" is not a path inside the shipped UI. Use the path from ui-map.md.`);
  }
  if (rel === "index.html") {
    throw new Error(
      "index.html cannot be overridden: SPOPI builds it from the shipped copy on every start. Change the page from user.css or from a module it loads.",
    );
  }
  if (rel.startsWith("locales/")) {
    throw new Error(
      "Do not copy a locale file. Write only the keys you change to locales/<lang>.json in the overlay.",
    );
  }
  return rel;
}

export function copyShippedUiFile(shipped: string, overlay: string, file: string): CopyResult {
  const rel = normalizeUiPath(file);
  const source = resolve(shipped, rel);
  const target = resolve(overlay, rel);
  if (!inside(resolve(shipped), source) || !inside(resolve(overlay), target)) {
    throw new Error(`"${file}" is not a path inside the shipped UI.`);
  }
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`SPOPI ships no file ${rel}. Find it with grep in ui-map.md.`);
  }
  if (existsSync(target)) return { copied: false, file: rel, target };
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { copied: true, file: rel, target };
}

export function registerSpopiUiCopy(pi: ExtensionAPI, env: Env = process.env) {
  const shipped = env.SPOPI_PUBLIC_DIR?.trim();
  const overlay = env.SPOPI_UI_OVERLAY?.trim();
  if (!shipped || !overlay) return;
  pi.registerTool({
    name: UI_COPY_TOOL,
    label: "Copy SPOPI UI file",
    description:
      "Copy one shipped SPOPI UI file into the overlay, byte for byte, then edit the copy. Use it instead of cp, sed, or retyping a shipped file. An existing overlay copy is kept.",
    parameters: Type.Object({
      file: Type.String({
        description:
          "Path relative to the shipped UI folder, as in ui-map.md, e.g. app/theme/themes.js",
      }),
    }),
    async execute(_toolCallId, params) {
      const result = copyShippedUiFile(shipped, overlay, String(params.file ?? ""));
      const text = result.copied
        ? `Copied ${result.file} to ${result.target}. Edit that copy; after the edit SPOPI shows a Reload banner.`
        : `${result.target} already exists in the overlay. Edit it there; it was not overwritten.`;
      return { content: [{ type: "text", text }], details: result };
    },
  });
}
