// ABOUTME: Tests enhanceSelect.
// ABOUTME: The case titles in this file name what it checks.
import { afterEach, describe, expect, it } from "vitest";
import { enhanceSelect } from "./select-menu.js";

function mountSelect(html = "") {
  document.body.innerHTML = `
    <select id="choice" class="ui-select" aria-label="Choice">
      <option value="a">Alpha</option>
      <option value="b">Beta</option>
      <option value="c">Gamma</option>
      ${html}
    </select>
  `;
  return document.getElementById("choice");
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("enhanceSelect", () => {
  it("keeps the native select and renders a styled trigger from the selected option", () => {
    const select = mountSelect();
    enhanceSelect(select);

    expect(document.getElementById("choice")).toBe(select);
    expect(select.classList.contains("ui-select-native")).toBe(true);
    expect(select.closest(".ui-select-menu")).not.toBeNull();
    expect(document.querySelector(".ui-select-value")?.textContent).toBe("Alpha");
    expect(document.querySelector(".ui-select[role='combobox']")).not.toBeNull();
  });

  it("opens a listbox and commits the chosen value through the native select", () => {
    const select = mountSelect();
    const changes = [];
    select.addEventListener("change", () => changes.push(select.value));
    enhanceSelect(select);

    document.querySelector(".ui-select[role='combobox']").click();
    const options = document.querySelectorAll(".ui-select-option");
    expect(options).toHaveLength(3);
    expect(options[1].textContent).toBe("Beta");

    options[1].click();
    expect(select.value).toBe("b");
    expect(changes).toEqual(["b"]);
    expect(document.querySelector(".ui-select-value")?.textContent).toBe("Beta");
    expect(document.querySelector(".ui-select-popover")?.hidden).toBe(true);
  });

  it("updates the trigger when native options or value change", () => {
    const select = mountSelect();
    enhanceSelect(select);

    select.replaceChildren();
    const zh = document.createElement("option");
    zh.value = "zh";
    zh.textContent = "中文";
    zh.selected = true;
    select.append(zh);
    select.dispatchEvent(new Event("change"));

    expect(document.querySelector(".ui-select-value")?.textContent).toBe("中文");
  });

  it("is idempotent and closes on Escape", () => {
    const select = mountSelect();
    const first = enhanceSelect(select);
    expect(enhanceSelect(select)).toBe(first);

    document.querySelector(".ui-select[role='combobox']").click();
    expect(document.querySelector(".ui-select-popover")?.hidden).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".ui-select-popover")?.hidden).toBe(true);
  });
});
