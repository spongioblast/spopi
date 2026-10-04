// ABOUTME: Settings → Models renders providers, API keys, and models.json.
// ABOUTME: The models page module fills those sections when the tab opens.

import { t, translateSubtree } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { sectionTitle } from "../ui/settings-controls.js";
import { mountModelsPage } from "./models-page.js";

/**
 * @typedef {object} ModelsSettingsDeps
 * @property {{ call: (op: string, params?: unknown, options?: unknown) => Promise<unknown> } | null | undefined} [configGateway]
 * @property {{
 *   command: (frame: Record<string, unknown>, options?: unknown) => Promise<unknown>,
 *   subscribe: (handler: (envelope: unknown) => void) => (() => void),
 * } | null | undefined} [oauthGateway]
 * @property {((url: string) => Promise<unknown>) | null | undefined} [openExternal]
 * @property {((change?: { providers?: string[], renamed?: { from: string, to: string } }) => Promise<void> | void) | null | undefined} [onModelConfigurationChanged]
 */

/**
 * @typedef {{
 *   apiKeys: Element | null,
 *   docsLink: HTMLAnchorElement | Element | null,
 *   path: Element | null,
 *   textarea: HTMLTextAreaElement | Element | null,
 *   error: Element | null,
 *   save: HTMLButtonElement | Element | null,
 *   insertExample: HTMLButtonElement | Element | null,
 * }} ModelsSettingsRefs
 */

/**
 * @param {Element | null | undefined} root
 * @param {ModelsSettingsDeps} [deps]
 */
export function mountModelsSettings(root, deps) {
  if (!root) return { refresh() {}, destroy() {} };
  root.replaceChildren(
    el(
      "div",
      {
        class: "settings-header",
      },
      [
        el(
          "h3",
          {
            "data-i18n": "settings.models.title",
          },
          ["Models"],
        ),
      ],
    ),
    el(
      "div",
      {
        class: "settings-body",
      },
      [
        el(
          "div",
          {
            class: "settings-section ui-card",
          },
          [
            sectionTitle("Providers", { i18n: "settings.authentication" }),
            el(
              "p",
              {
                class: "settings-help",
              },
              [
                el(
                  "span",
                  {
                    "data-i18n": "settings.auth.helpPre",
                  },
                  ["Keys are stored locally in"],
                ),
                el(
                  "code",
                  {
                    "data-i18n": "shell.piAgentAuthJson",
                  },
                  ["~/.pi/agent/auth.json"],
                ),
                el(
                  "span",
                  {
                    "data-i18n": /Windows/i.test(navigator.userAgent)
                      ? "settings.auth.helpPostWindows"
                      : "settings.auth.helpPost",
                  },
                  [
                    t(
                      /Windows/i.test(navigator.userAgent)
                        ? "settings.auth.helpPostWindows"
                        : "settings.auth.helpPost",
                    ),
                  ],
                ),
              ],
            ),
            el(
              "div",
              {
                class: "settings-api-keys",
                id: "settings-api-keys",
              },
              [
                el(
                  "div",
                  {
                    class: "settings-api-keys-loading ui-loading",
                    role: "status",
                    "aria-live": "polite",
                    "aria-busy": "true",
                    "data-i18n": "settings.loadingProviders",
                  },
                  ["Loading providers…"],
                ),
              ],
            ),
          ],
        ),
        el(
          "div",
          {
            class: "settings-section ui-card",
          },
          [
            sectionTitle("LLM providers", { i18n: "settings.llmProviders" }),
            el(
              "p",
              {
                class: "settings-help",
              },
              [
                el(
                  "span",
                  {
                    "data-i18n": "settings.models.helpPre",
                  },
                  ["Edit"],
                ),
                el(
                  "code",
                  {
                    "data-i18n": "shell.piAgentModelsJson",
                  },
                  ["~/.pi/agent/models.json"],
                ),
                el(
                  "span",
                  {
                    "data-i18n": "settings.models.helpPost1",
                  },
                  [
                    "to add custom providers (Ollama, vLLM, LM Studio, OpenAI-compatible proxies, OpenRouter routing overrides, etc). See the",
                  ],
                ),
                el(
                  "a",
                  {
                    href: "https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/models.md",
                    id: "models-config-docs-link",
                    target: "_blank",
                    rel: "noopener noreferrer",
                    "data-i18n": "settings.models.docsLink",
                  },
                  ["models.json docs"],
                ),
                el(
                  "span",
                  {
                    "data-i18n": "settings.models.helpPost2",
                  },
                  ["for the full schema. Changes are picked up immediately — no restart needed."],
                ),
              ],
            ),
            el(
              "div",
              {
                class: "settings-config-meta",
              },
              [
                el(
                  "span",
                  {
                    class: "settings-label",
                    "data-i18n": "settings.providersFile",
                  },
                  ["Providers file"],
                ),
                el("span", {
                  class: "settings-static-value",
                  id: "inline-models-path",
                }),
              ],
            ),
            el("textarea", {
              class: "ui-textarea config-editor-textarea settings-config-textarea",
              id: "inline-models-textarea",
              spellcheck: "false",
              autocomplete: "off",
              autocorrect: "off",
              autocapitalize: "off",
              placeholder: '{ "providers": { ... } }',
              "data-i18n-ph": "shell.providersPlaceholder",
            }),
            el(
              "div",
              {
                class: "settings-config-actions",
              },
              [
                el("div", {
                  class: "config-editor-error settings-save-status hidden",
                  id: "inline-models-error",
                  "aria-live": "polite",
                  role: "status",
                }),
                el(
                  "div",
                  {
                    class: "settings-config-button-group",
                  },
                  [
                    el(
                      "button",
                      {
                        class: "ui-button ui-button--secondary",
                        id: "inline-models-insert-example",
                        "data-i18n": "actions.insertExample",
                      },
                      ["Insert example"],
                    ),
                    el(
                      "button",
                      {
                        class: "ui-button ui-button--primary",
                        id: "inline-models-save",
                        "data-i18n": "shell.save",
                      },
                      ["Save"],
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ],
    ),
  );
  translateSubtree(root);
  const editors = deps?.configGateway
    ? mountModelsPage({
        configGateway: deps.configGateway,
        oauthGateway: deps.oauthGateway ?? undefined,
        onModelConfigurationChanged: deps.onModelConfigurationChanged,
        openExternal: deps.openExternal,
      })
    : null;
  return {
    refresh() {
      translateSubtree(root);
    },
    destroy() {
      root.replaceChildren();
    },
    loadApiKeysPanel: editors?.loadApiKeysPanel,
    loadInlineModelsEditor: editors?.loadInlineModelsEditor,
    loadOAuthCapability: editors?.loadOAuthCapability,
  };
}

/**
 * Models form nodes this page creates. The models editor asks here.
 *
 * @param {ParentNode} [root]
 * @returns {ModelsSettingsRefs}
 */
export function modelsSettingsRefs(root = document) {
  return {
    apiKeys: root.querySelector("#settings-api-keys"),
    docsLink: root.querySelector("#models-config-docs-link"),
    path: root.querySelector("#inline-models-path"),
    textarea: root.querySelector("#inline-models-textarea"),
    error: root.querySelector("#inline-models-error"),
    save: root.querySelector("#inline-models-save"),
    insertExample: root.querySelector("#inline-models-insert-example"),
  };
}
