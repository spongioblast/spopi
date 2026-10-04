// ABOUTME: Tests the phone tab bar.
// ABOUTME: Covers phone-tabs.js button classes, the selected region, and the tab switches.

import { afterEach, beforeEach, expect, test } from "vitest";
import { mountPhoneTabs } from "./phone-tabs.js";

beforeEach(() => {
  document.body.dataset.layout = "phone";
});

afterEach(() => {
  document.body.replaceChildren();
  delete document.body.dataset.phoneRegion;
  delete document.body.dataset.layout;
});

test("phone tabs are ghost buttons and mark the current region", () => {
  const root = document.createElement("nav");
  document.body.append(root);
  const tabs = mountPhoneTabs(root);
  const chat = root.querySelector("[data-phone-region='chat']");
  expect(chat?.className).toContain("ui-button");
  expect(chat?.classList.contains("on")).toBe(true);
  expect(chat?.getAttribute("aria-current")).toBe("page");
  root.querySelector("[data-phone-region='changes']")?.click();
  expect(document.body.dataset.phoneRegion).toBe("changes");
  expect(document.body.dataset.centerMode).toBe("review");
  tabs.destroy();
});

test("opening a chat from the Sessions tab shows the chat", () => {
  const root = document.createElement("nav");
  document.body.append(root);
  const tabs = mountPhoneTabs(root);
  root.querySelector("[data-phone-region='sessions']")?.click();
  document.dispatchEvent(new CustomEvent("spopi-session-opened"));
  expect(document.body.dataset.phoneRegion).toBe("chat");
  expect(root.querySelector("[data-phone-region='chat']")?.classList.contains("on")).toBe(true);
  root.querySelector("[data-phone-region='changes']")?.click();
  document.dispatchEvent(new CustomEvent("spopi-session-opened"));
  expect(document.body.dataset.phoneRegion).toBe("changes");
  tabs.destroy();
});

test("opening Review from a chat's file card shows the Changes tab", () => {
  const root = document.createElement("nav");
  document.body.append(root);
  const tabs = mountPhoneTabs(root);
  root.querySelector("[data-phone-region='chat']")?.click();
  document.dispatchEvent(new CustomEvent("spopi-review-shown", { detail: { list: "review" } }));
  expect(document.body.dataset.phoneRegion).toBe("changes");
  expect(root.querySelector("[data-phone-region='changes']")?.classList.contains("on")).toBe(true);
  tabs.destroy();
});

test("a wider window keeps the phone's tab when Review or a chat opens", () => {
  document.body.dataset.layout = "wide";
  const root = document.createElement("nav");
  document.body.append(root);
  const tabs = mountPhoneTabs(root);
  document.dispatchEvent(new CustomEvent("spopi-review-shown", { detail: { list: "review" } }));
  expect(document.body.dataset.phoneRegion).toBe("chat");
  document.body.dataset.phoneRegion = "sessions";
  document.dispatchEvent(new CustomEvent("spopi-session-opened"));
  expect(document.body.dataset.phoneRegion).toBe("sessions");
  tabs.destroy();
});
