// ABOUTME: Tests stripAnsi.
// ABOUTME: Includes "removes SGR colour codes but keeps the text".
import { beforeEach, describe, expect, it } from "vitest";
import { ExtensionWidgets, stripAnsi } from "./extension-widgets.js";

const ESC = String.fromCharCode(27);

function setup() {
  document.body.innerHTML = `
    <div class="extension-widgets hidden" id="above"></div>
    <div class="extension-widgets hidden" id="below"></div>
  `;
  const above = document.getElementById("above");
  const below = document.getElementById("below");
  return {
    above,
    below,
    widgets: new ExtensionWidgets({ aboveEditor: above, belowEditor: below }),
  };
}

const request = (widgetKey, widgetLines, widgetPlacement) => ({
  type: "extension_ui_request",
  method: "setWidget",
  widgetKey,
  widgetLines,
  widgetPlacement,
});

describe("stripAnsi", () => {
  it("removes SGR colour codes but keeps the text", () => {
    expect(stripAnsi(`${ESC}[2mBuild: running${ESC}[0m`)).toBe("Build: running");
  });
});

describe("ExtensionWidgets", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders widget lines and reveals the container", () => {
    const { below, widgets } = setup();
    widgets.apply(request("build", ["Build: running", "Tools: read, grep"]));

    expect(below.classList.contains("hidden")).toBe(false);
    expect(below.querySelectorAll(".extension-widget")).toHaveLength(1);
    expect(below.textContent).toContain("Build: running");
    expect(below.textContent).toContain("Tools: read, grep");
  });

  it("honours the requested placement and defaults to belowEditor", () => {
    const { above, below, widgets } = setup();
    widgets.apply(request("a", ["above me"], "aboveEditor"));
    widgets.apply(request("b", ["below me"]));

    expect(above.textContent).toContain("above me");
    expect(above.textContent).not.toContain("below me");
    expect(below.textContent).toContain("below me");
  });

  it("removes a widget when lines are undefined and re-hides the container", () => {
    const { below, widgets } = setup();
    widgets.apply(request("build", ["visible"]));
    widgets.apply(request("build", undefined));

    expect(below.classList.contains("hidden")).toBe(true);
    expect(below.querySelectorAll(".extension-widget")).toHaveLength(0);
  });

  it("keeps widgets from different extensions side by side and updates in place", () => {
    const { below, widgets } = setup();
    widgets.apply(request("one", ["first"]));
    widgets.apply(request("two", ["second"]));
    widgets.apply(request("one", ["first updated"]));

    const rendered = [...below.querySelectorAll(".extension-widget")];
    expect(rendered.map((node) => node.dataset.widgetKey)).toEqual(["one", "two"]);
    expect(rendered[0].textContent).toBe("first updated");
  });

  it("strips terminal colour codes before rendering", () => {
    const { below, widgets } = setup();
    widgets.apply(request("styled", [`${ESC}[31mdanger${ESC}[0m`]));

    expect(below.textContent).toBe("danger");
  });

  it("ignores requests without a widget key", () => {
    const { below, widgets } = setup();
    widgets.apply(request(undefined, ["orphan"]));

    expect(below.querySelectorAll(".extension-widget")).toHaveLength(0);
  });

  it("clear() drops every widget", () => {
    const { above, below, widgets } = setup();
    widgets.apply(request("a", ["above"], "aboveEditor"));
    widgets.apply(request("b", ["below"]));
    widgets.clear();

    expect(above.classList.contains("hidden")).toBe(true);
    expect(below.classList.contains("hidden")).toBe(true);
  });
});
