// ABOUTME: Tests verify-gate through a fake Pi: edits, the settle boundary, the repair cap, and /verify.
// ABOUTME: Includes "asks for at most maxRepairs repairs, then tells the user".

// @vitest-environment node

import * as path from "node:path";
import type { BashOperations, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { CheckResolution } from "./check-command";
import type { CheckRun } from "./run-check";
import { MESSAGE_TYPE, registerVerifyGate, STATUS_KEY } from "./verify-gate";

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;

const cwd = path.resolve("/work/app");
const FAIL_IN_CART = "src/cart.ts(3,1): error TS2322: bad\nFound 1 error.";

function harness(options: {
  runs: CheckRun[];
  resolution?: CheckResolution;
  trusted?: boolean;
  pending?: boolean;
}) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (name: string, command: { handler: () => Promise<void> }) =>
      commands.set(name, command),
  } as unknown as ExtensionAPI;
  const notify = vi.fn();
  const setStatus = vi.fn();
  const ctx = {
    cwd,
    hasUI: true,
    ui: { notify, setStatus },
    signal: undefined,
    isProjectTrusted: () => options.trusted ?? true,
    hasPendingMessages: () => options.pending ?? false,
    sessionManager: { getSessionId: () => "s1" },
  };
  const runs = [...options.runs];
  const run = vi.fn(async () => {
    const next = runs.shift();
    if (!next) throw new Error("no more runs");
    return next;
  });
  registerVerifyGate(pi, {
    resolve: () =>
      options.resolution ?? {
        kind: "command",
        check: {
          command: "bun run check",
          source: "package.json",
          timeoutSeconds: 60,
          maxRepairs: 2,
        },
      },
    operations: () => ({}) as BashOperations,
    run,
  });
  const emit = (name: string, event: Record<string, unknown> = {}) =>
    handlers.get(name)?.({ type: name, ...event }, ctx);
  const edit = (file = "src/cart.ts", toolName = "edit", isError = false) =>
    emit("tool_result", { toolName, input: { path: file }, isError, content: [] });
  // A completed assistant turn previews as not continuable until a handler adds an entry.
  const settle = (outcome = "completed") =>
    emit("agent_before_settle", {
      outcome,
      entries: [],
      continue: false,
      context: { canContinue: false },
    }) as Promise<{ entries: Array<Record<string, unknown>>; continue: boolean } | undefined>;
  return { emit, edit, settle, run, notify, setStatus, commands, ctx };
}

const done = (exitCode: number, output = ""): CheckRun => ({
  status: "done",
  exitCode,
  output,
  logPath: "/tmp/spopi-verify/s1.log",
});

describe("verify gate", () => {
  it("does nothing when the run edited no files", async () => {
    const h = harness({ runs: [] });
    expect(await h.settle()).toBeUndefined();
    expect(h.run).not.toHaveBeenCalled();
  });

  it("passes quietly after a clean check", async () => {
    const h = harness({ runs: [done(0)] });
    h.edit();
    expect(await h.settle()).toBeUndefined();
    expect(h.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "check: passed");
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("appends one repair message and continues when the failure names a changed file", async () => {
    const h = harness({ runs: [done(1, FAIL_IN_CART)] });
    h.edit();
    const result = await h.settle();
    expect(result?.continue).toBe(true);
    const [entry] = result?.entries ?? [];
    expect(entry).toMatchObject({
      type: "custom_message",
      customType: MESSAGE_TYPE,
      display: true,
    });
    expect(String(entry?.content)).toContain("src/cart.ts(3,1): error TS2322: bad");
    expect(String(entry?.content)).toContain("Full output: /tmp/spopi-verify/s1.log");
    expect(h.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "check: failed, repair 1/2");
  });

  it("asks for at most maxRepairs repairs, then tells the user", async () => {
    const h = harness({
      runs: [done(1, FAIL_IN_CART), done(1, FAIL_IN_CART), done(1, FAIL_IN_CART)],
    });
    h.edit();
    expect((await h.settle())?.continue).toBe(true);
    h.edit();
    expect((await h.settle())?.continue).toBe(true);
    h.edit();
    expect(await h.settle()).toBeUndefined();
    expect(h.notify).toHaveBeenLastCalledWith(
      "`bun run check` still fails after 2 repair(s). Full output: /tmp/spopi-verify/s1.log",
      "warning",
    );
    expect(h.run).toHaveBeenCalledTimes(3);
  });

  it("does not re-run the check when the model answers a repair request without editing", async () => {
    const h = harness({ runs: [done(1, FAIL_IN_CART)] });
    h.edit();
    expect((await h.settle())?.continue).toBe(true);
    expect(await h.settle()).toBeUndefined();
    expect(h.run).toHaveBeenCalledOnce();
    expect(h.notify).toHaveBeenLastCalledWith(
      "`bun run check` still fails. The model left it as not caused by its change.",
      "warning",
    );
  });

  it("resets the repair count and edited files when Pi settles", async () => {
    const h = harness({ runs: [done(1, FAIL_IN_CART), done(1, FAIL_IN_CART)] });
    h.edit();
    await h.settle();
    h.emit("agent_settled");
    expect(await h.settle()).toBeUndefined();
    expect(h.run).toHaveBeenCalledOnce();
    h.edit();
    expect((await h.settle())?.continue).toBe(true);
    expect(h.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, "check: failed, repair 1/2");
  });

  it("tells the user instead of the model when the failure is in untouched files", async () => {
    const h = harness({ runs: [done(1, "src/other.ts(1,1): error TS1")] });
    h.edit();
    expect(await h.settle()).toBeUndefined();
    expect(h.notify).toHaveBeenCalledWith(
      "`bun run check` fails, but not in files changed this run. Full output: /tmp/spopi-verify/s1.log",
      "warning",
    );
  });

  it("sends the output tail after a clean check earlier in the session", async () => {
    const h = harness({
      runs: [done(0), done(1, "FAIL cart.test.ts > totals\nexpected 3, got 4")],
    });
    h.edit();
    await h.settle();
    h.emit("agent_settled");
    h.edit();
    const result = await h.settle();
    expect(result?.continue).toBe(true);
    expect(String(result?.entries[0]?.content)).toContain("expected 3, got 4");
  });

  it("skips untrusted projects, aborted runs, queued input, and a disabled or missing check", async () => {
    for (const setup of [
      { trusted: false },
      { pending: true },
      { resolution: { kind: "disabled", source: ".pi/verify.json" } as const },
      { resolution: { kind: "none" } as const },
    ]) {
      const h = harness({ runs: [], ...setup });
      h.edit();
      expect(await h.settle()).toBeUndefined();
      expect(h.run).not.toHaveBeenCalled();
    }
    const aborted = harness({ runs: [] });
    aborted.edit();
    expect(await aborted.settle("aborted")).toBeUndefined();
    expect(aborted.run).not.toHaveBeenCalled();
  });

  it("tracks write and package edit tools, but not failed edits or reads", async () => {
    const h = harness({ runs: [] });
    h.edit("src/cart.ts", "edit", true);
    h.edit("src/cart.ts", "read");
    expect(await h.settle()).toBeUndefined();
    const w = harness({ runs: [done(0)] });
    w.edit("src/new.ts", "hashline_edit");
    await w.settle();
    expect(w.run).toHaveBeenCalledOnce();
  });

  it("continues even though Pi's preview before any entry cannot, and reports a check that could not run", async () => {
    const h = harness({ runs: [done(1, FAIL_IN_CART)] });
    h.edit();
    expect((await h.settle())?.continue).toBe(true);
    const broken = harness({
      runs: [{ status: "failed-to-run", message: "timeout:60", output: "", logPath: null }],
    });
    broken.edit();
    expect(await broken.settle()).toBeUndefined();
    expect(broken.notify).toHaveBeenCalledWith(
      "Verify gate could not run `bun run check`: timeout:60.",
      "warning",
    );
  });

  it("/verify runs the check once and reports the result without touching the model", async () => {
    const h = harness({ runs: [done(0)] });
    await h.commands.get("verify")?.handler("", h.ctx);
    expect(h.notify).toHaveBeenCalledWith(
      "`bun run check` from package.json: exit 0. Full output: /tmp/spopi-verify/s1.log",
      "info",
    );
    const off = harness({ runs: [], resolution: { kind: "disabled", source: ".pi/verify.json" } });
    await off.commands.get("verify")?.handler("", off.ctx);
    expect(off.notify).toHaveBeenCalledWith(
      "Verify gate is off for this project (.pi/verify.json).",
      "info",
    );
  });
});
