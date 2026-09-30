// ABOUTME: Tests FilePreviewPanel.
// ABOUTME: Includes "revealWrite returns null for a new file instead of forcing the panel open".
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { FilePreviewPanel } from "./file-preview-panel.js";
import { setLeadTab } from "./lead-tab.js";

let panel, resizer, tabBar, content, mainContainer;

beforeEach(async () => {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
  global.fetch = vi.fn((url) => {
    if (String(url).includes("/locales/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          messages: { copied: "Copied!" },
          nav: {},
          files: {
            preview: {
              close: "Close",
              conflict: "File modified externally",
              copyFailed: "Copy failed",
              loadError: "Failed to load file",
              loading: "Loading…",
              htmlLive: "Live HTML preview",
              readOnly: "Read-only",
              saveError: "Failed to save file",
              saved: "Saved",
              saving: "Saving…",
              unsupportedBinary: "Unsupported binary",
              markitdown: {
                pythonMissing: "Install Python 3.10 or later to preview this file.",
                pythonTooOld: "Python {version} is too old. Install Python 3.10 or later.",
                markitdownMissing: "Install MarkItDown to preview this file.",
                markitdownIncompatible:
                  "Update MarkItDown to a version that supports stdin conversion.",
                installPosix: "python3 -m pip install markitdown",
                installWindows: "py -3 -m pip install markitdown",
              },
            },
            unsaved: { title: "Unsaved changes" },
          },
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ content: "# Test\n", mtimeMs: 1700000000000 }),
    });
  });

  await createI18n();

  // Build DOM
  document.body.replaceChildren();
  mainContainer = document.createElement("div");
  mainContainer.className = "main";
  mainContainer.style.width = "800px";
  document.body.appendChild(mainContainer);

  panel = document.createElement("section");
  panel.className = "file-preview-panel collapsed";
  panel.id = "file-preview-panel";
  document.body.appendChild(panel);

  resizer = document.createElement("div");
  resizer.className = "file-preview-resizer collapsed";
  resizer.id = "file-preview-resizer";
  document.body.appendChild(resizer);

  tabBar = document.createElement("div");
  tabBar.className = "file-preview-tabs";
  tabBar.id = "file-preview-tabs";
  document.body.appendChild(tabBar);

  content = document.createElement("div");
  content.className = "file-preview-content";
  content.id = "file-preview-content";
  document.body.appendChild(content);

  // Panel control buttons.
  const enlargeBtn = document.createElement("button");
  enlargeBtn.id = "file-preview-enlarge";
  enlargeBtn.className = "hidden";
  document.body.appendChild(enlargeBtn);

  const collapseBtn = document.createElement("button");
  collapseBtn.id = "file-preview-collapse";
  document.body.appendChild(collapseBtn);

  const closeBtn = document.createElement("button");
  closeBtn.id = "file-preview-close";
  document.body.appendChild(closeBtn);

  const saveIcon = document.createElement("button");
  saveIcon.id = "file-preview-save-icon";
  document.body.appendChild(saveIcon);

  const toolbar = document.createElement("div");
  toolbar.id = "file-preview-toolbar";
  document.body.appendChild(toolbar);
  for (const id of [
    "file-preview-toolbar-toggle",
    "file-preview-mode-preview",
    "file-preview-mode-edit",
    "file-preview-save",
    "file-preview-reload",
    "file-preview-search",
    "file-preview-go-to-line",
    "file-preview-copy",
  ]) {
    const button = document.createElement("button");
    button.id = id;
    document.body.appendChild(button);
  }
  const goToLineInput = document.createElement("input");
  goToLineInput.id = "file-preview-go-to-line-input";
  goToLineInput.className = "hidden";
  document.body.appendChild(goToLineInput);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function createPanel(options = {}) {
  const storedValues = new Map();
  const byId = (id) => document.getElementById(id);
  return new FilePreviewPanel({
    panel,
    resizer,
    tabBar,
    content,
    mainContainer,
    workspaceRoot: "/test/workspace",
    controls: {
      toolbar: byId("file-preview-toolbar"),
      toolbarToggle: byId("file-preview-toolbar-toggle"),
      preview: byId("file-preview-mode-preview"),
      edit: byId("file-preview-mode-edit"),
      save: byId("file-preview-save"),
      saveIcon: byId("file-preview-save-icon"),
      reload: byId("file-preview-reload"),
      search: byId("file-preview-search"),
      goToLine: byId("file-preview-go-to-line"),
      diff: byId("file-preview-mode-diff"),
      goToLineInput: byId("file-preview-go-to-line-input"),
      copy: byId("file-preview-copy"),
      openDesktop: byId("file-preview-open"),
      wrap: byId("file-preview-wrap"),
      autoSave: byId("file-preview-autosave"),
      status: byId("file-preview-status"),
      enlarge: byId("file-preview-enlarge"),
      collapse: byId("file-preview-collapse"),
      close: byId("file-preview-close"),
    },
    fileSidebarToggle: byId("file-sidebar-toggle"),
    storage: {
      getItem: (key) => storedValues.get(key) ?? null,
      setItem: (key, value) => storedValues.set(key, String(value)),
      removeItem: (key) => storedValues.delete(key),
    },
    ...options,
  });
}

describe("FilePreviewPanel", () => {
  test("revealWrite returns null for a new file instead of forcing the panel open", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ previewStatus: "ready", renderAs: "text", content: "x" }),
      }),
    );
    const p = createPanel();
    const tab = await p.revealWrite("/test/workspace/fresh.md");
    expect(tab).toBeNull();
    expect(p.state.getTabs()).toHaveLength(0);
    p.destroy();
  });

  test("revealWrite silently reloads a clean tab without stealing focus", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ previewStatus: "ready", renderAs: "text", content: "v1" }),
      }),
    );
    const p = createPanel();
    await p.openFile("/test/workspace/README.md");
    await p.openFile("/test/workspace/other.md");
    const activeId = p.state.getActiveTab().id;
    let calls = 0;
    global.fetch = vi.fn(() => {
      calls += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({ previewStatus: "ready", renderAs: "text", content: "v2" }),
      });
    });

    const reloaded = await p.revealWrite("/test/workspace/README.md");

    // No duplicate tab and no focus steal: the active tab stays untouched.
    expect(p.state.getTabs()).toHaveLength(2);
    expect(p.state.getActiveTab().id).toBe(activeId);
    expect(reloaded.filePath).toBe("/test/workspace/README.md");
    expect(calls).toBeGreaterThan(0);
    p.destroy();
  });

  test("renders converted responses as read-only Markdown", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          previewStatus: "ready",
          renderAs: "markdown",
          content: "# Converted",
          editable: false,
        }),
      }),
    );
    const p = createPanel();
    await p.openFile("/test/workspace/mail.eml");
    expect(p.state.getActiveTab()).toMatchObject({
      editable: false,
      mode: "preview",
      renderAs: "markdown",
    });
    expect(content.querySelector(".file-markdown-preview")).not.toBeNull();
    expect(document.getElementById("file-preview-mode-edit").disabled).toBe(true);
    p.destroy();
  });

  test("maps an old Python dependency response to localized guidance", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          previewStatus: "dependencyUnavailable",
          dependencyReason: "pythonTooOld",
          pythonVersion: "3.9.7",
          editable: false,
        }),
      }),
    );
    const p = createPanel();
    await p.openFile("/test/workspace/report.docx");
    expect(content.textContent).toContain("Python 3.9.7 is too old");
    expect(content.textContent).not.toContain("stderr");
    p.destroy();
  });
  test("starts collapsed", () => {
    const p = createPanel();
    expect(panel.classList.contains("collapsed")).toBe(true);
    p.destroy();
  });

  test("openFile opens panel and creates tab", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/README.md");
    expect(panel.classList.contains("collapsed")).toBe(false);
    expect(tabBar.children.length).toBe(1);
    p.destroy();
  });

  test("opens source code files in edit mode by default", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/example.js");
    expect(p.state.getActiveTab()?.mode).toBe("edit");
    p.destroy();
  });

  test("opens markdown files in preview mode by default", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/README.md");
    expect(p.state.getActiveTab()?.mode).toBe("preview");
    p.destroy();
  });

  test("opens HTML files in live preview mode by default", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/index.html");
    expect(p.state.getActiveTab()?.mode).toBe("preview");
    expect(content.querySelector("iframe.file-html-frame")).not.toBeNull();
    p.destroy();
  });

  test("revealWrite reloads a clean tab and leaves a dirty tab unsaved", async () => {
    let contents = ["<p>one</p>", "<p>two</p>"];
    const p = createPanel({
      fileApi: {
        readFileContent: async () => ({
          ok: true,
          json: async () => ({ content: contents.shift() ?? "<p>two</p>", mtimeMs: 1 }),
        }),
      },
    });
    await p.openFile("index.html");
    expect(p.state.getActiveTab()?.content).toBe("<p>one</p>");
    await p.revealWrite("index.html");
    expect(p.state.getActiveTab()?.content).toBe("<p>two</p>");
    expect(p.state.getActiveTab()?.dirty).toBe(false);

    p.state.updateTab(p.state.getActiveTab().id, { dirty: true, content: "<p>local</p>" });
    contents = ["<p>disk</p>"];
    await p.revealWrite("index.html");
    expect(p.state.getActiveTab()?.content).toBe("<p>local</p>");
    expect(p.state.getActiveTab()?.dirty).toBe(true);
    p.destroy();
  });

  test("openFile jumps to the requested line", async () => {
    const p = createPanel({
      fileApi: {
        readFileContent: async () => ({
          ok: true,
          json: async () => ({ content: "one\ntwo\nthree\n", mtimeMs: 1, editable: true }),
        }),
      },
    });
    const goToLine = vi.fn(() => true);
    const mount = p._mountRenderer.bind(p);
    p._mountRenderer = async (tab) => {
      await mount(tab);
      p.currentRenderer?.destroy?.();
      p.currentRenderer = { goToLine, destroy() {} };
    };

    await p.openFile("/test/workspace/example.js", { line: 2 });
    expect(goToLine).toHaveBeenCalledWith(2);

    goToLine.mockClear();
    await p.openFile("/test/workspace/example.js", { line: 3 });
    expect(goToLine).toHaveBeenCalledWith(3);
    p.destroy();
  });

  test("uses the inline line input to navigate and then restores the button", () => {
    const p = createPanel();
    const goToLine = document.getElementById("file-preview-go-to-line");
    const input = document.getElementById("file-preview-go-to-line-input");
    const renderer = { destroy: vi.fn(), goToLine: vi.fn(() => true) };
    const tab = p.state.openFile("/test/workspace/example.js");
    p.state.updateTab(tab.id, { content: "line one\nline two\n" });
    p.currentRenderer = renderer;
    goToLine.disabled = false;
    vi.spyOn(window, "prompt").mockReturnValue(null);

    goToLine.click();

    expect(input.classList.contains("hidden")).toBe(false);

    input.value = "2";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(renderer.goToLine).toHaveBeenCalledWith(2);
    expect(input.classList.contains("hidden")).toBe(true);
    expect(goToLine.classList.contains("hidden")).toBe(false);
    p.destroy();
  });

  test("opening the same file selects it without reloading or losing dirty content", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/README.md");
    const tab = p.state.getActiveTab();
    p.state.updateTab(tab.id, { content: "# Unsaved\n", dirty: true });

    await p.openFile("/test/workspace/README.md");

    const contentCalls = global.fetch.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/files/content"),
    );
    expect(contentCalls).toHaveLength(1);
    expect(p.state.getActiveTab()?.content).toBe("# Unsaved\n");
    expect(p.state.getActiveTab()?.dirty).toBe(true);
    expect(tabBar.children).toHaveLength(1);
    p.destroy();
  });

  test("opening multiple files creates multiple tabs", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/a.js");
    await p.openFile("/test/workspace/b.js");
    expect(tabBar.children.length).toBe(2);
    p.destroy();
  });

  test("uses the server-discovered Python command in dependency guidance", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          previewStatus: "dependencyUnavailable",
          dependencyReason: "markitdownMissing",
          displayCommand: "python",
          editable: false,
        }),
      }),
    );
    const p = createPanel();
    await p.openFile("/test/workspace/report.docx");
    expect(content.textContent).toContain("python -m pip install");
    expect(content.textContent).not.toContain("python3 -m pip install");
    p.destroy();
  });

  test("aborts the old load when switching tabs and reloads it when selected again", async () => {
    const pending = new Map();
    global.fetch = vi.fn((url, options) => {
      const entry = { options, resolve: null };
      const promise = new Promise((resolve) => {
        entry.resolve = resolve;
      });
      pending.set(String(url), entry);
      return promise;
    });
    const p = createPanel();
    const first = p.openFile("/test/workspace/a.docx");
    const firstRequest = pending.get("/api/files/content?path=%2Ftest%2Fworkspace%2Fa.docx");
    const second = p.openFile("/test/workspace/b.docx");
    expect(firstRequest.options.signal.aborted).toBe(true);
    firstRequest.resolve({ ok: true, json: async () => ({ content: "stale" }) });
    pending.get("/api/files/content?path=%2Ftest%2Fworkspace%2Fb.docx").resolve({
      ok: true,
      json: async () => ({ content: "b" }),
    });
    await second;
    await first;
    const aTab = p.state.getTab("file:/test/workspace/a.docx");
    expect(aTab.content).toBeNull();
    const select = tabBar.querySelector('[data-tab-id="file:/test/workspace/a.docx"]');
    select.click();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(3);
    p.destroy();
  });

  test("finishes independent loads when files resolve out of order", async () => {
    const pending = new Map();
    global.fetch = vi.fn(
      (url) =>
        new Promise((resolve) => {
          pending.set(String(url), resolve);
        }),
    );
    const p = createPanel();

    const firstLoad = p.openFile("/test/workspace/a.js");
    const secondLoad = p.openFile("/test/workspace/b.js");
    pending.get("/api/files/content?path=%2Ftest%2Fworkspace%2Fb.js")({
      ok: true,
      json: async () => ({ content: "const b = 1;\n", mtimeMs: 2 }),
    });
    await secondLoad;
    pending.get("/api/files/content?path=%2Ftest%2Fworkspace%2Fa.js")({
      ok: true,
      json: async () => ({ content: "const a = 1;\n", mtimeMs: 1 }),
    });
    await firstLoad;

    expect(p.state.getTab("file:/test/workspace/a.js")?.loading).toBe(false);
    expect(p.state.getTab("file:/test/workspace/a.js")?.content).toBe("const a = 1;\n");
    expect(p.state.getTab("file:/test/workspace/b.js")?.content).toBe("const b = 1;\n");
    expect(p.state.getActiveTab()?.filePath).toBe("/test/workspace/b.js");
    p.destroy();
  });

  test("enlarge adds enlarged class", () => {
    const p = createPanel();
    p.enlarge();
    expect(panel.classList.contains("enlarged")).toBe(true);
    expect(panel.classList.contains("collapsed")).toBe(false);
    p.destroy();
  });

  test("collapse removes enlarged class", () => {
    const p = createPanel();
    p.enlarge();
    p.collapse();
    expect(panel.classList.contains("enlarged")).toBe(false);
    p.destroy();
  });

  test("closePanel collapses panel", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/README.md");
    p.closePanel();
    expect(panel.classList.contains("collapsed")).toBe(true);
    p.destroy();
  });

  test("closePanel preserves tabs (not closing them)", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/README.md");
    p.closePanel();
    expect(p.state.getTabs().length).toBe(1);
    p.destroy();
  });

  test("viewing a CRLF file does not ask to save, and the save icon stays disabled", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ content: "a\r\nb\r\n", mtimeMs: 1, editable: true }),
      }),
    );
    const confirmDirty = vi.fn(async () => "cancel");
    const p = createPanel({ confirmDirty });
    await p.openFile("/test/workspace/notes.txt");
    const saveIcon = document.getElementById("file-preview-save-icon");
    expect(p.state.getActiveTab()?.dirty).toBe(false);
    expect(saveIcon.disabled).toBe(true);
    expect(await p.closePanel()).toBe(true);
    expect(confirmDirty).not.toHaveBeenCalled();

    await p.openFile("/test/workspace/notes.txt");
    p.state.updateTab(p.state.getActiveTab().id, { dirty: true, content: "a\nb\nchanged\n" });
    expect(saveIcon.disabled).toBe(false);
    p.destroy();
  });

  test("auto-save is off by default so an edit waits for the save icon or Ctrl+S", async () => {
    vi.useFakeTimers();
    const writes = [];
    global.fetch = vi.fn((_url, init) => {
      if (init?.method === "PUT") writes.push(JSON.parse(init.body));
      return Promise.resolve({
        ok: true,
        json: async () => ({ content: "one\n", mtimeMs: 1, editable: true }),
      });
    });
    const p = createPanel();
    expect(p.autoSaveEnabled).toBe(false);
    await p.openFile("/test/workspace/notes.txt");
    const tab = p.state.getActiveTab();
    // Type through the editor so the renderer and the tab agree on the text.
    p.currentRenderer.getEditor().setValue("two\n");
    expect(p.state.getTab(tab.id).dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toHaveLength(0);
    expect(p.state.getTab(tab.id).dirty).toBe(true);

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toBe("two\n");
    vi.useRealTimers();
    p.destroy();
  });

  test("does not close a dirty tab when confirmation is cancelled", async () => {
    const confirmDirty = vi.fn(async () => "cancel");
    const p = createPanel({ confirmDirty });
    await p.openFile("/test/workspace/main.js");
    const tab = p.state.getActiveTab();
    p.currentRenderer.getEditor().setValue("changed\n");

    const closed = await p._closeTab(tab.id);

    expect(closed).toBe(false);
    expect(confirmDirty).toHaveBeenCalledOnce();
    expect(p.state.getTab(tab.id)).not.toBeNull();
    p.destroy();
  });

  test("edit control switches an editable text tab into edit mode", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/main.js");

    document.getElementById("file-preview-mode-edit").click();
    await vi.waitFor(() => {
      expect(content.querySelector(".cm-content")).not.toBeNull();
    });

    expect(p.state.getActiveTab()?.mode).toBe("edit");
    expect(content.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
    p.destroy();
  });

  test("keeps edits made while a save request is in flight dirty", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/main.js");
    const tab = p.state.getActiveTab();
    p.state.updateTab(tab.id, { content: "first edit\n", dirty: true });
    let resolveSave;
    global.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    const saving = p._saveTab(tab.id);
    p.state.updateTab(tab.id, { content: "second edit\n", dirty: true });
    resolveSave({
      ok: true,
      status: 200,
      json: async () => ({ mtimeMs: 1700000001000 }),
    });
    await saving;

    expect(p.state.getTab(tab.id)?.content).toBe("second edit\n");
    expect(p.state.getTab(tab.id)?.originalContent).toBe("first edit\n");
    expect(p.state.getTab(tab.id)?.dirty).toBe(true);
    p.destroy();
  });

  test("explicit save can overwrite after a conflict decision", async () => {
    const resolveConflict = vi.fn(async () => "overwrite");
    const p = createPanel({ resolveConflict });
    await p.openFile("/test/workspace/main.js");
    const tab = p.state.getActiveTab();
    p.state.updateTab(tab.id, { content: "updated\n", dirty: true });
    const requests = [];
    global.fetch = vi.fn(async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requests.length === 1) {
        return { ok: false, status: 409, json: async () => ({ error: "conflict" }) };
      }
      return { ok: true, status: 200, json: async () => ({ mtimeMs: 1700000002000 }) };
    });

    const saved = await p._saveTab(tab.id);

    expect(saved).toBe(true);
    expect(resolveConflict).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    expect(requests[1].force).toBe(true);
    expect(p.state.getTab(tab.id)?.dirty).toBe(false);
    expect(p.state.getTab(tab.id)?.conflict).toBe(false);
    p.destroy();
  });

  test("tab bar renders file names", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/main.js");
    const tabName = tabBar.querySelector(".file-preview-tab-name");
    expect(tabName).not.toBeNull();
    expect(tabName.textContent).toBe("main.js");
    p.destroy();
  });

  test("tabs and splitter expose keyboard interactions", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/a.js");
    await p.openFile("/test/workspace/b.js");
    const firstTab = tabBar.querySelector('[data-tab-id="file:/test/workspace/a.js"]');

    expect(firstTab?.getAttribute("role")).toBe("tab");
    expect(firstTab?.getAttribute("tabindex")).toBe("0");
    firstTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(p.state.getActiveTab()?.filePath).toBe("/test/workspace/a.js");

    const initialRatio = p.panelRatio;
    resizer.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(p.panelRatio).toBeGreaterThan(initialRatio);
    expect(resizer.getAttribute("aria-valuenow")).not.toBeNull();
    p.destroy();
  });

  test("tab bar renders close buttons", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/main.js");
    const closeBtn = tabBar.querySelector(".file-preview-tab-close");
    expect(closeBtn).not.toBeNull();
    p.destroy();
  });

  test("setWorkspaceRoot loads persisted tabs", () => {
    // Simulate persisted tabs from a previous session.
    const tabsData = {
      byRoot: {
        "/test/workspace": {
          tabs: [
            {
              id: "file:/test/workspace/persisted.js",
              kind: "file",
              filePath: "/test/workspace/persisted.js",
              fileName: "persisted.js",
              mode: "preview",
            },
          ],
          activeTabId: "file:/test/workspace/persisted.js",
          touchedAt: Date.now(),
        },
      },
    };

    // Use the FileTabState directly with injected storage.
    const { FileTabState } = require("./file-tab-state.js");
    const memStorage = new Map();
    memStorage.set("ui.editor.tabs", JSON.stringify(tabsData));
    const state = new FileTabState({
      storage: {
        getItem: (k) => memStorage.get(k) ?? null,
        setItem: (k, v) => memStorage.set(k, v),
        removeItem: (k) => memStorage.delete(k),
      },
    });
    state.load("/test/workspace");
    expect(state.getTabs().length).toBe(1);
    expect(state.getTabs()[0].fileName).toBe("persisted.js");
  });

  test("destroy cleans up renderer", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/README.md");
    p.destroy();
    // After destroy, the content should be empty.
    // The renderer's destroy() is called; content is cleared by _closePanel
    // only when closePanel is called. But destroy() destroys the renderer.
    // Content div may still have a wrapper; check for cm-editor absence.
    expect(content.querySelectorAll(".cm-editor").length).toBe(0);
  });
});

describe("FilePreviewPanel close and visibility", () => {
  test("getCloseRisk reports dirty file tabs with a monotonic version", () => {
    const p = createPanel();
    const first = p.getCloseRisk();
    expect(first.version).toBeGreaterThan(0);
    expect(Array.isArray(first.dirtyFiles)).toBe(true);
    p.destroy();
  });

  test("showPanel / hidePanel toggle the collapsed state", () => {
    const p = createPanel();
    p.showPanel();
    expect(panel.classList.contains("collapsed")).toBe(false);
    p.hidePanel();
    expect(panel.classList.contains("collapsed")).toBe(true);
    p.destroy();
  });

  test("closing the last file tab closes the panel", async () => {
    const p = createPanel();
    await p.openFile("/test/workspace/main.js");

    await p._closeTab(p.state.getActiveTab().id);

    expect(panel.classList.contains("collapsed")).toBe(true);
    p.destroy();
  });
});

describe("FilePreviewPanel workspace restore", () => {
  function seededStorage(seed) {
    const memStorage = new Map();
    memStorage.set("ui.editor.tabs", JSON.stringify(seed));
    return {
      getItem: (k) => memStorage.get(k) ?? null,
      setItem: (k, v) => memStorage.set(k, String(v)),
      removeItem: (k) => memStorage.delete(k),
    };
  }

  // Regression: during a foreground workspace switch the persisted tabs can
  // belong to a workspace the current server is not scoped to, so the content
  // fetch 403s. The panel must not flash open with a load error before the
  // authoritative state closes it.
  test("does not flash the panel open when restored content fails to load", async () => {
    const storage = seededStorage({
      byRoot: {
        "/ws/a": {
          tabs: [
            {
              id: "file:/ws/a/missing.js",
              kind: "file",
              filePath: "/ws/a/missing.js",
              fileName: "missing.js",
              mode: "edit",
            },
          ],
          activeTabId: "file:/ws/a/missing.js",
          touchedAt: Date.now(),
        },
      },
    });
    const p = createPanel({ storage });
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }));

    expect(panel.classList.contains("collapsed")).toBe(true);
    await p.setWorkspaceRoot("/ws/a");

    expect(panel.classList.contains("collapsed")).toBe(true);
    expect(p.state.getTabs().length).toBe(1);
    p.destroy();
  });

  test("opens the panel when restored content loads successfully", async () => {
    const storage = seededStorage({
      byRoot: {
        "/ws/a": {
          tabs: [
            {
              id: "file:/ws/a/real.js",
              kind: "file",
              filePath: "/ws/a/real.js",
              fileName: "real.js",
              mode: "edit",
            },
          ],
          activeTabId: "file:/ws/a/real.js",
          touchedAt: Date.now(),
        },
      },
    });
    const p = createPanel({ storage });
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: "real content\n", mtimeMs: 1 }),
    }));

    await p.setWorkspaceRoot("/ws/a");

    expect(panel.classList.contains("collapsed")).toBe(false);
    p.destroy();
  });

  test("hasPersistedTabs peeks storage without switching state", () => {
    const storage = seededStorage({
      byRoot: {
        "/ws/a": {
          tabs: [
            {
              id: "file:/ws/a/peek.js",
              kind: "file",
              filePath: "/ws/a/peek.js",
              fileName: "peek.js",
              mode: "edit",
            },
          ],
          activeTabId: "file:/ws/a/peek.js",
          touchedAt: Date.now(),
        },
      },
    });
    const p = createPanel({ storage });

    expect(p.hasPersistedTabs("/ws/a")).toBe(true);
    expect(p.hasPersistedTabs("/ws/empty")).toBe(false);
    // Peeking must not load tabs into the active state.
    expect(p.state.getTabs().length).toBe(0);
    p.destroy();
  });
});

describe("FilePreviewPanel Review tab", () => {
  test("draws the Review tab first and steps it aside when a file opens", async () => {
    const p = createPanel();
    const lead = {
      label: "Working tree",
      active: true,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onLeave: vi.fn(() => setLeadTab("review", { ...lead, active: false })),
    };
    setLeadTab("review", lead);
    const first = tabBar.firstElementChild;
    expect(first?.dataset.leadTab).toBe("review");
    expect(first?.classList.contains("active")).toBe(true);
    expect(first?.textContent).toContain("Working tree");

    await p.openFile("/test/workspace/README.md");
    expect(lead.onLeave).toHaveBeenCalled();
    expect(tabBar.querySelector('[data-lead-tab="review"]')?.classList.contains("active")).toBe(
      false,
    );
    expect(tabBar.querySelector("[data-tab-id]")?.classList.contains("active")).toBe(true);

    tabBar.querySelector('[data-lead-tab="review"] .file-preview-tab-close')?.click();
    expect(lead.onClose).toHaveBeenCalled();
    setLeadTab("review", null);
    p.destroy();
  });

  test("draws one tab per owner, each under its own key", () => {
    const p = createPanel();
    const tab = (label) => ({
      label,
      active: false,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onLeave: vi.fn(),
    });
    setLeadTab("review", tab("Turn 1"));
    setLeadTab("subagent", tab("scout"));
    expect([...tabBar.querySelectorAll("[data-lead-tab]")].map((el) => el.dataset.leadTab)).toEqual(
      ["review", "subagent"],
    );
    setLeadTab("review", null);
    setLeadTab("subagent", null);
    expect(tabBar.querySelector("[data-lead-tab]")).toBeNull();
    p.destroy();
  });

  test("brings the Review tab back when the last file closes", async () => {
    const p = createPanel();
    const lead = {
      label: "Turn 2",
      active: false,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onLeave: vi.fn(),
    };
    setLeadTab("review", lead);
    await p.openFile("/test/workspace/README.md");
    tabBar.querySelector("[data-tab-id] .file-preview-tab-close")?.click();
    await vi.waitFor(() => expect(lead.onSelect).toHaveBeenCalled());
    setLeadTab("review", null);
    p.destroy();
  });
});
