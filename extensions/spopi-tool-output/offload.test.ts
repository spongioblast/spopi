// ABOUTME: Tests offload through a fake Pi: which results are saved, the details link, and the turn_end context_edit.
// ABOUTME: Includes "replaces a long bash result with the digest at turn end".

// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { OFFLOAD_THRESHOLD_BYTES } from "./digest";
import { DETAILS_KEY, registerToolOutputOffload, resultText } from "./offload";
import { saveOutput } from "./save-output";

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;
type Boundary = { entries: Array<Record<string, unknown>> } | undefined;

const made: string[] = [];

afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function harness(options: { save?: typeof saveOutput } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "spopi-offload-"));
  made.push(cwd);
  const handlers = new Map<string, Handler>();
  const pi = { on: (name: string, handler: Handler) => handlers.set(name, handler) };
  const entries = new Map<string, unknown>();
  const ctx = { cwd, sessionManager: { getEntry: (id: string) => entries.get(id) } };
  registerToolOutputOffload(pi as unknown as ExtensionAPI, { save: options.save ?? saveOutput });
  const emit = (name: string, event: Record<string, unknown>) =>
    handlers.get(name)?.({ type: name, ...event }, ctx);
  const result = (toolCallId: string, text: string, extra: Record<string, unknown> = {}) =>
    emit("tool_result", {
      toolName: "bash",
      toolCallId,
      input: {},
      content: [{ type: "text", text }],
      details: undefined,
      isError: false,
      ...extra,
    }) as { details?: Record<string, unknown> } | undefined;
  const persist = (entryId: string, toolCallId: string) =>
    entries.set(entryId, { type: "message", message: { role: "toolResult", toolCallId } });
  const turnEnd = (ids: string[]) =>
    emit("turn_end", { entries: [], toolResultEntryIds: ids, toolResults: [] }) as Boundary;
  return { cwd, emit, result, persist, turnEnd };
}

const longLog = () =>
  `${Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n")}\nerror: boom\n`;

describe("tool output offload", () => {
  it("replaces a long bash result with the digest at turn end", () => {
    const h = harness();
    const change = h.result("call_1", longLog());
    const info = change?.details?.[DETAILS_KEY] as { path: string; lines: number };
    expect(info.path).toMatch(/^\.pi\/tmp\/tool-output\/bash-\d{8}-\d{6}-call_1\.log$/);
    expect(info.lines).toBe(3001);
    expect(fs.readFileSync(path.join(h.cwd, info.path), "utf8")).toBe(longLog());

    h.persist("entry-1", "call_1");
    const boundary = h.turnEnd(["entry-1"]);
    expect(boundary?.entries).toHaveLength(1);
    const edit = boundary?.entries[0] as {
      type: string;
      targetId: string;
      replacement: { content: string };
    };
    expect(edit.type).toBe("context_edit");
    expect(edit.targetId).toBe("entry-1");
    const digest = edit.replacement.content;
    expect(digest).toContain(info.path);
    expect(digest).toContain("error: boom");
    expect(digest).not.toContain("line 1500\n");
    expect(Buffer.byteLength(digest)).toBeLessThan(OFFLOAD_THRESHOLD_BYTES / 2);

    expect(h.turnEnd(["entry-1"])).toBeUndefined();
  });

  it("leaves short results, reads, and images alone", () => {
    const h = harness();
    expect(h.result("short", "ok")).toBeUndefined();
    expect(h.result("read", longLog(), { toolName: "read" })).toBeUndefined();
    expect(
      h.result("img", "", {
        content: [
          { type: "text", text: longLog() },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      }),
    ).toBeUndefined();
    expect(fs.existsSync(path.join(h.cwd, ".pi"))).toBe(false);
  });

  it("keeps Pi's own details next to the link", () => {
    const h = harness();
    const change = h.result("call_2", longLog(), { details: { exitCode: 1 } });
    expect(change?.details?.exitCode).toBe(1);
    expect(change?.details?.[DETAILS_KEY]).toBeDefined();
  });

  it("gives the model the full result when the project is not writable", () => {
    const h = harness({
      save: () => {
        throw new Error("EACCES");
      },
    });
    expect(h.result("call_3", longLog())).toBeUndefined();
    h.persist("entry-3", "call_3");
    expect(h.turnEnd(["entry-3"])).toBeUndefined();
  });

  it("matches edits by tool call id, not by position", () => {
    const h = harness();
    h.result("big", longLog());
    h.persist("entry-small", "small");
    h.persist("entry-big", "big");
    const boundary = h.turnEnd(["entry-small", "entry-big"]);
    expect(boundary?.entries.map((entry) => entry.targetId)).toEqual(["entry-big"]);
  });

  it("joins text blocks and refuses image results", () => {
    expect(
      resultText([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
    expect(resultText([{ type: "image", data: "", mimeType: "image/png" }])).toBeNull();
  });
});
