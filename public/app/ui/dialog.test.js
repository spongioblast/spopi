// ABOUTME: Tests dialog escape stack.
// ABOUTME: Includes "closes on Escape and reports ownership".
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeTop,
  confirmDialog,
  createDialogEscape,
  dialogOwnsEscape,
  openDialog,
  promptDialog,
} from "./dialog.js";

describe("dialog escape stack", () => {
  const unbinders = [];

  afterEach(() => {
    for (const unbind of unbinders.splice(0)) unbind();
    document.body.innerHTML = "";
  });

  it("closes on Escape and reports ownership", () => {
    const onClose = vi.fn();
    unbinders.push(createDialogEscape(onClose));
    expect(dialogOwnsEscape()).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the topmost active dialog first", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    unbinders.push(createDialogEscape(outer));
    unbinders.push(createDialogEscape(inner));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("skips inactive entries so hidden dialogs do not steal Escape", () => {
    const hidden = vi.fn();
    const visible = vi.fn();
    unbinders.push(createDialogEscape(hidden, { isActive: () => false }));
    unbinders.push(createDialogEscape(visible, { isActive: () => true }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(hidden).not.toHaveBeenCalled();
    expect(visible).toHaveBeenCalledTimes(1);
  });

  it("does not close when Escape was already handled", () => {
    const onClose = vi.fn();
    unbinders.push(createDialogEscape(onClose));
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closeTop dismisses only the top dialog", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    unbinders.push(createDialogEscape(outer));
    unbinders.push(createDialogEscape(inner));
    expect(closeTop()).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe("openDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses initialFocus and closes on Escape", () => {
    const root = document.createElement("div");
    root.id = "dialog-container";
    root.className = "hidden";
    document.body.append(root);
    const input = document.createElement("input");
    const onClose = vi.fn();
    const opened = openDialog({
      title: "Rename",
      body: input,
      actions: [{ label: "Cancel", onClick: () => opened.close() }],
      onClose,
      initialFocus: input,
      container: root,
    });
    expect(document.activeElement).toBe(input);
    expect(root.classList.contains("hidden")).toBe(false);
    expect(opened.element.getAttribute("aria-modal")).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.classList.contains("hidden")).toBe(true);
    expect(dialogOwnsEscape()).toBe(false);
  });

  it("closes when the backdrop is clicked", () => {
    const root = document.createElement("div");
    root.id = "dialog-container";
    document.body.append(root);
    const onClose = vi.fn();
    openDialog({ title: "Confirm", body: document.createElement("p"), onClose, container: root });
    root.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the opener and runs the primary action on Enter", () => {
    const root = document.createElement("div");
    root.id = "dialog-container";
    document.body.append(root);
    const opener = document.createElement("button");
    opener.type = "button";
    document.body.append(opener);
    opener.focus();
    const onPrimary = vi.fn();
    const opened = openDialog({
      title: "Confirm",
      body: document.createElement("p"),
      actions: [
        { label: "Cancel", onClick: () => opened.close() },
        { label: "OK", primary: true, onClick: onPrimary },
      ],
      container: root,
    });
    opened.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    opened.close();
    expect(document.activeElement).toBe(opener);
  });
});

describe("promptDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves the trimmed text or null on cancel", async () => {
    const root = document.createElement("div");
    root.id = "dialog-container";
    document.body.append(root);
    const pending = promptDialog({ title: "Name", value: "  draft  " });
    const input = document.querySelector(".dialog-field input");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await expect(pending).resolves.toBe("draft");

    const cancelled = promptDialog({ title: "Name" });
    document.querySelector(".dialog-actions .ui-button--secondary")?.click();
    await expect(cancelled).resolves.toBeNull();
  });
});

describe("confirmDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves true on the danger confirm", async () => {
    const root = document.createElement("div");
    root.id = "dialog-container";
    document.body.append(root);
    const pending = confirmDialog({ message: "Delete?", danger: true });
    document.querySelector(".ui-button--danger")?.click();
    await expect(pending).resolves.toBe(true);
  });
});
