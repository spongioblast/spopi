// ABOUTME: Tests settings controls.
// ABOUTME: Includes "renders a section title".
import { describe, expect, it, vi } from "vitest";
import { numberField, row, sectionTitle, select, textField, toggle } from "./settings-controls.js";

describe("settings controls", () => {
  it("renders a section title", () => {
    const node = sectionTitle("Terminal");
    expect(node.className).toBe("settings-section-title");
    expect(node.textContent).toBe("Terminal");
  });

  it("renders a row with a description and a control", () => {
    const control = document.createElement("button");
    const node = row({
      id: "setting-shell",
      label: "Shell",
      description: "New terminals",
      control,
    });
    expect(node.id).toBe("setting-shell");
    expect(node.querySelector(".settings-label-main").textContent).toBe("Shell");
    expect(node.querySelector(".settings-label-sub").textContent).toBe("New terminals");
    expect(node.contains(control)).toBe(true);
  });

  it("toggles and reports the next state", () => {
    const onChange = vi.fn();
    const button = toggle({ id: "toggle-auto-compact", checked: false, onChange });
    document.body.append(button);
    expect(button.classList.contains("on")).toBe(false);
    button.click();
    expect(button.classList.contains("on")).toBe(true);
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(onChange).toHaveBeenCalledWith(true);
    button.remove();
  });

  it("fires select, number, and text changes", () => {
    const onSelect = vi.fn();
    const onNumber = vi.fn();
    const onText = vi.fn();
    const menu = select({
      id: "settings-terminal-theme-select",
      label: "Theme",
      options: [
        { value: "auto", label: "Auto" },
        { value: "dark", label: "Dark" },
      ],
      value: "auto",
      onChange: onSelect,
    });
    menu.value = "dark";
    menu.dispatchEvent(new Event("change"));
    expect(onSelect).toHaveBeenCalledWith("dark");

    const number = numberField({ id: "scrollback", value: 1000, onChange: onNumber });
    number.value = "2000";
    number.dispatchEvent(new Event("change"));
    expect(onNumber).toHaveBeenCalledWith(2000);

    const field = textField({ id: "host", value: "", onChange: onText });
    field.value = "example.com";
    field.dispatchEvent(new Event("input"));
    expect(onText).toHaveBeenCalledWith("example.com");
  });
});
