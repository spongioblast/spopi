// ABOUTME: Saves a long tool result under `.pi/tmp/tool-output/` in the project and reads it back in windows.
// ABOUTME: Inside the project on purpose: Auto-edit reads there without an outside-the-project prompt.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureScratchDirectory, isPathWithinRoot, workspaceRelative } from "../scratch-dir";

export const OUTPUT_SUBDIR = "tool-output";
export const RETENTION_DAYS = 7;
/** Bytes read from each end of a saved file too large to read whole. */
export const WINDOW_BYTES = 64 * 1024;

export type SavedFile = { absolutePath: string; relativePath: string; bytes: number };

function timestampPart(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function safePart(value: string, max: number): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(-max) || "tool";
}

/**
 * Pi's shell tools keep the full output in a temp file once they truncate. Only that
 * location is copied, so a tool cannot make this extension copy an arbitrary file into the project.
 */
export function piFullOutputPath(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as { fullOutputPath?: unknown }).fullOutputPath;
  if (typeof value !== "string" || !value) return null;
  const resolved = path.resolve(value);
  const roots = [path.resolve(os.tmpdir())];
  try {
    roots.push(fs.realpathSync.native(os.tmpdir()));
  } catch {
    // The plain path is still checked.
  }
  if (!roots.some((root) => isPathWithinRoot(root, resolved))) return null;
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

/** Writes `text`, or copies `sourceFile` when given. Throws when the project is not writable. */
export function saveOutput(input: {
  cwd: string;
  toolName: string;
  toolCallId: string;
  text: string;
  sourceFile?: string | null;
  now?: Date;
}): SavedFile {
  const { root, directory } = ensureScratchDirectory(input.cwd, OUTPUT_SUBDIR);
  const base = `${safePart(input.toolName, 40)}-${timestampPart(input.now ?? new Date())}-${safePart(input.toolCallId, 8)}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const absolutePath = path.join(directory, `${base}${suffix}.log`);
    if (!isPathWithinRoot(root, absolutePath)) throw new Error("Output file is outside workspace");
    try {
      if (input.sourceFile) {
        fs.copyFileSync(input.sourceFile, absolutePath, fs.constants.COPYFILE_EXCL);
      } else {
        fs.writeFileSync(absolutePath, input.text, { encoding: "utf8", flag: "wx", mode: 0o600 });
      }
      return {
        absolutePath,
        relativePath: workspaceRelative(root, absolutePath),
        bytes: fs.statSync(absolutePath).size,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a unique output file");
}

/** The whole file when it is small, else the first and last WINDOW_BYTES. */
export function readWindows(file: string): { whole: string } | { head: string; tail: string } {
  const size = fs.statSync(file).size;
  if (size <= WINDOW_BYTES * 2) return { whole: fs.readFileSync(file, "utf8") };
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(WINDOW_BYTES);
    const tail = Buffer.alloc(WINDOW_BYTES);
    const headRead = fs.readSync(fd, head, 0, WINDOW_BYTES, 0);
    const tailRead = fs.readSync(fd, tail, 0, WINDOW_BYTES, size - WINDOW_BYTES);
    const decoder = new TextDecoder("utf-8");
    return {
      head: decoder.decode(head.subarray(0, headRead)),
      tail: decoder.decode(tail.subarray(0, tailRead)),
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** Deletes saved outputs older than RETENTION_DAYS. Never creates the folder. */
export function pruneOldOutputs(cwd: string, now = Date.now()): number {
  const directory = path.join(cwd, ".pi", "tmp", OUTPUT_SUBDIR);
  let names: string[];
  try {
    if (fs.lstatSync(directory).isSymbolicLink()) return 0;
    names = fs.readdirSync(directory);
  } catch {
    return 0;
  }
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    const file = path.join(directory, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;
      fs.unlinkSync(file);
      removed += 1;
    } catch {
      // A file another session is still writing or already removed is not ours to fix.
    }
  }
  return removed;
}
