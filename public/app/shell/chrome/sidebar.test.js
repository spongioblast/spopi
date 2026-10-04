// ABOUTME: Sidebar chrome mounts the session list and its actions.
// ABOUTME: Key refs keep the ids the rest of the shell already queries.

import { describe, expect, test } from "vitest";
import { mountSidebarChrome } from "./sidebar.js";

describe("sidebar chrome", () => {
  test("mounts the sidebar ids", () => {
    const root = document.createElement("div");
    const { refs } = mountSidebarChrome(root);
    expect(refs.sidebar.id).toBe("sidebar");
    expect(refs.overlay.id).toBe("sidebar-overlay");
    expect(refs.newSessionBtn.id).toBe("new-session-btn");
    expect(refs.openFolderBtn.id).toBe("open-folder-btn");
    expect(refs.refreshSessionsBtn.id).toBe("refresh-sessions-btn");
    expect(refs.sessionList.id).toBe("session-list");
    expect(refs.sessionList.getAttribute("role")).toBe("region");
    expect(refs.sessionList.getAttribute("aria-labelledby")).toBe("session-list-label");
    expect(root.querySelector("#session-list-label")?.getAttribute("data-i18n")).toBe(
      "sidebar.sessionList",
    );
    expect(refs.settingsBtn.id).toBe("settings-btn");
    const { destroy } = mountSidebarChrome(document.createElement("div"));
    destroy();
  });
});
