// ABOUTME: Turns raw terminal output (escape codes, carriage-return redraws) into plain lines for the model.
// ABOUTME: Pure text handling; fetching the output and the tools themselves are in spopi-terminal.ts.

const char = (code: number) => String.fromCharCode(code);
const ESC = char(27);
const OSC = new RegExp(`${ESC}\\][\\s\\S]*?(?:${char(7)}|${ESC}\\\\)`, "g");
// ConPTY places rows with an absolute cursor move instead of a newline when it redraws.
const ROW_MOVE = new RegExp(`${ESC}\\[\\d*(?:;\\d*)?[Hf]`, "g");
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const OTHER_ESC = new RegExp(`${ESC}(?:[()][0-9A-Za-z]|[@-Z\\\\-_])`, "g");
// Tab and newline stay; carriage returns are resolved before this runs.
const CONTROL = new RegExp(
  `[${char(0)}-${char(8)}${char(11)}${char(12)}${char(14)}-${char(31)}${char(127)}]`,
  "g",
);

/** A progress bar redraws its line after `\r`; only what was drawn last stays. */
function lastDrawn(line: string): string {
  const parts = line.split("\r");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].trim()) return parts[index];
  }
  return "";
}

export function terminalText(raw: string): string {
  const lines = raw
    .replace(OSC, "")
    .replace(ROW_MOVE, "\n")
    .replace(CSI, "")
    .replace(OTHER_ESC, "")
    .replace(/\r+\n/g, "\n")
    .split("\n")
    .map((line) => lastDrawn(line).replace(CONTROL, "").trimEnd());
  const kept: string[] = [];
  for (const line of lines) {
    if (!line && !kept.at(-1)) continue;
    kept.push(line);
  }
  while (kept.length && !kept.at(-1)) kept.pop();
  return kept.join("\n");
}

/**
 * The last `count` lines of the cleaned output. When the host cut older output, the first
 * line may start mid-line or mid-escape, so it is dropped.
 */
export function lastLines(
  raw: string,
  count: number,
  cut: boolean,
): { text: string; total: number; shown: number } {
  const lines = terminalText(raw).split("\n");
  if (cut && lines.length > 1) lines.shift();
  const all = lines.length === 1 && !lines[0] ? [] : lines;
  const shown = all.slice(-Math.max(1, count));
  return { text: shown.join("\n"), total: all.length, shown: shown.length };
}
