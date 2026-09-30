// ABOUTME: Tests run-check against fake BashOperations: output, exit codes, rejections, and the log file.
// ABOUTME: Includes "keeps the tail when output exceeds the memory cap".

// @vitest-environment node

import * as fs from "node:fs";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { MAX_OUTPUT_BYTES, runCheck } from "./run-check";

function ops(
  chunks: string[],
  result: { exitCode: number | null } | Error,
  seen: Record<string, unknown> = {},
): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      Object.assign(seen, { command, cwd, timeout: options.timeout });
      for (const chunk of chunks) options.onData(Buffer.from(chunk));
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("runCheck", () => {
  it("returns the exit code and output, and writes the log", async () => {
    const seen: Record<string, unknown> = {};
    const run = await runCheck({
      operations: ops(["src/a.ts(1,1): error\n", "Found 1 error\n"], { exitCode: 2 }, seen),
      command: "bun run check",
      cwd: "/work",
      timeoutSeconds: 120,
      logName: "session/1",
    });
    expect(seen).toEqual({ command: "bun run check", cwd: "/work", timeout: 120 });
    expect(run).toMatchObject({ status: "done", exitCode: 2 });
    if (run.status !== "done") throw new Error("expected done");
    expect(run.output).toBe("src/a.ts(1,1): error\nFound 1 error\n");
    expect(run.logPath).toMatch(/spopi-verify[\\/]session_1\.log$/);
    expect(fs.readFileSync(String(run.logPath), "utf8")).toBe(run.output);
  });

  it("reports a timeout or abort as failed-to-run with the partial output", async () => {
    const run = await runCheck({
      operations: ops(["partial"], new Error("timeout:5")),
      command: "slow",
      cwd: "/work",
      timeoutSeconds: 5,
      logName: "t",
    });
    expect(run).toMatchObject({ status: "failed-to-run", message: "timeout:5", output: "partial" });
  });

  it("keeps the tail when output exceeds the memory cap", async () => {
    const big = "x".repeat(MAX_OUTPUT_BYTES);
    const run = await runCheck({
      operations: ops([big, "last line"], { exitCode: 1 }),
      command: "noisy",
      cwd: "/work",
      timeoutSeconds: 5,
      logName: "big",
    });
    if (run.status !== "done") throw new Error("expected done");
    expect(run.output.endsWith("last line")).toBe(true);
    expect(run.output.length).toBeLessThan(MAX_OUTPUT_BYTES + 100);
  });
});
