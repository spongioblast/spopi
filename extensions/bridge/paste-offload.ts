// ABOUTME: Stores large pasted composer payloads in a workspace-local Pi scratch directory.
// ABOUTME: Enforces containment, symlink checks, restrictive permissions, and collision-safe names.

import * as fs from "node:fs";
import * as path from "node:path";
import { ensureScratchDirectory, isPathWithinRoot, workspaceRelative } from "../scratch-dir";

const FILE_PREFIX = "paste-";
const FILE_SUFFIX = ".txt";

export const PASTE_OFFLOAD_MAX_BYTES = 2 * 1024 * 1024;

type PasteOffloadResult = {
  absolutePath: string;
  relativePath: string;
};

function timestampPart(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function writePasteOffloadFile(
  workspaceRoot: string,
  content: string,
  now = new Date(),
): PasteOffloadResult {
  if (typeof content !== "string") throw new Error("Paste content must be text");
  if (Buffer.byteLength(content, "utf8") > PASTE_OFFLOAD_MAX_BYTES) {
    throw new Error("Paste content is too large");
  }

  const { root, directory: realDirectory } = ensureScratchDirectory(workspaceRoot);

  const baseName = `${FILE_PREFIX}${timestampPart(now)}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const absolutePath = path.join(realDirectory, `${baseName}${suffix}${FILE_SUFFIX}`);
    if (!isPathWithinRoot(root, absolutePath)) throw new Error("Paste file is outside workspace");
    try {
      const fd = fs.openSync(absolutePath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, content, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return { absolutePath, relativePath: workspaceRelative(root, absolutePath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    }
  }

  throw new Error("Could not allocate a unique paste file");
}
