// ABOUTME: Tests exportSessionHtml against a fake runtime.
// ABOUTME: A missing path does not reveal anything.
import { describe, expect, it, vi } from "vitest";
import { exportSessionHtml } from "./session-export.js";

describe("exportSessionHtml", () => {
  it("requests export_html and reveals the returned path", async () => {
    const runtime = {
      request: vi.fn(async () => ({ response: { data: { path: "D:\\sessions\\one.html" } } })),
    };
    const control = { revealPath: vi.fn(async () => ({})), openExternal: vi.fn() };
    const result = await exportSessionHtml(runtime, { sessionId: "s1" }, control);
    expect(runtime.request).toHaveBeenCalledWith({ type: "export_html" }, { sessionId: "s1" });
    expect(control.revealPath).toHaveBeenCalledWith("D:\\sessions\\one.html");
    expect(control.openExternal).not.toHaveBeenCalled();
    expect(result.path).toBe("D:\\sessions\\one.html");
  });

  it("opens a file url when reveal is unavailable", async () => {
    const runtime = {
      request: vi.fn(async () => ({ response: { data: { path: "/tmp/session.html" } } })),
    };
    const control = { openExternal: vi.fn(async () => ({})) };
    await exportSessionHtml(runtime, null, control);
    expect(control.openExternal).toHaveBeenCalledWith("file:///tmp/session.html");
  });

  it("does nothing when export returns no path", async () => {
    const runtime = { request: vi.fn(async () => ({ response: { data: {} } })) };
    const control = { revealPath: vi.fn() };
    const result = await exportSessionHtml(runtime, null, control);
    expect(result.path).toBe("");
    expect(control.revealPath).not.toHaveBeenCalled();
  });
});
