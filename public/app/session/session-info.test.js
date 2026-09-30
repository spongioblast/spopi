// ABOUTME: Tests session info display.
// ABOUTME: Includes "shows the file basename and keeps the full path for copy and hover".
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import englishMessages from "../../locales/en.json";
import { createI18n } from "../i18n/i18n.js";
import { describeSessionFile, describeSessionId, mountSessionInfo } from "./session-info.js";

describe("session info display", () => {
  it("shows the file basename and keeps the full path for copy and hover", () => {
    expect(describeSessionFile("/sessions/a.jsonl", "In memory")).toEqual({
      text: "a.jsonl",
      title: "/sessions/a.jsonl",
      copyValue: "/sessions/a.jsonl",
    });
  });

  it("uses the in-memory label when no file exists", () => {
    expect(describeSessionFile("", "In memory")).toEqual({
      text: "In memory",
      title: "",
      copyValue: "In memory",
    });
  });

  it("keeps the full session id for display, hover, and copy", () => {
    expect(describeSessionId("session-a", "Unavailable")).toEqual({
      text: "session-a",
      title: "session-a",
      copyValue: "session-a",
    });
  });
});

describe("session info", () => {
  beforeAll(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => englishMessages }),
    );
    await createI18n();
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="toggle" aria-expanded="false"></button>
      <section id="panel" class="hidden"><span id="file"></span><span id="id"></span></section>`;
  });

  it("shows the active session file and id", () => {
    document.getElementById("toggle").getBoundingClientRect = () => ({ bottom: 40, right: 900 });
    mountSessionInfo({
      toggle: document.getElementById("toggle"),
      panel: document.getElementById("panel"),
      fileValue: document.getElementById("file"),
      idValue: document.getElementById("id"),
      getTarget: () => ({ sessionId: "session-a" }),
      getSessions: () => [{ id: "session-a", filePath: "/sessions/a.jsonl" }],
    });

    document.getElementById("toggle").click();

    expect(document.getElementById("file").textContent).toBe("a.jsonl");
    expect(document.getElementById("file").getAttribute("title")).toBe("/sessions/a.jsonl");
    expect(document.getElementById("id").textContent).toBe("session-a");
    expect(document.getElementById("toggle").getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("panel").parentElement).toBe(document.body);
    expect(document.getElementById("panel").style.position).toBe("fixed");
    expect(document.getElementById("panel").style.top).toBe("48px");
  });

  it("uses an in-memory label before a session file exists", () => {
    mountSessionInfo({
      toggle: document.getElementById("toggle"),
      panel: document.getElementById("panel"),
      fileValue: document.getElementById("file"),
      idValue: document.getElementById("id"),
      getTarget: () => ({ sessionId: "temporary-a" }),
      getSessions: () => [],
    });

    document.getElementById("toggle").click();
    expect(document.getElementById("file").textContent).toContain("not saved yet");
    expect(document.getElementById("id").textContent).toBe("temporary-a");
  });

  it("copies the requested session field", async () => {
    const panel = document.getElementById("panel");
    panel.insertAdjacentHTML(
      "beforeend",
      '<button data-copy-session-field="file"></button><button data-copy-session-field="id"></button>',
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    mountSessionInfo({
      toggle: document.getElementById("toggle"),
      panel,
      fileValue: document.getElementById("file"),
      idValue: document.getElementById("id"),
      getTarget: () => ({ sessionId: "session-a" }),
      getSessions: () => [{ id: "session-a", filePath: "/sessions/a.jsonl" }],
      writeText,
    });

    document.getElementById("toggle").click();
    panel.querySelector('[data-copy-session-field="file"]').click();
    panel.querySelector('[data-copy-session-field="id"]').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    expect(writeText).toHaveBeenNthCalledWith(1, "/sessions/a.jsonl");
    expect(writeText).toHaveBeenNthCalledWith(2, "session-a");
  });
});
