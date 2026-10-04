// ABOUTME: Tests workspaceFolderName.
// ABOUTME: Includes "returns a POSIX basename".
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n, t } from "../i18n/i18n.js";
import { resetUiStore, uiStore } from "../storage/ui-store.js";
import { noteHiddenPath, noteMissingPath, resetMissingWorkspaces } from "./missing-workspace.js";
import { clearSessionListCache, seedSessionListCache } from "./session-list-cache.js";
import { SessionSidebar } from "./session-sidebar.js";
import { formatSessionTime, workspaceFolderName } from "./session-sidebar-records.js";

// Test file lives at public/app/session/session-sidebar.test.js.
// i18n locale JSONs live at public/locales/en.json. Vitest's
// process.cwd() inside the jsdom test environment resolves to the
// test file's directory, not the repo root, so we derive the locale
// path from import.meta.url (always the real file URL under vitest ESM).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EN_LOCALE_PATH = join(__dirname, "..", "..", "locales", "en.json");
const enMessages = JSON.parse(readFileSync(EN_LOCALE_PATH, "utf8"));

function makeSidebar(sessions, overrides = {}) {
  const container = document.createElement("div");
  // Sessions default to the current workspace/project so they land in the
  // expanded current-project group unless the test overrides projectPath.
  const enriched = sessions.map((session) => ({
    projectPath: "/ws-1",
    projectName: "ws-1",
    isCurrentWorkspace: true,
    ...session,
  }));
  const data = {
    listAllSessions: vi.fn().mockResolvedValue({ sessions: enriched }),
    searchSessions: vi.fn().mockResolvedValue({ results: [] }),
  };
  const runtime = { request: vi.fn().mockResolvedValue({}) };
  const config = {
    call: vi.fn().mockResolvedValue({ ok: true, data: { title: "Generated title" } }),
  };
  const control = { deleteSessions: vi.fn().mockResolvedValue({ deleted: [], errors: [] }) };
  const onSelect = vi.fn();
  const sidebar = new SessionSidebar(container, {
    data,
    runtime,
    control,
    config,
    getTarget: () => ({ workspaceId: "ws-1", sessionId: "s-active" }),
    onSelect,
    ...overrides,
  });
  return { sidebar, container, data, runtime, config, control, onSelect };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  document.getElementById("dialog-container")?.remove();
  const dialogs = document.createElement("div");
  dialogs.id = "dialog-container";
  dialogs.className = "hidden";
  document.body.append(dialogs);
  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).includes("/locales/")) {
      return { ok: true, status: 200, json: async () => enMessages };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  await createI18n();
});

describe("workspaceFolderName", () => {
  it("returns a POSIX basename", () => {
    expect(workspaceFolderName("/Users/me/Documents/test")).toBe("test");
  });

  it("returns only the folder name for Windows extended UNC paths", () => {
    expect(workspaceFolderName(String.raw`\\?\UNC\psf\Home\Documents\test`)).toBe("test");
    expect(workspaceFolderName(String.raw`\\?\UNC\psf\Home\Documents\New project 2`)).toBe(
      "New project 2",
    );
  });

  it("prefers a clean projectName over a Windows path", () => {
    expect(workspaceFolderName(String.raw`C:\Users\me\proj`, "proj")).toBe("proj");
  });
});

describe("formatSessionTime", () => {
  it("renders relative labels instead of raw ISO strings", () => {
    const now = Date.now();
    expect(formatSessionTime(new Date(now - 30 * 1000).toISOString())).toBe("Just now");
    expect(formatSessionTime(new Date(now - 5 * 60 * 1000).toISOString())).toBe("5m ago");
    expect(formatSessionTime(new Date(now - 3 * 3600 * 1000).toISOString())).toBe("3h ago");
    expect(formatSessionTime(new Date(now - 26 * 3600 * 1000).toISOString())).toBe("Yesterday");
  });

  it("returns empty string for invalid input", () => {
    expect(formatSessionTime("")).toBe("");
    expect(formatSessionTime("not-a-date")).toBe("");
  });
});

describe("SessionSidebar.render", () => {
  beforeEach(async () => {
    clearSessionListCache();
    resetUiStore();
    // Load the English locale so context-menu labels resolve before
    // the first render. P6 i18n-ized the hardcoded "Rename" /
    // "Archive all sessions" entries; without this they read back
    // as their key strings.
    const enJson = readFileSync(EN_LOCALE_PATH, "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        if (String(input).includes("/locales/en.json")) {
          return new Response(enJson);
        }
        return new Response("{}", { status: 404 });
      }),
    );
    await createI18n();
    document.querySelectorAll(".session-context-menu").forEach((menu) => {
      menu.remove();
    });
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).includes("/locales/")) {
        return { ok: true, status: 200, json: async () => enMessages };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    await createI18n();
  });

  afterEach(() => {
    resetMissingWorkspaces();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("marks a missing folder and hides it after it is removed from the list", async () => {
    noteMissingPath("/gone");
    const { sidebar, container } = makeSidebar([
      {
        id: "s-gone",
        projectPath: "/gone",
        projectName: "gone",
        isCurrentWorkspace: false,
      },
    ]);
    await sidebar.load();
    const missing = container.querySelector(".project-missing");
    expect(missing).not.toBeNull();
    expect(
      missing?.getAttribute("title") ||
        container.querySelector(".project-name")?.getAttribute("title"),
    ).toContain("/gone");
    noteHiddenPath("/gone");
    sidebar.render();
    expect(container.querySelector(".project-missing")).toBeNull();
    expect(container.textContent).not.toContain("gone");
  });

  it("renders each session with a title and no visible timestamp", async () => {
    const { sidebar, container } = makeSidebar(
      [{ id: "s-1", timestamp: new Date().toISOString(), name: "Hello", firstMessage: "hi" }],
      { getTarget: () => ({ workspaceId: "ws-1", sessionId: "s-1" }) },
    );
    await sidebar.load();
    expect(container.querySelectorAll(".session-item")).toHaveLength(1);
    expect(container.querySelector(".session-title").textContent).toBe("Hello");
    expect(container.querySelector(".session-time")).toBeNull();
  });

  it("updates a generated session name while the agent is still running", async () => {
    const { sidebar, container } = makeSidebar([
      { id: "s-active", timestamp: new Date().toISOString(), firstMessage: "Help me name this" },
    ]);
    await sidebar.load();

    sidebar.setSessionName("s-active", "Generated in Parallel");

    expect(container.querySelector(".session-title").textContent).toBe("Generated in Parallel");
  });

  it("generates and persists a title for the active session", async () => {
    const { sidebar, container, config, runtime } = makeSidebar([
      { id: "s-active", timestamp: new Date().toISOString(), name: "Old title" },
    ]);
    await sidebar.load();
    const item = container.querySelector('.session-item[data-session-id="s-active"]');
    item.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    const generate = Array.from(document.querySelectorAll(".context-menu-item")).find((row) =>
      row.textContent.toLowerCase().includes("generate title"),
    );
    if (!generate) {
      const all = Array.from(document.querySelectorAll(".context-menu-item")).map(
        (row) => row.textContent,
      );
      throw new Error(`Generate title row missing. Rows: ${JSON.stringify(all)}`);
    }
    generate.click();

    await vi.waitFor(() =>
      expect(config.call).toHaveBeenCalledWith(
        "generate_session_title",
        {},
        { timeoutMs: 100_000, target: expect.objectContaining({ sessionId: "s-active" }) },
      ),
    );
    await vi.waitFor(() =>
      expect(runtime.request).toHaveBeenCalledWith(
        { type: "set_session_name", name: "Generated title" },
        expect.objectContaining({ sessionId: "s-active" }),
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      ),
    );
    expect(item.querySelector(".session-title").textContent).toBe("Generated title");
  });

  it("renames a historical session through Pi SessionManager config", async () => {
    const { sidebar, container, config, runtime } = makeSidebar([
      {
        id: "s-history",
        timestamp: new Date().toISOString(),
        name: "Old title",
        filePath: "/sessions/history.jsonl",
      },
    ]);
    config.call.mockResolvedValue({
      ok: true,
      data: { filePath: "/sessions/history.jsonl", name: "New title" },
    });
    await sidebar.load();
    const item = container.querySelector('.session-item[data-session-id="s-history"]');
    item.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    const rename = Array.from(document.querySelectorAll(".context-menu-item")).find((row) =>
      row.textContent.includes("Rename"),
    );
    if (!rename) {
      // Surface what was rendered so the test fails with a useful message
      // rather than the cryptic "Cannot read properties of undefined".
      const all = Array.from(document.querySelectorAll(".context-menu-item")).map(
        (row) => row.textContent,
      );
      throw new Error(`Rename row missing from context menu. Rows: ${JSON.stringify(all)}`);
    }
    rename.click();
    const input = item.querySelector(".session-rename-input");
    input.value = "New title";
    input.dispatchEvent(new FocusEvent("blur"));

    await vi.waitFor(() =>
      expect(config.call).toHaveBeenCalledWith("rename_historical_session", {
        filePath: "/sessions/history.jsonl",
        name: "New title",
      }),
    );
    expect(runtime.request).not.toHaveBeenCalled();
    expect(item.querySelector(".session-title").textContent).toBe("New title");
  });

  it("loads a targetless launcher catalog with an explicit cache scope", async () => {
    const loadSessions = vi.fn().mockResolvedValue({
      sessions: [
        {
          id: "s-launcher",
          timestamp: new Date().toISOString(),
          name: "Launcher session",
          projectPath: "/ws-launcher",
          projectName: "ws-launcher",
          isCurrentWorkspace: false,
        },
      ],
    });
    const { sidebar, container, data } = makeSidebar([], {
      getTarget: () => null,
      cacheScope: "launcher",
      loadSessions,
    });

    await sidebar.load();

    expect(loadSessions).toHaveBeenCalledOnce();
    expect(data.listAllSessions).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Launcher session");
  });

  it("loads the session list from the data gateway", async () => {
    const { sidebar, container, data } = makeSidebar([]);
    data.listAllSessions.mockResolvedValue({
      sessions: [
        {
          id: "s-live",
          timestamp: new Date().toISOString(),
          name: "From Pi",
          projectPath: "/ws-1",
          projectName: "ws-1",
          isCurrentWorkspace: true,
        },
      ],
    });

    await sidebar.load();

    expect(data.listAllSessions).toHaveBeenCalledWith("ws-1");
    expect(container.textContent).toContain("From Pi");
  });

  it("retries transient load failures before showing the manual retry error", async () => {
    vi.useFakeTimers();
    const { sidebar, container, data } = makeSidebar([], {
      getTarget: () => ({ workspaceId: "ws-1", sessionId: "s-1" }),
    });
    data.listAllSessions
      .mockRejectedValueOnce(new Error("Host disconnected before the data request completed"))
      .mockResolvedValueOnce({
        sessions: [
          {
            id: "s-1",
            timestamp: new Date().toISOString(),
            name: "Recovered",
            projectPath: "/ws-1",
            projectName: "ws-1",
            isCurrentWorkspace: true,
          },
        ],
      });

    await sidebar.load();
    expect(container.querySelector(".ui-loading")).not.toBeNull();
    expect(container.textContent).toContain("Loading sessions");
    expect(container.textContent).not.toContain("Failed to load sessions");

    await vi.advanceTimersByTimeAsync(250);

    expect(data.listAllSessions).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".session-item")).toHaveLength(1);
    expect(container.querySelector(".session-title").textContent).toBe("Recovered");
  });

  it("renders a cached session list immediately while refreshing in the background", async () => {
    const pending = deferred();
    seedSessionListCache("ws-1", [
      {
        id: "s-cached",
        timestamp: new Date().toISOString(),
        name: "Cached",
        projectPath: "/ws-1",
        projectName: "ws-1",
        isCurrentWorkspace: true,
      },
    ]);
    const { sidebar, container, data } = makeSidebar([]);
    data.listAllSessions.mockReturnValueOnce(pending.promise);

    const load = sidebar.load();

    expect(container.textContent).toContain("Cached");
    expect(container.textContent).not.toContain("Loading sessions");

    pending.resolve({
      sessions: [
        {
          id: "s-fresh",
          timestamp: new Date().toISOString(),
          name: "Fresh",
          projectPath: "/ws-1",
          projectName: "ws-1",
          isCurrentWorkspace: true,
        },
      ],
    });
    await load;

    expect(container.textContent).toContain("Fresh");
    expect(container.textContent).not.toContain("Cached");
  });

  it("keeps cached sessions when an early host response is empty", async () => {
    const sessions = [
      {
        id: "s-active",
        timestamp: "2026-08-09T01:00:00.000Z",
        name: "Current session",
        projectPath: "/ws-1",
        projectName: "ws-1",
        isCurrentWorkspace: true,
      },
      {
        id: "s-other",
        timestamp: "2026-08-09T02:00:00.000Z",
        name: "Other",
        projectPath: "/ws-2",
        projectName: "ws-2",
        isCurrentWorkspace: false,
      },
    ];
    seedSessionListCache("ws-1", sessions);
    const { sidebar, container, data } = makeSidebar([]);
    data.listAllSessions.mockResolvedValueOnce({ sessions: [] });

    await sidebar.load();

    expect(container.querySelector('[data-session-id="s-active"]')).not.toBeNull();
    expect(sidebar.sessions).toHaveLength(2);
  });

  it("clears a cached in-progress status when the live session list has no runtime status", async () => {
    const pending = deferred();
    seedSessionListCache("ws-1", [
      {
        id: "s-interrupted",
        timestamp: new Date().toISOString(),
        name: "Interrupted",
        projectPath: "/ws-1",
        projectName: "ws-1",
        isCurrentWorkspace: true,
        status: "working",
      },
    ]);
    const { sidebar, container, data } = makeSidebar([]);
    data.listAllSessions.mockReturnValueOnce(pending.promise);

    const load = sidebar.load();
    expect(
      container
        .querySelector('.session-item[data-session-id="s-interrupted"]')
        .classList.contains("streaming"),
    ).toBe(true);

    pending.resolve({
      sessions: [
        {
          id: "s-interrupted",
          timestamp: new Date().toISOString(),
          name: "Interrupted",
          projectPath: "/ws-1",
          projectName: "ws-1",
          isCurrentWorkspace: true,
        },
      ],
    });
    await load;

    expect(
      container
        .querySelector('.session-item[data-session-id="s-interrupted"]')
        .classList.contains("streaming"),
    ).toBe(false);
  });

  it("falls back to the latest cached session list for a workspace without its own cache", async () => {
    const pending = deferred();
    seedSessionListCache("latest", [
      {
        id: "s-old-project",
        timestamp: new Date().toISOString(),
        name: "Old project",
        projectPath: "/old",
        projectName: "old",
        isCurrentWorkspace: true,
      },
      {
        id: "s-new-project",
        timestamp: new Date().toISOString(),
        name: "New project",
        projectPath: "/new",
        projectName: "new",
        isCurrentWorkspace: false,
      },
    ]);
    const { sidebar, container, data } = makeSidebar([], {
      getTarget: () => ({ workspaceId: "ws-2", sessionId: "s-new-project" }),
    });
    data.listAllSessions.mockReturnValueOnce(pending.promise);

    const load = sidebar.load();

    expect(container.textContent).toContain("New project");
    expect(
      container.querySelector(".project-group.current-project .project-name").textContent,
    ).toBe("new");
    expect(container.textContent).not.toContain("Loading sessions");

    pending.resolve({ sessions: [] });
    await load;
  });

  it("does not rerender when the refreshed session list is unchanged", async () => {
    const session = {
      id: "s-1",
      timestamp: new Date().toISOString(),
      name: "One",
      projectPath: "/ws-1",
      projectName: "ws-1",
      isCurrentWorkspace: true,
    };
    seedSessionListCache("ws-1", [session]);
    const { sidebar } = makeSidebar([]);
    sidebar.data.listAllSessions.mockResolvedValueOnce({ sessions: [session] });
    const render = vi.spyOn(sidebar, "render");

    await sidebar.load();

    expect(render).toHaveBeenCalledTimes(1);
  });

  it("upserts a newly bound session so it appears before the host list refresh catches up", async () => {
    const { sidebar, container } = makeSidebar([]);

    sidebar.upsertSession({
      id: "s-new",
      firstMessage: "Start with this request",
      timestamp: "2026-07-22T00:00:00.000Z",
      modifiedAtMs: 1,
      isCurrentWorkspace: true,
    });

    expect(container.querySelectorAll(".session-item")).toHaveLength(1);
    expect(container.querySelector(".session-title").textContent).toBe("Start with this request");
    expect(container.querySelector(".session-item").dataset.sessionId).toBe("s-new");

    sidebar.upsertSession({
      id: "s-new",
      firstMessage: "Follow-up should not replace the first title",
      modifiedAtMs: 2,
    });

    expect(container.querySelectorAll(".session-item")).toHaveLength(1);
    expect(container.querySelector(".session-title").textContent).toBe("Start with this request");
  });

  it("marks the active session", async () => {
    const { sidebar, container } = makeSidebar([
      { id: "s-active", timestamp: new Date().toISOString(), name: "Current" },
      { id: "s-2", timestamp: new Date().toISOString(), name: "Other" },
    ]);
    await sidebar.load();
    const active = container.querySelector(".session-item.active");
    expect(active?.dataset.sessionId).toBe("s-active");
  });

  it("invokes onSelect with the session object on click", async () => {
    const { sidebar, container, onSelect } = makeSidebar([
      { id: "s-2", timestamp: new Date().toISOString(), name: "Other" },
    ]);
    await sidebar.load();
    container.querySelector('.session-item[data-session-id="s-2"]').click();
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s-2", isCurrentWorkspace: true }),
    );
  });

  it("groups sessions by project and opens other projects in a new window", async () => {
    const { sidebar, container, onSelect } = makeSidebar([
      {
        id: "s-there",
        timestamp: new Date().toISOString(),
        name: "There",
        projectPath: "/other",
        projectName: "other",
        isCurrentWorkspace: false,
      },
      { id: "s-here", timestamp: new Date().toISOString(), name: "Here" },
    ]);
    await sidebar.load();
    const groups = container.querySelectorAll(".project-group");
    expect(groups).toHaveLength(2);
    // Project order follows the incoming recency order, even when the active
    // project appears later in the list.
    expect(groups[0].classList.contains("current-project")).toBe(false);
    expect(groups[0].querySelector(".project-name").textContent).toBe("other");
    expect(groups[1].classList.contains("current-project")).toBe(true);
    expect(groups[1].querySelector(".project-sessions").classList.contains("collapsed")).toBe(
      false,
    );
    expect(groups[0].querySelector(".project-sessions").classList.contains("collapsed")).toBe(true);
    container.querySelector('.session-item[data-session-id="s-there"]').click();
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s-there", projectPath: "/other", isCurrentWorkspace: false }),
    );
  });

  it("still toggles a project when saving its collapsed state exceeds storage quota", async () => {
    const { sidebar, container } = makeSidebar([
      {
        id: "s-other",
        timestamp: new Date().toISOString(),
        name: "Other",
        projectPath: "/other",
        projectName: "other",
        isCurrentWorkspace: false,
      },
    ]);
    await sidebar.load();

    const originalSetItem = uiStore.setItem.bind(uiStore);
    vi.spyOn(uiStore, "setItem").mockImplementation((key, value) => {
      if (key === "ui.sessions.projectsCollapsed") {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      originalSetItem(key, value);
    });

    const project = container.querySelector(".project-group");
    const fold = project.querySelector(".project-group-toggle");
    const sessions = project.querySelector(".project-sessions");
    expect(sessions.classList.contains("collapsed")).toBe(true);

    fold.click();

    expect(sessions.classList.contains("collapsed")).toBe(false);
    vi.restoreAllMocks();
  });

  it("shows the current project new-chat button for LAN clients", async () => {
    delete globalThis.__TAURI__;
    const onCreateSession = vi.fn().mockResolvedValue(undefined);
    const { sidebar, container } = makeSidebar(
      [{ id: "s-here", timestamp: new Date().toISOString(), name: "Here" }],
      { onCreateSession },
    );

    await sidebar.load();

    const button = container.querySelector(".current-project .project-new-chat-btn");
    expect(button).toBeTruthy();
    button.click();
    await vi.waitFor(() => expect(onCreateSession).toHaveBeenCalledWith("ws-1"));
  });

  it("keeps show more and show less controls for non-current project groups", async () => {
    const sessions = Array.from({ length: 12 }, (_, index) => ({
      id: `other-${index}`,
      timestamp: new Date(Date.now() - index * 1000).toISOString(),
      name: `Other ${index}`,
      projectPath: "/other",
      projectName: "other",
      isCurrentWorkspace: false,
    }));
    const { sidebar, container } = makeSidebar(sessions);

    await sidebar.load();

    let group = container.querySelector(".project-group");
    expect(group.querySelectorAll(".session-item")).toHaveLength(8);
    const showMore = group.querySelector(
      ".project-sessions-toggle:not(.project-sessions-toggle-less)",
    );
    expect(showMore).toBeTruthy();
    expect(group.querySelector(".project-sessions-toggle-less")).toBeNull();

    showMore.click();

    group = container.querySelector(".project-group");
    expect(group.querySelectorAll(".session-item")).toHaveLength(12);
    expect(
      group.querySelector(".project-sessions-toggle:not(.project-sessions-toggle-less)"),
    ).toBeNull();
    expect(group.querySelector(".project-sessions-toggle-less")).toBeTruthy();

    group.querySelector(".project-sessions-toggle-less").click();

    expect(
      container.querySelector(".project-group").querySelectorAll(".session-item"),
    ).toHaveLength(8);
  });

  it("groups favourites and archived into separate sections", async () => {
    const { sidebar, container } = makeSidebar([
      { id: "s-fav", timestamp: new Date().toISOString(), name: "Fav" },
      { id: "s-arc", timestamp: new Date().toISOString(), name: "Arc" },
      { id: "s-reg", timestamp: new Date().toISOString(), name: "Reg" },
    ]);
    sidebar.toggleFavourite("s-fav");
    sidebar.toggleArchived("s-arc");
    await sidebar.load();
    expect(container.querySelector(".archived-group")).toBeNull();
    expect(
      container.querySelector('.projects-group .session-item[data-session-id="s-fav"]'),
    ).toBeTruthy();
    expect(container.querySelector(".project-archived-toggle").textContent).toContain("1");
    container.querySelector(".project-archived-toggle").click();
    expect(
      container.querySelector('.project-group .session-item[data-session-id="s-arc"]'),
    ).toBeTruthy();
  });

  it("archives every session in a project from the project header context menu", async () => {
    const { sidebar, container } = makeSidebar([
      { id: "s-fav", timestamp: new Date().toISOString(), name: "Fav" },
      { id: "s-keep", timestamp: new Date().toISOString(), name: "Keep" },
      {
        id: "s-other",
        timestamp: new Date().toISOString(),
        name: "Other",
        projectPath: "/other",
        projectName: "other",
        isCurrentWorkspace: false,
      },
    ]);
    sidebar.toggleFavourite("s-fav");
    await sidebar.load();

    const currentHeader = container.querySelector(".project-group.current-project .project-header");
    currentHeader.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const menuItem = [
      ...document.querySelectorAll(".session-context-menu .context-menu-item"),
    ].find((el) => el.textContent?.includes("Archive sessions"));
    expect(menuItem).toBeTruthy();
    menuItem.click();

    expect(sidebar.isArchived("s-fav")).toBe(true);
    expect(sidebar.isArchived("s-keep")).toBe(true);
    expect(sidebar.isArchived("s-other")).toBe(false);
    expect(sidebar.isFavourite("s-fav")).toBe(false);
    expect(container.querySelector(".project-archived-toggle").textContent).toContain("2");
    expect(container.querySelector(".archived-group")).toBeNull();
  });

  it("shows a delete-all button on the archived header that deletes archived sessions after confirming", async () => {
    const { sidebar, container, control } = makeSidebar([
      { id: "s-arc-1", timestamp: new Date().toISOString(), name: "Arc 1" },
      { id: "s-arc-2", timestamp: new Date().toISOString(), name: "Arc 2" },
    ]);
    sidebar.toggleArchived("s-arc-1");
    sidebar.toggleArchived("s-arc-2");
    await sidebar.load();

    const deleteAllBtn = container.querySelector(".project-archived-row .archived-delete-all-btn");
    expect(deleteAllBtn).toBeTruthy();
    control.deleteSessions.mockResolvedValueOnce({ deleted: ["s-arc-1", "s-arc-2"], errors: [] });
    deleteAllBtn.click();

    // Confirmation dialog is shown; accept it.
    const confirmDialog = document.querySelector(".dialog");
    expect(confirmDialog).toBeTruthy();
    document.querySelector(".ui-button--danger").click();
    await vi.waitFor(() => expect(container.querySelector(".project-archived-row")).toBeFalsy());

    expect(control.deleteSessions).toHaveBeenCalledWith(["s-arc-1", "s-arc-2"]);
    expect(sidebar.isArchived("s-arc-1")).toBe(false);
  });

  it("drops an archived empty chat that has no file, and keeps a saved one the host could not delete", async () => {
    const { sidebar, container, control } = makeSidebar([
      { id: "s-empty", timestamp: new Date().toISOString() },
      { id: "s-saved", timestamp: new Date().toISOString(), filePath: "/s/saved.jsonl" },
    ]);
    sidebar.toggleArchived("s-empty");
    sidebar.toggleArchived("s-saved");
    await sidebar.load();
    control.deleteSessions.mockResolvedValueOnce({ deleted: [], errors: ["s-empty", "s-saved"] });
    container.querySelector(".project-archived-row .archived-delete-all-btn").click();
    document.querySelector(".ui-button--danger").click();

    await vi.waitFor(() => expect(sidebar.isArchived("s-empty")).toBe(false));
    expect(sidebar.sessions.some((session) => session.id === "s-empty")).toBe(false);
    expect(sidebar.isArchived("s-saved")).toBe(true);
  });

  it("focuses Cancel and dismisses archived deletion on Escape or click-outside", async () => {
    const { sidebar, container, control } = makeSidebar([
      { id: "s-arc-1", timestamp: new Date().toISOString(), name: "Arc 1" },
    ]);
    sidebar.toggleArchived("s-arc-1");
    await sidebar.load();
    const deleteAllBtn = container.querySelector(".project-archived-row .archived-delete-all-btn");
    deleteAllBtn.click();
    expect(document.activeElement).toBe(
      document.querySelector(".dialog-actions .ui-button--secondary"),
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();
    expect(control.deleteSessions).not.toHaveBeenCalled();
    expect(document.querySelector(".dialog")).toBeNull();

    deleteAllBtn.click();
    document
      .getElementById("dialog-container")
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await Promise.resolve();
    expect(control.deleteSessions).not.toHaveBeenCalled();
    expect(document.querySelector(".dialog")).toBeNull();
  });

  it("workspace context menu deletes a project's deletable sessions after confirming", async () => {
    const onCreateSession = vi.fn().mockResolvedValue(undefined);
    const { sidebar, container, control } = makeSidebar(
      [
        { id: "s-1", timestamp: new Date().toISOString(), name: "One" },
        { id: "s-2", timestamp: new Date().toISOString(), name: "Two" },
        { id: "s-live", timestamp: new Date().toISOString(), name: "Live" },
      ],
      { onCreateSession },
    );
    await sidebar.load();
    sidebar.setActive("s-1"); // the open session goes too; the chat moves to a fresh one first
    sidebar.setStreaming("s-live", true); // a running session is never batch-deleted

    const header = container.querySelector(".project-group-header");
    header.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 8,
        clientY: 8,
      }),
    );
    const rows = [...document.querySelectorAll(".session-context-menu .context-menu-item")];
    const deleteRow = rows.find((el) => el.textContent === "Delete all sessions");
    expect(deleteRow).toBeTruthy();

    control.deleteSessions.mockResolvedValueOnce({ deleted: ["s-1", "s-2"], errors: [] });
    deleteRow.click();
    document.querySelector(".ui-button--danger").click();
    await vi.waitFor(() => expect(control.deleteSessions).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.textContent).not.toContain("Two"));

    expect(onCreateSession).toHaveBeenCalledWith("ws-1");
    expect(onCreateSession.mock.invocationCallOrder[0]).toBeLessThan(
      control.deleteSessions.mock.invocationCallOrder[0],
    );
    expect(control.deleteSessions).toHaveBeenCalledWith(["s-1", "s-2"]);
    expect(container.textContent).not.toContain("One");
    expect(container.textContent).toContain("Live");
  });

  it("project menu copies the folder path and reveals only the open project", async () => {
    const revealPath = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { sidebar, container, control } = makeSidebar([
      { id: "s-1", timestamp: new Date().toISOString(), name: "One" },
    ]);
    control.revealPath = revealPath;
    await sidebar.load();
    const header = container.querySelector(".project-group-header");
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const rows = [...document.querySelectorAll(".session-context-menu .context-menu-item")];
    const labels = rows.map((el) => el.textContent);
    expect(labels).toContain("Reveal in Explorer");
    rows.find((el) => el.textContent === "Copy path").click();
    expect(writeText).toHaveBeenCalledWith("/ws-1");
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    [...document.querySelectorAll(".session-context-menu .context-menu-item")]
      .find((el) => el.textContent === "Reveal in Explorer")
      .click();
    expect(revealPath).toHaveBeenCalledWith("/ws-1", { workspaceId: "ws-1" });
    vi.unstubAllGlobals();
  });

  it("the project + starts a session in that project, open or not, without the desktop bridge", async () => {
    const onCreateSession = vi.fn().mockResolvedValue(undefined);
    const onCreateSessionInProject = vi.fn().mockResolvedValue(undefined);
    const { sidebar, container } = makeSidebar(
      [
        { id: "s-1", timestamp: new Date().toISOString(), name: "Here" },
        {
          id: "s-2",
          timestamp: new Date().toISOString(),
          name: "There",
          projectPath: "/other",
          projectName: "other",
          isCurrentWorkspace: false,
        },
      ],
      { onCreateSession, onCreateSessionInProject },
    );
    await sidebar.load();
    const buttons = [...container.querySelectorAll(".project-group .project-new-chat-btn")];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const header = button.closest(".project-group-header");
      const fold = header?.querySelector(".project-group-toggle");
      expect(header?.getAttribute("role")).toBeNull();
      expect(fold?.contains(button)).toBe(false);
      expect(button.parentElement).toBe(header);
    }
    container.querySelector(".project-group.current-project .project-new-chat-btn").click();
    expect(onCreateSession).toHaveBeenCalledWith("ws-1");
    container.querySelector(".project-group:not(.current-project) .project-new-chat-btn").click();
    expect(onCreateSessionInProject).toHaveBeenCalledWith("/other");
  });

  it("marks a just-started, unsaved session at the top of its project until it is saved", async () => {
    const { sidebar, container } = makeSidebar([
      { id: "s-1", timestamp: new Date().toISOString(), name: "Older" },
    ]);
    await sidebar.load();
    sidebar.setActive("temporary-abc");
    const unsaved = container.querySelector(".project-group.current-project .session-item-unsaved");
    expect(unsaved?.textContent).toBe("New session");
    expect(unsaved?.classList.contains("active")).toBe(true);
    sidebar.setActive("s-1");
    expect(container.querySelector(".session-item-unsaved")).toBeNull();
  });

  it("marks a new session that already has Pi's id from an adopted standby", async () => {
    const { sidebar, container } = makeSidebar([
      { id: "s-1", timestamp: new Date().toISOString(), name: "Older" },
    ]);
    await sidebar.load();
    sidebar.setActive("s-1");
    expect(container.querySelector(".session-item-unsaved")).toBeNull();
    sidebar.setActive("01a0e70e-da8d-7536-a901-183cdae19e16");
    const unsaved = container.querySelector(".project-group.current-project .session-item-unsaved");
    expect(unsaved?.dataset.sessionId).toBe("01a0e70e-da8d-7536-a901-183cdae19e16");
    expect(container.querySelector('.session-item.active[data-session-id="s-1"]')).toBeNull();
  });

  it("a new session with no siblings groups under the real project folder", async () => {
    const { sidebar, container, data } = makeSidebar([]);
    data.workspaceInfo = vi.fn().mockResolvedValue({ info: { path: "D:\\work\\todo-app" } });
    await sidebar.load();
    sidebar.upsertSession({ id: "s-new", firstMessage: "hi", timestamp: new Date().toISOString() });
    await vi.waitFor(() =>
      expect(container.querySelector(".project-name")?.textContent).toBe("todo-app"),
    );
    expect(data.workspaceInfo).toHaveBeenCalledWith("ws-1");
    expect(sidebar.sessions[0].projectPath).toBe("D:\\work\\todo-app");
  });

  it("a new project with no saved chat shows as the open project, not the old one", async () => {
    const { sidebar, container, data } = makeSidebar(
      [
        {
          id: "s-old",
          name: "hi",
          timestamp: new Date().toISOString(),
          projectPath: "D:\\projects\\old",
          projectName: "old",
          isCurrentWorkspace: false,
        },
      ],
      { getTarget: () => ({ workspaceId: "ws-1", sessionId: "temporary-abc" }) },
    );
    data.workspaceInfo = vi.fn().mockResolvedValue({ info: { path: "D:\\projects\\new" } });
    await sidebar.load();
    await vi.waitFor(() =>
      expect(
        container.querySelector(".project-group.current-project .project-name")?.textContent,
      ).toBe("new"),
    );
    const current = container.querySelector(".project-group.current-project");
    expect(current?.querySelector(".session-item-unsaved")?.dataset.sessionId).toBe(
      "temporary-abc",
    );
    const other = [...container.querySelectorAll(".project-group:not(.current-project)")];
    expect(other.map((group) => group.querySelector(".project-name")?.textContent)).toEqual([
      "old",
    ]);
  });

  it("files a new chat under the open project, never under another project's chat", async () => {
    const { sidebar, container, data } = makeSidebar([
      {
        id: "s-old",
        name: "hi",
        timestamp: new Date().toISOString(),
        projectPath: "D:\\projects\\old",
        projectName: "old",
        isCurrentWorkspace: false,
      },
    ]);
    data.workspaceInfo = vi.fn().mockResolvedValue({ info: { path: "D:\\projects\\new" } });
    await sidebar.load();
    sidebar.upsertSession({ id: "s-new", timestamp: new Date().toISOString() });
    await vi.waitFor(() =>
      expect(
        container.querySelector(".project-group.current-project .project-name")?.textContent,
      ).toBe("new"),
    );
    const created = sidebar.sessions.find((session) => session.id === "s-new");
    expect(created?.projectPath).toBe("D:\\projects\\new");
    const old = sidebar.sessions.find((session) => session.id === "s-old");
    expect(old?.isCurrentWorkspace).toBe(false);
  });

  it("keeps the open session when a fresh one cannot be started", async () => {
    const onCreateSession = vi.fn().mockRejectedValue(new Error("no host"));
    const { sidebar, control } = makeSidebar(
      [
        { id: "s-1", timestamp: new Date().toISOString(), name: "One" },
        { id: "s-2", timestamp: new Date().toISOString(), name: "Two" },
      ],
      { onCreateSession },
    );
    await sidebar.load();
    sidebar.setActive("s-1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deleting = sidebar.deleteWorkspaceSessions({ path: "/ws-1", name: "ws-1" });
    document.querySelector(".ui-button--danger").click();
    await deleting;
    expect(control.deleteSessions).toHaveBeenCalledWith(["s-2"]);
  });

  it("workspace delete-all works from the pinned-workspace menu shape (no sessions array)", async () => {
    const { sidebar, container, control } = makeSidebar([
      { id: "pin-1", timestamp: new Date().toISOString(), name: "Pinned One" },
      { id: "pin-2", timestamp: new Date().toISOString(), name: "Pinned Two" },
      {
        id: "sa-1",
        timestamp: new Date().toISOString(),
        name: "Super Agent",
        projectPath: "/Users/me/.pi/agent/super-agent",
      },
    ]);
    await sidebar.load();

    // The pinned-workspace context menu passes only { path, name } — no
    // sessions array (session-sidebar.js #renderPinnedWorkspaces call site).
    // Regression: deleteWorkspaceSessions derived ids from project?.sessions
    // and silently no-op'd for this shape.
    control.deleteSessions.mockResolvedValueOnce({ deleted: ["pin-1", "pin-2"], errors: [] });
    const deleting = sidebar.deleteWorkspaceSessions({ path: "/ws-1", name: "ws-1" });
    document.querySelector(".ui-button--danger").click();
    await deleting;

    // Ids derive from this.sessions filtered by projectPath === path; other
    // projects' sessions stay.
    expect(control.deleteSessions).toHaveBeenCalledWith(["pin-1", "pin-2"]);
    expect(container.textContent).not.toContain("Pinned One");
    expect(container.textContent).toContain("Super Agent");
  });

  it("cancelling the delete-all confirm dialog keeps archived sessions", async () => {
    const { sidebar, container, control } = makeSidebar([
      { id: "s-arc", timestamp: new Date().toISOString(), name: "Arc" },
    ]);
    sidebar.toggleArchived("s-arc");
    await sidebar.load();

    container.querySelector(".archived-delete-all-btn").click();
    document.querySelector(".dialog-actions .ui-button--secondary").click();
    await Promise.resolve();

    expect(control.deleteSessions).not.toHaveBeenCalled();
    expect(sidebar.isArchived("s-arc")).toBe(true);
  });

  it("drives streaming indicator classes", async () => {
    const { sidebar, container } = makeSidebar([
      { id: "s-1", timestamp: new Date().toISOString(), name: "One" },
    ]);
    await sidebar.load();
    sidebar.setStreaming("s-1", true);
    expect(container.querySelector('.session-item[data-session-id="s-1"]').classList).toContain(
      "streaming",
    );
    sidebar.setStreaming("s-1", false);
    expect(
      container
        .querySelector('.session-item[data-session-id="s-1"]')
        .classList.contains("streaming"),
    ).toBe(false);
  });

  it("hydrates unread and in-progress statuses from session summaries", async () => {
    const { sidebar, container } = makeSidebar([
      {
        id: "s-active",
        timestamp: new Date().toISOString(),
        name: "Active",
        status: "working",
        unread: true,
      },
      {
        id: "s-background",
        timestamp: new Date().toISOString(),
        name: "Background",
        status: "working",
        unread: true,
      },
    ]);
    await sidebar.load();
    expect(
      container.querySelector('.session-item[data-session-id="s-active"]').classList,
    ).toContain("streaming");
    expect(
      container
        .querySelector('.session-item[data-session-id="s-active"]')
        .classList.contains("unread"),
    ).toBe(false);
    expect(
      container.querySelector('.session-item[data-session-id="s-background"]').classList,
    ).toContain("streaming");
    expect(
      container.querySelector('.session-item[data-session-id="s-background"]').classList,
    ).toContain("unread");
  });
});

describe("SessionSidebar.pinned", () => {
  beforeEach(() => {
    clearSessionListCache();
    resetUiStore();
  });

  it("renders no PINNED section when nothing is pinned", async () => {
    const { sidebar, container } = makeSidebar([
      {
        id: "s-1",
        filePath: "/sessions/s-1.jsonl",
        timestamp: new Date().toISOString(),
        name: "Hello",
      },
    ]);
    await sidebar.load();
    expect(container.querySelector(".pinned-group")).toBeNull();
  });

  it("shows only the folder name for Windows UNC pinned workspaces", async () => {
    const winPath = String.raw`\\?\UNC\psf\Home\Documents\test`;
    const { sidebar, container } = makeSidebar([
      {
        id: "s-win",
        filePath: "/sessions/s-win.jsonl",
        timestamp: new Date().toISOString(),
        name: "Hello",
        projectPath: winPath,
        projectName: winPath,
      },
    ]);
    await sidebar.load();
    sidebar.pinnedStore.pinWorkspace(winPath, winPath);
    await sidebar.load();
    const nameEl = container.querySelector(".pinned-workspace-group .workspace-name");
    expect(nameEl?.textContent).toBe("test");
    expect(nameEl?.title).toBe(winPath);
  });

  it("renders a PINNED section listing pinned workspace sessions", async () => {
    const { sidebar, container } = makeSidebar([
      {
        id: "s-1",
        filePath: "/sessions/s-1.jsonl",
        timestamp: new Date().toISOString(),
        name: "Hello",
      },
      {
        id: "s-2",
        filePath: "/sessions/s-2.jsonl",
        timestamp: new Date().toISOString(),
        name: "World",
      },
    ]);
    await sidebar.load();
    sidebar.pinnedStore.pinWorkspace("/ws-1", "/ws-1");
    await sidebar.load();
    const group = container.querySelector(".pinned-group");
    expect(group).not.toBeNull();
    expect(group.querySelector(".pinned-workspace-group")).not.toBeNull();
    expect(group.querySelectorAll(".pinned-workspace-group .session-item")).toHaveLength(2);
    expect(group.textContent).toContain("PINNED");
  });

  it("keeps show more and show less controls for pinned workspace sessions", async () => {
    const sessions = Array.from({ length: 12 }, (_, index) => ({
      id: `pinned-${index}`,
      filePath: `/sessions/pinned-${index}.jsonl`,
      timestamp: new Date(Date.now() - index * 1000).toISOString(),
      name: `Pinned ${index}`,
    }));
    const { sidebar, container } = makeSidebar(sessions);

    await sidebar.load();
    sidebar.pinnedStore.pinWorkspace("/ws-1", "/ws-1");
    await sidebar.load();

    let group = container.querySelector(".pinned-workspace-group");
    expect(group.querySelectorAll(".session-item")).toHaveLength(8);
    const showMore = group.querySelector(
      ".project-sessions-toggle:not(.project-sessions-toggle-less)",
    );
    expect(showMore).toBeTruthy();
    expect(group.querySelector(".project-sessions-toggle-less")).toBeNull();

    showMore.click();

    group = container.querySelector(".pinned-workspace-group");
    expect(group.querySelectorAll(".session-item")).toHaveLength(12);
    expect(
      group.querySelector(".project-sessions-toggle:not(.project-sessions-toggle-less)"),
    ).toBeNull();
    expect(group.querySelector(".project-sessions-toggle-less")).toBeTruthy();

    group.querySelector(".project-sessions-toggle-less").click();

    expect(
      container.querySelector(".pinned-workspace-group").querySelectorAll(".session-item"),
    ).toHaveLength(8);
  });

  it("excludes workspace-pinned sessions from the regular project list", async () => {
    const { sidebar, container } = makeSidebar([
      {
        id: "s-1",
        filePath: "/sessions/s-1.jsonl",
        timestamp: new Date().toISOString(),
        name: "Hello",
      },
    ]);
    await sidebar.load();
    sidebar.pinnedStore.pinWorkspace("/ws-1", "/ws-1");
    await sidebar.load();
    // The pinned session appears under PINNED (inside a workspace-group).
    expect(container.querySelectorAll(".pinned-group .session-item")).toHaveLength(1);
    // And does NOT appear under PROJECTS.
    expect(container.querySelectorAll(".projects-group .session-item")).toHaveLength(0);
  });

  it("renders the Unavailable sub-section for orphan pin records", async () => {
    const { sidebar, container } = makeSidebar([
      {
        id: "s-1",
        filePath: "/sessions/s-1.jsonl",
        timestamp: new Date().toISOString(),
        name: "Hello",
      },
    ]);
    await sidebar.load();
    // Pin a workspace and a session that don't exist in the loaded list.
    sidebar.pinnedStore.pinWorkspace("/ghost-ws", "/ghost-ws");
    sidebar.pinnedStore.pinSession("ghost-session");
    await sidebar.load();
    // Each orphan renders as a workspace-group with a .pinned-unavailable
    // message + an Unpin button (buildSidebarWorkspaceGroup contract).
    const unavailableRows = container.querySelectorAll(".pinned-unavailable");
    expect(unavailableRows.length).toBeGreaterThanOrEqual(2);
  });

  it("clears an orphan pin via the Unavailable Unpin button", async () => {
    const { sidebar, container } = makeSidebar([]);
    await sidebar.load();
    sidebar.pinnedStore.pinWorkspace("/ghost-ws", "/ghost-ws");
    await sidebar.load();
    // The orphan workspace-group renders an Unpin button alongside the
    // .pinned-unavailable message.
    const unpinBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes(t("sidebar.unpinWorkspace")),
    );
    expect(unpinBtn).toBeTruthy();
    unpinBtn.click();
    expect(sidebar.pinnedStore.isWorkspacePinned("/ghost-ws")).toBe(false);
  });

  it("records every opened session in RECENT, newest first", async () => {
    const { sidebar, container } = makeSidebar([
      {
        id: "s-older",
        filePath: "/sessions/s-older.jsonl",
        timestamp: new Date().toISOString(),
        name: "Older",
      },
      {
        id: "s-1",
        filePath: "/sessions/s-1.jsonl",
        timestamp: new Date().toISOString(),
        name: "Hello",
      },
    ]);
    await sidebar.load();
    sidebar.setActive("s-older");
    sidebar.setActive("s-1");
    await sidebar.load();
    expect(sidebar.recent).toEqual(["s-1", "s-older"]);
    const recentGroup = container.querySelector(".recent-group");
    const recentIds = Array.from(recentGroup.querySelectorAll(".session-item")).map(
      (node) => node.dataset.sessionId,
    );
    expect(recentIds).toEqual(["s-1", "s-older"]);
  });

  it("renders the PINNED section between RECENT and PROJECTS", async () => {
    const { sidebar, container } = makeSidebar([
      {
        id: "s-1",
        filePath: "/sessions/s-1.jsonl",
        timestamp: new Date().toISOString(),
        name: "Hello",
      },
      {
        id: "s-other",
        filePath: "/sessions/s-other.jsonl",
        timestamp: new Date().toISOString(),
        name: "Other",
        projectPath: "/other-ws",
        projectName: "other-ws",
        isCurrentWorkspace: false,
      },
    ]);
    await sidebar.load();
    // Touch the active session so it lands in the RECENT bucket.
    sidebar.setActive("s-1");
    // Pin only /ws-1; /other-ws stays in PROJECTS so the test can assert
    // the PINNED section sits between RECENT and PROJECTS.
    sidebar.pinnedStore.pinWorkspace("/ws-1", "/ws-1");
    await sidebar.load();
    // Sections now carry a `sidebar-section` prefix class, so check for
    // membership instead of exact className[0].
    const order = Array.from(container.children).map(
      (node) =>
        node.className.split(" ").find((c) => c.endsWith("-group")) || node.className.split(" ")[0],
    );
    const recentIdx = order.indexOf("recent-group");
    const pinnedIdx = order.indexOf("pinned-group");
    const projectIdx = order.indexOf("projects-group");
    expect(recentIdx).toBeGreaterThanOrEqual(0);
    expect(pinnedIdx).toBeGreaterThan(recentIdx);
    expect(projectIdx).toBeGreaterThan(pinnedIdx);
  });
});

describe("project actions", () => {
  const other = {
    id: "s-other",
    timestamp: new Date().toISOString(),
    name: "Other",
    projectPath: "/other",
    projectName: "other",
    isCurrentWorkspace: false,
  };

  beforeEach(() => {
    clearSessionListCache();
    resetUiStore();
    resetMissingWorkspaces();
    document.querySelectorAll(".session-context-menu").forEach((menu) => {
      menu.remove();
    });
  });

  /** @param {HTMLElement} container @param {string} name */
  function openMenuOf(container, name) {
    const header = [...container.querySelectorAll(".project-group-header")].find((el) =>
      el.textContent?.includes(name),
    );
    header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return [...document.querySelectorAll(".session-context-menu .context-menu-item")];
  }

  function withProjectControl(control, reports = {}) {
    control.projectChats = vi.fn(
      async (path) => reports[path] ?? { foreign: 0, insideProject: false, inProjectsFolder: true },
    );
    control.closeProject = vi.fn().mockResolvedValue(undefined);
    control.renameProject = vi.fn().mockResolvedValue({ projectPath: "/renamed" });
    control.relinkProject = vi.fn().mockResolvedValue(1);
    control.keepChatsInProject = vi.fn().mockResolvedValue({ moved: 1 });
  }

  it("closing another project hides it without deleting its chats", async () => {
    const { sidebar, container, control } = makeSidebar([
      { id: "s-1", timestamp: new Date().toISOString(), name: "One" },
      other,
    ]);
    withProjectControl(control);
    await sidebar.load();
    openMenuOf(container, "other")
      .find((el) => el.textContent === "Close project")
      .click();
    await vi.waitFor(() => expect(control.closeProject).toHaveBeenCalledWith("/other"));
    await vi.waitFor(() => expect(container.textContent).not.toContain("Other"));
    expect(control.deleteSessions).not.toHaveBeenCalled();
    expect(container.textContent).toContain("One");
  });

  it("renames a project from its menu", async () => {
    const { sidebar, container, control } = makeSidebar([other]);
    withProjectControl(control);
    await sidebar.load();
    openMenuOf(container, "other")
      .find((el) => el.textContent === "Rename…")
      .click();
    const input = container.querySelector(".session-rename-input");
    expect(input.value).toBe("other");
    input.value = "renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(control.renameProject).toHaveBeenCalledWith("/other", "renamed"));
  });

  it("asks before renaming a folder outside the Projects folder", async () => {
    const { sidebar, container, control } = makeSidebar([other]);
    withProjectControl(control, { "/other": { foreign: 0, inProjectsFolder: false } });
    await sidebar.load();
    openMenuOf(container, "other")
      .find((el) => el.textContent === "Rename…")
      .click();
    const input = container.querySelector(".session-rename-input");
    input.value = "renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector(".ui-button--primary")).toBeTruthy());
    expect(control.renameProject).not.toHaveBeenCalled();
    document.querySelector(".ui-button--primary").click();
    await vi.waitFor(() => expect(control.renameProject).toHaveBeenCalledWith("/other", "renamed"));
  });

  it("offers Keep chats only when the chats are not in the folder yet", async () => {
    const { sidebar, container, control } = makeSidebar([
      { id: "s-1", timestamp: new Date().toISOString(), name: "One" },
      other,
    ]);
    withProjectControl(control, { "/ws-1": { foreign: 0, insideProject: true } });
    await sidebar.load();
    const labelsFor = (name) => openMenuOf(container, name).map((el) => el.textContent);
    expect(labelsFor("ws-1")).not.toContain("Keep chats in project folder");
    document.querySelectorAll(".session-context-menu").forEach((menu) => {
      menu.remove();
    });
    expect(labelsFor("other")).toContain("Keep chats in project folder");
  });

  it("a failed Keep chats restarts Pi and keeps the page so the error shows", async () => {
    const onError = vi.fn();
    const { sidebar, container, control, data } = makeSidebar(
      [{ id: "s-1", timestamp: new Date().toISOString(), name: "One" }],
      { onError },
    );
    withProjectControl(control);
    control.keepChatsInProject = vi.fn().mockRejectedValue(new Error("b.jsonl already exists"));
    control.restartRuntime = vi.fn().mockResolvedValue(undefined);
    await sidebar.load();
    const loads = data.listAllSessions.mock.calls.length;
    openMenuOf(container, "ws-1")
      .find((el) => el.textContent === "Keep chats in project folder")
      .click();
    await vi.waitFor(() => expect(document.querySelector(".ui-button--primary")).toBeTruthy());
    document.querySelector(".ui-button--primary").click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0].message).toBe("b.jsonl already exists");
    await vi.waitFor(() => expect(control.restartRuntime).toHaveBeenCalledWith("ws-1", "s-active"));
    await vi.waitFor(() => expect(data.listAllSessions.mock.calls.length).toBeGreaterThan(loads));
  });

  it("project headers fold with the keyboard", async () => {
    const { sidebar, container } = makeSidebar([
      { id: "s-1", timestamp: new Date().toISOString(), name: "One" },
    ]);
    await sidebar.load();
    const header = container.querySelector(".project-group-header");
    const fold = header?.querySelector(".project-group-toggle");
    expect(fold).toBeInstanceOf(HTMLButtonElement);
    expect(header.getAttribute("role")).toBeNull();
    expect(fold.getAttribute("aria-controls")).toBe(
      header.parentElement?.querySelector(".project-sessions")?.id,
    );
    const expanded = fold.getAttribute("aria-expanded");
    fold.click();
    expect(fold.getAttribute("aria-expanded")).toBe(expanded === "true" ? "false" : "true");
  });

  it("shows a relink note for chats recorded elsewhere and links them", async () => {
    const { sidebar, container, control } = makeSidebar([other]);
    withProjectControl(control, {
      "/other": { foreign: 2, recordedAt: "D:\\old\\other", recordedExists: false },
    });
    await sidebar.load();
    const note = container.querySelector(".project-relink-note");
    expect(note.textContent).toContain("D:\\old\\other");
    note.querySelector(".project-relink-btn").click();
    await vi.waitFor(() => expect(control.relinkProject).toHaveBeenCalledWith("/other"));
  });
});

describe("worktree groups", () => {
  it("nests a worktree under its project, with a new chat button and a menu", async () => {
    const { container, sidebar } = makeSidebar([
      {
        id: "main",
        projectPath: "D:\\repo",
        projectName: "repo",
        isCurrentWorkspace: true,
      },
      {
        id: "wt",
        projectPath: "D:\\.worktrees\\repo\\feat-x",
        projectName: "feat-x",
        worktreeOf: "D:\\repo",
        isCurrentWorkspace: false,
      },
    ]);
    await sidebar.load();
    const group = container.querySelector(".worktree-group");
    expect(group?.closest(".project-group")?.textContent).toContain("repo");
    expect(group?.textContent).toContain("feat-x");
    expect(group?.querySelector(".worktree-new-chat")).toBeInstanceOf(HTMLButtonElement);
    expect(group?.querySelector(".worktree-menu")).toBeInstanceOf(HTMLButtonElement);
    expect(container.querySelectorAll(".project-group")).toHaveLength(1);
    const toggle = group?.querySelector(".project-group-toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    /** @type {HTMLElement | null | undefined} */ (toggle)?.click();
    expect(group?.querySelector(".project-sessions")?.classList.contains("collapsed")).toBe(true);
  });
});
