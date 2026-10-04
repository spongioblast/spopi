// ABOUTME: Verifies local action icons use one accessible Lucide-style SVG contract.
// ABOUTME: Icons are decorative; their buttons own localized accessible names.
import { expect, test } from "vitest";
import { createIcon, setButtonIcon } from "./icons.js";

test("creates local action icons with the shared SVG contract", () => {
  const icon = createIcon("save", { size: 14 });
  expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(icon?.getAttribute("stroke")).toBe("currentColor");
  expect(icon?.getAttribute("stroke-linecap")).toBe("round");
  expect(icon?.getAttribute("aria-hidden")).toBe("true");
});

test("creates icons in a supplied document for isolated views", () => {
  const ownerDocument = document.implementation.createHTMLDocument("isolated");
  const icon = createIcon("arrow-up", { document: ownerDocument, size: 12 });
  expect(icon?.ownerDocument).toBe(ownerDocument);
  expect(icon?.getAttribute("width")).toBe("12");
});

test("replaces decorative button content without changing its accessible name", () => {
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Save file");
  button.textContent = "Save";
  setButtonIcon(button, "save");
  expect(button.getAttribute("aria-label")).toBe("Save file");
  expect(button.querySelector("svg")).not.toBeNull();
});

test("exposes distinct maximize and minimize glyphs", () => {
  const maximize = createIcon("maximize");
  const minimize = createIcon("minimize");
  for (const icon of [maximize, minimize]) {
    expect(icon, "action icon must exist").not.toBeNull();
    expect(icon?.querySelectorAll("*").length).toBeGreaterThan(0);
  }
  expect(maximize?.isEqualNode(minimize)).toBe(false);
});

test("sidebar and File panel icons match the Lucide v1 geometry", () => {
  expect(createIcon("folder-plus")?.querySelector("path")?.getAttribute("d")).toBe("M12 10v6");
  expect(createIcon("arrow-up")?.querySelector("path")?.getAttribute("d")).toBe("m5 12 7-7 7 7");
  expect(createIcon("folder-open")?.querySelector("path")?.getAttribute("d")).toContain(
    "m6 14 1.5-2.9",
  );
});

test("git-info matches shared Git repository indicator geometry", () => {
  const icon = createIcon("git-info");
  expect(icon?.querySelector('line[x1="6"][y1="3"][x2="6"][y2="15"]')).not.toBeNull();
  expect(icon?.querySelector('circle[cx="18"][cy="6"]')).not.toBeNull();
  expect(icon?.querySelector('circle[cx="6"][cy="18"]')).not.toBeNull();
  expect(icon?.querySelector('path[d="M18 9a9 9 0 0 1-9 9"]')).not.toBeNull();
});

test("circle-info matches the Info panel toolbar geometry", () => {
  const icon = createIcon("circle-info");
  expect(icon?.querySelector("circle")?.getAttribute("r")).toBe("10");
  expect(icon?.querySelector('path[d="M12 16v-4"]')).not.toBeNull();
  expect(icon?.querySelector('path[d="M12 8h.01"]')).not.toBeNull();
});

test("every action glyph follows the 24x24 currentColor round-stroke contract", () => {
  for (const name of ["maximize", "minimize", "box", "arrow-up"]) {
    const icon = createIcon(name);
    expect(icon, `${name} must exist`).not.toBeNull();
    expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon?.getAttribute("stroke")).toBe("currentColor");
    expect(icon?.getAttribute("stroke-linecap")).toBe("round");
    expect(icon?.getAttribute("stroke-linejoin")).toBe("round");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  }
});
