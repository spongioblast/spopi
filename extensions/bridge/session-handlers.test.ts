// ABOUTME: Session title, tree, paste, and external links.
// ABOUTME: Each operation is called on its handler with a temporary Pi agent directory.
// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigContext, SpopiConfigResult } from "./paths";
import type { BridgeHandler } from "./types";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
  ModelRuntime: { create: vi.fn() },
  SessionManager: { inMemory: vi.fn(), listAll: vi.fn(), open: vi.fn() },
  getAgentDir: () =>
    process.env.PI_CODING_AGENT_DIR?.trim() || join(process.env.HOME || "", ".pi", "agent"),
  SettingsManager: { create: vi.fn() },
}));
vi.mock("./session-title", () => ({
  generateTitleForSession: vi.fn().mockResolvedValue("Generated title"),
}));
const tempHomes: string[] = [];

async function loadConfigWithTempHome() {
  const home = mkdtempSync(join(tmpdir(), "spopi-handler-"));
  tempHomes.push(home);
  vi.resetModules();
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
  process.env.APPDATA = join(home, "AppData", "Roaming");
  const { handlers } = await import("./session.ts");
  async function handleSpopiConfig(
    op: string,
    params: unknown,
    ctx: unknown,
  ): Promise<SpopiConfigResult> {
    try {
      const table = handlers as Record<string, BridgeHandler>;
      const handler = table[op];
      if (!handler) return { ok: false, error: `Unknown configuration operation: ${op}` };
      return await handler((ctx ?? {}) as ConfigContext, (params ?? {}) as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }
  return { home, handleSpopiConfig, handlers };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("session handlers", () => {
  it("renames a managed historical session through Pi SessionManager", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-config-session-"));
    tempHomes.push(home);
    const sessionPath = join(home, "session.jsonl");
    writeFileSync(sessionPath, '{"type":"session","id":"s1"}\n', "utf8");
    const appendSessionInfo = vi.fn();
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    vi.mocked(SessionManager.listAll).mockResolvedValue([{ path: sessionPath }] as never);
    vi.mocked(SessionManager.open).mockReturnValue({ appendSessionInfo } as never);
    const { handleSpopiConfig } = await loadConfigWithTempHome();

    await expect(
      handleSpopiConfig(
        "rename_historical_session",
        { filePath: sessionPath, name: "  Renamed session  " },
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      data: { filePath: realpathSync.native(sessionPath), name: "Renamed session" },
    });
    expect(SessionManager.open).toHaveBeenCalledWith(realpathSync.native(sessionPath));
    expect(appendSessionInfo).toHaveBeenCalledWith("Renamed session");
  });

  it("rejects unmanaged historical session paths", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-config-session-"));
    tempHomes.push(home);
    const sessionPath = join(home, "session.jsonl");
    writeFileSync(sessionPath, '{"type":"session","id":"s1"}\n', "utf8");
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    vi.mocked(SessionManager.listAll).mockResolvedValue([] as never);
    const { handleSpopiConfig } = await loadConfigWithTempHome();

    await expect(
      handleSpopiConfig(
        "rename_historical_session",
        { filePath: sessionPath, name: "Renamed session" },
        {},
      ),
    ).resolves.toEqual({ ok: false, error: "Session is not available." });
    expect(SessionManager.open).not.toHaveBeenCalled();
  });

  it("writes large pasted text into the active workspace scratch directory", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const workspace = join(home, "workspace");
    mkdirSync(workspace, { recursive: true });

    const result = await handleSpopiConfig(
      "write_paste_offload",
      { content: "large pasted text" },
      { cwd: workspace },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Paste offload failed");
    const relativePath = (result.data as { path: string }).path;
    expect(relativePath.startsWith(".pi/tmp/paste-")).toBe(true);
    expect(relativePath.endsWith(".txt")).toBe(true);
    expect(readFileSync(join(workspace, relativePath), "utf8")).toBe("large pasted text");
  });

  it("navigates the active session tree through Pi context", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const navigateTree = vi.fn().mockResolvedValue({ cancelled: false });

    await expect(
      handleSpopiConfig(
        "navigate_tree",
        { targetId: "entry-2", summarize: false, label: "Resume branch" },
        { navigateTree } as never,
      ),
    ).resolves.toEqual({ ok: true, data: { cancelled: false } });
    expect(navigateTree).toHaveBeenCalledWith("entry-2", {
      summarize: false,
      label: "Resume branch",
    });
  });

  it("rejects navigation without a target entry", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    await expect(
      handleSpopiConfig("navigate_tree", {}, { navigateTree: vi.fn() } as never),
    ).resolves.toEqual({ ok: false, error: "targetId is required" });
  });

  it("generates a title from the active persisted session", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    await expect(
      handleSpopiConfig(
        "generate_session_title",
        {},
        {
          model: { provider: "test", id: "model" },
          sessionManager: { getSessionFile: () => "/sessions/current.jsonl" },
        },
      ),
    ).resolves.toEqual({ ok: true, data: { title: "Generated title" } });
  });

  it("sets a label through Pi", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const setLabel = vi.fn();
    await expect(
      handleSpopiConfig("set_label", { entryId: "entry-1", label: "checkpoint" }, { setLabel }),
    ).resolves.toEqual({ ok: true });
    expect(setLabel).toHaveBeenCalledWith("entry-1", "checkpoint");
  });
});
