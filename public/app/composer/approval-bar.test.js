// ABOUTME: Tests the docked approval bar.
// ABOUTME: The first answer wins, including keys 1, 2, and 3.
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeWhenResolved } from "../extension-ui/dialog.js";
import {
  approvalChoices,
  mountApprovalBar,
  openDockedApproval,
  showApprovalOrDialog,
} from "./approval-bar.js";

describe("approval bar", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("uses the request options when they exist", () => {
    const choices = approvalChoices({
      method: "select",
      options: ["Allow once", "Always", "Deny"],
    });
    expect(choices.map((choice) => choice.label)).toEqual(["Allow once", "Always", "Deny"]);
    expect(choices[0]?.result).toEqual({ value: "Allow once" });
  });

  it("docks a permission select as a card with the command and named choices", async () => {
    const request = {
      method: "select",
      title:
        "Permission Required\ntool         : bash\nrule         : *\ncommand      : node --check app.js",
      options: ["Yes", 'Yes, allow bash "node *" for this session', "No", "No, provide reason"],
    };
    const host = document.createElement("div");
    host.id = "approval-bar";
    host.className = "hidden";
    document.body.append(host);
    const pending = showApprovalOrDialog(request, document.body);
    expect(host.classList.contains("hidden")).toBe(false);
    expect(host.querySelector(".approval-bar-title")?.textContent).toBe(
      "Pi wants to run a command",
    );
    expect(host.querySelector(".approval-bar-tool")?.textContent).toBe("bash");
    expect(host.querySelector(".approval-bar-subject")?.textContent).toBe("node --check app.js");
    const buttons = [...host.querySelectorAll(".approval-choice")];
    expect(
      buttons.map((button) => button.querySelector(".approval-choice-label")?.textContent),
    ).toEqual(["Allow once", 'Allow bash "node *" for this session', "Deny", "Deny with reason"]);
    expect(buttons.map((button) => button.querySelector("kbd")?.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(buttons[0]?.classList.contains("ui-button--primary")).toBe(true);
    expect(buttons[2]?.classList.contains("ui-button--danger")).toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
    host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await pending;
    expect(host.classList.contains("hidden")).toBe(true);
  });

  it("offers Allow once, Always, and Deny for a bare confirm", () => {
    const choices = approvalChoices({ method: "confirm", title: "Run tests?" });
    expect(choices.map((choice) => choice.label)).toEqual(["Allow once", "Always", "Deny"]);
    expect(choices[2]?.result).toEqual({ cancelled: true });
  });

  it("keeps the first answer and ignores the second", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onAnswer = vi.fn();
    mountApprovalBar(root, { method: "confirm", title: "Run tests?" }, { onAnswer });
    const buttons = root.querySelectorAll("button");
    buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    buttons[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ confirmed: true });
  });

  it("maps keys 1, 2, and 3 to the first three choices", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onAnswer = vi.fn();
    mountApprovalBar(
      root,
      { method: "select", title: "Pick", options: ["A", "B", "C"] },
      { onAnswer },
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ value: "B" });
  });

  it("returns null when the composer has no approval host", () => {
    expect(openDockedApproval({ method: "confirm" })).toBeNull();
  });

  it("counts down a request timeout and then cancels", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.append(root);
    const onAnswer = vi.fn();
    const handle = mountApprovalBar(
      root,
      { method: "confirm", title: "Run tests?", timeout: 2000 },
      { onAnswer },
    );
    expect(root.querySelector(".approval-bar-timeout")?.textContent).toBe("2s");
    vi.advanceTimersByTime(1000);
    expect(root.querySelector(".approval-bar-timeout")?.textContent).toBe("1s");
    vi.advanceTimersByTime(1000);
    expect(onAnswer).toHaveBeenCalledWith({ cancelled: true });
    handle.destroy();
    vi.useRealTimers();
  });

  it("closes the matching prompt when another client resolves it", () => {
    const finish = vi.fn();
    const stop = closeWhenResolved({ id: "req-1" }, finish);
    document.dispatchEvent(new CustomEvent("spopi-ui-resolved", { detail: { id: "other" } }));
    expect(finish).not.toHaveBeenCalled();
    document.dispatchEvent(new CustomEvent("spopi-ui-resolved", { detail: { id: "req-1" } }));
    expect(finish).toHaveBeenCalledWith({ cancelled: true });
    stop();
  });
});
