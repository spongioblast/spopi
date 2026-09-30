// ABOUTME: Creates the workspace-local scratch directory `.pi/tmp/` (self-ignored) and subfolders in it.
// ABOUTME: Enforces containment and refuses symlinks; what gets written there belongs to the callers.

import * as fs from "node:fs";
import * as path from "node:path";

const GITIGNORE_CONTENT = "*\n!.gitignore\n";

export function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function canonicalWorkspaceRoot(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error("Workspace root is not a directory");
  return fs.realpathSync.native(resolved);
}

function ensureDirectoryComponent(directory: string): void {
  if (fs.existsSync(directory)) {
    if (fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error("Scratch directory must not contain symlinks");
    }
    if (!fs.statSync(directory).isDirectory()) throw new Error("Scratch path is not a directory");
    return;
  }
  fs.mkdirSync(directory);
}

function ensureContainedDirectory(root: string, directory: string): string {
  const realDirectory = fs.realpathSync.native(directory);
  if (!isPathWithinRoot(root, realDirectory)) {
    throw new Error("Scratch directory is outside workspace");
  }
  if (!fs.statSync(realDirectory).isDirectory()) throw new Error("Scratch path is not a directory");
  return realDirectory;
}

/**
 * `.pi/tmp/` under the workspace, or `.pi/tmp/<subdir>/` when given. The `.gitignore`
 * in `.pi/tmp/` ignores everything below it, so nothing written here is committed.
 */
export function ensureScratchDirectory(
  workspaceRoot: string,
  subdir?: string,
): { root: string; directory: string } {
  const root = canonicalWorkspaceRoot(workspaceRoot);
  const piDirectory = path.join(root, ".pi");
  ensureDirectoryComponent(piDirectory);
  const tmpDirectory = path.join(piDirectory, "tmp");
  ensureDirectoryComponent(tmpDirectory);
  const realTmp = ensureContainedDirectory(root, tmpDirectory);

  const ignorePath = path.join(realTmp, ".gitignore");
  if (fs.existsSync(ignorePath)) {
    if (fs.lstatSync(ignorePath).isSymbolicLink()) {
      throw new Error("Scratch ignore file must not be a symlink");
    }
  } else {
    fs.writeFileSync(ignorePath, GITIGNORE_CONTENT, { encoding: "utf8", mode: 0o600 });
  }

  if (!subdir) return { root, directory: realTmp };
  const nested = path.join(realTmp, subdir);
  ensureDirectoryComponent(nested);
  return { root, directory: ensureContainedDirectory(root, nested) };
}

/** Workspace-relative path with forward slashes, as the model and the UI show it. */
export function workspaceRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}
