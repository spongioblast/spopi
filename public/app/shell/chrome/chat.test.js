// ABOUTME: Chat chrome mounts the session header and the message column.
// ABOUTME: The header stays a direct child of the workspace, above the column.

import { describe, expect, test } from "vitest";
import { mountChatChrome } from "./chat.js";

describe("chat chrome", () => {
  test("mounts the header and message ids", () => {
    const workspace = document.createElement("div");
    const main = document.createElement("div");
    const { refs } = mountChatChrome(workspace, main);
    expect(refs.header.classList.contains("session-header")).toBe(true);
    expect(workspace.firstElementChild).toBe(refs.header);
    expect(refs.header.querySelector(".header-left .session-info-anchor")).not.toBeNull();
    expect(refs.sidebarToggle.id).toBe("sidebar-toggle");
    expect(refs.sessionInfoToggle.id).toBe("session-info-toggle");
    expect(refs.fileSidebarToggle.id).toBe("file-sidebar-toggle");
    expect(refs.messages.id).toBe("messages");
    expect(main.querySelector("#scroll-bottom-badge")).not.toBeNull();
  });
});
