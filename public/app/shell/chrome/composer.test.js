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
});
