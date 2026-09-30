// ABOUTME: Tests syncMessagesInsets.
// ABOUTME: The case titles in this file name what it checks.
import { describe, expect, test } from "vitest";
import { syncMessagesInsets } from "./layout-insets.js";

describe("syncMessagesInsets", () => {
  test("uses the live header and composer heights instead of hard-coded message padding", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");
    const workspaceContent = document.createElement("div");

    syncMessagesInsets({
      main,
      messages,
      header,
      inputArea,
      workspaceContent,
      measureHeight: (element) => {
        if (element === header) return 92;
        if (element === inputArea) return 118;
        return 0;
      },
    });

    expect(main.style.getPropertyValue("--messages-top-inset")).toBe("104px");
    expect(main.style.getPropertyValue("--messages-bottom-inset")).toBe("130px");
    expect(messages.style.getPropertyValue("scroll-padding-top")).toBe("104px");
    expect(messages.style.getPropertyValue("scroll-padding-bottom")).toBe("130px");
    expect(workspaceContent.style.getPropertyValue("--workspace-header-offset")).toBe("92px");
  });

  test("never shrinks message padding below the base safe insets", () => {
    const main = document.createElement("div");
    const messages = document.createElement("div");
    const header = document.createElement("div");
    const inputArea = document.createElement("div");
    const workspaceContent = document.createElement("div");

    syncMessagesInsets({
      main,
      messages,
      header,
      inputArea,
      workspaceContent,
      measureHeight: () => 20,
    });

    expect(main.style.getPropertyValue("--messages-top-inset")).toBe("32px");
    expect(main.style.getPropertyValue("--messages-bottom-inset")).toBe("32px");
    expect(workspaceContent.style.getPropertyValue("--workspace-header-offset")).toBe("20px");
  });
});
