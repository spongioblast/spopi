// ABOUTME: Turns a failed check's output into the short message the model sees after its edits.
// ABOUTME: Pure text work. It keeps output that names a changed file; running the check lives elsewhere.

import * as path from "node:path";

export const MAX_REPORT_LINES = 40;
export const MAX_REPORT_CHARS = 4000;

/** `src/a.ts(3,5)`, `src/a.ts:3:5`, ` --> src/a.rs:3:5`: a file path followed by a line number. */
const LOCATION = /(?:[A-Za-z]:)?[\w.@~/\\-]*[\w-]\.[A-Za-z0-9]+(?=[:(]\d)/g;

export type ChangedFile = { absolute: string; relative: string; base: string };

export function describeChangedFiles(cwd: string, files: Iterable<string>): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const file of files) {
    const absolute = path.resolve(cwd, file);
    out.push({
      absolute: normalize(absolute),
      relative: normalize(path.relative(cwd, absolute)),
      base: normalize(path.basename(absolute)),
    });
  }
  return out;
}

function normalize(value: string): string {
  const slashed = value.replaceAll("\\", "/");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

function mentions(line: string, file: ChangedFile): boolean {
  const text = normalize(line);
  if (file.relative && !file.relative.startsWith("..") && text.includes(file.relative)) return true;
  if (text.includes(file.absolute)) return true;
  const at = text.indexOf(file.base);
  if (at < 0) return false;
  const before = at === 0 ? " " : text[at - 1];
  const after = text[at + file.base.length] ?? " ";
  return /[\s/"'(]/.test(before) && /[\s:("',]/.test(after);
}

function mentionsAny(line: string, files: ChangedFile[]): boolean {
  return files.some((file) => mentions(line, file));
}

function locationCount(block: string[]): number {
  const seen = new Set<string>();
  for (const line of block) {
    for (const match of line.matchAll(LOCATION)) seen.add(normalize(match[0]));
  }
  return seen.size;
}

/**
 * Blocks are split on blank lines, the way cargo, biome, and eslint group one
 * finding. A block that names no changed file is dropped. Inside a block that
 * lists several files one per line (tsc), only the lines for changed files and
 * lines without a location are kept.
 */
export function relevantOutput(output: string, files: ChangedFile[]): string[] {
  if (files.length === 0) return [];
  const blocks: string[][] = [[]];
  for (const line of output.replaceAll("\r\n", "\n").split("\n")) {
    if (line.trim() === "") {
      if (blocks[blocks.length - 1].length > 0) blocks.push([]);
      continue;
    }
    blocks[blocks.length - 1].push(line);
  }
  const kept: string[] = [];
  for (const block of blocks) {
    if (block.length === 0 || !block.some((line) => mentionsAny(line, files))) continue;
    const lines =
      locationCount(block) > 1
        ? block.filter((line) => mentionsAny(line, files) || !line.match(LOCATION))
        : block;
    if (kept.length > 0) kept.push("");
    kept.push(...lines);
  }
  return kept;
}

/** The last lines of the output, for a failure that names no changed file after a clean check. */
export function outputTail(output: string): string[] {
  const lines = output
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");
  return lines.slice(-MAX_REPORT_LINES);
}

export function capLines(lines: string[]): { text: string; omitted: number } {
  const shown: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (shown.length >= MAX_REPORT_LINES || chars + line.length > MAX_REPORT_CHARS) break;
    shown.push(line);
    chars += line.length + 1;
  }
  return { text: shown.join("\n"), omitted: lines.length - shown.length };
}

/** The follow-up the model gets. Plain facts, one repair request, and a way out when the error is not its own. */
export function repairMessage(input: {
  command: string;
  exitCode: number | null;
  lines: string[];
  logPath: string | null;
}): string {
  const { text, omitted } = capLines(input.lines);
  const exit = input.exitCode === null ? "no exit code" : `exit ${input.exitCode}`;
  const parts = [
    `\`${input.command}\` failed after your edits (${exit}). Output that names files you changed:`,
    "",
    "```",
    text,
    "```",
  ];
  if (omitted > 0) parts.push(`${omitted} more line(s) are in the full output.`);
  if (input.logPath) parts.push(`Full output: ${input.logPath}`);
  parts.push("If this comes from your change, fix it. If it does not, say so and stop.");
  return parts.join("\n");
}
