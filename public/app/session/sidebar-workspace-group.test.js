// ABOUTME: Tests sidebar-workspace-group.js.
// ABOUTME: A disclosure row is one toggle button; action buttons stay beside it.

import { describe, expect, it } from "vitest";
import { buildSidebarWorkspaceGroup, mountDisclosure } from "./sidebar-workspace-group.js";

describe("mountDisclosure", () => {
  it("keeps action buttons out of the toggle", () => {
    const header = document.createElement("div");
    header.className = "project-header";
    const name = document.createElement("span");
    name.textContent = "Project";
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = "New";
    header.append(name, action);
    const body = document.createElement("div");

    const toggle = mountDisclosure(header, body, true, null);

    expect(header.getAttribute("role")).toBeNull();
    expect(toggle).toBeInstanceOf(HTMLButtonElement);
    expect(toggle.contains(action)).toBe(false);
    expect(action.parentElement).toBe(header);
    expect(toggle.textContent).toBe("Project");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe(body.id);
    expect(body.classList.contains("collapsed")).toBe(false);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(header.classList.contains("collapsed")).toBe(true);
    expect(body.classList.contains("collapsed")).toBe(true);

    action.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("buildSidebarWorkspaceGroup", () => {
  it("places new chat and actions beside the fold button", () => {
    const { group, header } = buildSidebarWorkspaceGroup({
      workspaceId: "ws",
      folderName: "App",
      expanded: true,
      onNewChat: () => {},
      onMoreActions: () => {},
    });
    const toggle = header.querySelector(".project-group-toggle");
    const created = header.querySelector(".workspace-new-chat-btn");
    const more = header.querySelector(".workspace-more-actions-btn");
    expect(toggle).toBeInstanceOf(HTMLButtonElement);
    expect(header.getAttribute("role")).toBeNull();
    expect(toggle?.contains(created)).toBe(false);
    expect(toggle?.contains(more)).toBe(false);
    expect(created?.parentElement).toBe(header);
    expect(more?.parentElement).toBe(header);
    expect(group.querySelector(".workspace-sessions")?.id).toBe(
      toggle?.getAttribute("aria-controls"),
    );
  });
});
