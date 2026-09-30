// ABOUTME: Tests large-paste composer offers without starting native app bootstrap.
// ABOUTME: Covers threshold detection, inline dismissal, range replacement, and failures.

import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountComposerPasteOffload,
  PASTE_OFFLOAD_BYTE_THRESHOLD,
} from "./composer-paste-offload.js";

function setupDom() {
  const dom = new JSDOM('<div class="composer"><textarea></textarea></div>');
  const document = dom.window.document;
  return {
    dom,
    document,
    container: document.querySelector(".composer"),
    textarea: document.querySelector("textarea"),
  };
}

function paste(dom, textarea, text, start = textarea.value.length, end = start) {
  textarea.setSelectionRange(start, end);
  const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  textarea.dispatchEvent(event);
  textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

const t = (key, params = {}) =>
  ({
    "input.pasteDetected": `Pasted ${params.size}`,
    "input.pasteAsFile": "Attach as file",
    "input.keepInline": "Keep inline",
    "input.pasteOffloadFailed": "Could not save pasted text",
  })[key] ?? key;

describe("mountComposerPasteOffload", () => {
  let refs;

  beforeEach(() => {
    refs = setupDom();
  });

  it("does not show an offer below threshold", () => {
    const offload = vi.fn();
    mountComposerPasteOffload({ ...refs, offload, t });
    paste(refs.dom, refs.textarea, "x".repeat(PASTE_OFFLOAD_BYTE_THRESHOLD - 1));
    expect(refs.container.querySelector(".paste-offload-prompt").classList.contains("hidden")).toBe(
      true,
    );
    expect(offload).not.toHaveBeenCalled();
  });

  it("keeps large pasted text inline when dismissed", () => {
    const offload = vi.fn();
    mountComposerPasteOffload({ ...refs, offload, t });
    const text = "x".repeat(PASTE_OFFLOAD_BYTE_THRESHOLD);
    paste(refs.dom, refs.textarea, text);
    refs.container.querySelector(".paste-offload-keep-inline").click();
    expect(refs.textarea.value).toBe(text);
    expect(offload).not.toHaveBeenCalled();
  });

  it("replaces only confirmed pasted range with an @ reference", async () => {
    const text = "x".repeat(PASTE_OFFLOAD_BYTE_THRESHOLD);
    const offload = vi.fn().mockResolvedValue(".pi/tmp/paste-20260821-143205.txt");
    mountComposerPasteOffload({ ...refs, offload, t });
    refs.textarea.value = "before after";
    paste(refs.dom, refs.textarea, text, 7, 7);
    refs.container.querySelector(".paste-offload-as-file").click();
    await Promise.resolve();
    expect(offload).toHaveBeenCalledWith(text);
    expect(refs.textarea.value).toBe("before \n@.pi/tmp/paste-20260821-143205.txt\nafter");
  });

  it("marks composer busy during offload and clears it after success", async () => {
    let resolveOffload;
    const offload = vi.fn(() => new Promise((resolve) => (resolveOffload = resolve)));
    const controller = mountComposerPasteOffload({ ...refs, offload, t });
    const text = "x".repeat(PASTE_OFFLOAD_BYTE_THRESHOLD);
    paste(refs.dom, refs.textarea, text);
    refs.container.querySelector(".paste-offload-as-file").click();
    expect(controller.isBusy()).toBe(true);
    expect(refs.textarea.dataset.pasteOffloadBusy).toBe("true");
    resolveOffload(".pi/tmp/paste-20260821-143205.txt");
    await Promise.resolve();
    expect(controller.isBusy()).toBe(false);
    expect(refs.textarea.dataset.pasteOffloadBusy).toBeUndefined();
  });

  it("leaves textarea unchanged when offload fails", async () => {
    const offload = vi.fn().mockRejectedValue(new Error("write failed"));
    mountComposerPasteOffload({ ...refs, offload, t });
    const text = "x".repeat(PASTE_OFFLOAD_BYTE_THRESHOLD);
    paste(refs.dom, refs.textarea, text);
    refs.container.querySelector(".paste-offload-as-file").click();
    await Promise.resolve();
    expect(refs.textarea.value).toBe(text);
    expect(refs.container.querySelector(".paste-offload-prompt").textContent).toContain(
      "Could not save pasted text",
    );
  });
});
