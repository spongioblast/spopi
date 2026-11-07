// ABOUTME: Tests spopi-terminal: registered only under SPOPI, runs through the host, waits, reads, and stops.
// ABOUTME: Includes "returns while the command keeps running and says how to check it".

// @vitest-environment node

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  describeRun,
  type RunView,
  registerSpopiTerminal,
  TERMINAL_READ_TOOL,
  TERMINAL_RUN_TOOL,
} from "./spopi-terminal";

type Result = { content: Array<{ text: string }>; details: Record<string, unknown> };
type Tool = {
  name: string;
  promptGuidelines?: string[];
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((result: Result) => void) | undefined,
    ctx: { cwd: string; sessionManager?: { getSessionId: () => string } },
  ) => Promise<Result>;
};

function view(patch: Partial<RunView>): RunView {
  return {
    terminalId: "t1",
    label: "Pi: plan.py",
    status: "running",
    elapsedMs: 1000,
    output: "",
    outputTruncated: false,
    ...patch,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function register(fetchImpl: typeof fetch, origin = "http://127.0.0.1:57620/") {
  const tools: Tool[] = [];
  const pi = { registerTool: (tool: Tool) => tools.push(tool) } as unknown as ExtensionAPI;
  registerSpopiTerminal(pi, origin, fetchImpl);
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

const ctx = { cwd: "D:\\work\\app", sessionManager: { getSessionId: () => "s1" } };

describe("spopi_terminal tools", () => {
  it("are not registered outside SPOPI", () => {
    expect(register(fetch, "")).toEqual({});
  });

  it("tell the model not to detach long commands from bash", () => {
    const tools = register(fetch);
    expect(tools[TERMINAL_RUN_TOOL].promptGuidelines?.[0]).toContain("nohup");
  });

  it("run in the session's window and return once the command ends", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/api/terminal/run")) return json({ terminalId: "t1", label: "Pi: make" });
      return json(view({ status: "exited", exitCode: 0, output: "built\r\n" }));
    });
    const tools = register(fetchImpl as unknown as typeof fetch);
    const result = await tools[TERMINAL_RUN_TOOL].execute(
      "c1",
      { command: "make", cwd: "sub" },
      undefined,
      undefined,
      ctx,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:57620/api/terminal/run");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      command: "make",
      sessionId: "s1",
      cwd: expect.stringMatching(/app[\\/]sub$/),
    });
    expect(result.content[0].text).toContain("exited with code 0");
    expect(result.content[0].text).toContain("built");
    expect(result.details).toMatchObject({ terminalId: "t1", status: "exited", exitCode: 0 });
  });

  it("returns while the command keeps running and says how to check it", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/terminal/run")) return json({ terminalId: "t1", label: "Pi: plan" });
      return json(view({ output: "[1/70] done\r\n" }));
    });
    const tools = register(fetchImpl as unknown as typeof fetch);
    const result = await tools[TERMINAL_RUN_TOOL].execute(
      "c1",
      { command: "python plan.py", wait: 0 },
      undefined,
      undefined,
      ctx,
    );
    expect(result.content[0].text).toContain("still running");
    expect(result.content[0].text).toContain(`${TERMINAL_READ_TOOL} and terminal "t1"`);
  });

  it("fail with the host's reason", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: { message: "No SPOPI window shows this project." } }, 404),
    );
    const tools = register(fetchImpl as unknown as typeof fetch);
    await expect(
      tools[TERMINAL_RUN_TOOL].execute("c1", { command: "ls" }, undefined, undefined, ctx),
    ).rejects.toThrow("No SPOPI window shows this project.");
  });

  it("stop a command and report its end", async () => {
    let stopped = false;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/terminal/stop")) {
        stopped = true;
        return json({ ok: true });
      }
      return json(view(stopped ? { status: "stopped" } : {}));
    });
    const tools = register(fetchImpl as unknown as typeof fetch);
    const result = await tools[TERMINAL_READ_TOOL].execute(
      "c1",
      { terminal: "t1", stop: true },
      undefined,
      undefined,
      ctx,
    );
    expect(fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:57620/api/terminal/stop");
    expect(result.content[0].text).toContain("stopped after");
  });
});

describe("describeRun", () => {
  it("shows only the last lines and says so", () => {
    const output = Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n");
    const text = describeRun(view({ status: "exited", exitCode: 2, output }), 3);
    expect(text).toContain("exited with code 2");
    expect(text).toContain("Last 3 lines of output:\nline 7\nline 8\nline 9");
  });
});
