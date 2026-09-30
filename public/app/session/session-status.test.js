// ABOUTME: Tests createSessionStatus.
// ABOUTME: Waiting restores the previous connection kind.
import { describe, expect, it } from "vitest";
import { createSessionStatus } from "./session-status.js";

function t(key) {
  return key;
}

function bindUi(status, extras = {}) {
  const statusText = document.createElement("span");
  const statusIndicator = document.createElement("span");
  const composerCard = document.createElement("div");
  const abortButton = document.createElement("button");
  const sendButton = document.createElement("button");
  abortButton.classList.add("hidden");
  status.bind({
    statusText,
    statusIndicator,
    composerCard,
    abortButton,
    sendButton,
    hasPending: () => false,
    getSessionId: () => "session-a",
    ...extras,
  });
  return { abortButton, composerCard, sendButton, statusIndicator, statusText };
}

describe("createSessionStatus", () => {
  it("shows waiting for you during a prompt and restores the previous status", () => {
    const status = createSessionStatus({ t });
    status.setStatus("working", "Thinking");
    const { statusText, statusIndicator } = bindUi(status);
    status.setWaiting(true);
    expect(status.isWaiting()).toBe(true);
    expect(statusText.textContent).toBe("status.waitingForYou");
    expect(statusIndicator.classList.contains("streaming")).toBe(false);
    status.setWaiting(false);
    expect(status.getKind()).toBe("working");
    expect(statusText.textContent).toBe("Thinking");
  });

  it("accepts status updates before bind without throwing", () => {
    const status = createSessionStatus({ t });
    expect(() => status.setStatus("working")).not.toThrow();
    expect(() => status.renderStatus()).not.toThrow();
    expect(status.getKind()).toBe("working");

    const { abortButton, sendButton, statusText } = bindUi(status);
    expect(statusText.textContent).toBe("status.working");
    expect(abortButton.classList.contains("hidden")).toBe(false);
    expect(sendButton.classList.contains("hidden")).toBe(true);
  });

  it("keeps the abort button visible while the working label is thinking", () => {
    const status = createSessionStatus({ t });
    const { abortButton, sendButton, statusText } = bindUi(status);
    status.setStatus("working", "thinking");
    expect(statusText.textContent).toBe("thinking");
    expect(abortButton.classList.contains("hidden")).toBe(false);
    expect(sendButton.classList.contains("hidden")).toBe(true);
  });

  it("shows abort when an extension prompt is pending even if not working", () => {
    const status = createSessionStatus({ t });
    const { abortButton, sendButton } = bindUi(status, { hasPending: () => true });
    status.setStatus("connected");
    expect(abortButton.classList.contains("hidden")).toBe(false);
    expect(sendButton.classList.contains("hidden")).toBe(true);
  });
});
