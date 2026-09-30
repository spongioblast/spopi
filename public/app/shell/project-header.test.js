// ABOUTME: Tests project header.
// ABOUTME: Includes "shows the workspace folder name in the files toggle".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n, setLocale } from "../i18n/i18n.js";
import { mountProjectHeader } from "./project-header.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

/** Mount the header DOM the module expects, built via DOM APIs (no innerHTML). */
function mountBaseHeader() {
  const filesToggle = document.createElement("button");
  filesToggle.id = "file-sidebar-toggle";
  filesToggle.className = "file-sidebar-toggle";
  filesToggle.title = "Files";
  filesToggle.setAttribute("aria-label", "Toggle file browser");
  const workspaceIndicator = document.createElement("span");
  workspaceIndicator.id = "workspace-indicator";
  workspaceIndicator.className = "file-sidebar-toggle__label hidden";
  filesToggle.append(workspaceIndicator);

  const diffToggle = document.createElement("button");
  diffToggle.id = "diff-sidebar-toggle";
  diffToggle.className = "git-branch-toggle hidden";
  const branchLabel = document.createElement("span");
  branchLabel.id = "git-branch-indicator";
  branchLabel.className = "git-branch-toggle__label";
  diffToggle.append(branchLabel);

  document.body.append(filesToggle, diffToggle);
}

describe("project header", () => {
  beforeEach(async () => {
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).includes("/locales/")) {
        return { ok: true, json: async () => enMessages };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    await createI18n();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows the workspace folder name in the files toggle", async () => {
    mountBaseHeader();
    const fullPath = "/Users/ShixinGuo/code/pi/pi-web-ui";
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({ info: { path: fullPath } }),
    };

    await mountProjectHeader({ data, workspaceId: "workspace-a" });

    const indicator = document.getElementById("workspace-indicator");
    const toggle = document.getElementById("file-sidebar-toggle");
    expect(data.workspaceInfo).toHaveBeenCalledWith("workspace-a");
    expect(indicator.textContent).toBe("pi-web-ui");
    expect(indicator.classList.contains("hidden")).toBe(false);
    expect(toggle.title).toBe(fullPath);
    expect(toggle.getAttribute("aria-label")).toBe(`Open Files panel — ${fullPath}`);
  });

  it("shows git branch toggle with branch name when git info is available", async () => {
    mountBaseHeader();
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({
        info: { path: "/some/path", gitBranch: "main" },
      }),
    };

    await mountProjectHeader({ data, workspaceId: "workspace-b" });

    const toggle = document.getElementById("diff-sidebar-toggle");
    const label = document.getElementById("git-branch-indicator");
    expect(toggle.classList.contains("hidden")).toBe(false);
    expect(label.textContent).toBe("main");
    expect(toggle.title).toContain("main");
  });

  it("hides git branch toggle when project has no git info", async () => {
    mountBaseHeader();
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({
        info: { path: "/some/non-git-path" },
      }),
    };

    await mountProjectHeader({ data, workspaceId: "workspace-c" });

    const toggle = document.getElementById("diff-sidebar-toggle");
    expect(toggle.classList.contains("hidden")).toBe(true);
  });

  it("leaves the path label hidden when workspace path is unavailable", async () => {
    mountBaseHeader();
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({ info: { gitBranch: "main" } }),
    };

    await mountProjectHeader({ data, workspaceId: "workspace-d" });

    const indicator = document.getElementById("workspace-indicator");
    const toggle = document.getElementById("file-sidebar-toggle");
    expect(indicator.classList.contains("hidden")).toBe(true);
    expect(indicator.textContent).toBe("");
    expect(toggle.title).toBe("Files");
    expect(toggle.getAttribute("aria-label")).toBe("Toggle file browser");
  });

  it("updates git pill visibility on every workspace switch, both directions", async () => {
    mountBaseHeader();
    const data = {
      workspaceInfo: vi
        .fn()
        .mockResolvedValueOnce({ info: { path: "/git/workspace", gitBranch: "main" } })
        .mockResolvedValueOnce({ info: { path: "/plain/workspace" } })
        .mockResolvedValueOnce({ info: { path: "/git/workspace-2", gitBranch: "feature/x" } }),
    };

    await mountProjectHeader({ data, workspaceId: "git-ws" });
    let toggle = document.getElementById("diff-sidebar-toggle");
    expect(toggle.classList.contains("hidden")).toBe(false);
    expect(document.getElementById("git-branch-indicator").textContent).toBe("main");

    await mountProjectHeader({ data, workspaceId: "plain-ws" });
    toggle = document.getElementById("diff-sidebar-toggle");
    expect(toggle.classList.contains("hidden")).toBe(true);

    await mountProjectHeader({ data, workspaceId: "git-ws-2" });
    toggle = document.getElementById("diff-sidebar-toggle");
    expect(toggle.classList.contains("hidden")).toBe(false);
    expect(document.getElementById("git-branch-indicator").textContent).toBe("feature/x");
  });

  it("keeps the latest workspace probe authoritative when earlier probes resolve late", async () => {
    mountBaseHeader();
    let resolveOldProbe;
    const data = {
      workspaceInfo: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOldProbe = resolve;
            }),
        )
        .mockResolvedValueOnce({ info: { path: "/new/workspace", gitBranch: "main" } }),
    };

    const oldProbe = mountProjectHeader({ data, workspaceId: "old-ws" });
    await mountProjectHeader({ data, workspaceId: "new-ws" });
    expect(document.getElementById("workspace-indicator").textContent).toBe("workspace");

    resolveOldProbe({ info: { path: "/old/workspace", gitBranch: "old-branch" } });
    await oldProbe;

    expect(document.getElementById("workspace-indicator").textContent).toBe("workspace");
    expect(document.getElementById("git-branch-indicator").textContent).toBe("main");
    expect(document.getElementById("diff-sidebar-toggle").classList.contains("hidden")).toBe(false);
  });

  it("drops the previous workspace's locale relabeling after a re-probe", async () => {
    mountBaseHeader();
    const data = {
      workspaceInfo: vi
        .fn()
        .mockResolvedValueOnce({ info: { path: "/old/workspace" } })
        // Second workspace has no path: its labels stay hidden and the old
        // workspace's listener must no longer overwrite them.
        .mockResolvedValueOnce({ info: { gitBranch: "main" } }),
    };

    await mountProjectHeader({ data, workspaceId: "old-ws" });
    await mountProjectHeader({ data, workspaceId: "new-ws" });

    await setLocale("en");

    const toggle = document.getElementById("file-sidebar-toggle");
    expect(toggle.title).toBe("Files");
    expect(toggle.getAttribute("aria-label")).toBe("Toggle file browser");
  });
});
