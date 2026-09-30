// ABOUTME: Verifies Git broker request correlation and generation safety.
// ABOUTME: Covers refusal before bootstrap, timeout cleanup, and workspace reset.

import { describe, expect, it, vi } from "vitest";
import { GitClient } from "./git-client.js";

describe("GitClient", () => {
  it("refuses commands before a workspace generation exists", () => {
    const send = vi.fn();
    const client = new GitClient({ send });
    expect(client.command({ type: "status" })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it("adds unique request ids and correlates responses", async () => {
    const send = vi.fn();
    const client = new GitClient({ send, timeoutMs: 100 });
    client.setWorkspaceGeneration(4);
    const requestId = client.command({ type: "status" });
    const promise = client._await(requestId, (m) => m.type === "git_status", 100);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, workspaceGeneration: 4 }),
    );
    expect(client.resolveResponse({ requestId, type: "git_status" })).toBe(true);
    await expect(promise).resolves.toMatchObject({ type: "git_status" });
  });
  it("resolves pending requests on reset", async () => {
    const client = new GitClient({ send: vi.fn() });
    client.setWorkspaceGeneration(1);
    const id = client.command({ type: "status" });
    const promise = client._await(id, () => true, 1000);
    client.reset();
    await expect(promise).resolves.toBeNull();
    expect(client.generation).toBeNull();
  });
  it("consumes only acknowledgements for pending writes in its generation", () => {
    const client = new GitClient({ send: vi.fn() });
    client.setWorkspaceGeneration(4);
    const writeId = client.write("stage", "snapshot", []);

    expect(client.consumeWriteAck({ requestId: "git-old", workspaceGeneration: 4 })).toBe(false);
    expect(client.consumeWriteAck({ requestId: writeId, workspaceGeneration: 3 })).toBe(false);
    expect(client.consumeWriteAck({ requestId: writeId, workspaceGeneration: 4 })).toBe(true);
    expect(client.consumeWriteAck({ requestId: writeId, workspaceGeneration: 4 })).toBe(false);
  });
  it("builds independent history command frames", () => {
    const send = vi.fn();
    const client = new GitClient({ send });
    client.setWorkspaceGeneration(7);
    const logId = client.log(50, null);
    const detailId = client.logDetail("aabb");
    const diffId = client.commitDiff("aabb", "YS50eHQ=");
    expect(new Set([logId, detailId, diffId]).size).toBe(3);
    expect(send.mock.calls.map(([frame]) => frame.command)).toEqual([
      { type: "log", limit: 50, before: null },
      { type: "log_detail", oid: "aabb" },
      { type: "commit_diff", commitOid: "aabb", pathBytesBase64: "YS50eHQ=" },
    ]);
  });
  it("releases a pending write when the broker reports failure", () => {
    const client = new GitClient({ send: vi.fn() });
    client.setWorkspaceGeneration(4);
    const writeId = client.write("stage", "snapshot", []);

    expect(client.consumeWriteFailure({ requestId: writeId, workspaceGeneration: 4 })).toBe(true);
    expect(client.consumeWriteAck({ requestId: writeId, workspaceGeneration: 4 })).toBe(false);
  });
  it("resolves HEAD text, rejects errors, and times out", async () => {
    const send = vi.fn();
    const client = new GitClient({ send, timeoutMs: 20 });
    client.setWorkspaceGeneration(1);
    const pending = client.fileAtHeadText("YS50eHQ=");
    const requestId = send.mock.calls[0][0].requestId;
    expect(
      client.resolveResponse({
        requestId,
        type: "git_file_at_head",
        content: "one\n",
        exists: true,
        binary: false,
      }),
    ).toBe(true);
    await expect(pending).resolves.toEqual({ content: "one\n", exists: true, binary: false });

    const failed = client.fileAtHeadText("YS50eHQ=");
    const failId = send.mock.calls[1][0].requestId;
    client.resolveResponse({ requestId: failId, type: "error", error: { message: "nope" } });
    await expect(failed).rejects.toThrow("nope");

    const slow = new GitClient({ send: vi.fn(), timeoutMs: 5 });
    slow.setWorkspaceGeneration(1);
    await expect(slow.fileAtHeadText("YS50eHQ=")).rejects.toThrow("git_timeout");
  });
});
