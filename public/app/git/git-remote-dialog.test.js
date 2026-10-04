// ABOUTME: Tests the remote dialog: the URL and name checks, and changing or removing a remote.
// ABOUTME: The Git client is a stub; nothing reaches git.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { isSafeRemoteName, isSafeRemoteUrl, openRemoteDialog } from "./git-remote-dialog.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

beforeEach(async () => {
  document.body.replaceChildren();
  const dialogs = document.createElement("div");
  dialogs.id = "dialog-container";
  dialogs.className = "hidden";
  document.body.append(dialogs);
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(enMessages)));
  await createI18n();
});

describe("remote checks", () => {
  it("accepts the URLs the host accepts", () => {
    for (const url of [
      "https://github.com/you/repo.git",
      "ssh://git@github.com/you/repo.git",
      "git@github.com:you/repo.git",
      "file:///srv/repo.git",
    ]) {
      expect(isSafeRemoteUrl(url), url).toBe(true);
    }
    for (const url of [
      "",
      "-uhack",
      "ext::sh -c id",
      "https://",
      "https://host/a b",
      "C:\\repos\\x.git",
      "github.com:you/repo.git",
      "git@host://evil",
    ]) {
      expect(isSafeRemoteUrl(url), url).toBe(false);
    }
    expect(isSafeRemoteName("origin")).toBe(true);
    for (const name of ["", "-x", ".x", "a/b", "a b", "x.lock"]) {
      expect(isSafeRemoteName(name), name).toBe(false);
    }
  });
});

describe("openRemoteDialog", () => {
  it("changes the URL of an existing remote", async () => {
    const sendAndAwait = vi.fn(async () => ({ type: "git_command_ack" }));
    const closed = openRemoteDialog({
      client: { sendAndAwait },
      remote: { name: "origin", url: "https://example.com/old.git" },
    });
    const dialog = /** @type {HTMLElement} */ (document.querySelector(".git-remote-dialog"));
    expect(dialog.querySelector(".dialog-title")?.textContent).toBe("Remote origin");
    expect(
      /** @type {HTMLInputElement} */ (dialog.querySelector(".git-remote-name")).disabled,
    ).toBe(true);
    expect(dialog.querySelector(".git-remote-publish")).toBeNull();
    const url = /** @type {HTMLInputElement} */ (dialog.querySelector(".git-remote-url"));
    url.value = "git@example.com:me/new.git";
    /** @type {HTMLButtonElement} */ (dialog.querySelector(".git-remote-save")).click();
    await closed;
    expect(sendAndAwait).toHaveBeenCalledWith({
      type: "remote_set_url",
      name: "origin",
      url: "git@example.com:me/new.git",
    });
  });

  it("removes a remote after confirmation", async () => {
    const sendAndAwait = vi.fn(async () => ({ type: "git_command_ack" }));
    const closed = openRemoteDialog({
      client: { sendAndAwait },
      remote: { name: "origin", url: "https://example.com/a.git" },
    });
    /** @type {HTMLButtonElement} */ (document.querySelector(".git-remote-remove")).click();
    await vi.waitFor(() => expect(document.querySelectorAll(".dialog")).toHaveLength(2));
    const confirm = /** @type {HTMLButtonElement} */ (
      document.querySelectorAll(".dialog")[1].querySelector(".ui-button--danger")
    );
    confirm.click();
    await closed;
    expect(sendAndAwait).toHaveBeenCalledWith({ type: "remote_remove", name: "origin" });
  });
});
