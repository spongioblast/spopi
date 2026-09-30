// ABOUTME: Tests spopi-screenshot: registered only under SPOPI, returns the host PNG as an image block.
// ABOUTME: Includes "passes the caller's project folder so the host picks its window".

// @vitest-environment node

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerSpopiScreenshot, SCREENSHOT_TOOL, screenshotUrl } from "./spopi-screenshot";

type Tool = {
  name: string;
  execute: (
    id: string,
    params: object,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ) => Promise<{ content: Array<Record<string, unknown>> }>;
};

function register(origin: string, fetchImpl: typeof fetch) {
  const tools: Tool[] = [];
  const pi = { registerTool: (tool: Tool) => tools.push(tool) } as unknown as ExtensionAPI;
  registerSpopiScreenshot(pi, origin, fetchImpl);
  return tools;
}

describe("spopi_screenshot", () => {
  it("is not registered outside SPOPI", () => {
    expect(register("", fetch)).toEqual([]);
  });

  it("passes the caller's project folder so the host picks its window", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchImpl = vi.fn(async () => new Response(png, { status: 200 }));
    const [tool] = register("http://127.0.0.1:57620/", fetchImpl as unknown as typeof fetch);
    expect(tool.name).toBe(SCREENSHOT_TOOL);
    const result = await tool.execute("c1", {}, undefined, undefined, { cwd: "D:\\work\\app" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:57620/api/ui/screenshot?cwd=D%3A%5Cwork%5Capp",
      expect.anything(),
    );
    expect(result.content[1]).toEqual({
      type: "image",
      data: Buffer.from(png).toString("base64"),
      mimeType: "image/png",
    });
  });

  it("fails with the host's reason", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "No SPOPI project window is open." } }), {
          status: 404,
        }),
    );
    const [tool] = register("http://127.0.0.1:57620", fetchImpl as unknown as typeof fetch);
    await expect(tool.execute("c1", {}, undefined, undefined, { cwd: "/w" })).rejects.toThrow(
      "No SPOPI project window is open.",
    );
  });

  it("builds the URL without a double slash", () => {
    expect(screenshotUrl("http://127.0.0.1:1/", "/a b")).toBe(
      "http://127.0.0.1:1/api/ui/screenshot?cwd=%2Fa%20b",
    );
  });
});
