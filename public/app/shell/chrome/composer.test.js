// ABOUTME: Composer chrome mounts the message form and its controls.
// ABOUTME: The form, thinking control, and send button keep their ids.

import { describe, expect, test } from "vitest";
import { mountComposerChrome } from "./composer.js";

describe("composer chrome", () => {
  test("mounts the composer ids", () => {
    const root = document.createElement("div");
    const { refs } = mountComposerChrome(root);
    expect(refs.form.id).toBe("chat-form");
    expect(refs.inputArea.querySelector("#composer-card").id).toBe("composer-card");
    expect(refs.messageInput.id).toBe("message-input");
    expect(refs.messageInput.getAttribute("spellcheck")).toBe("false");
    expect(refs.sendBtn.id).toBe("send-btn");
    expect(refs.thinkingBtn.id).toBe("thinking-btn");
    expect(refs.thinkingBtn.textContent.trim()).toBe("Think off");
    expect(root.querySelector("#abort-btn")).not.toBeNull();
  });

  test("the More menu names its items and lets the toolbar overflow while open", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { refs, destroy } = mountComposerChrome(root);
    const toolbar = refs.moreBtn.closest(".composer-toolbar");
    expect(refs.attachBtn.textContent).toBe("Attach image");
    expect(refs.commandBtn.textContent).toBe("Commands");
    refs.moreBtn.click();
    expect(refs.moreMenu.classList.contains("hidden")).toBe(false);
    expect(toolbar.classList.contains("more-menu-open")).toBe(true);
    expect(refs.moreBtn.getAttribute("aria-expanded")).toBe("true");
    const escapeKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    let reached = false;
    const listener = () => {
      reached = true;
    };
    document.addEventListener("keydown", listener);
    document.body.dispatchEvent(escapeKey);
    document.removeEventListener("keydown", listener);
    expect(reached).toBe(false);
    expect(refs.moreMenu.classList.contains("hidden")).toBe(true);
    expect(toolbar.classList.contains("more-menu-open")).toBe(false);
    refs.moreBtn.click();
    refs.commandBtn.click();
    expect(refs.moreMenu.classList.contains("hidden")).toBe(true);
    destroy();
    root.remove();
  });
});
