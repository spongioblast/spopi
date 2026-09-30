// ABOUTME: Tests process details expansion.
// ABOUTME: Also covers flagging a thinking-only row for Show thinking off.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { captureExpandedProcessGroups, createProcessDetailsGroup } from "./process-group.js";

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  );
  await createI18n();
  document.body.replaceChildren();
});

describe("process details expansion", () => {
  it("survives a history redraw while an assistant response is streaming", () => {
    const messages = document.createElement("div");
    const first = createProcessDetailsGroup();
    const second = createProcessDetailsGroup();
    messages.append(first.wrapper, second.wrapper);

    second.wrapper.querySelector("button").click();
    const expandedGroups = captureExpandedProcessGroups(messages);

    messages.replaceChildren();
    messages.append(
      createProcessDetailsGroup({ expanded: expandedGroups.has(0) }).wrapper,
      createProcessDetailsGroup({ expanded: expandedGroups.has(1) }).wrapper,
    );

    expect(messages.children[0].classList.contains("expanded")).toBe(false);
    expect(messages.children[1].classList.contains("expanded")).toBe(true);
    expect(messages.children[1].querySelector("button").getAttribute("aria-expanded")).toBe("true");
  });

  it("flags a row that is only thinking, so Show thinking off can hide it", () => {
    const group = createProcessDetailsGroup();
    group.body.innerHTML =
      '<div class="message assistant history"><div class="message-content"><div class="thinking-block">plan</div></div></div>';
    group.flagThinkingOnly();
    expect(group.wrapper.classList.contains("thinking-only")).toBe(true);

    group.body.insertAdjacentHTML("beforeend", '<div class="tool-card">read a.js</div>');
    group.flagThinkingOnly();
    expect(group.wrapper.classList.contains("thinking-only")).toBe(false);
  });
});
