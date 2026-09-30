// ABOUTME: Tests the Send gate for a picker with no usable model.
// ABOUTME: Send dims with a hint, and a held prompt shows one note that points to the fix.

import { expect, test, vi } from "vitest";
import { createSendModelGate } from "./send-model-gate.js";

function makeGate() {
  const sendButton = document.createElement("button");
  const dismiss = vi.fn();
  const notify = vi.fn(() => ({ dismiss }));
  const openModelPicker = vi.fn();
  const openModelSettings = vi.fn();
  const gate = createSendModelGate({
    sendButton,
    t: (key) => key,
    notify,
    openModelPicker,
    openModelSettings,
  });
  return { gate, sendButton, notify, dismiss, openModelPicker, openModelSettings };
}

test("a ready picker lets the prompt go and leaves Send alone", () => {
  const { gate, sendButton, notify } = makeGate();
  expect(gate.allowPrompt()).toBe(true);
  expect(notify).not.toHaveBeenCalled();
  expect(sendButton.classList.contains("is-model-blocked")).toBe(false);
});

test("a lost selection dims Send and points to the picker", () => {
  const { gate, sendButton, notify, openModelPicker } = makeGate();
  gate.setStatus("unselected");
  expect(sendButton.classList.contains("is-model-blocked")).toBe(true);
  expect(sendButton.getAttribute("aria-disabled")).toBe("true");
  expect(sendButton.title).toBe("composer.sendNeedsModel");
  expect(sendButton.dataset.i18nTitle).toBe("composer.sendNeedsModel");

  expect(gate.allowPrompt()).toBe(false);
  const notice = notify.mock.calls[0][0];
  expect(notice.message).toBe("composer.sendNeedsModelHint");
  notice.action.onClick();
  expect(openModelPicker).toHaveBeenCalledOnce();
});

test("no model at all points to Settings → Models", () => {
  const { gate, notify, openModelSettings } = makeGate();
  gate.setStatus("none");
  gate.allowPrompt();
  const notice = notify.mock.calls[0][0];
  expect(notice.message).toBe("composer.sendNoModelHint");
  notice.action.onClick();
  expect(openModelSettings).toHaveBeenCalledOnce();
});

test("a repeated send keeps one note, and picking a model clears it", () => {
  const { gate, sendButton, notify, dismiss } = makeGate();
  gate.setStatus("unselected");
  gate.allowPrompt();
  gate.allowPrompt();
  expect(notify).toHaveBeenCalledTimes(2);
  expect(dismiss).toHaveBeenCalledOnce();

  gate.setStatus("ready");
  expect(dismiss).toHaveBeenCalledTimes(2);
  expect(sendButton.hasAttribute("aria-disabled")).toBe(false);
  expect(sendButton.title).toBe("input.send");
  expect(gate.allowPrompt()).toBe(true);
});
