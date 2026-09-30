// ABOUTME: Tests app launcher startup.
// ABOUTME: Includes "resolves a project before navigating and does not navigate on failure".
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../i18n/i18n.js", () => ({
  createI18n: vi.fn().mockResolvedValue(undefined),
  t: (key) => key,
}));
vi.mock("../theme/themes.js", () => ({
  applyTheme: vi.fn(),
  getCurrentTheme: vi.fn(() => "night"),
}));

beforeEach(() => {
  vi.resetModules();
});

// Importing the module runs the launcher's start, which waits about two seconds
// for a host that jsdom never answers; a busy full run can pass five.
describe("app launcher startup", { timeout: 20_000 }, () => {
  it("resolves a project before navigating and does not navigate on failure", async () => {
    const { openLauncherSession } = await import("./app-launcher.js?session-navigation");
    const navigate = vi.fn();
    const control = { resolveWorkspace: vi.fn().mockResolvedValue("workspace-a") };
    const session = { id: "session-a", projectPath: "/projects/a" };

    await openLauncherSession(session, { control, navigate });

    expect(control.resolveWorkspace).toHaveBeenCalledWith("/projects/a");
    expect(navigate).toHaveBeenCalledWith("/app/workspaces/workspace-a/sessions/session-a");

    control.resolveWorkspace.mockRejectedValueOnce(new Error("project not found"));
    await expect(openLauncherSession(session, { control, navigate })).rejects.toThrow(
      "project not found",
    );
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("resumes the newest session and skips gone projects", async () => {
    const { resumeLatestSession } = await import("./app-launcher.js?resume-latest");
    const navigate = vi.fn();
    const control = {
      resolveWorkspace: vi.fn(async (path) => {
        if (path === "/gone") throw new Error("project not found");
        return "workspace-b";
      }),
    };
    const sessions = [
      { id: "no-project", projectPath: null },
      { id: "gone", projectPath: "/gone" },
      { id: "session-b", projectPath: "/projects/b" },
    ];

    await expect(resumeLatestSession(sessions, { control, navigate })).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledWith("/app/workspaces/workspace-b/sessions/session-b");
    await expect(resumeLatestSession([], { control, navigate })).resolves.toBe(false);
  });

  it("the + creates a project and opens its first chat when no project is open", async () => {
    const { mountLauncherNewProject } = await import("./app-launcher.js?new-project");
    document.body.innerHTML = `<aside id="sidebar"><button id="new-session-btn" class="hidden"></button></aside>`;
    const control = {
      createProject: vi.fn().mockResolvedValue({ workspaceId: "ws-new", projectPath: "/p" }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspaceId: "ws-new", sessionId: "temporary-1", instanceId: "i-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();

    mountLauncherNewProject(control, navigate);
    const button = document.getElementById("new-session-btn");
    expect(button.classList.contains("hidden")).toBe(false);
    button.click();

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/app/workspaces/ws-new/sessions/temporary-1"),
    );
    expect(control.createProject).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
