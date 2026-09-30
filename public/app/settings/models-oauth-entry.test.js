// ABOUTME: Ensures the Subscriptions → OpenAI Codex card starts in-app OAuth.
// ABOUTME: Guards the dead-click path where the picker closed with no login dialog.

import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mountModelsPage } from "./models-page.js";

describe("OpenAI Codex OAuth picker entry", () => {
  let dom;

  beforeEach(() => {
    dom = new JSDOM(`
      <div id="settings-api-keys"></div>
      <span id="inline-models-path"></span>
      <textarea id="inline-models-textarea"></textarea>
      <div id="inline-models-error" class="hidden"></div>
      <button id="inline-models-save">Save</button>
      <a id="models-config-docs-link"></a>
      <div id="dialog-container" class="hidden"></div>
    `);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.confirm;
  });

  test("clicking the Codex subscription card opens the login dialog immediately", async () => {
    const call = vi.fn(async (operation) => {
      if (operation === "list_model_catalog") {
        return {
          ok: true,
          data: {
            providers: [
              {
                provider: "openai-codex",
                displayName: "OpenAI Codex",
                configured: false,
                source: "oauth",
                models: [],
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const command = vi.fn(
      () =>
        new Promise(() => {
          // Stay pending: the dialog must appear before this resolves.
        }),
    );
    const { loadApiKeysPanel } = mountModelsPage({
      configGateway: { call },
      oauthGateway: {
        command,
        subscribe: () => () => {},
      },
    });

    await loadApiKeysPanel();
    document.querySelector(".models-provider-add").click();

    const card = [...document.querySelectorAll(".provider-picker-card")].find((node) =>
      node.textContent.includes("OpenAI Codex"),
    );
    expect(card).toBeTruthy();
    card.click();

    await Promise.resolve();
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start_oauth_login",
        provider: "openai-codex",
        method: "device_code",
      }),
      undefined,
    );
    expect(document.querySelector(".oauth-login-dialog-title")?.textContent).toMatch(
      /Preparing|settings\.models\.oauth\.preparing/,
    );
  });
});
