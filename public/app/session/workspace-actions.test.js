// ABOUTME: Tests workspace actions.
// ABOUTME: Includes "the top button creates a project, then a session in it".
import { afterEach, describe, expect, it, vi } from "vitest";
import { onSessionCreated } from "./session-created-action.js";
import { SessionSidebar } from "./session-sidebar.js";
import { errorFromHostBody, mountNewSessionButton } from "./workspace-actions.js";

describe("workspace actions", () => {
  it("keeps the host error code when the body is an object", () => {
    const error = errorFromHostBody({ error: { code: "project_not_found" } }, 404);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("project_not_found");
    expect(/** @type {{ code?: string }} */ (error).code).toBe("project_not_found");
    expect(errorFromHostBody({}, 500).message).toBe("Server error 500");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete globalThis.__TAURI__;
    vi.restoreAllMocks();
  });

  it("the top button creates a project, then a session in it", async () => {
    document.body.innerHTML = '<button id="new-session-btn">New Session</button>';
    delete globalThis.__TAURI__;

    const createProject = vi.fn().mockResolvedValue({
      workspaceId: "workspace-new",
      projectPath: "D:\\projects\\2026-09-29_07-30-00",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          workspaceId: "workspace-new",
          sessionId: "temporary-abc123",
          instanceId: "instance-xyz",
        }),
    });
    globalThis.fetch = fetchMock;

    const eventSpy = vi.fn();
    const unbind = onSessionCreated(eventSpy);

    mountNewSessionButton({ control: { createProject }, workspaceId: "workspace-a" });
    document.getElementById("new-session-btn").click();

    await vi.waitFor(() => expect(eventSpy).toHaveBeenCalled());
    expect(createProject).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/v2/new-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "workspace-new" }),
    });
    unbind();
    delete globalThis.fetch;
  });

  it("Mod+N's action clicks the + of the open project's row", () => {
    const list = document.createElement("div");
    list.innerHTML = `
      <div class="project-group"><button class="project-new-chat-btn" id="other"></button></div>
      <div class="project-group current-project"><button class="project-new-chat-btn" id="open"></button></div>
    `;
    const clicked = [];
    for (const button of list.querySelectorAll(".project-new-chat-btn")) {
      button.addEventListener("click", () => clicked.push(button.id));
    }
    SessionSidebar.prototype.newChatInCurrentProject.call({ container: list });
    expect(clicked).toEqual(["open"]);
  });
});
