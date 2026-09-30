// ABOUTME: Runs the check command through Pi's own local shell and saves the full output to a log file.
// ABOUTME: Same shell as the bash tool on every OS; which command to run and what to report live elsewhere.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BashOperations } from "@earendil-works/pi-coding-agent";

/** Output kept in memory; the tail is what matters when a long check fails. */
export const MAX_OUTPUT_BYTES = 1024 * 1024;

export type CheckRun =
  | { status: "done"; exitCode: number | null; output: string; logPath: string | null }
  | { status: "failed-to-run"; message: string; output: string; logPath: string | null };

export async function runCheck(input: {
  operations: BashOperations;
  command: string;
  cwd: string;
  timeoutSeconds: number;
  logName: string;
  signal?: AbortSignal;
}): Promise<CheckRun> {
  const chunks: Buffer[] = [];
  let size = 0;
  const onData = (data: Buffer) => {
    chunks.push(data);
    size += data.length;
    while (size > MAX_OUTPUT_BYTES && chunks.length > 1) {
      size -= chunks[0].length;
      chunks.shift();
    }
  };
  const collected = () => Buffer.concat(chunks).toString("utf8");
  try {
    const { exitCode } = await input.operations.exec(input.command, input.cwd, {
      onData,
      signal: input.signal,
      timeout: input.timeoutSeconds,
    });
    const output = collected();
    return { status: "done", exitCode, output, logPath: writeLog(input.logName, output) };
  } catch (error) {
    const output = collected();
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed-to-run", message, output, logPath: writeLog(input.logName, output) };
  }
}

/** Outside the project on purpose: the log is for this run, not something to commit. */
function writeLog(name: string, output: string): string | null {
  try {
    const dir = path.join(os.tmpdir(), "spopi-verify");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name.replace(/[^\w.-]+/g, "_") || "check"}.log`);
    fs.writeFileSync(file, output);
    return file;
  } catch {
    return null;
  }
}
