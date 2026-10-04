// ABOUTME: Tests the /mcp session prompt and the notice that ends a sign-in.
// ABOUTME: The observer is the page's view of Pi's notify messages.

import { describe, expect, it, vi } from "vitest";
import {
  emitExtensionNotify,
  observeExtensionNotify,
} from "../../extension-ui/notify-observers.js";
import { firstUrl, isTerminalMcpNotice, runMcpSessionCommand } from "./mcp-session-actions.js";

describe("mcp session actions", () => {
  it("sends the slash line and linkifies the first url", async () => {
    const request = vi.fn(async () => ({}));
    await runMcpSessionCommand(
      { runtime: { request }, getTarget: () => ({ workspaceId: "w" }) },
      "login",
      "remote",
    );
    expect(request.mock.calls[0][0]).toEqual({
      type: "prompt",
      message: "/mcp login remote",
    });
    const url = "https://mcp.sentry.dev/oauth/start?x=1";
    expect(firstUrl(`Sign in:\n${url}`)).toBe(url);
  });

  it("ends on Pi's result text and on the observer", () => {
    expect(isTerminalMcpNotice('Signed in to MCP server "remote" (3 tools).')).toBe(true);
    expect(isTerminalMcpNotice("Sign-in cancelled.")).toBe(true);
    expect(isTerminalMcpNotice("still waiting")).toBe(false);
    const seen = [];
    const stop = observeExtensionNotify((notice) => seen.push(notice.message));
    emitExtensionNotify({ message: "hello", notifyType: "info" });
    stop();
    emitExtensionNotify({ message: "after" });
    expect(seen).toEqual(["hello"]);
  });
});
