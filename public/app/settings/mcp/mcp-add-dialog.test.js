// ABOUTME: Tests the add-server dialog: themed selects, labelled inputs, the env-var hint, and the spec.
// ABOUTME: The host control is a stub; nothing reaches pi mcp.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/i18n.js";
import { openAddServerDialog } from "./mcp-add-dialog.js";

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

/** @param {HTMLInputElement} input @param {string} value */
function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("add-server dialog", () => {
  it("uses the themed select menus and keeps the env-var syntax in the hint", () => {
    openAddServerDialog({});
    const form = /** @type {HTMLElement} */ (document.querySelector(".mcp-add-form"));
    expect(form.querySelectorAll(".ui-select-menu")).toHaveLength(4);
    expect(form.querySelectorAll("select:not(.ui-select-native)")).toHaveLength(0);
    expect(form.textContent).toContain(`Use $${"{NAME}"} to read a value from your environment`);
    const argument = /** @type {HTMLInputElement} */ (form.querySelector(".mcp-arg-list input"));
    expect(argument.placeholder).toBe("Argument");
  });

  it("enables Add only once a command is typed, and sends the arguments as a list", async () => {
    const addMcpServer = vi.fn(async () => ({}));
    openAddServerDialog({ control: { addMcpServer }, workspaceId: "w1" });
    const form = /** @type {HTMLElement} */ (document.querySelector(".mcp-add-form"));
    const submit = /** @type {HTMLButtonElement} */ (
      document.querySelector(".dialog-actions .ui-button--primary")
    );
    const inputs = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll("input")]);
    type(inputs[0], "echo");
    type(/** @type {HTMLInputElement} */ (form.querySelector(".mcp-arg-list input")), "server.mjs");
    expect(submit.disabled).toBe(true);
    type(/** @type {HTMLInputElement} */ (form.querySelector("input[placeholder='npx']")), "node");
    expect(submit.disabled).toBe(false);
    submit.click();
    await vi.waitFor(() => expect(addMcpServer).toHaveBeenCalled());
    expect(addMcpServer.mock.calls[0][0]).toMatchObject({
      name: "echo",
      scope: "global",
      kind: "stdio",
      command: "node",
      args: ["server.mjs"],
    });
  });
});
