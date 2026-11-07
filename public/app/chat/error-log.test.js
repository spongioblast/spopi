// ABOUTME: Tests the collected-errors strip: count header, dedupe, expand, dismiss, clear.
// ABOUTME: The strip collects transport errors instead of stacking them into the transcript.

import { beforeEach, describe, expect, it } from "vitest";
import { clearErrorLog, mountErrorLog, pushErrorLog } from "./error-log.js";

/** @type {HTMLDivElement} */
let container;

beforeEach(() => {
  clearErrorLog();
  container = document.createElement("div");
  container.className = "error-log hidden";
  mountErrorLog(container);
});

describe("error log", () => {
  it("stays hidden with nothing to show", () => {
    expect(container.classList.contains("hidden")).toBe(true);
    expect(container.children).toHaveLength(0);
  });

  it("shows the newest error on a collapsed header and stays collapsed", () => {
    pushErrorLog("Pi RPC request failed: Timeout");

    expect(container.classList.contains("hidden")).toBe(false);
    expect(container.querySelector(".error-log-latest")?.textContent).toBe(
      "Pi RPC request failed: Timeout",
    );
    expect(container.querySelector(".error-log-clear")).not.toBeNull();
    expect(container.querySelector(".error-log-list")).toBeNull();
  });

  it("folds a repeated message into a count instead of a new row", () => {
    pushErrorLog("Timeout");
    pushErrorLog("Timeout");
    container.querySelector(".error-log-header")?.dispatchEvent(new Event("click"));

    const rows = container.querySelectorAll(".error-log-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector(".error-log-badge")?.textContent).toBe("×2");
    expect(rows[0]?.querySelector(".error-log-time")?.textContent).toBeTruthy();
  });

  it("keeps a differing detail as its own row and shows it", () => {
    pushErrorLog("Timeout", "while Pi was working");
    pushErrorLog("Timeout");
    container.querySelector(".error-log-header")?.dispatchEvent(new Event("click"));

    const rows = container.querySelectorAll(".error-log-row");
    expect(rows).toHaveLength(2);
    const details = [...rows].map((r) => r.querySelector(".error-log-detail")?.textContent ?? "");
    expect(details).toContain("while Pi was working");
  });

  it("dismisses one row and clears all", () => {
    pushErrorLog("first");
    pushErrorLog("second");
    container.querySelector(".error-log-header")?.dispatchEvent(new Event("click"));
    expect(container.querySelectorAll(".error-log-row")).toHaveLength(2);

    container.querySelector(".error-log-row .error-log-dismiss")?.dispatchEvent(new Event("click"));
    expect(container.querySelectorAll(".error-log-row")).toHaveLength(1);

    container.querySelector(".error-log-clear")?.dispatchEvent(new Event("click"));
    expect(container.classList.contains("hidden")).toBe(true);
  });
});
