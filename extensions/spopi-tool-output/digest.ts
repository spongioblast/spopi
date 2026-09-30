// ABOUTME: Builds the short text the model sees in place of a long tool result: size, file path, head and tail.
// ABOUTME: Pure string work; reading and writing the saved file belong to save-output.ts.

/** Results larger than this (UTF-8 bytes) are saved to a file; about 4k tokens. */
export const OFFLOAD_THRESHOLD_BYTES = 16 * 1024;
export const HEAD_LINES = 20;
export const HEAD_BYTES = 1024;
export const TAIL_LINES = 60;
export const TAIL_BYTES = 4 * 1024;
/** Minified JSON or a progress bar is one enormous line; cut each shown line at this length. */
export const MAX_LINE_CHARS = 500;

export type DigestLines = {
  head: string[];
  tail: string[];
  /** Lines between head and tail, or null when the total line count is unknown. */
  omitted: number | null;
};

export function linesOfText(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function clipLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  return `${line.slice(0, MAX_LINE_CHARS)} [line cut at ${MAX_LINE_CHARS} characters]`;
}

function take(lines: Iterable<string>, maxLines: number, maxBytes: number): string[] {
  const out: string[] = [];
  let bytes = 0;
  for (const raw of lines) {
    if (out.length >= maxLines) break;
    const line = clipLine(raw);
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (out.length > 0 && bytes + size > maxBytes) break;
    out.push(line);
    bytes += size;
  }
  return out;
}

function* reversed(lines: string[], stopAt: number): Generator<string> {
  for (let index = lines.length - 1; index >= stopAt; index -= 1) yield lines[index];
}

/** Head and tail of an output held completely in memory. */
export function pickFromLines(lines: string[]): DigestLines {
  const head = take(lines, HEAD_LINES, HEAD_BYTES);
  const tail = take(reversed(lines, head.length), TAIL_LINES, TAIL_BYTES).reverse();
  return { head, tail, omitted: lines.length - head.length - tail.length };
}

/**
 * Head and tail from two byte windows of a file too large to read whole. The line cut
 * by each window's edge is dropped unless it is the only line the window has.
 */
export function pickFromWindows(
  headText: string,
  tailText: string,
  totalLines: number | null,
): DigestLines {
  const headLines = linesOfText(headText);
  if (headLines.length > 1) headLines.pop();
  const tailLines = linesOfText(tailText);
  if (tailLines.length > 1) tailLines.shift();
  const head = take(headLines, HEAD_LINES, HEAD_BYTES);
  const tail = take(reversed(tailLines, 0), TAIL_LINES, TAIL_BYTES).reverse();
  const omitted = totalLines === null ? null : Math.max(0, totalLines - head.length - tail.length);
  return { head, tail, omitted };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildDigest(input: {
  relativePath: string;
  totalBytes: number;
  totalLines: number | null;
  lines: DigestLines;
}): string {
  const { head, tail, omitted } = input.lines;
  const size =
    input.totalLines === null
      ? formatSize(input.totalBytes)
      : `${formatSize(input.totalBytes)}, ${input.totalLines.toLocaleString("en-US")} lines`;
  const shown =
    omitted === 0
      ? "Every line is below, long lines cut short"
      : `The first ${head.length} and last ${tail.length} lines are below`;
  const parts = [
    `[Long output (${size}), saved in full to ${input.relativePath}. ${shown}; read or search that file for the rest.]`,
    ...head,
  ];
  if (omitted !== 0) {
    parts.push(
      omitted === null
        ? "[... middle of the output not shown ...]"
        : `[... ${omitted.toLocaleString("en-US")} lines not shown ...]`,
    );
  }
  parts.push(...tail);
  return parts.join("\n");
}
